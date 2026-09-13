import { prisma } from '../../utils/prisma.js';
import { Role, LeadStatus, LeadSource, Priority, Prisma } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';
import { notificationEmitter } from '../notifications/notification.events.js';

export class LeadsService {
  /**
   * Section 9: Duplicate Lead / Existing User Check
   * Checks both mobile and email, returning complete past interactions if found.
   */
  static async checkDuplicate(mobile: string, email?: string) {
    const customerWhere: Prisma.CustomerWhereInput = {
      OR: [
        { phone: mobile },
        ...(email ? [{ email }] : []),
      ],
    };

    const existingCustomer = await prisma.customer.findFirst({
      where: customerWhere,
      include: {
        leads: {
          include: {
            assignedManager: { select: { id: true, name: true, phone: true } },
            assignedExecutive: { select: { id: true, name: true, phone: true } },
            calls: {
              take: 5,
              orderBy: { createdAt: 'desc' },
              select: { id: true, duration: true, outcome: true, callStatus: true, createdAt: true },
            },
            followUps: {
              take: 5,
              orderBy: { followUpDate: 'desc' },
              select: { id: true, followUpDate: true, type: true, status: true },
            },
            visits: {
              take: 5,
              orderBy: { visitDate: 'desc' },
              select: { id: true, visitDate: true, address: true, status: true },
            },
            bookings: {
              take: 3,
              select: { id: true, bookingNumber: true, amount: true, paymentStatus: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!existingCustomer || existingCustomer.leads.length === 0) {
      return { existingFound: false };
    }

    const latestLead = existingCustomer.leads[0];

    return {
      existingFound: true,
      customer: {
        id: existingCustomer.id,
        name: existingCustomer.name,
        phone: existingCustomer.phone,
        email: existingCustomer.email,
        city: existingCustomer.city,
      },
      latestLead: {
        id: latestLead.id,
        leadNumber: latestLead.leadNumber,
        source: latestLead.source,
        status: latestLead.status,
        createdAt: latestLead.createdAt,
        assignedManager: latestLead.assignedManager,
        assignedExecutive: latestLead.assignedExecutive,
        callsCount: latestLead.calls.length,
        recentCalls: latestLead.calls,
        recentFollowUps: latestLead.followUps,
        recentVisits: latestLead.visits,
        bookings: latestLead.bookings,
      },
      allPreviousLeads: existingCustomer.leads.map((l) => ({
        id: l.id,
        leadNumber: l.leadNumber,
        source: l.source,
        status: l.status,
        createdAt: l.createdAt,
      })),
    };
  }

  /**
   * Create a new Lead with automatic Customer link or creation
   */
  static async createLead(data: any, createdById: string) {
    // 1. Find or create Customer
    let customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { phone: data.mobile },
          ...(data.email ? [{ email: data.email }] : []),
        ],
      },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: data.name,
          phone: data.mobile,
          email: data.email || null,
          alternatePhone: data.alternateMobile || null,
          city: data.city || null,
          address: data.address || null,
        },
      });
    }

    // 2. Generate Lead Number (LD-YYYY-XXXX)
    const count = await prisma.lead.count();
    const currentYear = new Date().getFullYear();
    const leadNumber = `LD-${currentYear}-${String(count + 1).padStart(4, '0')}`;

    // 3. Create Lead
    const lead = await prisma.lead.create({
      data: {
        leadNumber,
        customerId: customer.id,
        source: data.source || LeadSource.META,
        status: data.assignedExecutiveId ? LeadStatus.ASSIGNED : LeadStatus.NEW,
        priority: data.priority || Priority.MEDIUM,
        remarks: data.remarks || null,
        createdById,
        assignedManagerId: data.assignedManagerId || null,
        assignedExecutiveId: data.assignedExecutiveId || null,
      },
      include: {
        customer: true,
        assignedManager: { select: { id: true, name: true } },
        assignedExecutive: { select: { id: true, name: true } },
      },
    });

    // 4. Record Activity Timeline
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        activityType: 'LEAD_CREATED',
        description: `Lead created from source ${lead.source}`,
        performedById: createdById,
        metadata: { source: lead.source, customerId: customer.id },
      },
    });

    // If initially assigned, log assignment
    if (data.assignedExecutiveId) {
      await prisma.leadAssignment.create({
        data: {
          leadId: lead.id,
          previousExecutiveId: null,
          newExecutiveId: data.assignedExecutiveId,
          assignedById: createdById,
          reason: 'Initial assignment upon lead creation',
        },
      });

      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          activityType: 'LEAD_ASSIGNED',
          description: `Assigned to executive upon creation`,
          performedById: createdById,
          metadata: { assignedExecutiveId: data.assignedExecutiveId },
        },
      });

      notificationEmitter.emit('lead.assigned', {
        leadId: lead.id,
        newExecutiveId: data.assignedExecutiveId,
        assignedById: createdById,
        reason: 'Initial assignment upon lead creation',
        leadNumber: lead.leadNumber,
        customerName: customer.name,
      });
    }

    await logAudit({
      userId: createdById,
      action: 'LEAD_CREATED',
      entity: 'Lead',
      entityId: lead.id,
      newValue: { leadNumber: lead.leadNumber, source: lead.source },
    });

    return lead;
  }

  /**
   * List leads with role-based restrictions, pagination, filters, and search
   */
  static async listLeads(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: LeadStatus;
      source?: LeadSource;
      priority?: Priority;
      managerId?: string;
      executiveId?: string;
      from?: string;
      to?: string;
    },
    user: { id: string; role: Role; managerId?: string | null }
  ) {
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {};

    // Role-based boundary
    if (user.role === Role.EXECUTIVE) {
      where.assignedExecutiveId = user.id;
    } else if (user.role === Role.MANAGER) {
      // Manager sees leads assigned to their team
      where.OR = [
        { assignedManagerId: user.id },
        { assignedExecutive: { managerId: user.id } },
      ];
    } else if (params.managerId) {
      where.assignedManagerId = params.managerId;
    }

    if (params.executiveId && user.role !== Role.EXECUTIVE) {
      where.assignedExecutiveId = params.executiveId;
    }

    if (params.status) where.status = params.status;
    if (params.source) where.source = params.source;
    if (params.priority) where.priority = params.priority;

    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }

    if (params.search) {
      where.OR = [
        { leadNumber: { contains: params.search, mode: 'insensitive' } },
        { customer: { name: { contains: params.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: params.search, mode: 'insensitive' } } },
        { customer: { email: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: true,
          assignedManager: { select: { id: true, name: true, employeeId: true } },
          assignedExecutive: { select: { id: true, name: true, employeeId: true } },
          _count: {
            select: {
              calls: true,
              followUps: true,
              visits: true,
              bookings: true,
              notes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      leads,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single lead detail with complete timeline
   */
  static async getLeadById(id: string, user: { id: string; role: Role }) {
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        customer: true,
        assignedManager: { select: { id: true, name: true, email: true, phone: true } },
        assignedExecutive: { select: { id: true, name: true, email: true, phone: true } },
        assignments: {
          include: {
            previousExecutive: { select: { id: true, name: true } },
            newExecutive: { select: { id: true, name: true } },
            assignedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: {
            performedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        notes: {
          include: {
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        calls: {
          include: {
            executive: { select: { id: true, name: true } },
            recording: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        callbacks: {
          orderBy: { callbackDate: 'desc' },
        },
        followUps: {
          orderBy: { followUpDate: 'desc' },
        },
        visits: {
          include: {
            revisits: true,
          },
          orderBy: { visitDate: 'desc' },
        },
        bookings: {
          include: {
            invoices: true,
            payments: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        lossRecords: true,
      },
    });

    if (!lead) {
      throw { statusCode: 404, message: 'Lead not found', errorCode: 'LEAD_NOT_FOUND' };
    }

    // Role security check
    if (user.role === Role.EXECUTIVE && lead.assignedExecutiveId !== user.id) {
      throw { statusCode: 403, message: 'Access to this lead is denied', errorCode: 'FORBIDDEN' };
    }

    return lead;
  }

  /**
   * Update lead status and record immutable timeline event
   */
  static async updateStatus(
    id: string,
    newStatus: LeadStatus,
    remarks?: string,
    lossReason?: string,
    estimatedLossAmount?: number,
    user?: { id: string; role: Role }
  ) {
    const currentLead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, status: true, assignedManagerId: true, assignedExecutiveId: true },
    });

    if (!currentLead) {
      throw { statusCode: 404, message: 'Lead not found', errorCode: 'LEAD_NOT_FOUND' };
    }

    const previousStatus = currentLead.status;

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: {
        status: newStatus,
        remarks: remarks || undefined,
        lastContactAt: new Date(),
      },
      include: {
        customer: true,
      },
    });

    // Record immutable LeadActivity
    await prisma.leadActivity.create({
      data: {
        leadId: id,
        activityType: 'STATUS_CHANGED',
        description: `Status changed from ${previousStatus} to ${newStatus}${remarks ? `: ${remarks}` : ''}`,
        performedById: user?.id || null,
        metadata: { previousStatus, newStatus, remarks },
      },
    });

    // If marked LOST, create LossRecord
    if (newStatus === LeadStatus.LOST && lossReason) {
      await prisma.lossRecord.create({
        data: {
          leadId: id,
          reason: lossReason,
          estimatedLossAmount: estimatedLossAmount || 0,
          managerId: currentLead.assignedManagerId,
          executiveId: currentLead.assignedExecutiveId,
          remarks,
        },
      });
    }

    await logAudit({
      userId: user?.id,
      action: 'LEAD_STATUS_CHANGED',
      entity: 'Lead',
      entityId: id,
      oldValue: { status: previousStatus },
      newValue: { status: newStatus, remarks },
    });

    notificationEmitter.emit('lead.status.changed', {
      leadId: id,
      leadNumber: updatedLead.leadNumber,
      previousStatus,
      newStatus,
      customerName: updatedLead.customer?.name,
      managerId: currentLead.assignedManagerId,
      executiveId: currentLead.assignedExecutiveId,
      remarks,
    });

    return updatedLead;
  }

  /**
   * Add a note to a lead
   */
  static async addNote(leadId: string, noteText: string, userId: string) {
    const note = await prisma.leadNote.create({
      data: {
        leadId,
        authorId: userId,
        note: noteText,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId,
        activityType: 'NOTE_ADDED',
        description: `Note added: ${noteText.length > 50 ? noteText.substring(0, 50) + '...' : noteText}`,
        performedById: userId,
        metadata: { noteId: note.id },
      },
    });

    return note;
  }
}

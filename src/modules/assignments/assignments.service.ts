import { prisma } from '../../utils/prisma.js';
import { LeadStatus, Role } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';

export class AssignmentsService {
  static async assignOrReassign(params: {
    leadId: string;
    newExecutiveId: string;
    reason: string;
    assignedById: string;
    assignedByRole: Role;
  }) {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
      include: {
        assignedExecutive: { select: { id: true, name: true } },
      },
    });

    if (!lead) {
      throw { statusCode: 404, message: 'Lead not found', errorCode: 'LEAD_NOT_FOUND' };
    }

    const newExecutive = await prisma.user.findUnique({
      where: { id: params.newExecutiveId },
      select: { id: true, name: true, role: true, managerId: true },
    });

    if (!newExecutive || newExecutive.role !== Role.EXECUTIVE) {
      throw { statusCode: 400, message: 'Selected user is not an executive', errorCode: 'INVALID_EXECUTIVE' };
    }

    const isReassignment = !!lead.assignedExecutiveId;
    const previousExecutiveId = lead.assignedExecutiveId;
    const previousExecutiveName = lead.assignedExecutive?.name || 'Unassigned';

    // 1. Create LeadAssignment record
    const assignment = await prisma.leadAssignment.create({
      data: {
        leadId: params.leadId,
        previousExecutiveId,
        newExecutiveId: params.newExecutiveId,
        assignedById: params.assignedById,
        reason: params.reason,
      },
      include: {
        newExecutive: { select: { id: true, name: true } },
        previousExecutive: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
      },
    });

    // 2. Update Lead
    const updatedLead = await prisma.lead.update({
      where: { id: params.leadId },
      data: {
        assignedExecutiveId: params.newExecutiveId,
        status: lead.status === LeadStatus.NEW ? LeadStatus.ASSIGNED : lead.status,
      },
    });

    // 3. Record Immutable Activity
    const activityType = isReassignment ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED';
    const description = isReassignment
      ? `Reassigned from ${previousExecutiveName} to ${newExecutive.name}. Reason: ${params.reason}`
      : `Assigned to ${newExecutive.name}. Reason: ${params.reason}`;

    await prisma.leadActivity.create({
      data: {
        leadId: params.leadId,
        activityType,
        description,
        performedById: params.assignedById,
        metadata: {
          previousExecutiveId,
          newExecutiveId: params.newExecutiveId,
          reason: params.reason,
        },
      },
    });

    // 4. Create in-app notification for the newly assigned executive
    await prisma.notification.create({
      data: {
        userId: params.newExecutiveId,
        title: isReassignment ? 'Lead Reassigned to You' : 'New Lead Assigned',
        body: `Lead ${lead.leadNumber} has been assigned to you.`,
        type: isReassignment ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED',
        metadata: { leadId: lead.id, leadNumber: lead.leadNumber },
      },
    });

    // 5. Audit Log
    await logAudit({
      userId: params.assignedById,
      action: activityType,
      entity: 'Lead',
      entityId: lead.id,
      oldValue: { assignedExecutiveId: previousExecutiveId },
      newValue: { assignedExecutiveId: params.newExecutiveId, reason: params.reason },
    });

    return {
      assignment,
      lead: updatedLead,
    };
  }

  static async getAssignmentHistory(leadId: string) {
    return prisma.leadAssignment.findMany({
      where: { leadId },
      include: {
        previousExecutive: { select: { id: true, name: true, employeeId: true } },
        newExecutive: { select: { id: true, name: true, employeeId: true } },
        assignedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

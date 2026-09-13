import { prisma } from '../../utils/prisma.js';
import { FollowUpStatus, Role } from '@prisma/client';
import { notificationEmitter } from '../notifications/notification.events.js';

export class FollowUpsService {
  static async createFollowUp(data: any, executiveId: string) {
    const followUp = await prisma.followUp.create({
      data: {
        leadId: data.leadId,
        executiveId,
        followUpDate: new Date(data.followUpDate),
        followUpTime: data.followUpTime || null,
        type: data.type || 'GENERAL',
        remarks: data.remarks || null,
        status: FollowUpStatus.PENDING,
      },
      include: {
        lead: {
          select: {
            leadNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
      },
    });

    await prisma.lead.update({
      where: { id: data.leadId },
      data: { nextFollowUpAt: new Date(data.followUpDate) },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: data.leadId,
        activityType: 'FOLLOWUP_CREATED',
        description: `Follow-up created for ${data.followUpDate.split('T')[0]}. Remarks: ${data.remarks || 'None'}`,
        performedById: executiveId,
        metadata: { followUpId: followUp.id },
      },
    });

    // Emit notification event
    notificationEmitter.emit('followup.created', {
      followUpId: followUp.id,
      leadId: followUp.leadId,
      executiveId,
      followUpDate: data.followUpDate.split('T')[0],
      customerName: followUp.lead.customer?.name,
    });

    return followUp;
  }

  static async updateFollowUp(id: string, data: any, userId: string) {
    const followUp = await prisma.followUp.update({
      where: { id },
      data: {
        status: data.status,
        remarks: data.remarks || undefined,
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: followUp.leadId,
        activityType: 'FOLLOWUP_UPDATED',
        description: `Follow-up marked as ${data.status}`,
        performedById: userId,
        metadata: { status: data.status },
      },
    });

    return followUp;
  }

  static async listFollowUps(user: { id: string; role: Role }) {
    const where: any = {};
    if (user.role === Role.EXECUTIVE) {
      where.executiveId = user.id;
    }

    return prisma.followUp.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            leadNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
        executive: { select: { id: true, name: true } },
      },
      orderBy: { followUpDate: 'asc' },
    });
  }
}

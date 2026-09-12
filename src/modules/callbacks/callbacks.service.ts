import { prisma } from '../../utils/prisma.js';
import { CallbackStatus, Role } from '@prisma/client';

export class CallbacksService {
  static async createCallback(data: any, executiveId: string) {
    const callback = await prisma.callback.create({
      data: {
        leadId: data.leadId,
        assignedExecutiveId: executiveId,
        callbackDate: new Date(data.callbackDate),
        callbackTime: data.callbackTime,
        reason: data.reason || null,
        remarks: data.remarks || null,
        status: CallbackStatus.SCHEDULED,
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

    // Update lead's next follow-up pointer
    await prisma.lead.update({
      where: { id: data.leadId },
      data: { nextFollowUpAt: new Date(data.callbackDate) },
    });

    // Record activity timeline
    await prisma.leadActivity.create({
      data: {
        leadId: data.leadId,
        activityType: 'CALLBACK_SCHEDULED',
        description: `Callback scheduled for ${data.callbackDate.split('T')[0]} at ${data.callbackTime}`,
        performedById: executiveId,
        metadata: { callbackId: callback.id },
      },
    });

    return callback;
  }

  static async updateCallback(id: string, data: any, userId: string) {
    const callback = await prisma.callback.update({
      where: { id },
      data: {
        status: data.status,
        remarks: data.remarks || undefined,
        ...(data.newDate && { callbackDate: new Date(data.newDate) }),
        ...(data.newTime && { callbackTime: data.newTime }),
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: callback.leadId,
        activityType: 'CALLBACK_UPDATED',
        description: `Callback marked as ${data.status}`,
        performedById: userId,
        metadata: { status: data.status, remarks: data.remarks },
      },
    });

    return callback;
  }

  static async listCallbacks(user: { id: string; role: Role }) {
    const where: any = {};
    if (user.role === Role.EXECUTIVE) {
      where.assignedExecutiveId = user.id;
    }

    return prisma.callback.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            leadNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
        assignedExecutive: { select: { id: true, name: true } },
      },
      orderBy: { callbackDate: 'asc' },
    });
  }
}

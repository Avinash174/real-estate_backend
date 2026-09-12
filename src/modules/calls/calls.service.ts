import { prisma } from '../../utils/prisma.js';
import { CallOutcome, CallStatus, Role } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';

export class CallsService {
  static async logCall(params: {
    leadId: string;
    executiveId: string;
    phoneNumber: string;
    duration: number;
    callStatus: CallStatus;
    outcome: CallOutcome;
    recordingUrl?: string | null;
    remarks?: string | null;
    providerCallId?: string | null;
  }) {
    const lead = await prisma.lead.findUnique({
      where: { id: params.leadId },
    });

    if (!lead) {
      throw { statusCode: 404, message: 'Lead not found', errorCode: 'LEAD_NOT_FOUND' };
    }

    const call = await prisma.call.create({
      data: {
        leadId: params.leadId,
        executiveId: params.executiveId,
        phoneNumber: params.phoneNumber,
        duration: params.duration,
        callStatus: params.callStatus,
        outcome: params.outcome,
        recordingUrl: params.recordingUrl || null,
        remarks: params.remarks || null,
      },
    });

    // If recording URL or provider call ID is provided, create CallRecording record
    if (params.recordingUrl || params.providerCallId) {
      await prisma.callRecording.create({
        data: {
          callId: call.id,
          recordingUrl: params.recordingUrl || '',
          recordingDuration: params.duration,
          providerCallId: params.providerCallId || null,
        },
      });
    }

    // Update Lead last contact time
    await prisma.lead.update({
      where: { id: params.leadId },
      data: { lastContactAt: new Date() },
    });

    // Record immutable activity timeline
    await prisma.leadActivity.create({
      data: {
        leadId: params.leadId,
        activityType: 'CALL_MADE',
        description: `Call ${params.callStatus.toLowerCase()} (${params.outcome}). Duration: ${params.duration}s. Remarks: ${params.remarks || 'None'}`,
        performedById: params.executiveId,
        metadata: {
          callId: call.id,
          outcome: params.outcome,
          duration: params.duration,
          hasRecording: !!params.recordingUrl,
        },
      },
    });

    await logAudit({
      userId: params.executiveId,
      action: 'CALL_LOGGED',
      entity: 'Call',
      entityId: call.id,
      newValue: { outcome: params.outcome, duration: params.duration },
    });

    return call;
  }

  static async listCalls(params: {
    page?: number;
    limit?: number;
    leadId?: string;
    executiveId?: string;
    outcome?: CallOutcome;
  }, user: { id: string; role: Role }) {
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (user.role === Role.EXECUTIVE) {
      where.executiveId = user.id;
    } else if (params.executiveId) {
      where.executiveId = params.executiveId;
    }

    if (params.leadId) where.leadId = params.leadId;
    if (params.outcome) where.outcome = params.outcome;

    const [total, calls] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({
        where,
        skip,
        take: limit,
        include: {
          executive: { select: { id: true, name: true, employeeId: true } },
          lead: {
            select: {
              id: true,
              leadNumber: true,
              customer: { select: { name: true, phone: true } },
            },
          },
          recording: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      calls,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async attachRecordingWebhook(data: {
    providerCallId: string;
    recordingUrl: string;
    duration: number;
  }) {
    const recording = await prisma.callRecording.findFirst({
      where: { providerCallId: data.providerCallId },
    });

    if (recording) {
      await prisma.callRecording.update({
        where: { id: recording.id },
        data: {
          recordingUrl: data.recordingUrl,
          recordingDuration: data.duration,
        },
      });

      await prisma.call.update({
        where: { id: recording.callId },
        data: { recordingUrl: data.recordingUrl, duration: data.duration },
      });

      return { success: true, updated: true };
    }

    return { success: false, message: 'Provider call ID not linked' };
  }
}

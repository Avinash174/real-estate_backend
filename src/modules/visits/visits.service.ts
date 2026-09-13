import { prisma } from '../../utils/prisma.js';
import { VisitStatus, LeadStatus, Role } from '@prisma/client';
import { calculateDistanceMeters } from '../../utils/geo.js';
import { logAudit } from '../../utils/audit.js';
import { notificationEmitter } from '../notifications/notification.events.js';

export class VisitsService {
  static async scheduleVisit(data: any, executiveId: string) {
    const visit = await prisma.visit.create({
      data: {
        leadId: data.leadId,
        executiveId,
        visitDate: new Date(data.visitDate),
        visitTime: data.visitTime || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        address: data.address,
        remarks: data.remarks || null,
        status: VisitStatus.SCHEDULED,
      },
      include: {
        lead: { select: { leadNumber: true, customer: { select: { name: true, phone: true } } } },
      },
    });

    // Update lead pipeline status to VISIT
    await prisma.lead.update({
      where: { id: data.leadId },
      data: { status: LeadStatus.VISIT, nextFollowUpAt: new Date(data.visitDate) },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: data.leadId,
        activityType: 'VISIT_SCHEDULED',
        description: `Visit scheduled at ${data.address} for ${data.visitDate.split('T')[0]}`,
        performedById: executiveId,
        metadata: { visitId: visit.id, address: data.address },
      },
    });

    // Emit notification event
    notificationEmitter.emit('visit.scheduled', {
      visitId: visit.id,
      leadId: visit.leadId,
      executiveId,
      visitDate: data.visitDate.split('T')[0],
      visitTime: data.visitTime,
      address: data.address,
      customerName: visit.lead.customer?.name,
    });

    return visit;
  }

  static async startVisit(id: string, coords: { latitude: number; longitude: number; accuracy?: number }, executiveId: string) {
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { lead: true },
    });

    if (!visit) {
      throw { statusCode: 404, message: 'Visit not found', errorCode: 'VISIT_NOT_FOUND' };
    }

    if (visit.executiveId !== executiveId) {
      throw { statusCode: 403, message: 'Only the assigned executive can check-in', errorCode: 'FORBIDDEN' };
    }

    // Geofence check if target coordinates are defined
    if (visit.latitude && visit.longitude) {
      const distance = calculateDistanceMeters(
        visit.latitude,
        visit.longitude,
        coords.latitude,
        coords.longitude
      );

      // Check setting
      const radiusSetting = await prisma.systemSetting.findUnique({
        where: { key: 'VISIT_GEOFENCE_RADIUS_METERS' },
      });
      const maxRadius = radiusSetting ? parseFloat(radiusSetting.value) : 200;

      if (distance > maxRadius) {
        throw {
          statusCode: 400,
          message: `Check-in location is ${Math.round(distance)}m away from property. Allowed radius is ${maxRadius}m.`,
          errorCode: 'GEOFENCE_VIOLATION',
        };
      }
    }

    const updatedVisit = await prisma.visit.update({
      where: { id },
      data: {
        status: VisitStatus.STARTED,
        checkInLatitude: coords.latitude,
        checkInLongitude: coords.longitude,
        checkInTime: new Date(),
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: visit.leadId,
        activityType: 'VISIT_STARTED',
        description: `Visit started. Checked-in at coordinates (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})`,
        performedById: executiveId,
        metadata: { visitId: visit.id, ...coords },
      },
    });

    return updatedVisit;
  }

  static async completeVisit(id: string, data: { latitude: number; longitude: number; remarks: string }, executiveId: string) {
    const visit = await prisma.visit.findUnique({
      where: { id },
    });

    if (!visit) {
      throw { statusCode: 404, message: 'Visit not found', errorCode: 'VISIT_NOT_FOUND' };
    }

    const updatedVisit = await prisma.visit.update({
      where: { id },
      data: {
        status: VisitStatus.COMPLETED,
        checkOutLatitude: data.latitude,
        checkOutLongitude: data.longitude,
        checkOutTime: new Date(),
        remarks: data.remarks,
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: visit.leadId,
        activityType: 'VISIT_COMPLETED',
        description: `Visit completed. Remarks: ${data.remarks}`,
        performedById: executiveId,
        metadata: { visitId: visit.id, remarks: data.remarks },
      },
    });

    notificationEmitter.emit('visit.completed', {
      visitId: visit.id,
      leadId: visit.leadId,
      executiveId,
      remarks: data.remarks,
    });

    return updatedVisit;
  }

  static async scheduleRevisit(data: any, executiveId: string) {
    const revisit = await prisma.revisit.create({
      data: {
        visitId: data.visitId || null,
        leadId: data.leadId,
        executiveId,
        revisitDate: new Date(data.revisitDate),
        revisitTime: data.revisitTime || null,
        location: data.location || null,
        reason: data.reason,
        remarks: data.remarks || null,
        status: VisitStatus.SCHEDULED,
      },
    });

    // Update lead status to REVISIT
    await prisma.lead.update({
      where: { id: data.leadId },
      data: { status: LeadStatus.REVISIT, nextFollowUpAt: new Date(data.revisitDate) },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: data.leadId,
        activityType: 'REVISIT_SCHEDULED',
        description: `Revisit scheduled for ${data.revisitDate.split('T')[0]}. Reason: ${data.reason}`,
        performedById: executiveId,
        metadata: { revisitId: revisit.id, reason: data.reason },
      },
    });

    return revisit;
  }

  static async listVisits(user: { id: string; role: Role }) {
    const where: any = {};
    if (user.role === Role.EXECUTIVE) {
      where.executiveId = user.id;
    }

    return prisma.visit.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            leadNumber: true,
            customer: { select: { name: true, phone: true } },
          },
        },
        executive: { select: { id: true, name: true, employeeId: true } },
        revisits: true,
      },
      orderBy: { visitDate: 'desc' },
    });
  }
}

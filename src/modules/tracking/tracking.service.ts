import { prisma } from '../../utils/prisma.js';
import { TrackingStatus, Role } from '@prisma/client';
import { emitLocationUpdate } from '../../socket.js';
import { logger } from '../../utils/logger.js';

export class TrackingService {
  /**
   * Check if current time is within configured working hours (e.g. 09:00 - 19:00)
   */
  static async isWithinWorkingHours(): Promise<boolean> {
    const [startSetting, endSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'WORKING_HOURS_START' } }),
      prisma.systemSetting.findUnique({ where: { key: 'WORKING_HOURS_END' } }),
    ]);

    const start = startSetting?.value || '09:00';
    const end = endSetting?.value || '19:00';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  /**
   * Executive mobile location update
   */
  static async updateLocation(params: {
    userId: string;
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
    batteryLevel?: number | null;
    status: TrackingStatus;
    timestamp?: string;
  }) {
    // 1. Working hours check
    const withinHours = await this.isWithinWorkingHours();
    let effectiveStatus = params.status;
    if (!withinHours && params.status === TrackingStatus.TRACKING) {
      effectiveStatus = TrackingStatus.PAUSED;
      logger.info(`Tracking paused for user ${params.userId}: Outside working hours`);
    }

    const timestamp = params.timestamp ? new Date(params.timestamp) : new Date();

    // 2. Fetch executive user details
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, name: true, employeeId: true, managerId: true },
    });

    if (!user) {
      throw { statusCode: 404, message: 'Executive not found', errorCode: 'USER_NOT_FOUND' };
    }

    // 3. Upsert high-performance Current Location table
    const currentLocation = await prisma.employeeCurrentLocation.upsert({
      where: { employeeId: params.userId },
      update: {
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
        speed: params.speed,
        heading: params.heading,
        batteryLevel: params.batteryLevel,
        status: effectiveStatus,
        lastUpdatedAt: timestamp,
      },
      create: {
        employeeId: params.userId,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
        speed: params.speed,
        heading: params.heading,
        batteryLevel: params.batteryLevel,
        status: effectiveStatus,
        lastUpdatedAt: timestamp,
      },
    });

    // 4. Save to history table for breadcrumb route rendering (only when tracking is active)
    if (effectiveStatus === TrackingStatus.TRACKING) {
      await prisma.employeeLocationHistory.create({
        data: {
          employeeId: params.userId,
          latitude: params.latitude,
          longitude: params.longitude,
          accuracy: params.accuracy,
          speed: params.speed,
          heading: params.heading,
          batteryLevel: params.batteryLevel,
          timestamp,
        },
      });
    }

    // 5. Emit real-time Socket.IO event to authorized Admin and Team Manager rooms
    emitLocationUpdate({
      employeeId: user.id,
      name: user.name,
      employeeCode: user.employeeId,
      managerId: user.managerId,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy: params.accuracy,
      speed: params.speed,
      batteryLevel: params.batteryLevel,
      status: effectiveStatus,
      lastUpdatedAt: timestamp,
    });

    return {
      currentLocation,
      isWithinWorkingHours: withinHours,
    };
  }

  /**
   * Get live executive locations for Admin or Manager map
   */
  static async getLiveTracking(user: { id: string; role: Role; managerId?: string | null }) {
    const userWhere: any = {
      role: Role.EXECUTIVE,
      status: 'ACTIVE',
    };

    if (user.role === Role.MANAGER) {
      userWhere.managerId = user.id;
    }

    const executives = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        employeeId: true,
        name: true,
        phone: true,
        managerId: true,
        manager: { select: { id: true, name: true } },
        currentLocation: true,
        visits: {
          where: {
            visitDate: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lte: new Date(new Date().setHours(23, 59, 59, 999)),
            },
          },
          select: {
            id: true,
            status: true,
            address: true,
            visitTime: true,
            lead: { select: { leadNumber: true, customer: { select: { name: true } } } },
          },
        },
        _count: {
          select: {
            assignedLeads: true,
          },
        },
      },
    });

    return executives.map((e) => ({
      id: e.id,
      name: e.name,
      employeeId: e.employeeId,
      phone: e.phone,
      manager: e.manager?.name || 'Unassigned',
      location: e.currentLocation
        ? {
            latitude: e.currentLocation.latitude,
            longitude: e.currentLocation.longitude,
            accuracy: e.currentLocation.accuracy,
            speed: e.currentLocation.speed,
            batteryLevel: e.currentLocation.batteryLevel,
            status: e.currentLocation.status,
            lastUpdatedAt: e.currentLocation.lastUpdatedAt,
          }
        : null,
      todayVisits: {
        total: e.visits.length,
        completed: e.visits.filter((v) => v.status === 'COMPLETED').length,
        pending: e.visits.filter((v) => v.status === 'SCHEDULED' || v.status === 'STARTED').length,
        list: e.visits,
      },
      assignedLeadsCount: e._count.assignedLeads,
    }));
  }

  /**
   * Get location history and route stops for an executive on a specific date
   */
  static async getHistory(executiveId: string, dateStr?: string, requestingUser?: { id: string; role: Role }) {
    // Role check: Manager can only view their team
    if (requestingUser?.role === Role.MANAGER) {
      const exec = await prisma.user.findUnique({
        where: { id: executiveId },
        select: { managerId: true },
      });
      if (exec?.managerId !== requestingUser.id) {
        throw { statusCode: 403, message: 'You can only view history for your team', errorCode: 'FORBIDDEN' };
      }
    }

    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const [history, visits] = await Promise.all([
      prisma.employeeLocationHistory.findMany({
        where: {
          employeeId: executiveId,
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.visit.findMany({
        where: {
          executiveId,
          visitDate: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          id: true,
          status: true,
          address: true,
          checkInLatitude: true,
          checkInLongitude: true,
          checkInTime: true,
          checkOutTime: true,
          remarks: true,
          lead: { select: { leadNumber: true, customer: { select: { name: true } } } },
        },
      }),
    ]);

    return {
      date: startOfDay.toISOString().split('T')[0],
      totalPoints: history.length,
      route: history.map((h) => ({
        latitude: h.latitude,
        longitude: h.longitude,
        speed: h.speed,
        timestamp: h.timestamp,
      })),
      stops: visits,
    };
  }
}

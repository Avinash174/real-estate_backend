import bcrypt from 'bcryptjs';
import { prisma } from '../../utils/prisma.js';
import { Role, AccountStatus, Prisma } from '@prisma/client';
import { logAudit } from '../../utils/audit.js';

export class UsersService {
  static async listUsers(params: {
    page?: number;
    limit?: number;
    role?: Role;
    status?: AccountStatus;
    search?: string;
    managerId?: string;
  }) {
    const page = Math.max(Number(params.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (params.role) where.role = params.role;
    if (params.status) where.status = params.status;
    if (params.managerId) where.managerId = params.managerId;

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search, mode: 'insensitive' } },
        { employeeId: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          employeeId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          designation: true,
          managerId: true,
          manager: {
            select: { id: true, name: true, employeeId: true },
          },
          currentLocation: {
            select: {
              status: true,
              latitude: true,
              longitude: true,
              lastUpdatedAt: true,
            },
          },
          _count: {
            select: {
              assignedLeads: true,
              managedLeads: true,
              teamMembers: true,
            },
          },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      users,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async listManagers() {
    return prisma.user.findMany({
      where: { role: Role.MANAGER, status: AccountStatus.ACTIVE },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        designation: true,
        _count: { select: { teamMembers: true, managedLeads: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  static async listExecutives(managerId?: string) {
    const where: Prisma.UserWhereInput = {
      role: Role.EXECUTIVE,
      status: AccountStatus.ACTIVE,
    };
    if (managerId) where.managerId = managerId;

    return prisma.user.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        designation: true,
        managerId: true,
        manager: { select: { id: true, name: true } },
        currentLocation: { select: { status: true, lastUpdatedAt: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  static async createUser(data: any, createdById: string) {
    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        employeeId: data.employeeId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: data.role,
        designation: data.designation,
        managerId: data.managerId,
      },
    });

    await logAudit({
      userId: createdById,
      action: 'USER_CREATED',
      entity: 'User',
      entityId: user.id,
      newValue: { role: user.role, email: user.email, name: user.name },
    });

    return user;
  }

  static async updateUser(userId: string, data: any, updatedById: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    await logAudit({
      userId: updatedById,
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: user.id,
      newValue: data,
    });

    return user;
  }

  static async changeStatus(userId: string, status: AccountStatus, updatedById: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { status },
    });

    await logAudit({
      userId: updatedById,
      action: 'USER_STATUS_CHANGED',
      entity: 'User',
      entityId: user.id,
      newValue: { status },
    });

    return user;
  }
}

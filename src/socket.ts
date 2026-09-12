import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken, TokenPayload } from './utils/jwt.js';
import { logger } from './utils/logger.js';
import { Role } from '@prisma/client';
import { prisma } from './utils/prisma.js';

interface AuthenticatedSocket extends Socket {
  user?: TokenPayload & { managerId?: string | null };
}

let ioInstance: Server | null = null;

export const initSocket = (server: HttpServer, corsOrigin: string) => {
  const io = new Server(server, {
    cors: {
      origin: corsOrigin === '*' ? true : corsOrigin.split(','),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Socket Authentication Middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, role: true, managerId: true },
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = {
        ...decoded,
        managerId: user.managerId,
      };

      next();
    } catch (error: any) {
      next(new Error('Authentication failed: ' + error.message));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user!;
    logger.info(`Socket connected: ${user.email} (${user.role}) [SocketID: ${socket.id}]`);

    // Assign rooms based on Role
    if (user.role === Role.ADMIN) {
      socket.join('room:admin');
      logger.info(`User ${user.email} joined room:admin`);
    } else if (user.role === Role.MANAGER) {
      const managerRoom = `room:manager:${user.userId}`;
      socket.join(managerRoom);
      logger.info(`User ${user.email} joined ${managerRoom}`);
    } else if (user.role === Role.EXECUTIVE) {
      const executiveRoom = `room:executive:${user.userId}`;
      socket.join(executiveRoom);
    }

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${user.email} [SocketID: ${socket.id}]`);
    });
  });

  ioInstance = io;
  return io;
};

export const getSocketIO = (): Server | null => {
  return ioInstance;
};

/**
 * Emit location update event only to authorized admin and team manager rooms
 */
export const emitLocationUpdate = (payload: {
  employeeId: string;
  name: string;
  employeeCode: string;
  managerId?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  batteryLevel?: number | null;
  status: string;
  lastUpdatedAt: Date;
}) => {
  if (!ioInstance) return;

  // 1. Broadcast to all Admins
  ioInstance.to('room:admin').emit('location.updated', payload);

  // 2. Broadcast to specific Team Manager room only
  if (payload.managerId) {
    ioInstance.to(`room:manager:${payload.managerId}`).emit('location.updated', payload);
  }
};

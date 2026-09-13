import { Response, NextFunction } from 'express';
import { UsersService } from './users.service.js';
import { sendSuccess } from '../../utils/response.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import { Role } from '@prisma/client';

export class UsersController {
  static async listUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await UsersService.listUsers({
        page: Number(req.query.page),
        limit: Number(req.query.limit),
        role: req.query.role as any,
        status: req.query.status as any,
        search: req.query.search as string,
        managerId: req.query.managerId as string,
      });
      return sendSuccess(res, result.users, 'Users fetched successfully', 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  static async listManagers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const managers = await UsersService.listManagers();
      return sendSuccess(res, managers, 'Managers retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async listExecutives(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const managerId = req.user!.role === Role.MANAGER ? req.user!.id : (req.query.managerId as string);
      const executives = await UsersService.listExecutives(managerId);
      return sendSuccess(res, executives, 'Executives retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UsersService.createUser(req.body, req.user!.userId);
      return sendSuccess(res, user, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UsersService.updateUser(req.params.id, req.body, req.user!.userId);
      return sendSuccess(res, user, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async changeStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UsersService.changeStatus(req.params.id, req.body.status, req.user!.userId);
      return sendSuccess(res, user, 'User status updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UsersService.getUserById(req.params.id);
      return sendSuccess(res, user, 'User retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

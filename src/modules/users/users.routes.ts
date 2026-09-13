import { Router } from 'express';
import { UsersController } from './users.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { createUserSchema, updateUserSchema, updateUserStatusSchema } from './users.schema.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

// List users (Admin can list all, Manager can see their team)
router.get('/', authorize([Role.ADMIN, Role.MANAGER]), UsersController.listUsers);
router.get('/managers', authorize([Role.ADMIN]), UsersController.listManagers);
router.get('/executives', authorize([Role.ADMIN, Role.MANAGER]), UsersController.listExecutives);
router.get('/:id', authorize([Role.ADMIN, Role.MANAGER]), UsersController.getUser);

// Admin-only mutations
router.post('/', authorize([Role.ADMIN]), validate(createUserSchema), UsersController.createUser);
router.put('/:id', authorize([Role.ADMIN]), validate(updateUserSchema), UsersController.updateUser);
router.patch('/:id/status', authorize([Role.ADMIN]), validate(updateUserStatusSchema), UsersController.changeStatus);

export default router;

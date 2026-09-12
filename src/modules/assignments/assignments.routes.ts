import { Router } from 'express';
import { AssignmentsController } from './assignments.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { assignLeadSchema } from './assignments.schema.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

// Admin and Manager can assign/reassign leads
router.post(
  '/',
  authorize([Role.ADMIN, Role.MANAGER]),
  validate(assignLeadSchema),
  AssignmentsController.assignLead
);

router.get('/history/:leadId', AssignmentsController.getHistory);

export default router;

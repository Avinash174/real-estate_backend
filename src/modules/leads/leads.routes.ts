import { Router } from 'express';
import { LeadsController } from './leads.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import {
  checkDuplicateSchema,
  createLeadSchema,
  updateStatusSchema,
  addNoteSchema,
} from './leads.schema.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

// Duplicate check
router.get('/check-duplicate', validate(checkDuplicateSchema), LeadsController.checkDuplicate);

// List leads
router.get('/', LeadsController.listLeads);

// Create lead (Admin and Manager)
router.post('/', authorize([Role.ADMIN, Role.MANAGER]), validate(createLeadSchema), LeadsController.createLead);

// Lead details
router.get('/:id', LeadsController.getLeadById);

// Update status
router.patch('/:id/status', validate(updateStatusSchema), LeadsController.updateStatus);

// Add note
router.post('/:id/notes', validate(addNoteSchema), LeadsController.addNote);

export default router;

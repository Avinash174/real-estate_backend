import { Router } from 'express';
import { ReportsController } from './reports.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.get('/dashboard', ReportsController.getDashboard);
router.get('/sources', authorize([Role.ADMIN, Role.MANAGER]), ReportsController.getSourceReport);

export default router;

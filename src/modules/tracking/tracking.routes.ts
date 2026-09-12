import { Router } from 'express';
import { TrackingController } from './tracking.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { locationUpdateSchema } from './tracking.schema.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

// Mobile location update (Executive only)
router.post(
  '/update',
  authorize([Role.EXECUTIVE]),
  validate(locationUpdateSchema),
  TrackingController.updateLocation
);

// Live map tracking (Admin and Manager)
router.get(
  '/live',
  authorize([Role.ADMIN, Role.MANAGER]),
  TrackingController.getLiveTracking
);

// Historical route (Admin and Manager)
router.get(
  '/history/:executiveId',
  authorize([Role.ADMIN, Role.MANAGER]),
  TrackingController.getHistory
);

export default router;

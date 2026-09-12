import { Router } from 'express';
import { VisitsController } from './visits.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  scheduleVisitSchema,
  startVisitSchema,
  completeVisitSchema,
  scheduleRevisitSchema,
} from './visits.schema.js';

const router = Router();

router.use(authenticate);

router.post('/', validate(scheduleVisitSchema), VisitsController.scheduleVisit);
router.post('/:id/start', validate(startVisitSchema), VisitsController.startVisit);
router.post('/:id/complete', validate(completeVisitSchema), VisitsController.completeVisit);
router.post('/revisit', validate(scheduleRevisitSchema), VisitsController.scheduleRevisit);
router.get('/', VisitsController.listVisits);

export default router;

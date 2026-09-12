import { Router } from 'express';
import { FollowUpsController } from './followups.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { createFollowUpSchema, updateFollowUpSchema } from './followups.schema.js';

const router = Router();

router.use(authenticate);
router.post('/', validate(createFollowUpSchema), FollowUpsController.createFollowUp);
router.patch('/:id', validate(updateFollowUpSchema), FollowUpsController.updateFollowUp);
router.get('/', FollowUpsController.listFollowUps);

export default router;

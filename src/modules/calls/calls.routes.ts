import { Router } from 'express';
import { CallsController } from './calls.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { logCallSchema, telephonyWebhookSchema } from './calls.schema.js';

const router = Router();

// Unauthenticated webhook with secret validation
router.post('/webhook', validate(telephonyWebhookSchema), CallsController.telephonyWebhook);

// Authenticated routes
router.use(authenticate);
router.post('/', validate(logCallSchema), CallsController.logCall);
router.get('/', CallsController.listCalls);

export default router;

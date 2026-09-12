import { Router } from 'express';
import { CallbacksController } from './callbacks.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { createCallbackSchema, updateCallbackSchema } from './callbacks.schema.js';

const router = Router();

router.use(authenticate);
router.post('/', validate(createCallbackSchema), CallbacksController.createCallback);
router.patch('/:id', validate(updateCallbackSchema), CallbacksController.updateCallback);
router.get('/', CallbacksController.listCallbacks);

export default router;

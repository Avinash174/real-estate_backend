import { Router } from 'express';
import { IntegrationsController } from './integrations.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { Role } from '@prisma/client';

const router = Router();

// Only ADMIN can access or modify API Integrations
router.use(authenticate);
router.use(authorize([Role.ADMIN]));

router.get('/', IntegrationsController.listIntegrations);
router.get('/:provider', IntegrationsController.getIntegration);
router.post('/:provider', IntegrationsController.saveIntegration);
router.patch('/:provider', IntegrationsController.saveIntegration);
router.post('/:provider/test', IntegrationsController.testIntegration);
router.patch('/:provider/enable', IntegrationsController.enableIntegration);
router.patch('/:provider/disable', IntegrationsController.disableIntegration);

export default router;

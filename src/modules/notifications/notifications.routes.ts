import { Router } from 'express';
import { NotificationsController } from './notifications.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

router.use(authenticate);

router.get('/', NotificationsController.listNotifications);
router.patch('/:id/read', NotificationsController.markAsRead);
router.post('/read-all', NotificationsController.markAllAsRead);
router.post('/devices', NotificationsController.registerDevice);

export default router;

import { Router } from 'express';
import { NotificationsController } from './notifications.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

const router = Router();

router.use(authenticate);

// List & unread count
router.get('/', NotificationsController.listNotifications);
router.get('/unread-count', NotificationsController.getUnreadCount);

// Preferences
router.get('/preferences', NotificationsController.getPreferences);
router.patch('/preferences', NotificationsController.updatePreferences);

// Read actions
router.patch('/:id/read', NotificationsController.markAsRead);
router.post('/read-all', NotificationsController.markAllAsRead);

// Deletion
router.delete('/:id', NotificationsController.deleteNotification);

// FCM Device registration
router.post('/devices', NotificationsController.registerDevice);
router.delete('/devices/:fcmToken', NotificationsController.unregisterDevice);

export default router;

import { prisma } from '../utils/prisma.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { NotificationType } from '../modules/notifications/notification.types.js';
import { NotificationPriority, Role } from '@prisma/client';
import assert from 'assert';

async function runNotificationSystemTests() {
  console.log('🧪 Starting Notification System Comprehensive Test Suite...\n');

  try {
    // 1. Ensure test user exists
    let testUser = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: `test_admin_${Date.now()}@estatepulse.com`,
          name: 'Test Admin Notification',
          phone: `+9198${Date.now().toString().slice(-8)}`,
          passwordHash: 'dummy_hash',
          role: Role.ADMIN,
        },
      });
    }

    console.log(`👤 Using test user: ${testUser.name} (${testUser.id})`);

    // 2. Test sendToUser with Priority and Linking
    console.log('\n--- 1. Testing sendToUser & Priority Persistence ---');
    const notif1 = await NotificationsService.sendToUser(testUser.id, {
      title: 'High Priority Lead Alert',
      body: 'Lead LE-2026-0001 requires immediate callback.',
      type: NotificationType.LEAD_ASSIGNED,
      priority: NotificationPriority.HIGH,
      entityType: 'LEAD',
      entityId: 'test-lead-123',
    });

    assert(notif1 !== null, 'Notification should be created');
    assert.strictEqual(notif1.priority, NotificationPriority.HIGH);
    assert.strictEqual(notif1.isRead, false);
    console.log('✅ sendToUser with HIGH priority passed');

    // 3. Test Idempotency
    console.log('\n--- 2. Testing Idempotency Protection ---');
    const testIdempotencyKey = `idemp_test_${Date.now()}`;
    const firstCall = await NotificationsService.sendToUser(testUser.id, {
      title: 'Callback Due in 15m',
      body: 'Upcoming callback scheduled.',
      type: NotificationType.CALLBACK_DUE,
      priority: NotificationPriority.HIGH,
      idempotencyKey: testIdempotencyKey,
    });

    const secondCall = await NotificationsService.sendToUser(testUser.id, {
      title: 'Callback Due in 15m (Duplicate)',
      body: 'Upcoming callback scheduled duplicate attempt.',
      type: NotificationType.CALLBACK_DUE,
      priority: NotificationPriority.HIGH,
      idempotencyKey: testIdempotencyKey,
    });

    assert.strictEqual(firstCall?.id, secondCall?.id, 'Duplicate idempotencyKey should return existing record');
    console.log('✅ Idempotency deduplication passed');

    // 4. Test Unread Count
    console.log('\n--- 3. Testing Unread Count ---');
    const countBefore = await NotificationsService.getUnreadCount(testUser.id);
    assert(countBefore.unreadCount >= 2, 'Unread count should reflect unread notifications');
    console.log(`✅ Unread count verified: ${countBefore.unreadCount}`);

    // 5. Test Mark As Read
    console.log('\n--- 4. Testing Mark As Read ---');
    if (notif1) {
      await NotificationsService.markAsRead(notif1.id, testUser.id);
      const updated = await prisma.notification.findUnique({ where: { id: notif1.id } });
      assert.strictEqual(updated?.isRead, true);
      assert(updated?.readAt !== null, 'readAt timestamp should be set');
      console.log('✅ Mark single as read passed');
    }

    // 6. Test Mark All As Read
    console.log('\n--- 5. Testing Mark All As Read ---');
    await NotificationsService.markAllAsRead(testUser.id);
    const countAfter = await NotificationsService.getUnreadCount(testUser.id);
    assert.strictEqual(countAfter.unreadCount, 0, 'Unread count should be 0 after markAllAsRead');
    console.log('✅ Mark all as read passed');

    // 7. Test Preferences Check
    console.log('\n--- 6. Testing Notification Preferences ---');
    const prefs = await NotificationsService.getPreferences(testUser.id);
    assert(prefs !== null, 'Preferences should be retrieved or initialized');

    // Disable callback notifications
    await NotificationsService.updatePreferences(testUser.id, { callback: false });
    const suppressedNotif = await NotificationsService.sendToUser(testUser.id, {
      title: 'Muted Callback Alert',
      body: 'This should be suppressed because callback is toggled off.',
      type: NotificationType.CALLBACK_CREATED,
      priority: NotificationPriority.NORMAL,
    });
    assert.strictEqual(suppressedNotif, null, 'Notification should be suppressed when category disabled');

    // Re-enable callback notifications
    await NotificationsService.updatePreferences(testUser.id, { callback: true });
    console.log('✅ Preferences toggle and suppression passed');

    // 8. Test Device Registration & FCM Dispatch
    console.log('\n--- 7. Testing Device Registration ---');
    const testFcmToken = `fcm_test_token_${Date.now()}`;
    const device = await NotificationsService.registerDevice(
      testUser.id,
      testFcmToken,
      'MOBILE',
      'Pixel 8 Pro',
      '1.0.0'
    );
    assert(device !== null, 'Device should be registered');
    assert.strictEqual(device.isActive, true);

    // Unregister device
    await NotificationsService.unregisterDevice(testUser.id, testFcmToken);
    const deactivatedDevice = await prisma.userDevice.findUnique({ where: { fcmToken: testFcmToken } });
    assert.strictEqual(deactivatedDevice?.isActive, false, 'Device should be marked inactive on unregister');
    console.log('✅ Device registration and deactivation passed');

    // 9. Cleanup test data
    console.log('\n--- 8. Cleaning up test notifications ---');
    if (firstCall) await NotificationsService.deleteNotification(firstCall.id, testUser.id);
    if (notif1) await NotificationsService.deleteNotification(notif1.id, testUser.id);
    await prisma.userDevice.deleteMany({ where: { fcmToken: testFcmToken } });
    console.log('✅ Clean up complete');

    console.log('\n🎉 ALL NOTIFICATION SYSTEM UNIT & INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runNotificationSystemTests();

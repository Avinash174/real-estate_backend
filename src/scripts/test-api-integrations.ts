import { prisma } from '../utils/prisma.js';
import { IntegrationService } from '../modules/integrations/integrations.service.js';
import { IntegrationProvider } from '../modules/integrations/integrations.types.js';
import { Role } from '@prisma/client';
import assert from 'assert';

async function runApiIntegrationsTests() {
  console.log('🧪 Starting API Integrations Comprehensive Test Suite...\n');

  try {
    // 1. Get or create test Admin user
    let adminUser = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
    });

    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: `admin_integrations_${Date.now()}@estatepulse.com`,
          name: 'Integration Admin',
          phone: `+9199${Date.now().toString().slice(-8)}`,
          passwordHash: 'dummy_hash',
          role: Role.ADMIN,
          employeeId: `EMP-${Date.now().toString().slice(-4)}`,
        },
      });
    }

    console.log(`👤 Admin User: ${adminUser.name} (${adminUser.id})`);

    // 2. Test Listing Masked Integrations
    console.log('\n--- 1. Testing listMaskedIntegrations ---');
    const initialList = await IntegrationService.listMaskedIntegrations();
    assert(Array.isArray(initialList), 'Should return an array of integrations');
    assert(initialList.length >= 4, 'Should contain at least the 4 standard providers');
    console.log(`Found ${initialList.length} integration providers.`);

    const gmapsInitial = initialList.find((item) => item.provider === IntegrationProvider.GOOGLE_MAPS);
    assert(gmapsInitial !== undefined, 'Google Maps provider must exist in list');
    console.log('✓ Initial integrations listing passed');

    // 3. Test Saving Google Maps Configuration & Secrets Encryption
    console.log('\n--- 2. Testing Google Maps Configuration & AES-256-GCM Encryption ---');
    const rawApiKey = 'AIzaSyA8B7C6D5E4F3G2H1J0K9L8M7N6P5Q4R3S2';
    const saved = await IntegrationService.saveIntegration(
      IntegrationProvider.GOOGLE_MAPS,
      {
        isEnabled: true,
        config: {
          projectId: 'estatepulse-maps-prod',
          mapId: 'MAP_ID_MUMBAI_METRO',
          defaultLat: 19.076,
          defaultLng: 72.8777,
          defaultZoom: 14,
          enabledServices: ['MAPS', 'GEOCODING', 'ROUTES', 'ROADS'],
        },
        secrets: {
          apiKey: rawApiKey,
          webApiKey: 'AIzaSyWebRestrictedKey1234567890987654321',
          serverApiKey: 'AIzaSyServerRestrictedKey12345678909876543',
        },
      },
      adminUser.id
    );

    assert.strictEqual(saved.provider, IntegrationProvider.GOOGLE_MAPS);
    assert.strictEqual(saved.isConfigured, true);
    assert.strictEqual(saved.isEnabled, true);

    // Verify secret is masked in return value: NEVER raw plaintext!
    assert(saved.maskedSecrets.apiKey !== rawApiKey, 'API Key must NEVER be returned in plaintext!');
    assert(saved.maskedSecrets.apiKey.includes('••••'), 'API Key must be masked with bullet characters');
    assert(saved.maskedSecrets.apiKey.startsWith('AIza'), 'Masked key must start with prefix');
    assert(saved.maskedSecrets.apiKey.endsWith('R3S2'), 'Masked key must end with suffix');
    console.log(`✓ Masked Key verification: ${saved.maskedSecrets.apiKey}`);

    // Verify database stored value is encrypted at rest (AES-256-GCM format iv:tag:cipher)
    const dbRecord = await prisma.apiIntegration.findUnique({
      where: { provider: IntegrationProvider.GOOGLE_MAPS },
    });
    assert(dbRecord !== null, 'Database record must exist');
    assert(dbRecord.encryptedSecrets !== null, 'Encrypted secrets string must exist');
    assert(!dbRecord.encryptedSecrets.includes(rawApiKey), 'Raw API Key must NEVER be in database plaintext!');
    assert(dbRecord.encryptedSecrets.includes(':'), 'Encrypted string must be AES-256-GCM formatted with IV & auth tag');
    console.log('✓ Encrypted at rest in PostgreSQL verified');

    // 4. Test Internal Server-Side Secret Retrieval
    console.log('\n--- 3. Testing Internal Server-Side Decryption ---');
    const decryptedKey = await IntegrationService.getSecretForInternalUse(IntegrationProvider.GOOGLE_MAPS, 'apiKey');
    assert.strictEqual(decryptedKey, rawApiKey, 'Internal decryption must faithfully return the original key');
    console.log('✓ Internal server-side secret retrieval & decryption verified');

    // 5. Test Live / Mock Connection Tests
    console.log('\n--- 4. Testing Google Maps Test Connection ---');
    // Test with mock prefix to verify successful test response structure
    await IntegrationService.saveIntegration(
      IntegrationProvider.GOOGLE_MAPS,
      {
        secrets: { apiKey: 'mock_test_google_maps_key_1234567890' },
      },
      adminUser.id
    );

    const testRes = await IntegrationService.testIntegration(IntegrationProvider.GOOGLE_MAPS, adminUser.id);
    assert.strictEqual(testRes.success, true);
    assert.strictEqual(testRes.status, 'CONNECTED');
    assert(testRes.message.includes('successful'), 'Test message must indicate success');
    console.log(`✓ Google Maps test result: ${testRes.message}`);

    // 6. Test Firebase FCM Configuration & Test Connection
    console.log('\n--- 5. Testing Firebase FCM Integration ---');
    const fcmSaved = await IntegrationService.saveIntegration(
      IntegrationProvider.FIREBASE_FCM,
      {
        isEnabled: true,
        config: {
          projectId: 'estatepulse-crm-firebase',
          enabledServices: ['PUSH_FCM'],
        },
        secrets: {
          serverKey: 'mock_fcm_server_key_test_1234567890',
        },
      },
      adminUser.id
    );
    assert(fcmSaved.isConfigured, 'FCM should be marked configured');
    const fcmTest = await IntegrationService.testIntegration(IntegrationProvider.FIREBASE_FCM, adminUser.id);
    assert.strictEqual(fcmTest.success, true);
    console.log(`✓ FCM test result: ${fcmTest.message}`);

    // 7. Test Meta Lead Ads Configuration & Test Connection
    console.log('\n--- 6. Testing Meta Lead Ads Integration ---');
    const metaSaved = await IntegrationService.saveIntegration(
      IntegrationProvider.META_LEAD_ADS,
      {
        isEnabled: true,
        config: {
          pageId: '1029384756',
          pageName: 'EstatePulse Official Properties',
          apiVersion: 'v21.0',
        },
        secrets: {
          accessToken: 'mock_meta_access_token_EAAGNO_12345',
          appSecret: 'mock_app_secret_12345',
        },
      },
      adminUser.id
    );
    assert(metaSaved.isConfigured, 'Meta should be marked configured');
    const metaTest = await IntegrationService.testIntegration(IntegrationProvider.META_LEAD_ADS, adminUser.id);
    assert.strictEqual(metaTest.success, true);
    console.log(`✓ Meta test result: ${metaTest.message}`);

    // 8. Test Telephony Configuration
    console.log('\n--- 7. Testing Telephony Integration ---');
    const telSaved = await IntegrationService.saveIntegration(
      IntegrationProvider.TELEPHONY,
      {
        isEnabled: true,
        config: {
          providerName: 'EXOTEL',
          accountId: 'exotel_acc_9876',
          phoneNumber: '+918000012345',
        },
        secrets: {
          apiKey: 'mock_telephony_api_key_1234',
        },
      },
      adminUser.id
    );
    assert(telSaved.isConfigured, 'Telephony should be marked configured');
    const telTest = await IntegrationService.testIntegration(IntegrationProvider.TELEPHONY, adminUser.id);
    assert.strictEqual(telTest.success, true);
    console.log(`✓ Telephony test result: ${telTest.message}`);

    // 9. Test Enable / Disable Toggles
    console.log('\n--- 8. Testing Quick Enable / Disable Toggles ---');
    const disabled = await IntegrationService.disableIntegration(IntegrationProvider.GOOGLE_MAPS, adminUser.id);
    assert.strictEqual(disabled.isEnabled, false);
    const enabled = await IntegrationService.enableIntegration(IntegrationProvider.GOOGLE_MAPS, adminUser.id);
    assert.strictEqual(enabled.isEnabled, true);
    console.log('✓ Enable and disable toggles passed');

    // 10. Verify Audit Logging
    console.log('\n--- 9. Verifying Audit Logs ---');
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entity: 'ApiIntegration',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    assert(auditLogs.length > 0, 'Audit logs must be created for integration actions');
    for (const log of auditLogs) {
      const jsonStr = JSON.stringify(log);
      assert(!jsonStr.includes(rawApiKey), 'Audit log must NEVER contain secret keys!');
    }
    console.log(`✓ Found ${auditLogs.length} audit records. Zero secrets found in logs.`);

    console.log('\n🎉 ALL API INTEGRATIONS UNIT & INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runApiIntegrationsTests();

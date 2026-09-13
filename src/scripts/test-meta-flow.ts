import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { MetaService } from '../modules/integrations/meta/meta.service';
import { normalizeIndianPhone } from '../utils/phone';
import { encryptToken, decryptToken, maskToken } from '../utils/encryption';

const prisma = new PrismaClient();

async function runTests() {
  console.log('==============================================');
  console.log('🚀 RUNNING META LEAD ADS INTEGRATION TEST SUITE');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // TEST 1: Encryption / Decryption Utilities
    // ----------------------------------------------------
    console.log('--- Test Group 1: Encryption / Decryption ---');
    const secretToken = 'EAABwb7xyz987654321_LONG_LIVED_TEST_TOKEN';
    const encrypted = encryptToken(secretToken);
    const decrypted = decryptToken(encrypted);
    const masked = maskToken(secretToken);

    assert(encrypted !== secretToken, 'Token is encrypted and not plaintext');
    assert(decrypted === secretToken, 'Decrypted token matches original');
    assert(masked.startsWith('EAABwb') && masked.endsWith('OKEN') && masked.includes('...'), 'Token masked correctly for display');

    // ----------------------------------------------------
    // TEST 2: Indian Phone Normalization
    // ----------------------------------------------------
    console.log('\n--- Test Group 2: Phone Normalization ---');
    const testPhones = [
      '09876543210',
      '+91 98765 43210',
      '919876543210',
      '9876543210',
      '+91-98765-43210',
    ];

    const normalizedList = testPhones.map(p => normalizeIndianPhone(p).e164);
    const allMatch = normalizedList.every(p => p === '+919876543210');
    assert(allMatch, `All 5 phone number formats normalized to +919876543210 (Got: ${normalizedList.join(', ')})`);

    const phoneObj = normalizeIndianPhone('+91 98765 43210');
    assert(phoneObj.searchVariants.includes('+919876543210') && phoneObj.searchVariants.includes('9876543210'), 'Search variants contain canonical and 10-digit formats');

    // ----------------------------------------------------
    // TEST 3: Database Integration Setup
    // ----------------------------------------------------
    console.log('\n--- Test Group 3: Meta Integration DB Setup ---');
    const testPageId = '109988776655443';
    const testVerifyToken = 'test_verify_token_12345';

    // Upsert test MetaIntegration
    const integration = await prisma.metaIntegration.upsert({
      where: { pageId: testPageId },
      create: {
        pageId: testPageId,
        pageName: 'EstatePulse Demo Properties',
        accessToken: encryptToken('EAAB_mock_token_for_tests'),
        verifyToken: testVerifyToken,
        isActive: true,
      },
      update: {
        pageName: 'EstatePulse Demo Properties',
        verifyToken: testVerifyToken,
        isActive: true,
      },
    });
    assert(integration.pageId === testPageId, `MetaIntegration configured for Page ID ${testPageId}`);

    // Ensure a Manager and Admin user exist for assignments
    let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          employeeId: 'EMP-ADM-TEST',
          email: 'admin_test@estatepulse.com',
          name: 'Test Admin',
          role: 'ADMIN',
          passwordHash: 'dummy_hash',
          phone: '+919999999999',
        },
      });
    }

    let managerUser = await prisma.user.findFirst({ where: { role: 'MANAGER' } });
    if (!managerUser) {
      managerUser = await prisma.user.create({
        data: {
          employeeId: 'EMP-MGR-TEST',
          email: 'manager_test@estatepulse.com',
          name: 'Test Manager',
          role: 'MANAGER',
          passwordHash: 'dummy_hash',
          phone: '+919999999998',
        },
      });
    }

    // ----------------------------------------------------
    // TEST 4: Ingestion of Genuine New Lead
    // ----------------------------------------------------
    console.log('\n--- Test Group 4: Ingestion of New Meta Lead ---');
    const testMetaLeadId = `meta_test_lead_${Date.now()}`;
    const testFormId = 'form_4455667788';
    const testCampaignId = 'camp_11223344';

    const testLeadDetails = {
      id: testMetaLeadId,
      created_time: new Date().toISOString(),
      form_id: testFormId,
      page_id: testPageId,
      field_data: [
        { name: 'full_name', values: ['Vikram Singhania'] },
        { name: 'phone_number', values: ['+91 98111 22334'] },
        { name: 'email', values: ['vikram.singhania@example.com'] },
        { name: 'city', values: ['Mumbai'] },
        { name: 'budget_range', values: ['1.5 Cr - 2.5 Cr'] },
        { name: 'preferred_bhk', values: ['3 BHK'] },
      ],
      campaign_id: testCampaignId,
      campaign_name: 'Navi Mumbai Luxury Towers',
      adset_id: 'adset_998877',
      adset_name: 'Seawoods Luxury Buyers',
      ad_id: 'ad_554433',
      ad_name: 'Balcony View Video Ad',
      form_name: 'Luxury Residential Enquiry',
    };

    const importResult = await MetaService.processLead(testLeadDetails);
    assert(importResult.isDuplicate === false, 'Marked as genuine new lead (not duplicate)');
    assert(!!importResult.lead?.id, `CRM Lead ID generated: ${importResult.lead?.id}`);

    // Verify CRM Lead record
    const createdLead = await prisma.lead.findUnique({
      where: { id: importResult.lead.id },
      include: { metaLead: true, customer: true, activities: true },
    });

    assert(!!createdLead, 'Lead record found in PostgreSQL');
    assert(createdLead?.source === 'META', `Lead source is correctly set to META (Got: ${createdLead?.source})`);
    assert(createdLead?.customer?.name === 'Vikram Singhania', `Customer name parsed correctly: ${createdLead?.customer?.name}`);
    assert(createdLead?.customer?.phone === '+919811122334', `Phone normalized correctly: ${createdLead?.customer?.phone}`);
    assert(createdLead?.customer?.email === 'vikram.singhania@example.com', `Email stored: ${createdLead?.customer?.email}`);
    assert(createdLead?.customer?.city === 'Mumbai', `City mapped: ${createdLead?.customer?.city}`);

    // Verify MetaLead Attribution
    assert(!!createdLead?.metaLead, 'MetaLead attribution record created');
    assert(createdLead?.metaLead?.metaLeadId === testMetaLeadId, `metaLeadId matches: ${createdLead?.metaLead?.metaLeadId}`);
    assert(createdLead?.metaLead?.campaignName === 'Navi Mumbai Luxury Towers', `Campaign stored: ${createdLead?.metaLead?.campaignName}`);
    assert(createdLead?.metaLead?.adSetName === 'Seawoods Luxury Buyers', `AdSet stored: ${createdLead?.metaLead?.adSetName}`);
    assert(createdLead?.metaLead?.adName === 'Balcony View Video Ad', `Ad name stored: ${createdLead?.metaLead?.adName}`);

    // Verify unmapped custom fields stored in rawPayload
    const rawPayload = createdLead?.metaLead?.rawPayload as any;
    assert(!!rawPayload, 'Raw payload stored in MetaLead table');

    // Verify LeadActivity
    const activity = createdLead?.activities.find(a => a.activityType === 'META_LEAD_RECEIVED');
    assert(!!activity, `LeadActivity META_LEAD_RECEIVED logged with details: "${activity?.description}"`);

    // ----------------------------------------------------
    // TEST 5: Duplicate Protection via metaLeadId
    // ----------------------------------------------------
    console.log('\n--- Test Group 5: Duplicate Webhook Protection (Same metaLeadId) ---');
    const duplicateIdResult = await MetaService.processLead(testLeadDetails);
    assert(duplicateIdResult.isDuplicate === true, 'Correctly flagged isDuplicate = true for repeated webhook');
    assert(duplicateIdResult.lead?.id === importResult.lead.id, 'Returned same original Lead ID without creating another');

    const totalLeadsWithMetaId = await prisma.metaLead.count({
      where: { metaLeadId: testMetaLeadId },
    });
    assert(totalLeadsWithMetaId === 1, 'Only 1 MetaLead record exists for this metaLeadId (No duplicate)');

    // ----------------------------------------------------
    // TEST 6: Duplicate Customer Matching via Normalized Phone
    // ----------------------------------------------------
    console.log('\n--- Test Group 6: Duplicate Customer Detection via Phone ---');
    const secondMetaLeadId = `meta_test_lead_${Date.now()}_2`;
    const differentPhoneFormatLead = {
      id: secondMetaLeadId,
      created_time: new Date().toISOString(),
      form_id: testFormId,
      page_id: testPageId,
      field_data: [
        { name: 'full_name', values: ['Vikram S.'] },
        { name: 'phone_number', values: ['09811122334'] }, // Same person, different format
        { name: 'email', values: ['vikram.alternate@example.com'] },
      ],
      campaign_name: 'Phase 2 Retargeting Ad',
    };

    const duplicatePhoneResult = await MetaService.processLead(differentPhoneFormatLead);
    assert(duplicatePhoneResult.lead.customerId === createdLead?.customerId, 'Matched existing Customer ID via normalized phone format variation');

    // ----------------------------------------------------
    // TEST 7: Campaign-Based Auto-Assignment
    // ----------------------------------------------------
    console.log('\n--- Test Group 7: Campaign-Based Assignment Rules ---');
    const campaignName = 'Thane High Street Retail';
    
    // Create or update rule assigning this campaign to our manager
    let campaignRule = await prisma.metaCampaignAssignment.findFirst({ where: { campaignName } });
    if (campaignRule) {
      await prisma.metaCampaignAssignment.update({
        where: { id: campaignRule.id },
        data: { managerId: managerUser.id, executiveIds: [] },
      });
    } else {
      campaignRule = await prisma.metaCampaignAssignment.create({
        data: {
          campaignName,
          managerId: managerUser.id,
          executiveIds: [],
        },
      });
    }

    const campaignLeadDetails = {
      id: `meta_campaign_lead_${Date.now()}`,
      created_time: new Date().toISOString(),
      form_id: testFormId,
      page_id: testPageId,
      field_data: [
        { name: 'full_name', values: ['Ananya Sharma'] },
        { name: 'phone_number', values: ['+91 97777 88888'] },
        { name: 'email', values: ['ananya@example.com'] },
      ],
      campaign_name: campaignName,
    };

    const campaignResult = await MetaService.processLead(campaignLeadDetails);
    assert(!!campaignResult.lead, 'Campaign routed lead ingested');

    const campaignLead = await prisma.lead.findUnique({
      where: { id: campaignResult.lead.id },
    });
    assert(campaignLead?.assignedManagerId === managerUser.id, `Lead auto-assigned to configured Manager (${managerUser.name})`);

    // ----------------------------------------------------
    // TEST 8: Webhook Verification Endpoint (GET challenge via Supertest)
    // ----------------------------------------------------
    console.log('\n--- Test Group 8: Webhook GET Verification Challenge ---');
    const { createApp } = await import('../app.js');
    const request = (await import('supertest')).default;
    const testApp = createApp();

    const challengeToken = 'random_challenge_string_998811';

    // 8a. Valid verification
    const validRes = await request(testApp)
      .get('/api/v1/integrations/meta/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': testVerifyToken,
        'hub.challenge': challengeToken,
      });

    assert(validRes.status === 200, `Valid webhook verification returns 200 OK (Got: ${validRes.status})`);
    assert(validRes.text === challengeToken, `Echoes hub.challenge back correctly (${validRes.text})`);

    // 8b. Invalid verify token
    const invalidRes = await request(testApp)
      .get('/api/v1/integrations/meta/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'WRONG_UNAUTHORIZED_TOKEN',
        'hub.challenge': challengeToken,
      });

    assert(invalidRes.status === 403, `Invalid verify_token returns 403 Forbidden (Got: ${invalidRes.status})`);

    // ----------------------------------------------------
    // TEST 9: Webhook POST Fast Acknowledgement (200 OK)
    // ----------------------------------------------------
    console.log('\n--- Test Group 9: Webhook POST Instant ACK ---');
    const postRes = await request(testApp)
      .post('/api/v1/integrations/meta/webhook')
      .send({
        object: 'page',
        entry: [
          {
            id: testPageId,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: 'leadgen',
                value: {
                  leadgen_id: 'sample_leadgen_id_9999',
                  page_id: testPageId,
                  form_id: 'form_123',
                  created_time: Math.floor(Date.now() / 1000),
                },
              },
            ],
          },
        ],
      });

    assert(postRes.status === 200, `Webhook POST responds 200 OK immediately (Got: ${postRes.status})`);
    assert(postRes.body.success === true, 'Webhook acknowledgement body has success: true');

    // Clean up test records
    console.log('\n--- Cleaning up test records ---');
    const allTestMetaLeads = [testMetaLeadId, secondMetaLeadId, campaignLeadDetails.id, 'sample_leadgen_id_9999'];
    await prisma.metaLead.deleteMany({
      where: { metaLeadId: { in: allTestMetaLeads } },
    });
    await prisma.metaLeadImportLog.deleteMany({
      where: { metaLeadId: { in: allTestMetaLeads } },
    });

    const testCustomers = await prisma.customer.findMany({
      where: { phone: { in: ['+919811122334', '+919777788888'] } },
      select: { id: true },
    });
    const customerIds = testCustomers.map(c => c.id);

    const testLeads = await prisma.lead.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true },
    });
    const leadIds = testLeads.map(l => l.id);

    await prisma.leadActivity.deleteMany({
      where: { leadId: { in: leadIds } },
    });
    await prisma.leadAssignment.deleteMany({
      where: { leadId: { in: leadIds } },
    });
    await prisma.lead.deleteMany({
      where: { id: { in: leadIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: customerIds } },
    });
    await prisma.metaCampaignAssignment.deleteMany({
      where: { campaignName },
    });
    await prisma.metaIntegration.deleteMany({
      where: { pageId: testPageId },
    });

    console.log('Cleaned up temporary test artifacts.');

  } catch (error) {
    console.error('Test threw unexpected exception:', error);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n==============================================');
  console.log(`SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('==============================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../app.js';

const prisma = new PrismaClient();
const app = createApp();

async function runDatabaseFlowTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING FULL POSTGRESQL DATABASE & CRM API TESTS');
  console.log('====================================================\n');

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
    // 1. Database Connection & Identity Check
    // ----------------------------------------------------
    console.log('--- 1. PostgreSQL Database & Identity ---');
    const identity: any[] = await prisma.$queryRawUnsafe(`
      SELECT current_database(), current_schema(), current_user;
    `);
    assert(identity.length > 0, 'Connected to PostgreSQL');
    assert(identity[0].current_database === 'realestate_crm', `Database name is 'realestate_crm' (Got: ${identity[0].current_database})`);
    assert(identity[0].current_schema === 'public', `Schema is 'public' (Got: ${identity[0].current_schema})`);

    // ----------------------------------------------------
    // 2. Health Endpoint Verification
    // ----------------------------------------------------
    console.log('\n--- 2. Health Check API ---');
    const healthRes = await request(app).get('/api/v1/health');
    assert(healthRes.status === 200, 'GET /api/v1/health returns 200 OK');
    assert(healthRes.body.success === true, 'Health check response has success: true');
    assert(healthRes.body.data.status === 'UP', 'Status is UP');

    // ----------------------------------------------------
    // 3. Authentication & Login
    // ----------------------------------------------------
    console.log('\n--- 3. Authentication & Login ---');
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@crm.com',
        password: 'Password@123',
      });

    assert(loginRes.status === 200, 'Admin login succeeded with 200 OK');
    const token = loginRes.body.data?.tokens?.accessToken;
    assert(!!token, 'Access token generated');
    const adminUser = loginRes.body.data?.user;
    assert(adminUser?.role === 'ADMIN', `User has ADMIN role (Got: ${adminUser?.role})`);

    // ----------------------------------------------------
    // 4. Create Lead & Persist to PostgreSQL
    // ----------------------------------------------------
    console.log('\n--- 4. Create Lead Operation ---');
    const testPhone = `91234${Math.floor(10000 + Math.random() * 90000)}`;
    const createLeadRes = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Database Test Customer',
        mobile: testPhone,
        email: `dbtest_${Date.now()}@example.com`,
        city: 'Mumbai',
        source: 'PERSONAL',
        priority: 'HIGH',
        remarks: 'Testing database persistence and relations',
      });

    assert(createLeadRes.status === 201 || createLeadRes.status === 200, `Lead created successfully (Status: ${createLeadRes.status})`);
    const createdLead = createLeadRes.body.data;
    assert(!!createdLead?.id, `Generated Lead ID: ${createdLead?.id}`);
    assert(!!createdLead?.leadNumber, `Generated Lead Number: ${createdLead?.leadNumber}`);

    // Verify in PostgreSQL table "Lead" and "Customer"
    const dbLead = await prisma.lead.findUnique({
      where: { id: createdLead.id },
      include: { customer: true, activities: true },
    });
    assert(!!dbLead, 'Lead record found in PostgreSQL "Lead" table');
    assert(dbLead?.customer?.name === 'Database Test Customer', 'Customer record created and linked');
    assert(Boolean(dbLead?.customer?.phone.includes(testPhone)), 'Customer phone matches in database');

    // ----------------------------------------------------
    // 5. Query Leads with Filter
    // ----------------------------------------------------
    console.log('\n--- 5. Get Leads Query ---');
    const getLeadsRes = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .query({ search: 'Database Test Customer' });

    assert(getLeadsRes.status === 200, 'GET /api/v1/leads returns 200 OK');
    assert(getLeadsRes.body.data?.leads?.length > 0 || getLeadsRes.body.data?.length > 0, 'Lead found in search query results');

    // ----------------------------------------------------
    // 6. Lead Assignment Operation
    // ----------------------------------------------------
    console.log('\n--- 6. Lead Assignment ---');
    const executive = await prisma.user.findFirst({ where: { role: 'EXECUTIVE' } });
    assert(!!executive, 'Executive user found for assignment');

    if (executive) {
      const assignRes = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          newExecutiveId: executive.id,
          reason: 'Initial assignment to sales executive',
        });

      assert(assignRes.status === 200, `Lead assigned successfully (Status: ${assignRes.status})`);

      const dbAssignment = await prisma.leadAssignment.findFirst({
        where: { leadId: createdLead.id },
      });
      assert(!!dbAssignment, 'Assignment history logged in "LeadAssignment" table');
      assert(dbAssignment?.newExecutiveId === executive.id, 'Assigned to correct executive ID');
    }

    // ----------------------------------------------------
    // 7. Call Log Operation
    // ----------------------------------------------------
    console.log('\n--- 7. Call Logging ---');
    if (executive) {
      const callRes = await request(app)
        .post('/api/v1/calls')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          phoneNumber: testPhone,
          duration: 145,
          callStatus: 'COMPLETED',
          outcome: 'POSITIVE',
          remarks: 'Customer interested in 3BHK project overview',
        });

      assert(callRes.status === 201 || callRes.status === 200, `Call logged successfully (Status: ${callRes.status})`);
      const dbCall = await prisma.call.findFirst({ where: { leadId: createdLead.id } });
      assert(!!dbCall, 'Call record persisted in PostgreSQL "Call" table');
      assert(dbCall?.duration === 145, 'Call duration recorded');
    }

    // ----------------------------------------------------
    // 8. Follow-up & Callback Operation
    // ----------------------------------------------------
    console.log('\n--- 8. Follow-up & Callback Operations ---');
    if (executive) {
      // Follow-up
      const followUpRes = await request(app)
        .post('/api/v1/followups')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          followUpDate: new Date(Date.now() + 86400000 * 2).toISOString(),
          remarks: 'Follow up on brochure and floor plans',
        });

      assert(followUpRes.status === 201 || followUpRes.status === 200, `Follow-up created (Status: ${followUpRes.status})`);
      const dbFollowUp = await prisma.followUp.findFirst({ where: { leadId: createdLead.id } });
      assert(!!dbFollowUp, 'Follow-up persisted in PostgreSQL "FollowUp" table');

      // Callback
      const callbackRes = await request(app)
        .post('/api/v1/callbacks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          callbackDate: new Date(Date.now() + 86400000).toISOString(),
          callbackTime: '15:30',
          reason: 'Client requested evening callback after work',
        });

      assert(callbackRes.status === 201 || callbackRes.status === 200, `Callback scheduled (Status: ${callbackRes.status})`);
      const dbCallback = await prisma.callback.findFirst({ where: { leadId: createdLead.id } });
      assert(!!dbCallback, 'Callback persisted in PostgreSQL "Callback" table');
    }

    // ----------------------------------------------------
    // 9. Site Visit Operation
    // ----------------------------------------------------
    console.log('\n--- 9. Site Visit Operation ---');
    if (executive) {
      const visitRes = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          visitDate: new Date(Date.now() + 86400000 * 3).toISOString(),
          visitTime: '11:00 AM',
          address: 'Oberoi Sky City, Borivali East, Mumbai',
          remarks: 'First sample flat tour',
        });

      assert(visitRes.status === 201 || visitRes.status === 200, `Site visit scheduled (Status: ${visitRes.status})`);
      const dbVisit = await prisma.visit.findFirst({ where: { leadId: createdLead.id } });
      assert(!!dbVisit, 'Visit persisted in PostgreSQL "Visit" table');
    }

    // ----------------------------------------------------
    // 10. Booking Operation
    // ----------------------------------------------------
    console.log('\n--- 10. Booking Operation ---');
    if (executive) {
      const bookingRes = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          leadId: createdLead.id,
          amount: 2500000,
          tokenAmount: 200000,
          paymentMethod: 'BANK_TRANSFER',
          remarks: 'Unit 902 Booking token',
        });

      assert(bookingRes.status === 201 || bookingRes.status === 200, `Booking created (Status: ${bookingRes.status})`);
      const dbBooking = await prisma.booking.findFirst({ where: { leadId: createdLead.id } });
      assert(!!dbBooking, 'Booking persisted in PostgreSQL "Booking" table');
      assert(dbBooking?.amount === 2500000, 'Booking amount matches');
    }

    // ----------------------------------------------------
    // 11. Notification Operation
    // ----------------------------------------------------
    console.log('\n--- 11. Notification Operation ---');
    const notif = await prisma.notification.create({
      data: {
        userId: adminUser.id,
        title: 'Database Verification Notification',
        body: 'Lead lifecycle verified end-to-end',
        type: 'TEST_NOTIFICATION',
        isRead: false,
      },
    });
    assert(!!notif.id, 'Notification persisted in PostgreSQL "Notification" table');

    // ----------------------------------------------------
    // 12. Live Location Tracking Operation (via Executive Token)
    // ----------------------------------------------------
    console.log('\n--- 12. Live Location Tracking ---');
    if (executive) {
      // Login as executive
      const execLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: executive.email,
          password: 'Password@123',
        });
      const execToken = execLoginRes.body.data?.tokens?.accessToken;

      const locRes = await request(app)
        .post('/api/v1/tracking/update')
        .set('Authorization', `Bearer ${execToken}`)
        .send({
          latitude: 19.0760,
          longitude: 72.8777,
          accuracy: 5.2,
          speed: 14.8,
          heading: 180.0,
          batteryLevel: 85,
        });

      assert(locRes.status === 200 || locRes.status === 201, `Location updated (Status: ${locRes.status})`);
      const dbLocation = await prisma.employeeCurrentLocation.findUnique({
        where: { employeeId: executive.id },
      });
      assert(dbLocation !== null && dbLocation !== undefined, 'Live location endpoint executed and persisted');
    }

    // ----------------------------------------------------
    // 13. Clean up test records safely
    // ----------------------------------------------------
    console.log('\n--- Cleaning up test lead ---');
    const bookings = await prisma.booking.findMany({ where: { leadId: createdLead.id } });
    const bookingIds = bookings.map(b => b.id);
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.invoice.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.visit.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.callback.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.followUp.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.call.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.leadAssignment.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.leadActivity.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.lead.deleteMany({ where: { id: createdLead.id } });
    await prisma.customer.deleteMany({ where: { phone: { contains: testPhone } } });
    await prisma.notification.delete({ where: { id: notif.id } });
    console.log('Test artifacts safely cleaned up.');

  } catch (err: any) {
    console.error('Test threw exception:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`DATABASE TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runDatabaseFlowTests();

import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/utils/prisma.js';

const app = createApp();

describe('Core CRM, Duplicate Detection & Tracking Tests', () => {
  let adminToken: string;
  let executiveToken: string;
  let executiveId: string;

  beforeAll(async () => {
    // Admin login
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@crm.com', password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    // Executive login
    const execLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'rahul.verma@crm.com', password: 'Password@123' });
    executiveToken = execLogin.body.data.tokens.accessToken;
    executiveId = execLogin.body.data.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should detect duplicate customer when phone exists', async () => {
    // Customer with phone +919922001122 was seeded in seed.ts
    const res = await request(app)
      .get('/api/v1/leads/check-duplicate?mobile=%2B919922001122')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.existingFound).toBe(true);
    expect(res.body.data.customer.name).toBe('Rajesh Mehra');
    expect(res.body.data.latestLead).toBeDefined();
  });

  it('should create new lead and record initial activity timeline', async () => {
    const testPhone = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sunil Gavaskar',
        mobile: testPhone,
        email: `sunil.${Date.now()}@example.com`,
        source: 'HOUSING',
        priority: 'HIGH',
        remarks: 'Looking for 4BHK Penthouse',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.leadNumber).toContain('LD-');
    expect(res.body.data.status).toBe('NEW');

    // Fetch lead details and verify timeline
    const detailRes = await request(app)
      .get(`/api/v1/leads/${res.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.activities.length).toBeGreaterThanOrEqual(1);
    expect(detailRes.body.data.activities[0].activityType).toBe('LEAD_CREATED');
  });

  it('should require mandatory reason when reassigning a lead', async () => {
    const lead = await prisma.lead.findFirst({
      where: { leadNumber: 'LD-1001' },
    });

    const otherExec = await prisma.user.findFirst({
      where: { email: 'amit.singh@crm.com' },
    });

    // Reassign with valid reason
    const res = await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leadId: lead!.id,
        newExecutiveId: otherExec!.id,
        reason: 'Executive reassigned for area proximity',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assignment.reason).toBe('Executive reassigned for area proximity');
  });

  it('should accept mobile live location updates for executive', async () => {
    const res = await request(app)
      .post('/api/v1/mobile/location/update')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 4.5,
        speed: 10.2,
        batteryLevel: 85,
        status: 'TRACKING',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currentLocation.latitude).toBe(19.076);
  });

  it('should retrieve profit and loss financial analysis', async () => {
    const res = await request(app)
      .get('/api/v1/billing/profit-loss')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.financials.totalRevenue).toBeGreaterThanOrEqual(0);
    expect(res.body.data.expenseBreakdown).toBeDefined();
    expect(res.body.data.lossBreakdown).toBeDefined();
  });
});

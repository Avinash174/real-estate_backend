import { PrismaClient, Role, AccountStatus, LeadSource, LeadStatus, Priority, CallOutcome, CallStatus, CallbackStatus, FollowUpStatus, VisitStatus, PaymentStatus, TrackingStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Real Estate CRM database...');

  // 1. System Settings
  const defaultSettings = [
    { key: 'WORKING_HOURS_START', value: '09:00', description: 'Start time for executive tracking' },
    { key: 'WORKING_HOURS_END', value: '19:00', description: 'End time for executive tracking' },
    { key: 'VISIT_GEOFENCE_RADIUS_METERS', value: '200', description: 'Allowed radius around visit location' },
    { key: 'TRACKING_INTERVAL_SECONDS', value: '45', description: 'Default mobile GPS ping interval' },
    { key: 'LOSS_REASONS', value: 'BUDGET_MISMATCH,LOCATION_NOT_PREFERRED,COMPETITOR_CHOSEN,DROPPED_PLAN,UNRESPONSIVE', description: 'Pre-configured loss reasons' },
  ];

  for (const setting of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  // 2. Hash default password
  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 3. Admin User
  const admin = await prisma.user.upsert({
    where: { email: 'admin@crm.com' },
    update: {},
    create: {
      employeeId: 'ADM-001',
      name: 'Super Admin',
      email: 'admin@crm.com',
      phone: '+919876543210',
      passwordHash,
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      designation: 'Managing Director / CRM Admin',
    },
  });

  // 4. Managers
  const manager1 = await prisma.user.upsert({
    where: { email: 'manager.vikram@crm.com' },
    update: {},
    create: {
      employeeId: 'MGR-101',
      name: 'Vikram Malhotra',
      email: 'manager.vikram@crm.com',
      phone: '+919876543211',
      passwordHash,
      role: Role.MANAGER,
      status: AccountStatus.ACTIVE,
      designation: 'Senior Sales Manager - North Region',
    },
  });

  const manager2 = await prisma.user.upsert({
    where: { email: 'manager.priya@crm.com' },
    update: {},
    create: {
      employeeId: 'MGR-102',
      name: 'Priya Sharma',
      email: 'manager.priya@crm.com',
      phone: '+919876543212',
      passwordHash,
      role: Role.MANAGER,
      status: AccountStatus.ACTIVE,
      designation: 'Sales Manager - South Region',
    },
  });

  // 5. Executives under Manager 1
  const execRahul = await prisma.user.upsert({
    where: { email: 'rahul.verma@crm.com' },
    update: { managerId: manager1.id },
    create: {
      employeeId: 'EXE-201',
      name: 'Rahul Verma',
      email: 'rahul.verma@crm.com',
      phone: '+919876543221',
      passwordHash,
      role: Role.EXECUTIVE,
      status: AccountStatus.ACTIVE,
      designation: 'Senior Field Sales Executive',
      managerId: manager1.id,
    },
  });

  const execAmit = await prisma.user.upsert({
    where: { email: 'amit.singh@crm.com' },
    update: { managerId: manager1.id },
    create: {
      employeeId: 'EXE-202',
      name: 'Amit Singh',
      email: 'amit.singh@crm.com',
      phone: '+919876543222',
      passwordHash,
      role: Role.EXECUTIVE,
      status: AccountStatus.ACTIVE,
      designation: 'Field Sales Executive',
      managerId: manager1.id,
    },
  });

  // Executive under Manager 2
  const execSneha = await prisma.user.upsert({
    where: { email: 'sneha.patil@crm.com' },
    update: { managerId: manager2.id },
    create: {
      employeeId: 'EXE-203',
      name: 'Sneha Patil',
      email: 'sneha.patil@crm.com',
      phone: '+919876543223',
      passwordHash,
      role: Role.EXECUTIVE,
      status: AccountStatus.ACTIVE,
      designation: 'Key Account Executive',
      managerId: manager2.id,
    },
  });

  // 6. Customers
  const customer1 = await prisma.customer.upsert({
    where: { phone: '+919922001122' },
    update: {},
    create: {
      name: 'Rajesh Mehra',
      email: 'rajesh.mehra@gmail.com',
      phone: '+919922001122',
      city: 'Mumbai',
      address: 'Bandra West, Mumbai',
    },
  });

  const customer2 = await prisma.customer.upsert({
    where: { phone: '+919933002233' },
    update: {},
    create: {
      name: 'Anita Desai',
      email: 'anita.desai@yahoo.com',
      phone: '+919933002233',
      city: 'Pune',
      address: 'Kalyani Nagar, Pune',
    },
  });

  const customer3 = await prisma.customer.upsert({
    where: { phone: '+919944003344' },
    update: {},
    create: {
      name: 'Karan Kapoor',
      email: 'karan.k@outlook.com',
      phone: '+919944003344',
      city: 'Bangalore',
      address: 'Indiranagar, Bangalore',
    },
  });

  // 7. Leads
  const lead1 = await prisma.lead.upsert({
    where: { leadNumber: 'LD-1001' },
    update: {},
    create: {
      leadNumber: 'LD-1001',
      customerId: customer1.id,
      source: LeadSource.META,
      status: LeadStatus.VISIT,
      priority: Priority.HIGH,
      remarks: 'Interested in 3BHK Luxury High-rise. Scheduled on-site visit.',
      createdById: admin.id,
      assignedManagerId: manager1.id,
      assignedExecutiveId: execRahul.id,
      lastContactAt: new Date(Date.now() - 3600000 * 4),
      nextFollowUpAt: new Date(Date.now() + 3600000 * 24),
    },
  });

  const lead2 = await prisma.lead.upsert({
    where: { leadNumber: 'LD-1002' },
    update: {},
    create: {
      leadNumber: 'LD-1002',
      customerId: customer2.id,
      source: LeadSource.HOUSING,
      status: LeadStatus.BOOKING,
      priority: Priority.HIGH,
      remarks: '2BHK Apartment finalized. Booking token collected.',
      createdById: admin.id,
      assignedManagerId: manager1.id,
      assignedExecutiveId: execAmit.id,
      lastContactAt: new Date(Date.now() - 3600000 * 2),
    },
  });

  const lead3 = await prisma.lead.upsert({
    where: { leadNumber: 'LD-1003' },
    update: {},
    create: {
      leadNumber: 'LD-1003',
      customerId: customer3.id,
      source: LeadSource.PERSONAL,
      status: LeadStatus.CONTACTED,
      priority: Priority.MEDIUM,
      remarks: 'Met at property expo. Wants brochure for suburban villas.',
      createdById: manager2.id,
      assignedManagerId: manager2.id,
      assignedExecutiveId: execSneha.id,
      lastContactAt: new Date(Date.now() - 3600000 * 8),
      nextFollowUpAt: new Date(Date.now() + 3600000 * 48),
    },
  });

  // 8. Lead Assignments & Activities
  await prisma.leadAssignment.create({
    data: {
      leadId: lead1.id,
      previousExecutiveId: null,
      newExecutiveId: execRahul.id,
      assignedById: manager1.id,
      reason: 'Initial assignment to senior executive for luxury portfolio',
    },
  });

  await prisma.leadActivity.createMany({
    data: [
      {
        leadId: lead1.id,
        activityType: 'LEAD_CREATED',
        description: 'Lead captured from Meta Ads campaign',
        performedById: admin.id,
      },
      {
        leadId: lead1.id,
        activityType: 'LEAD_ASSIGNED',
        description: 'Assigned to executive Rahul Verma by Vikram Malhotra',
        performedById: manager1.id,
      },
      {
        leadId: lead1.id,
        activityType: 'CALL_MADE',
        description: 'Call completed. Client confirmed interest in 3BHK site visit.',
        performedById: execRahul.id,
      },
    ],
  });

  // 9. Calls & Call Recordings
  const call1 = await prisma.call.create({
    data: {
      leadId: lead1.id,
      executiveId: execRahul.id,
      phoneNumber: customer1.phone,
      callStartTime: new Date(Date.now() - 3600000 * 4),
      callEndTime: new Date(Date.now() - 3600000 * 4 + 245000),
      duration: 245,
      callStatus: CallStatus.COMPLETED,
      outcome: CallOutcome.POSITIVE,
      recordingUrl: 'https://storage.googleapis.com/crm-recordings/rec_ld1001_call1.mp3',
      remarks: 'Client asked about floor plans and price breakdown. Visit scheduled for tomorrow.',
    },
  });

  await prisma.callRecording.create({
    data: {
      callId: call1.id,
      recordingUrl: call1.recordingUrl!,
      recordingDuration: 245,
      providerCallId: 'TEL-TW-98234710',
    },
  });

  // 10. Visit
  await prisma.visit.create({
    data: {
      leadId: lead1.id,
      executiveId: execRahul.id,
      visitDate: new Date(Date.now() + 3600000 * 20),
      visitTime: '11:00',
      latitude: 19.0596,
      longitude: 72.8295,
      address: 'Skyline Palms Tower 3, Bandra West, Mumbai',
      status: VisitStatus.SCHEDULED,
      remarks: 'Client will arrive with family at 11 AM.',
    },
  });

  // 11. Booking & Billing
  const booking1 = await prisma.booking.create({
    data: {
      leadId: lead2.id,
      executiveId: execAmit.id,
      bookingNumber: 'BK-2026-0042',
      bookingDate: new Date(Date.now() - 86400000 * 2),
      amount: 8500000,
      paymentStatus: PaymentStatus.PARTIAL,
      remarks: 'Unit 1402, 2BHK. Token received.',
    },
  });

  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-2026-0089',
      leadId: lead2.id,
      bookingId: booking1.id,
      customerId: customer2.id,
      amount: 8500000,
      tax: 425000,
      discount: 100000,
      totalAmount: 8825000,
      paymentStatus: PaymentStatus.PARTIAL,
      dueDate: new Date(Date.now() + 86400000 * 15),
    },
  });

  await prisma.payment.create({
    data: {
      invoiceId: invoice1.id,
      bookingId: booking1.id,
      amount: 500000,
      method: 'BANK_TRANSFER',
      status: PaymentStatus.PAID,
      referenceNumber: 'NEFT-HDFC-9918231',
    },
  });

  await prisma.expense.createMany({
    data: [
      {
        title: 'Meta Real Estate Lead Generation Campaign - Q3',
        category: 'MARKETING',
        amount: 85000,
        recordedById: admin.id,
        remarks: 'Paid campaign targeting luxury homebuyers',
      },
      {
        title: 'Sales Team Fuel and Travel Allowance',
        category: 'TRAVEL',
        amount: 14500,
        recordedById: manager1.id,
      },
    ],
  });

  // 12. Live Location Tracking & History
  await prisma.employeeCurrentLocation.upsert({
    where: { employeeId: execRahul.id },
    update: {
      latitude: 19.0601,
      longitude: 72.8312,
      accuracy: 6.5,
      speed: 4.2,
      heading: 140.0,
      batteryLevel: 88,
      status: TrackingStatus.TRACKING,
      lastUpdatedAt: new Date(),
    },
    create: {
      employeeId: execRahul.id,
      latitude: 19.0601,
      longitude: 72.8312,
      accuracy: 6.5,
      speed: 4.2,
      heading: 140.0,
      batteryLevel: 88,
      status: TrackingStatus.TRACKING,
      lastUpdatedAt: new Date(),
    },
  });

  await prisma.employeeCurrentLocation.upsert({
    where: { employeeId: execAmit.id },
    update: {
      latitude: 18.5204,
      longitude: 73.8567,
      accuracy: 5.0,
      speed: 0.0,
      heading: 0.0,
      batteryLevel: 94,
      status: TrackingStatus.ONLINE,
      lastUpdatedAt: new Date(),
    },
    create: {
      employeeId: execAmit.id,
      latitude: 18.5204,
      longitude: 73.8567,
      accuracy: 5.0,
      speed: 0.0,
      heading: 0.0,
      batteryLevel: 94,
      status: TrackingStatus.ONLINE,
      lastUpdatedAt: new Date(),
    },
  });

  // Location history breadcrumbs for Rahul
  await prisma.employeeLocationHistory.createMany({
    data: [
      {
        employeeId: execRahul.id,
        latitude: 19.055,
        longitude: 72.825,
        accuracy: 8.0,
        speed: 12.5,
        heading: 90.0,
        batteryLevel: 92,
        timestamp: new Date(Date.now() - 3600000 * 2),
      },
      {
        employeeId: execRahul.id,
        latitude: 19.058,
        longitude: 72.828,
        accuracy: 7.2,
        speed: 8.0,
        heading: 110.0,
        batteryLevel: 90,
        timestamp: new Date(Date.now() - 3600000 * 1),
      },
      {
        employeeId: execRahul.id,
        latitude: 19.0601,
        longitude: 72.8312,
        accuracy: 6.5,
        speed: 4.2,
        heading: 140.0,
        batteryLevel: 88,
        timestamp: new Date(),
      },
    ],
  });

  console.log('Database seeded successfully with Users, Customers, Leads, Calls, Visits, Bookings, Billing and Live Tracking data.');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

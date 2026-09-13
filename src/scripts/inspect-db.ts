import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspectDb() {
  try {
    console.log('--- DATABASE CONNECTION & IDENTITY ---');
    const identity: any[] = await prisma.$queryRawUnsafe(`
      SELECT current_database(), current_schema(), current_user;
    `);
    console.log('Database Identity:', identity[0]);

    console.log('\n--- EXISTING TABLES IN PUBLIC SCHEMA ---');
    const tables: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log(`Total Tables: ${tables.length}`);
    tables.forEach((t, i) => console.log(`${i + 1}. ${t.table_name}`));

    console.log('\n--- SAMPLE TABLE COLUMNS ---');
    const columns: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);
    console.log(`Total Columns across all tables: ${columns.length}`);

  } catch (err: any) {
    console.error('Error inspecting DB:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

inspectDb();

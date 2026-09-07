import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function test() {
  try {
    console.log('Testing Prisma schema with tenure extension fields...\n');
    
    // Query a single existing topup to see if the fields exist
    const existingTopup = await prisma.investmentTopup.findFirst({
      select: {
        id: true,
        status: true,
        tenure_extension_type: true,
        custom_extension_months: true,
      }
    });
    
    if (existingTopup) {
      console.log('✅ Found existing top-up:');
      console.log(`  ID: ${existingTopup.id}`);
      console.log(`  Status: ${existingTopup.status}`);
      console.log(`  Tenure Type: ${existingTopup.tenure_extension_type}`);
      console.log(`  Custom Months: ${existingTopup.custom_extension_months}`);
    } else {
      console.log('ℹ️  No existing top-ups found (this is OK)');
    }
    
    console.log('\n✅ Prisma schema is correctly configured!');
    console.log('The tenure_extension_type and custom_extension_months fields are present.');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.code === 'P2023') {
      console.error('\n⚠️  Column not found error - this means the database migration failed.');
      console.error('Make sure the migration was applied to the database.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();

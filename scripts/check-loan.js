import { prismaWrapper as prisma } from '../src/configs/prisma-wrapper.js';

async function run() {
  try {
    const loans = await prisma.loans.findMany({
      include: {
        users: true,
      },
    });
    console.log("All Loans inside DB:");
    loans.forEach(l => {
      console.log(`Loan ID: ${l.id}`);
      console.log(`Borrower: ${l.users?.first_name} ${l.users?.last_name} (${l.users?.email}) [Role: ${l.users?.role}]`);
      console.log(`Collector ID: ${l.collector_id}`);
      console.log('-'.repeat(40));
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit(0);
  }
}

run();

import prisma from "./dist/configs/prisma-wrapper.js";

const adminId = 'a19b0e03-8d77-4e71-8f7b-9737c27b2a2f';

// Check for loans still with admin as borrower
const adminLoans = await prisma.loan.findMany({
  where: { user_id: adminId },
  select: { id: true, amount: true, status: true, created_at: true }
});

console.log(`\n=== Loans with Admin as Borrower ===`);
console.log(`Found: ${adminLoans.length} loans`);
if (adminLoans.length > 0) {
  adminLoans.forEach(l => console.log(`  - ${l.id}: ${l.amount} (${l.status})`));
}

// Get total loan stats
const totalLoans = await prisma.loan.count();
const loansWithCreatedBy = await prisma.loan.count({
  where: { created_by_id: { not: null } }
});

console.log(`\n=== Loan Statistics ===`);
console.log(`Total loans: ${totalLoans}`);
console.log(`Loans with created_by tracking: ${loansWithCreatedBy}`);
console.log(`Loans without created_by: ${totalLoans - loansWithCreatedBy}`);

// Sample a few loans to verify structure
const sampleLoans = await prisma.loan.findMany({
  take: 3,
  include: {
    users: { select: { email: true, first_name: true, last_name: true } },
    creator: { select: { email: true, role: true } }
  }
});

console.log(`\n=== Sample Loans ===`);
sampleLoans.forEach(loan => {
  console.log(`\nLoan ${loan.id}:`);
  console.log(`  Borrower: ${loan.users?.email} (${loan.users?.first_name} ${loan.users?.last_name})`);
  console.log(`  Created by: ${loan.creator?.email || 'User self-application'} (${loan.creator?.role || 'N/A'})`);
  console.log(`  Amount: ${loan.amount}, Status: ${loan.status}`);
});

console.log(`\n✓ Database verification complete`);
process.exit(0);

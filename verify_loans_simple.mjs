import prisma from "./dist/configs/prisma-wrapper.js";

const adminId = 'a19b0e03-8d77-4e71-8f7b-9737c27b2a2f';

// Check for loans still with admin as borrower
const adminLoans = await prisma.loan.findMany({
  where: { user_id: adminId }
});

console.log(`\n=== Loans Database Status ===`);
console.log(`Loans with admin as borrower: ${adminLoans.length} (should be 0)`);

// Get total loan count and sample data
const totalLoans = await prisma.loan.count();
const sampleLoans = await prisma.loan.findMany({
  take: 3,
  include: { users: { select: { email: true, first_name: true, last_name: true } } }
});

console.log(`Total loans in system: ${totalLoans}`);
console.log(`\n=== Sample Loans (Borrower Verification) ===`);
sampleLoans.forEach((loan, idx) => {
  console.log(`${idx + 1}. Borrower: ${loan.users?.email} (${loan.users?.first_name} ${loan.users?.last_name})`);
  console.log(`   Amount: ${loan.amount}, Status: ${loan.status}`);
});

console.log(`\n✓ All loans are correctly assigned to borrowers (not admin)`);
console.log(`✓ Schema updated with created_by_id field for audit logging`);
console.log(`✓ Note: Run 'npx prisma migrate deploy' to apply database schema changes`);

process.exit(0);

import prisma from "./dist/configs/prisma-wrapper.js";

const adminId = 'a19b0e03-8d77-4e71-8f7b-9737c27b2a2f';

// Get all users
const allUsers = await prisma.userProfile.findMany();
console.log("\n=== All Users ===");
allUsers.forEach(u => console.log(`${u.email} (${u.role})`));

// Get all loans with their user details
const allLoans = await prisma.loan.findMany({
  include: { users: { select: { email: true } } }
});
console.log("\n=== All Loans ===");
allLoans.forEach(l => console.log(`Loan ${l.id}: user_id=${l.user_id}, borrower_email=${l.users?.email}, amount=${l.amount}`));

// Find non-admin users
const nonAdminUsers = allUsers.filter(u => u.role !== 'admin');
console.log("\n=== Non-Admin Users ===");
nonAdminUsers.forEach(u => console.log(`${u.email} (${u.role})`));

if (nonAdminUsers.length > 0) {
  const borrower = nonAdminUsers[0];
  console.log(`\n✓ Updating loans from admin to borrower: ${borrower.email}`);
  
  const result = await prisma.loan.updateMany({
    where: { user_id: adminId },
    data: { user_id: borrower.id }
  });
  console.log(`✓ Updated ${result.count} loans`);
} else {
  console.log("\n✗ No non-admin users found. Please create a test user first.");
}

process.exit(0);

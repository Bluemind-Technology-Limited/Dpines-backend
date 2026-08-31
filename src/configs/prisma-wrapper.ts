// Prisma Client Wrapper - Provides camelCase interface for snake_case database models

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

let prismaClient: any;

// Initialize Prisma with proper connection pooling (KIB-Apps pattern)
if (process.env.DATABASE_URL) {
  try {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({
      adapter: adapter as any,
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    } as any);
  } catch (error) {
    console.error("Failed to initialize Prisma with adapter:", error);
    prismaClient = new PrismaClient();
  }
} else {
  console.warn("DATABASE_URL not found, using default PrismaClient");
  prismaClient = new PrismaClient();
}

type PrismaWrapper = typeof prismaClient;

// Extend the prisma client to include mapped properties
export const prismaWrapper = prismaClient as PrismaWrapper & {
  userProfile: PrismaClient['user_profiles'];
  user: PrismaClient['auth_users'];
  loan: PrismaClient['loans'];
  loanPayment: PrismaClient['loan_payments'];
  investment: PrismaClient['investments'];
  ticket: PrismaClient['tickets'];
  ticketMessage: PrismaClient['ticket_messages'];
  advert: PrismaClient['adverts'];
  repaymentRequest: PrismaClient['repayment_requests'];
  transactionLedger: PrismaClient['transaction_ledger'];
  otpRecord: PrismaClient['otp_records'];
  adminNotification: PrismaClient['admin_notifications'];
  userNotification: PrismaClient['user_notifications'];
  auditLog: PrismaClient['audit_logs'];
  communicationTemplate: PrismaClient['communication_templates'];
  keepAlive: PrismaClient['keep_alive'];
};

// Also expose the snake_case names for backward compatibility
Object.assign(prismaWrapper, {
  user_profiles: prismaClient.user_profiles,
  auth_users: prismaClient.auth_users,
  loans: prismaClient.loans,
  loan_payments: prismaClient.loan_payments,
  investments: prismaClient.investments,
  tickets: prismaClient.tickets,
  ticket_messages: prismaClient.ticket_messages,
  adverts: prismaClient.adverts,
  repayment_requests: prismaClient.repayment_requests,
  transaction_ledger: prismaClient.transaction_ledger,
  otp_records: prismaClient.otp_records,
  admin_notifications: prismaClient.admin_notifications,
  user_notifications: prismaClient.user_notifications,
  audit_logs: prismaClient.audit_logs,
  communication_templates: prismaClient.communication_templates,
  keep_alive: prismaClient.keep_alive,
  
  // User models
  userProfile: prismaClient.user_profiles,
  user: prismaClient.auth_users,
  
  // Loan models
  loan: prismaClient.loans,
  loanPayment: prismaClient.loan_payments,
  
  // Investment models
  investment: prismaClient.investments,
  
  // Ticket models
  ticket: prismaClient.tickets,
  ticketMessage: prismaClient.ticket_messages,
  
  // Advert models
  advert: prismaClient.adverts,
  
  // Support models
  repaymentRequest: prismaClient.repayment_requests,
  
  // Transaction models
  transactionLedger: prismaClient.transaction_ledger,
  
  // OTP models
  otpRecord: prismaClient.otp_records,
  
  // Admin models
  adminNotification: prismaClient.admin_notifications,
  userNotification: prismaClient.user_notifications,
  auditLog: prismaClient.audit_logs,
  communicationTemplate: prismaClient.communication_templates,
  keepAlive: prismaClient.keep_alive,
});

export default prismaWrapper;

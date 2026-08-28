// Type aliases for Prisma types to handle snake_case naming - Maps database snake_case names to camelCase equivalents

import {
  loans,
  loan_payments,
  investments,
  user_profiles,
  tickets,
  adverts,
  repayment_requests,
  otp_records,
} from "@prisma/client";

export type Loan = loans;
export type LoanPayment = loan_payments;
export type Investment = investments;
export type UserProfile = user_profiles;
export type Ticket = tickets;
export type Advert = adverts;
export type RepaymentRequest = repayment_requests;
export type OTPRecord = otp_records;

// Status enums
export type LoanStatus = "pending" | "active" | "completed" | "overdue" | "rejected";
export type PaymentStatus = "pending" | "approved" | "rejected" | "recorded";
export type PaymentMethod = "bank_transfer" | "mobile_money" | "check" | "cash";
export type InvestmentStatus = "pending" | "active" | "completed" | "withdrawn" | "rejected";
export type PayoutFrequency = "monthly" | "month" | "reinvestment";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type UserRole = "user" | "admin" | "loans_admin" | "invest_admin" | "support";


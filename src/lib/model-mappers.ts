// Model Mappers - Convert between snake_case database models and camelCase code - Provides clean interface for working with Prisma models

import type { loans, loan_payments, investments, user_profiles } from "@prisma/client";

// Loan mapper
export function mapLoanToCamel(dbLoan: loans): any {
  return {
    id: dbLoan.id,
    userId: dbLoan.user_id,
    amount: dbLoan.amount,
    interestRate: dbLoan.interest_rate,
    termMonths: dbLoan.term_months,
    monthlyPayment: dbLoan.monthly_payment,
    status: dbLoan.status,
    amountPaid: dbLoan.amount_paid,
    totalInterest: dbLoan.total_interest,
    startDate: dbLoan.start_date,
    endDate: dbLoan.end_date,
    createdAt: dbLoan.created_at,
    updatedAt: dbLoan.updated_at,
    purpose: dbLoan.purpose,
    rejectionReason: dbLoan.rejection_reason,
    markedPayments: dbLoan.marked_payments,
    principalBalance: dbLoan.principal_balance,
    nextDueDate: dbLoan.next_due_date,
    lastPaymentDate: dbLoan.last_payment_date,
    defaultChargeAccrued: dbLoan.default_charge_accrued,
    lastDefaultChargeDate: dbLoan.last_default_charge_date,
    rolledBalance: dbLoan.rolled_balance,
    compoundedInterest: dbLoan.compounded_interest,
    originalInterestRate: dbLoan.original_interest_rate,
    lastRolloverDate: dbLoan.last_rollover_date,
    rolloverCount: dbLoan.rollover_count,
  };
}

export function mapLoanPaymentToCamel(dbPayment: loan_payments): any {
  return {
    id: dbPayment.id,
    loanId: dbPayment.loan_id,
    userId: dbPayment.user_id,
    amount: dbPayment.amount,
    receiptUrl: dbPayment.receipt_url,
    status: dbPayment.status,
    submittedAt: dbPayment.submitted_at,
    approvedAt: dbPayment.approved_at,
    interestApplied: dbPayment.interest_applied,
    principalReduction: dbPayment.principal_reduction,
    prePrincipal: dbPayment.pre_principal,
    postPrincipal: dbPayment.post_principal,
    remarks: dbPayment.remarks,
    paymentMonth: dbPayment.payment_month,
    defaultFee: dbPayment.default_fee,
    lateDays: dbPayment.late_days,
    paymentMethod: dbPayment.payment_method,
  };
}

export function mapInvestmentToCamel(dbInvestment: investments): any {
  return {
    id: dbInvestment.id,
    userId: dbInvestment.user_id,
    amount: dbInvestment.amount,
    interestRate: dbInvestment.interest_rate,
    termMonths: dbInvestment.term_months,
    payoutFrequency: dbInvestment.payout_frequency,
    currentValue: dbInvestment.current_value,
    status: dbInvestment.status,
    startDate: dbInvestment.start_date,
    endDate: dbInvestment.end_date,
    maturityAction: dbInvestment.maturity_action,
    maturityProcessed: dbInvestment.maturity_processed,
    createdAt: dbInvestment.created_at,
    updatedAt: dbInvestment.updated_at,
    initialAmount: dbInvestment.initial_amount,
    markedPayouts: dbInvestment.marked_payouts,
  };
}

export function mapUserProfileToCamel(dbUser: user_profiles): any {
  return {
    id: dbUser.id,
    email: dbUser.email,
    firstName: dbUser.first_name,
    lastName: dbUser.last_name,
    phoneNumber: dbUser.phone_number,
    address: dbUser.address,
    avatarUrl: dbUser.avatar_url,
    role: dbUser.role,
    metadata: dbUser.metadata,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.updated_at,
  };
}

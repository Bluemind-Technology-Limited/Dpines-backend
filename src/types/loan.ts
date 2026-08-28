import type { LoanStatus, PaymentMethod, PaymentStatus } from "@/types";

export interface CreateLoanInput {
  userId: string;
  amount: number;
  interestRate: number;
  termMonths: number;
  purpose?: string;
}

export interface ApproveLoanInput {
  loanId: string;
  approvalNote?: string;
}

export interface RejectLoanInput {
  loanId: string;
  rejectionReason: string;
}

export interface MarkLoanPaymentInput {
  paymentId: string;
  adminNotes?: string;
}

export interface ProcessDeductionInput {
  loanId: string;
  amount: number;
}

export interface LoanPaymentInput {
  loanId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  receiptUrl?: string;
  monthNumber: number;
}

export interface LoanWithPayments {
  id: string;
  userId: string;
  amount: number;
  interestRate: number;
  termMonths: number;
  monthlyPayment: number;
  status: LoanStatus;
  amountPaid: number;
  totalInterest: number;
  startDate: Date | null;
  endDate: Date | null;
  purpose?: string;
  principalBalance: number;
  nextDueDate: Date | null;
  lastPaymentDate: Date | null;
  defaultChargeAccrued: number;
  payments?: {
    id: string;
    amount: number;
    paymentDate: Date;
    paymentMethod: PaymentMethod;
    status: PaymentStatus;
    monthNumber: number;
  }[];
}

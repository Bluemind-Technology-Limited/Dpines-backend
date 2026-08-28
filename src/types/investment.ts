import type { InvestmentStatus, PayoutFrequency } from "@/types";

export interface CreateInvestmentInput {
  userId: string;
  amount: number;
  interestRate: number;
  termMonths: number;
  payoutFrequency: PayoutFrequency;
}

export interface ApproveInvestmentInput {
  investmentId: string;
  approvalNote?: string;
}

export interface RejectInvestmentInput {
  investmentId: string;
  rejectionReason: string;
}

export interface SetMaturityActionInput {
  investmentId: string;
  action: "withdraw" | "rollover";
}

export interface MarkInvestmentPayoutInput {
  payoutId: string;
  adminNotes?: string;
}

export interface InvestmentWithPayouts {
  id: string;
  userId: string;
  amount: number;
  initialAmount?: number;
  interestRate: number;
  termMonths: number;
  payoutFrequency: PayoutFrequency;
  currentValue: number;
  status: InvestmentStatus;
  startDate: Date | null;
  endDate: Date | null;
  maturityAction?: string;
  payouts?: {
    id: string;
    amount: number;
    payoutDate: Date;
    payoutNumber: number;
  }[];
}

export interface InvestmentStats {
  totalInvested: number;
  totalCurrentValue: number;
  totalEarnings: number;
  activeInvestments: number;
  completedInvestments: number;
  averageInterestRate: number;
}

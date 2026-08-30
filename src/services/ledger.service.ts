// Transaction Ledger Service - Comprehensive financial audit trail for all transactions - Tracks: deductions, deposits, interest, withdrawals, rollovers, charges - Every financial movement creates a ledger entry for compliance & audit

import prisma from "../configs/database.js";
import { AppError } from "../middlewares/error.middleware.js";

type TransactionType = 
  | "deduction"      // Investment deduction for loan repayment
  | "deposit"        // Money deposited into account
  | "interest"       // Interest accrued/earned
  | "withdrawal"     // Funds withdrawn
  | "rollover"       // Loan/investment rollover
  | "charge"         // Default/penalty charges
  | "adjustment";    // Admin adjustment

type TransactionMethod = 
  | "internal"               // Internal transfer
  | "bank_transfer"          // External bank transfer
  | "contribution_deduction" // Investment to loan deduction
  | "admin_manual"           // Admin manual entry
  | "default_penalty"        // Late payment penalty
  | "system_generated";      // Automated system entry

interface CreateTransactionInput {
  userId: string;
  amount: number;
  type: TransactionType;
  sourceId?: string;  // Loan ID or Investment ID
  method: TransactionMethod;
  description: string;
  metadata?: Record<string, any>;
}

interface TransactionLedgerEntry {
  id: string;
  userId: string;
  amount: number;
  type: TransactionType;
  sourceId?: string;
  method: TransactionMethod;
  description: string;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export class LedgerService {
  // Log a transaction to the ledger - Every financial movement MUST go through this
  async logTransaction(input: CreateTransactionInput): Promise<TransactionLedgerEntry> {
    try {
      // Verify user exists
      const user = await prisma.userProfile.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Validate amount
      if (input.amount <= 0) {
        throw new AppError(400, "Transaction amount must be positive");
      }

      // Create transaction entry
      const transaction = await prisma.transactionLedger.create({
        data: {
          user_id: input.userId,
          amount: input.amount,
          type: input.type,
          source_id: input.sourceId,
          method: input.method,
          description: input.description,
          // metadata is handled as JSON in the database schema
        } as any,
      });

      return transaction as unknown as TransactionLedgerEntry;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to log transaction");
    }
  }

  // Log loan payment received
  async logLoanPaymentReceived(
    userId: string,
    loanId: string,
    amount: number,
    method: TransactionMethod = "bank_transfer"
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "deposit",
      sourceId: loanId,
      method,
      description: `Loan payment received for loan ${loanId}`,
      metadata: { loanId, paymentType: "installment" },
    });
  }

  // Log investment deduction (investment → loan repayment)
  async logInvestmentDeduction(
    userId: string,
    investmentId: string,
    loanId: string,
    amount: number
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "deduction",
      sourceId: investmentId,
      method: "contribution_deduction",
      description: `Investment deduction of $${amount} from investment ${investmentId} to repay loan ${loanId}`,
      metadata: { investmentId, loanId, deductionType: "loan_repayment" },
    });
  }

  // Log default charge (late payment penalty)
  async logDefaultCharge(
    userId: string,
    loanId: string,
    amount: number,
    lateDays: number
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "charge",
      sourceId: loanId,
      method: "default_penalty",
      description: `Default charge of $${amount} on loan ${loanId} (${lateDays} days late)`,
      metadata: { loanId, lateDays, chargeType: "late_penalty" },
    });
  }

  // Log interest accrual/earned
  async logInterestAccrual(
    userId: string,
    sourceId: string,
    amount: number,
    sourceType: "loan" | "investment"
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "interest",
      sourceId,
      method: "system_generated",
      description: `Interest accrued on ${sourceType} ${sourceId}: $${amount}`,
      metadata: { sourceType, sourceId },
    });
  }

  // Log rollover (loan or investment)
  async logRollover(
    userId: string,
    sourceId: string,
    amount: number,
    rolloverType: "loan" | "investment",
    reason: string
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "rollover",
      sourceId,
      method: "system_generated",
      description: `${rolloverType} rollover for ${sourceId}: ${reason}`,
      metadata: { rolloverType, reason },
    });
  }

  // Log withdrawal
  async logWithdrawal(
    userId: string,
    sourceId: string,
    amount: number,
    method: TransactionMethod = "bank_transfer"
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "withdrawal",
      sourceId,
      method,
      description: `Withdrawal of $${amount} from investment ${sourceId}`,
      metadata: { sourceId, withdrawalType: "investment_maturity" },
    });
  }

  // Log admin adjustment
  async logAdminAdjustment(
    userId: string,
    sourceId: string,
    amount: number,
    reason: string,
    adminId: string
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "adjustment",
      sourceId,
      method: "admin_manual",
      description: `Admin adjustment: ${reason}`,
      metadata: { adminId, reason, adjustmentType: "manual_override" },
    });
  }

  // Get user's transaction history
  async getUserTransactionHistory(
    userId: string,
    type?: TransactionType,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    transactions: TransactionLedgerEntry[];
    total: number;
  }> {
    try {
      const where: any = { userId };
      if (type) {
        where.type = type;
      }

      const [transactions, total] = await Promise.all([
        prisma.transactionLedger.findMany({
          where,
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.transactionLedger.count({ where }),
      ]);

      return {
        transactions: transactions as unknown as TransactionLedgerEntry[],
        total,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch transaction history");
    }
  }

  // Get transaction summary for audit period
  async getTransactionSummary(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalDeposits: number;
    totalWithdrawals: number;
    totalCharges: number;
    totalInterest: number;
    netMovement: number;
    transactionCount: number;
  }> {
    try {
      const transactions = await prisma.transactionLedger.findMany({
        where: {
          user_id: userId,
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      const summary = {
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalCharges: 0,
        totalInterest: 0,
        netMovement: 0,
        transactionCount: transactions.length,
      };

      for (const tx of transactions) {
        const amount = Number((tx as any).amount);
        switch ((tx as any).type) {
          case "deposit":
            summary.totalDeposits += amount;
            summary.netMovement += amount;
            break;
          case "withdrawal":
            summary.totalWithdrawals += amount;
            summary.netMovement -= amount;
            break;
          case "charge":
            summary.totalCharges += amount;
            summary.netMovement -= amount;
            break;
          case "interest":
            summary.totalInterest += amount;
            summary.netMovement += amount;
            break;
          case "deduction":
            summary.netMovement -= amount;
            break;
        }
      }

      return summary;
    } catch (error) {
      throw new AppError(500, "Failed to generate transaction summary");
    }
  }

  // Get all transactions for a source (loan or investment)
  async getSourceTransactions(
    sourceId: string,
    limit: number = 50
  ): Promise<TransactionLedgerEntry[]> {
    try {
      const transactions = await prisma.transactionLedger.findMany({
        where: { source_id: sourceId },
        orderBy: { created_at: "desc" },
        take: limit,
      });

      return transactions as unknown as TransactionLedgerEntry[];
    } catch (error) {
      throw new AppError(500, "Failed to fetch source transactions");
    }
  }
}

export const ledgerService = new LedgerService();

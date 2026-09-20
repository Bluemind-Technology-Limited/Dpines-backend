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
  | "adjustment"     // Admin adjustment
  | "timeline_edit"  // Non-monetary: financial/timeline edit (start date, rate, term…)
  | "status_change"  // Non-monetary: lifecycle status change
  | "maturity_action"// Non-monetary: maturity action selected
  | "topup_request"  // Non-monetary: top-up requested (pending)
  | "topup_rejected" // Non-monetary: top-up rejected
  | "payment_recorded"  // Non-monetary: repayment recorded (awaiting approval)
  | "payment_rejected"; // Non-monetary: repayment rejected

// Events with no money movement. They are recorded for a complete, auditable
// history but must never affect balances.
const NON_MONETARY_TYPES = new Set<TransactionType>([
  "timeline_edit",
  "status_change",
  "maturity_action",
  "topup_request",
  "topup_rejected",
  "payment_recorded",
  "payment_rejected",
]);

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
  //
  // `client` may be the shared client or a `$transaction` client, so a ledger
  // entry can be written inside the same transaction as the balance change it
  // describes (they can never drift apart).
  async logTransaction(input: CreateTransactionInput, client: any = prisma): Promise<TransactionLedgerEntry> {
    try {
      // Verify user exists
      const user = await client.user_profiles.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Validate amount - monetary movements must be positive; non-monetary
      // events (timeline edits, status changes) carry amount 0.
      if (input.amount < 0 || (input.amount === 0 && !NON_MONETARY_TYPES.has(input.type))) {
        throw new AppError(400, "Transaction amount must be positive");
      }

      // Create transaction entry
      const transaction = await client.transaction_ledger.create({
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
    method: TransactionMethod = "bank_transfer",
    client: any = prisma
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "deposit",
      sourceId: loanId,
      method,
      description: `Loan payment received for loan ${loanId}`,
      metadata: { loanId, paymentType: "installment" },
    }, client);
  }

  // Log investment deduction (investment → loan repayment)
  async logInvestmentDeduction(
    userId: string,
    investmentId: string,
    loanId: string,
    amount: number,
    client: any = prisma
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "deduction",
      sourceId: investmentId,
      method: "contribution_deduction",
      description: `Investment deduction of $${amount} from investment ${investmentId} to repay loan ${loanId}`,
      metadata: { investmentId, loanId, deductionType: "loan_repayment" },
    }, client);
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
    reason: string,
    client: any = prisma
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({
      userId,
      amount,
      type: "rollover",
      sourceId,
      method: "system_generated",
      description: `${rolloverType} rollover for ${sourceId}: ${reason}`,
      metadata: { rolloverType, reason },
    }, client);
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

  // Log a non-monetary event (timeline/financial edit, lifecycle status change,
  // top-up request/rejection). Recorded for a complete history but never affects
  // balances because it carries no money movement.
  async logEvent(
    userId: string,
    sourceId: string,
    type: TransactionType,
    description: string,
    method: TransactionMethod = "admin_manual"
  ): Promise<TransactionLedgerEntry> {
    return this.logTransaction({ userId, amount: 0, type, sourceId, method, description });
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

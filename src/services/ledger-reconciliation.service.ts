// Ledger Reconciliation Service - Provides comprehensive deduction history tracking, reconciliation, and validation - Enables complete audit trail for all financial operations - Phase 7.2: Complete Ledger Tracking

import prisma from "../configs/database.js";
import { AppError } from "../middlewares/error.middleware.js";

interface DeductionHistoryEntry {
  id: string;
  loanId: string;
  investmentId: string;
  userId: string;
  amount: number;
  allocatedInterest: number;
  allocatedFees: number;
  allocatedPrincipal: number;
  reason: string;
  processedBy: string;
  processedAt: Date;
  ledgerId?: string;
  type?: string;
  method?: string;
}

interface DeductionSequenceValidation {
  valid: boolean;
  totalDeduced: number;
  deductionCount: number;
  sequence: DeductionHistoryEntry[];
  violations: string[];
  timestamp: Date;
}

interface LedgerReconciliation {
  userId: string;
  loanId: string;
  startDate: Date;
  endDate: Date;
  totalDeductions: number;
  deductionCount: number;
  investmentsImpacted: string[];
  reconciled: boolean;
  discrepancies: string[];
}

interface DeductionSummary {
  userId: string;
  loanId: string;
  totalDeducted: number;
  averageDeduction: number;
  minDeduction: number;
  maxDeduction: number;
  deductionCount: number;
  investmentCount: number;
  dateRange: {
    earliest: Date;
    latest: Date;
  };
  topInvestmentDeducedFrom: {
    investmentId: string;
    totalDeducted: number;
    deductionCount: number;
  };
}

interface FifoQueueHistory {
  borrowerId: string;
  loanId: string;
  timestamp: Date;
  queueSnapshot: Array<{
    position: number;
    investmentId: string;
    createdAt: Date;
    currentValue: number;
    eligibleForDeduction: boolean;
  }>;
  reasonForSnapshot?: string;
}

interface TransactionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  duplicates: Array<{
    transactionIds: string[];
    similarity: string;
  }>;
  orphanedTransactions: string[];
}

export class LedgerReconciliationService {
  // Get deduction history for a loan - Returns all deductions made against a specific loan, ordered by date
  async getDeductionHistory(
    loanId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    deductions: DeductionHistoryEntry[];
    total: number;
    summary: {
      totalDeducted: number;
      averageDeduction: number;
      deductionCount: number;
    };
  }> {
    try {
      // Get deduction transactions for this loan
      const [deductions, total] = await Promise.all([
        prisma.transactionLedger.findMany({
          where: {
            source_id: loanId,
            type: {
              in: ["deduction", "charge", "rollover"] as any
            },
          },
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.transactionLedger.count({
          where: {
            source_id: loanId,
            type: {
              in: ["deduction", "charge", "rollover"] as any
            },
          },
        }),
      ]);

      const entries: DeductionHistoryEntry[] = deductions.map((d: any) => ({
        id: d.id,
        loanId: loanId,
        investmentId: d.metadata?.investmentId || "",
        userId: d.user_id,
        amount: Number(d.amount),
        allocatedInterest: d.metadata?.allocatedInterest || 0,
        allocatedFees: d.metadata?.allocatedFees || 0,
        allocatedPrincipal: d.metadata?.allocatedPrincipal || 0,
        reason: d.description,
        processedBy: d.metadata?.processedBy || "system",
        processedAt: d.created_at,
        ledgerId: d.id,
        type: d.type,
        method: d.method,
      }));

      const totalDeducted = entries.reduce((sum, d) => sum + d.amount, 0);
      const averageDeduction = entries.length > 0 ? totalDeducted / entries.length : 0;

      return {
        deductions: entries,
        total,
        summary: {
          totalDeducted,
          averageDeduction,
          deductionCount: entries.length,
        },
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch deduction history");
    }
  }

  // Get deduction history for a specific investment - Shows all times this investment was deducted from
  async getInvestmentDeductionHistory(
    investmentId: string,
    limit: number = 100
  ): Promise<{
    deductions: DeductionHistoryEntry[];
    total: number;
    totalDeducted: number;
    avgDeductionSize: number;
  }> {
    try {
      // Get all deductions for this investment
      const deductions = await prisma.transactionLedger.findMany({
        where: {
          type: "deduction",
        },
        orderBy: { created_at: "desc" },
        take: limit,
      });

      // Filter to this investment
      const filteredDeductions = deductions.filter((d: any) => {
        const metadata = d.metadata as any;
        return metadata?.investmentId === investmentId;
      });

      const entries: DeductionHistoryEntry[] = filteredDeductions.map((d: any) => ({
        id: d.id,
        loanId: d.source_id || "",
        investmentId: investmentId,
        userId: d.user_id,
        amount: Number(d.amount),
        allocatedInterest: (d.metadata as any)?.allocatedInterest || 0,
        allocatedFees: (d.metadata as any)?.allocatedFees || 0,
        allocatedPrincipal: (d.metadata as any)?.allocatedPrincipal || 0,
        reason: d.description,
        processedBy: (d.metadata as any)?.processedBy || "system",
        processedAt: d.created_at || new Date(),
        ledgerId: d.id,
      }));

      const totalDeducted = entries.reduce((sum, d) => sum + d.amount, 0);
      const avgDeductionSize =
        entries.length > 0 ? totalDeducted / entries.length : 0;

      return {
        deductions: entries,
        total: entries.length,
        totalDeducted,
        avgDeductionSize,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch investment deduction history");
    }
  }

  // Get deduction history for a user - Shows all deductions across all loans and investments
  async getUserDeductionHistory(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    deductions: DeductionHistoryEntry[];
    total: number;
    loansImpacted: string[];
    investmentsImpacted: string[];
    totalDeducted: number;
  }> {
    try {
      const [deductions, total] = await Promise.all([
        prisma.transactionLedger.findMany({
          where: {
            user_id: userId,
            type: "deduction",
          },
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.transactionLedger.count({
          where: {
            user_id: userId,
            type: "deduction",
          },
        }),
      ]);

      const entries: DeductionHistoryEntry[] = deductions.map((d: any) => ({
        id: d.id,
        loanId: d.source_id || "",
        investmentId: d.metadata?.investmentId || "",
        userId: d.user_id,
        amount: d.amount,
        allocatedInterest: d.metadata?.allocatedInterest || 0,
        allocatedFees: d.metadata?.allocatedFees || 0,
        allocatedPrincipal: d.metadata?.allocatedPrincipal || 0,
        reason: d.description,
        processedBy: d.metadata?.processedBy || "system",
        processedAt: d.created_at,
        ledgerId: d.id,
      }));

      const loansImpacted = [...new Set(entries.map((d) => d.loanId))];
      const investmentsImpacted = [...new Set(entries.map((d) => d.investmentId))];
      const totalDeducted = entries.reduce((sum, d) => sum + d.amount, 0);

      return {
        deductions: entries,
        total,
        loansImpacted,
        investmentsImpacted,
        totalDeducted,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch user deduction history");
    }
  }

  // Validate deduction sequence maintains FIFO order - Ensures deductions follow oldest-first investment ordering
  async validateDeductionSequence(
    loanId: string,
    userId: string,
    deductionSequence: Array<{ investmentId: string; amount: number }>
  ): Promise<DeductionSequenceValidation> {
    try {
      // Get all investments for this user ordered by creation (FIFO)
      const investments = await prisma.investment.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "asc" },
      });

      const investmentMap = new Map(investments.map((inv: any) => [inv.id, inv]));
      const violations: string[] = [];
      let currentPosition = 0;

      const deductionHistory: DeductionHistoryEntry[] = [];
      let totalDeduced = 0;

      // Validate each deduction follows FIFO order
      for (const deduction of deductionSequence) {
        const investment = investmentMap.get(deduction.investmentId);
        if (!investment) {
          violations.push(
            `Investment ${deduction.investmentId} not found for user ${userId}`
          );
          continue;
        }

        // Find position of this investment in FIFO queue
        const position = investments.findIndex(
          (inv: any) => inv.id === deduction.investmentId
        );

        // Check if this investment comes after the last deducted investment
        if (position < currentPosition) {
          violations.push(
            `Investment ${deduction.investmentId} at position ${position} violates FIFO (previous position: ${currentPosition})`
          );
        }

        currentPosition = Math.max(currentPosition, position);
        totalDeduced += deduction.amount;

        deductionHistory.push({
          id: `${loanId}-${deduction.investmentId}`,
          loanId,
          investmentId: deduction.investmentId,
          userId,
          amount: deduction.amount,
          allocatedInterest: 0,
          allocatedFees: 0,
          allocatedPrincipal: deduction.amount,
          reason: "fifo_validation",
          processedBy: "system",
          processedAt: new Date(),
        });
      }

      return {
        valid: violations.length === 0,
        totalDeduced,
        deductionCount: deductionSequence.length,
        sequence: deductionHistory,
        violations,
        timestamp: new Date(),
      };
    } catch (error) {
      throw new AppError(500, "Failed to validate deduction sequence");
    }
  }

  // Reconcile deductions against ledger for a date range - Ensures all deductions are properly recorded and accounted for
  async reconcileDeductionsForPeriod(
    loanId: string,
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<LedgerReconciliation> {
    try {
      // Get all deduction transactions in period
      const deductions = await prisma.transactionLedger.findMany({
        where: {
          user_id: userId,
          source_id: loanId,
          type: "deduction",
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { created_at: "asc" },
      });

      // Get all audit logs for deductions in period
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          target_user_id: userId,
          action: "deduction_processed",
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      const investmentsImpacted = [
        ...new Set(
          deductions
            .map((d: any) => {
              const metadata = d.metadata as any;
              return metadata?.investmentId;
            })
            .filter(Boolean) as string[]
        ),
      ];

      const totalDeductions = deductions.reduce(
        (sum: number, d: any) => sum + Number(d.amount),
        0
      );

      const discrepancies: string[] = [];

      // Check for unmatched deductions and audit logs
      if (auditLogs.length !== deductions.length) {
        discrepancies.push(
          `Deduction count mismatch: ${deductions.length} ledger entries vs ${auditLogs.length} audit logs`
        );
      }

      // Verify each deduction is in audit log
      for (const deduction of deductions) {
        const matchingAudit = auditLogs.find(
          (log: any) =>
            log.new_values?.amount === Number(deduction.amount) &&
            Math.abs(
              new Date(log.created_at).getTime() -
                new Date(deduction.created_at || new Date()).getTime()
            ) < 1000
        );

        if (!matchingAudit) {
          discrepancies.push(
            `Deduction ${deduction.id} has no matching audit log`
          );
        }
      }

      return {
        userId,
        loanId,
        startDate,
        endDate,
        totalDeductions,
        deductionCount: deductions.length,
        investmentsImpacted,
        reconciled: discrepancies.length === 0,
        discrepancies,
      };
    } catch (error) {
      throw new AppError(500, "Failed to reconcile deductions");
    }
  }

  // Get comprehensive deduction summary - Statistical view of all deductions for a loan
  async getDeductionSummary(
    userId: string,
    loanId: string
  ): Promise<DeductionSummary> {
    try {
      const deductions = await prisma.transactionLedger.findMany({
        where: {
          user_id: userId,
          source_id: loanId,
          type: "deduction",
        },
      });

      if (deductions.length === 0) {
        throw new AppError(404, "No deductions found for this loan");
      }

      const amounts = deductions.map((d: any) => Number(d.amount));
      const totalDeducted = amounts.reduce((a: number, b: number) => a + b, 0);
      const investmentIds = [
        ...new Set(
          deductions
            .map((d: any) => {
              const metadata = d.metadata as any;
              return metadata?.investmentId;
            })
            .filter(Boolean) as string[]
        ),
      ];

      // Find top investment deducted from
      const investmentDeductionMap = new Map<string, { total: number; count: number }>();
      for (const deduction of deductions) {
        const invId = ((deduction as any).metadata as any)?.investmentId;
        if (invId) {
          const current = investmentDeductionMap.get(invId) || { total: 0, count: 0 };
          current.total += Number((deduction as any).amount);
          current.count += 1;
          investmentDeductionMap.set(invId, current);
        }
      }

      let topInvestment = {
        investmentId: "",
        totalDeducted: 0,
        deductionCount: 0,
      };

      for (const [invId, data] of investmentDeductionMap.entries()) {
        if (data.total > topInvestment.totalDeducted) {
          topInvestment = {
            investmentId: invId,
            totalDeducted: data.total,
            deductionCount: data.count,
          };
        }
      }

      return {
        userId,
        loanId,
        totalDeducted,
        averageDeduction: totalDeducted / amounts.length,
        minDeduction: Math.min(...amounts),
        maxDeduction: Math.max(...amounts),
        deductionCount: amounts.length,
        investmentCount: investmentIds.length,
        dateRange: {
          earliest: new Date(
            Math.min(
              ...deductions.map((d: any) => {
                const date = new Date(d.created_at || new Date());
                return date.getTime();
              })
            )
          ),
          latest: new Date(
            Math.max(
              ...deductions.map((d: any) => {
                const date = new Date(d.created_at || new Date());
                return date.getTime();
              })
            )
          ),
        },
        topInvestmentDeducedFrom: topInvestment,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to generate deduction summary");
    }
  }

  // Validate transactions for duplicates and orphaned entries - Ensures ledger integrity
  async validateTransactionIntegrity(
    userId: string,
    loanId: string,
    type: "deduction" | "all" = "all"
  ): Promise<TransactionValidationResult> {
    try {
      const where: any = {
        user_id: userId,
        source_id: loanId,
      };

      if (type !== "all") {
        where.type = type;
      }

      const transactions = await prisma.transactionLedger.findMany({
        where,
        orderBy: { created_at: "desc" },
      });

      const errors: string[] = [];
      const warnings: string[] = [];
      const duplicates: Array<{ transactionIds: string[]; similarity: string }> = [];
      const orphanedTransactions: string[] = [];

      // Check for duplicate transactions (same amount, type, within 10 seconds)
      const transactionGroups = new Map<string, any[]>();

      for (const tx of transactions) {
        const key = `${tx.type}-${tx.amount}`;
        if (!transactionGroups.has(key)) {
          transactionGroups.set(key, []);
        }
        transactionGroups.get(key)!.push(tx);
      }

      for (const [, txList] of transactionGroups.entries()) {
        if (txList.length > 1) {
          // Check if they're within 10 seconds of each other
          for (let i = 0; i < txList.length - 1; i++) {
            const timeDiff = Math.abs(
              new Date(txList[i].created_at).getTime() -
                new Date(txList[i + 1].created_at).getTime()
            );

            if (timeDiff < 10000) {
              duplicates.push({
                transactionIds: [txList[i].id, txList[i + 1].id],
                similarity: `Same ${txList[i].type} of ${txList[i].amount}, created ${timeDiff}ms apart`,
              });

              warnings.push(
                `Potential duplicate transactions: ${txList[i].id} and ${txList[i + 1].id}`
              );
            }
          }
        }
      }

      // Check for transactions without matching audit logs (orphaned)
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          target_user_id: userId,
          action: "deduction_processed",
        },
      });

      const auditAmounts = new Set(
        auditLogs
          .map((log: any) => log.new_values?.amount)
          .filter(Boolean)
      );

      for (const tx of transactions) {
        if (tx.type === "deduction" && !auditAmounts.has(tx.amount)) {
          orphanedTransactions.push(
            `Deduction ${tx.id} (${tx.amount}) has no matching audit log`
          );
        }
      }

      if (orphanedTransactions.length > 0) {
        errors.push(
          `Found ${orphanedTransactions.length} transactions without audit trail`
        );
      }

      return {
        valid: errors.length === 0 && duplicates.length === 0,
        errors,
        warnings,
        duplicates,
        orphanedTransactions,
      };
    } catch (error) {
      throw new AppError(500, "Failed to validate transaction integrity");
    }
  }

  // Store FIFO queue snapshot for audit trail - Preserves state of investment queue at specific time for compliance
  async storeFifoQueueSnapshot(
    borrowerId: string,
    loanId: string,
    queueSnapshot: Array<{
      position: number;
      investmentId: string;
      createdAt: Date;
      currentValue: number;
      eligibleForDeduction: boolean;
    }>,
    reason?: string
  ): Promise<FifoQueueHistory> {
    try {
      // Store as audit metadata or create dedicated record
      // For now, we'll store in audit log with special action type
      await prisma.auditLog.create({
        data: {
          admin_id: "system",
          target_user_id: borrowerId,
          action: "deduction_processed",
          new_values: {
            queueSnapshot,
            reason,
            snapshotType: "fifo_queue_history",
          },
        },
      });

      return {
        borrowerId,
        loanId,
        timestamp: new Date(),
        queueSnapshot,
        reasonForSnapshot: reason,
      };
    } catch (error) {
      throw new AppError(500, "Failed to store FIFO queue snapshot");
    }
  }

  // Get FIFO queue history for audit trail - Retrieves historical snapshots of investment queue
  async getFifoQueueHistory(
    borrowerId: string,
    loanId: string,
    limit: number = 20
  ): Promise<FifoQueueHistory[]> {
    try {
      const snapshots = await prisma.auditLog.findMany({
        where: {
          target_user_id: borrowerId,
        },
        orderBy: { created_at: "desc" },
        take: limit,
      });

      // Filter to FIFO queue history snapshots
      return snapshots
        .filter((snapshot: any) => {
          const newVals = snapshot.new_values as any;
          return newVals?.snapshotType === "fifo_queue_history";
        })
        .map((snapshot: any) => ({
          borrowerId,
          loanId,
          timestamp: snapshot.created_at,
          queueSnapshot: (snapshot.new_values as any)?.queueSnapshot || [],
          reasonForSnapshot: (snapshot.new_values as any)?.reason,
        }));
    } catch (error) {
      throw new AppError(500, "Failed to fetch FIFO queue history");
    }
  }
}

export const ledgerReconciliationService = new LedgerReconciliationService();

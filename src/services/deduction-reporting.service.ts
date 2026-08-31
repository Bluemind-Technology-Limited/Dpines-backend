// Deduction Reporting Service - Financial reporting APIs, FIFO queue history tracking, and comprehensive analytics - Phase 7.2: Complete Ledger Tracking

import prisma from "../configs/database.js";
import { AppError } from "../middlewares/error.middleware.js";

interface FifoQueueHistoryEntry {
  timestamp: Date;
  position: number;
  investmentId: string;
  createdAt: Date;
  currentValue: number;
  eligibleForDeduction: boolean;
  deductedInPeriod?: boolean;
  deductionAmount?: number;
}

interface FifoQueueTimeline {
  borrowerId: string;
  loanId: string;
  totalSnapshots: number;
  firstSnapshot: Date;
  lastSnapshot: Date;
  history: FifoQueueHistoryEntry[];
}

interface DeductionReport {
  period: { startDate: Date; endDate: Date };
  summary: {
    totalDeductions: number;
    averageDeduction: number;
    minDeduction: number;
    maxDeduction: number;
    deductionCount: number;
  };
  byInvestment: Array<{
    investmentId: string;
    totalDeducted: number;
    deductionCount: number;
    averageDeduction: number;
    lastDeductionDate: Date;
  }>;
  byReason: Array<{
    reason: string;
    count: number;
    totalAmount: number;
    percentage: number;
  }>;
  timeline: Array<{
    date: Date;
    deductionCount: number;
    totalAmount: number;
  }>;
}

interface FinancialHealth {
  userId: string;
  loanId: string;
  totalDeducted: number;
  remainingInvestments: number;
  investmentRiskProfile: {
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  };
  deductionPace: {
    perDay: number;
    perWeek: number;
    perMonth: number;
  };
  projectedDeductionCompletion?: Date;
}

interface SequenceValidationReport {
  loanId: string;
  userId: string;
  timestamp: Date;
  valid: boolean;
  fifoCompliance: number; // percentage 0-100
  violations: Array<{
    position: number;
    investmentId: string;
    reason: string;
  }>;
  recommendations: string[];
}

interface ComplianceReport {
  period: { startDate: Date; endDate: Date };
  totalDeductions: number;
  totalLoans: number;
  totalUsers: number;
  complianceMetrics: {
    fifoComplianceRate: number; // percentage
    auditTrailCompleteness: number; // percentage
    duplicateRate: number; // percentage
    orphanedTransactionRate: number; // percentage
  };
  flaggedItems: Array<{
    itemId: string;
    issue: string;
    severity: "low" | "medium" | "high";
    requiredAction: string;
  }>;
}

interface InvestmentDeductionAnalysis {
  investmentId: string;
  totalDeducted: number;
  remainingValue: number;
  deductionPercentage: number;
  timeSinceFirstDeduction: number; // days
  deductionFrequency: number; // deductions per month
  estimatedCompletionDate?: Date;
  deductionHistory: Array<{
    date: Date;
    amount: number;
    loanId: string;
    reason: string;
  }>;
}

export class DeductionReportingService {
  // Get comprehensive deduction report for a period - Shows detailed breakdown of all deductions by investment, reason, and timeline
  async getDeductionReport(
    loanId: string,
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DeductionReport> {
    try {
      // Get all deductions in period
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

      if (deductions.length === 0) {
        throw new AppError(404, "No deductions found for this period");
      }

      // Calculate summary
      const amounts = deductions.map((d: any) => Number(d.amount));
      const totalDeductions = amounts.reduce((a: number, b: number) => a + b, 0);
      const averageDeduction = totalDeductions / amounts.length;

      // Group by investment
      const byInvestmentMap = new Map<
        string,
        { total: number; count: number; lastDate: Date }
      >();
      const byReasonMap = new Map<string, { count: number; total: number }>();

      for (const deduction of deductions) {
        const metadata = (deduction as any).metadata as any;
        const invId = metadata?.investmentId || "unknown";
        const reason = deduction.description || "unspecified";

        // By investment
        const invData = byInvestmentMap.get(invId) || {
          total: 0,
          count: 0,
          lastDate: new Date(),
        };
        invData.total += Number(deduction.amount);
        invData.count += 1;
        invData.lastDate = new Date(deduction.created_at || new Date());
        byInvestmentMap.set(invId, invData);

        // By reason
        const reasonData = byReasonMap.get(reason) || { count: 0, total: 0 };
        reasonData.count += 1;
        reasonData.total += Number(deduction.amount);
        byReasonMap.set(reason, reasonData);
      }

      // Convert to arrays
      const byInvestment = Array.from(byInvestmentMap.entries()).map(
        ([invId, data]) => ({
          investmentId: invId,
          totalDeducted: data.total,
          deductionCount: data.count,
          averageDeduction: data.total / data.count,
          lastDeductionDate: data.lastDate,
        })
      );

      const byReason = Array.from(byReasonMap.entries()).map(([reason, data]) => ({
        reason,
        count: data.count,
        totalAmount: data.total,
        percentage: (data.total / totalDeductions) * 100,
      }));

      // Group by date for timeline
      const timelineMap = new Map<string, { count: number; total: number }>();
      for (const deduction of deductions) {
        const dateKey = new Date(deduction.created_at || new Date())
          .toISOString()
          .split("T")[0];
        const existing = timelineMap.get(dateKey) || { count: 0, total: 0 };
        existing.count += 1;
        existing.total += Number(deduction.amount);
        timelineMap.set(dateKey, existing);
      }

      const timeline = Array.from(timelineMap.entries())
        .map(([date, data]) => ({
          date: new Date(date),
          deductionCount: data.count,
          totalAmount: data.total,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        period: { startDate, endDate },
        summary: {
          totalDeductions,
          averageDeduction,
          minDeduction: Math.min(...amounts),
          maxDeduction: Math.max(...amounts),
          deductionCount: amounts.length,
        },
        byInvestment: byInvestment.sort(
          (a, b) => b.totalDeducted - a.totalDeducted
        ),
        byReason: byReason.sort((a, b) => b.totalAmount - a.totalAmount),
        timeline,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to generate deduction report");
    }
  }

  // Get FIFO queue timeline - Tracks how the queue changed over time
  async getFifoQueueTimeline(
    borrowerId: string,
    loanId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<FifoQueueTimeline> {
    try {
      const where: any = {
        target_user_id: borrowerId,
      };

      if (startDate || endDate) {
        where.created_at = {};
        if (startDate) where.created_at.gte = startDate;
        if (endDate) where.created_at.lte = endDate;
      }

      const snapshots = await prisma.auditLog.findMany({
        where,
        orderBy: { created_at: "asc" },
      });

      // Filter snapshots that contain FIFO queue history
      const fifoSnapshots = snapshots.filter((s: any) => {
        const newVals = s.new_values as any;
        return newVals?.snapshotType === "fifo_queue_history";
      });

      if (fifoSnapshots.length === 0) {
        throw new AppError(404, "No FIFO queue snapshots found");
      }

      const history: FifoQueueHistoryEntry[] = [];
      const allInvestments = new Set<string>();

      for (const snapshot of fifoSnapshots) {
        const newVals = snapshot.new_values as any;
        const queueSnapshot = newVals?.queueSnapshot || [];
        for (const entry of queueSnapshot) {
          allInvestments.add(entry.investmentId);
          history.push({
            timestamp: snapshot.created_at,
            position: entry.position,
            investmentId: entry.investmentId,
            createdAt: entry.createdAt,
            currentValue: entry.currentValue,
            eligibleForDeduction: entry.eligibleForDeduction,
          });
        }
      }

      const sortedHistory = history.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );

      return {
        borrowerId,
        loanId,
        totalSnapshots: fifoSnapshots.length,
        firstSnapshot: sortedHistory[0]?.timestamp || new Date(),
        lastSnapshot: sortedHistory[sortedHistory.length - 1]?.timestamp || new Date(),
        history: sortedHistory,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to generate FIFO queue timeline");
    }
  }

  // Get financial health assessment - Shows deduction pace, investment risk, and projected timeline
  async getFinancialHealth(
    userId: string,
    loanId: string
  ): Promise<FinancialHealth> {
    try {
      // Get deduction history (last 90 days)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const recentDeductions = await prisma.transactionLedger.findMany({
        where: {
          user_id: userId,
          source_id: loanId,
          type: "deduction",
          created_at: {
            gte: ninetyDaysAgo,
          },
        },
      });

      // Get all investments
      const investments = await prisma.investment.findMany({
        where: { user_id: userId },
      });

      // Get all deductions ever
      const allDeductions = await prisma.transactionLedger.findMany({
        where: {
          user_id: userId,
          source_id: loanId,
          type: "deduction",
        },
      });

      const totalDeducted = allDeductions.reduce((sum: number, d: any) => sum + d.amount, 0);
      const remainingInvestments = investments.length;

      // Calculate deduction pace
      const daysPassed = 90; // Use fixed 90 days for consistency
      const deductionsPerDay = recentDeductions.length / daysPassed;
      const deductionsPerWeek = deductionsPerDay * 7;
      const deductionsPerMonth = deductionsPerDay * 30;

      // Risk profile (simplified: based on deduction count from each)
      const investmentDeductionCounts = new Map<string, number>();
      for (const deduction of allDeductions) {
        const invId = ((deduction as any).metadata as any)?.investmentId;
        if (invId) {
          investmentDeductionCounts.set(
            invId,
            (investmentDeductionCounts.get(invId) || 0) + 1
          );
        }
      }

      const highRisk = Array.from(investmentDeductionCounts.values()).filter(
        (count) => count > 5
      ).length;
      const mediumRisk = Array.from(investmentDeductionCounts.values()).filter(
        (count) => count > 2 && count <= 5
      ).length;
      const lowRisk = Array.from(investmentDeductionCounts.values()).filter(
        (count) => count <= 2
      ).length;

      // Project completion date if deduction pace continues
      const remainingInvestmentValue = investments.reduce(
        (sum: number, inv: any) => sum + Number(inv.current_value || 0),
        0
      );
      let projectedCompletion: Date | undefined;

      if (deductionsPerDay > 0 && remainingInvestmentValue > 0) {
        const daysRemaining = Math.ceil(
          remainingInvestmentValue / (deductionsPerDay * 1000) // Estimate deduction size
        );
        projectedCompletion = new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);
      }

      return {
        userId,
        loanId,
        totalDeducted,
        remainingInvestments,
        investmentRiskProfile: {
          highRisk,
          mediumRisk,
          lowRisk,
        },
        deductionPace: {
          perDay: Math.round(deductionsPerDay * 100) / 100,
          perWeek: Math.round(deductionsPerWeek * 100) / 100,
          perMonth: Math.round(deductionsPerMonth * 100) / 100,
        },
        projectedDeductionCompletion: projectedCompletion,
      };
    } catch (error) {
      throw new AppError(500, "Failed to assess financial health");
    }
  }

  // Get sequence validation report - Provides detailed analysis of FIFO compliance
  async getSequenceValidationReport(
    loanId: string,
    userId: string,
    deductionSequence: Array<{ investmentId: string; amount: number }>
  ): Promise<SequenceValidationReport> {
    try {
      const investments = await prisma.investment.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "asc" },
      });

      const violations: Array<{
        position: number;
        investmentId: string;
        reason: string;
      }> = [];
      let currentPosition = -1;

      for (let i = 0; i < deductionSequence.length; i++) {
        const { investmentId } = deductionSequence[i];
        const position = investments.findIndex((inv: any) => inv.id === investmentId);

        if (position < currentPosition) {
          violations.push({
            position: i,
            investmentId,
            reason: `Investment at position ${position} violates FIFO (previous position: ${currentPosition})`,
          });
        }

        currentPosition = Math.max(currentPosition, position);
      }

      const fifoCompliance = Math.round(
        ((deductionSequence.length - violations.length) / deductionSequence.length) * 100
      );

      const recommendations: string[] = [];

      if (fifoCompliance < 100) {
        recommendations.push(
          `Reorder deductions to follow FIFO: start with oldest investments first`
        );
        recommendations.push(
          `${violations.length} deductions violate FIFO order and should be corrected`
        );
      } else {
        recommendations.push("Deduction sequence is FIFO compliant - no changes needed");
      }

      if (deductionSequence.length > 10) {
        recommendations.push(
          "Consider splitting large batch deductions into smaller batches for better tracking"
        );
      }

      return {
        loanId,
        userId,
        timestamp: new Date(),
        valid: violations.length === 0,
        fifoCompliance,
        violations,
        recommendations,
      };
    } catch (error) {
      throw new AppError(500, "Failed to generate sequence validation report");
    }
  }

  // Get compliance report for a period - Comprehensive audit compliance metrics
  async getComplianceReport(
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    try {
      // Get all deductions in period
      const deductions = await prisma.transactionLedger.findMany({
        where: {
          type: "deduction",
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Get all audit logs in period
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          action: "deduction_processed",
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Count unique loans and users
      const loansImpacted = new Set(deductions.map((d: any) => d.source_id));
      const usersImpacted = new Set(deductions.map((d: any) => d.user_id));

      // Calculate compliance metrics
      const auditTrailCompleteness =
        auditLogs.length > 0
          ? Math.round((Math.min(deductions.length, auditLogs.length) / deductions.length) * 100)
          : 0;

      // Check for duplicates
      const deductionsByKey = new Map<string, any[]>();
      for (const d of deductions) {
        const key = `${d.type}-${Number(d.amount)}-${d.user_id}`;
        if (!deductionsByKey.has(key)) {
          deductionsByKey.set(key, []);
        }
        deductionsByKey.get(key)!.push(d);
      }

      let duplicates = 0;
      for (const [, items] of deductionsByKey) {
        if (items.length > 1) {
          duplicates += items.length - 1;
        }
      }

      const duplicateRate = Math.round((duplicates / deductions.length) * 100);

      // Check for orphaned transactions
      const auditAmounts = new Set(
        auditLogs.map((log: any) => log.new_values?.amount).filter(Boolean)
      );

      let orphaned = 0;
      for (const d of deductions) {
        const amountNum = Number((d as any).amount);
        if (!auditAmounts.has(amountNum)) {
          orphaned++;
        }
      }

      const orphanedRate = Math.round((orphaned / deductions.length) * 100);

      // FIFO compliance rate (simplified estimate)
      const fifoCompliance = Math.max(0, 100 - orphanedRate - duplicateRate);

      // Identify flagged items
      const flaggedItems: Array<{
        itemId: string;
        issue: string;
        severity: "low" | "medium" | "high";
        requiredAction: string;
      }> = [];

      if (duplicateRate > 5) {
        flaggedItems.push({
          itemId: "duplicate-transactions",
          issue: `${duplicates} duplicate transactions detected (${duplicateRate}%)`,
          severity: "high",
          requiredAction: "Investigate and remove duplicate deductions",
        });
      }

      if (orphanedRate > 5) {
        flaggedItems.push({
          itemId: "orphaned-transactions",
          issue: `${orphaned} transactions without audit trail (${orphanedRate}%)`,
          severity: "high",
          requiredAction: "Add missing audit logs or remove orphaned transactions",
        });
      }

      if (auditTrailCompleteness < 100) {
        flaggedItems.push({
          itemId: "incomplete-audit-trail",
          issue: `Audit trail only ${auditTrailCompleteness}% complete`,
          severity: "medium",
          requiredAction: "Ensure all deductions are logged in audit trail",
        });
      }

      return {
        period: { startDate, endDate },
        totalDeductions: deductions.length,
        totalLoans: loansImpacted.size,
        totalUsers: usersImpacted.size,
        complianceMetrics: {
          fifoComplianceRate: fifoCompliance,
          auditTrailCompleteness,
          duplicateRate,
          orphanedTransactionRate: orphanedRate,
        },
        flaggedItems,
      };
    } catch (error) {
      throw new AppError(500, "Failed to generate compliance report");
    }
  }

  // Analyze deduction patterns for a specific investment
  async analyzeInvestmentDeductions(
    investmentId: string
  ): Promise<InvestmentDeductionAnalysis> {
    try {
      // Get investment details
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      // Get all deductions for this investment
      const deductions = await prisma.transactionLedger.findMany({
        where: {
          type: "deduction",
        },
        orderBy: { created_at: "asc" },
      });

      // Filter to this investment
      const filteredDeductions = deductions.filter((d: any) => {
        const metadata = (d as any).metadata as any;
        return metadata?.investmentId === investmentId;
      });

      const totalDeducted = filteredDeductions.reduce(
        (sum: number, d: any) => sum + Number(d.amount),
        0
      );
      const remainingValue = Math.max(
        0,
        Number(investment.current_value || 0) - totalDeducted
      );
      const deductionPercentage =
        Number(investment.current_value || 0) > 0
          ? (totalDeducted / Number(investment.current_value || 0)) * 100
          : 0;

      // Calculate time metrics
      let timeSinceFirstDeduction = 0;
      let estimatedCompletionDate: Date | undefined;

      if (filteredDeductions.length > 0) {
        const firstDeduction = new Date(
          filteredDeductions[0].created_at || new Date()
        );
        const now = new Date();
        timeSinceFirstDeduction = Math.floor(
          (now.getTime() - firstDeduction.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Calculate frequency
        const deductionFrequency =
          (filteredDeductions.length / timeSinceFirstDeduction) * 30; // per month

        // Project completion
        if (deductionFrequency > 0 && remainingValue > 0) {
          const avgDeductionSize =
            totalDeducted / filteredDeductions.length;
          const deductionsRemaining = Math.ceil(
            remainingValue / avgDeductionSize
          );
          const daysRemaining = Math.ceil(
            deductionsRemaining / (deductionFrequency / 30)
          );
          estimatedCompletionDate = new Date(
            now.getTime() + daysRemaining * 24 * 60 * 60 * 1000
          );
        }
      }

      // Build deduction history
      const deductionHistory = filteredDeductions.map((d: any) => ({
        date: d.created_at,
        amount: Number(d.amount),
        loanId: d.source_id || "unknown",
        reason: d.description || "unspecified",
      }));

      return {
        investmentId,
        totalDeducted,
        remainingValue,
        deductionPercentage,
        timeSinceFirstDeduction,
        deductionFrequency: filteredDeductions.length > 0
          ? (filteredDeductions.length / timeSinceFirstDeduction) * 30
          : 0,
        estimatedCompletionDate,
        deductionHistory,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to analyze investment deductions");
    }
  }
}

export const deductionReportingService = new DeductionReportingService();

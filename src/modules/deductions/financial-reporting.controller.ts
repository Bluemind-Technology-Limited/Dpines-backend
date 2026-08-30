// Financial Reporting Controller - Deduction reporting APIs, FIFO history tracking, and financial analytics - Phase 7.2: Complete Ledger Tracking

import { Router, Request, Response } from "express";
import { deductionReportingService } from "../../services/deduction-reporting.service.js";
import { asyncHandler } from "../../middlewares/async.middleware.js";
import { authenticate, adminOnly } from "../../middlewares/auth.middleware.js";
import { AppError } from "../../middlewares/error.middleware.js";

const router: Router = Router();

// GET /api/deductions/reports/deduction-report - Get comprehensive deduction report for a period - Shows detailed breakdown by investment, reason, and timeline - Query params: - - loanId: string (required) - - userId: string (required) - - startDate: ISO string (required) - - endDate: ISO string (required) - Response: - { - success: true, - data: { - period: { startDate, endDate }, - summary: { totalDeductions, averageDeduction, minDeduction, maxDeduction, deductionCount }, - byInvestment: Array<{ investmentId, totalDeducted, deductionCount, averageDeduction, lastDeductionDate }>, - byReason: Array<{ reason, count, totalAmount, percentage }>, - timeline: Array<{ date, deductionCount, totalAmount }> - } - }
router.get(
  "/reports/deduction-report",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, userId, startDate, endDate } = req.query;

    if (!loanId || !userId || !startDate || !endDate) {
      throw new AppError(
        400,
        "Missing required query params: loanId, userId, startDate, endDate"
      );
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, "Invalid date format");
    }

    if (start > end) {
      throw new AppError(400, "startDate must be before endDate");
    }

    const report = await deductionReportingService.getDeductionReport(
      loanId as string,
      userId as string,
      start,
      end
    );

    res.status(200).json({
      success: true,
      message: "Deduction report generated",
      data: report,
    });
  })
);

// GET /api/deductions/reports/fifo-timeline - Get FIFO queue timeline showing historical changes - Query params: - - borrowerId: string (required) - - loanId: string (required) - - startDate: ISO string (optional) - - endDate: ISO string (optional) - Response: - { - success: true, - data: { - borrowerId: string, - loanId: string, - totalSnapshots: number, - firstSnapshot: Date, - lastSnapshot: Date, - history: Array<FifoQueueHistoryEntry> - } - }
router.get(
  "/reports/fifo-timeline",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { borrowerId, loanId, startDate, endDate } = req.query;

    if (!borrowerId || !loanId) {
      throw new AppError(400, "Missing required query params: borrowerId, loanId");
    }

    let start: Date | undefined;
    let end: Date | undefined;

    if (startDate) {
      start = new Date(startDate as string);
      if (isNaN(start.getTime())) {
        throw new AppError(400, "Invalid startDate format");
      }
    }

    if (endDate) {
      end = new Date(endDate as string);
      if (isNaN(end.getTime())) {
        throw new AppError(400, "Invalid endDate format");
      }
    }

    if (start && end && start > end) {
      throw new AppError(400, "startDate must be before endDate");
    }

    const timeline = await deductionReportingService.getFifoQueueTimeline(
      borrowerId as string,
      loanId as string,
      start,
      end
    );

    res.status(200).json({
      success: true,
      message: "FIFO queue timeline retrieved",
      data: timeline,
    });
  })
);

// GET /api/deductions/reports/financial-health - Get financial health assessment - Shows deduction pace, investment risk profile, and projected timeline - Query params: - - userId: string (required) - - loanId: string (required) - Response: - { - success: true, - data: { - userId: string, - loanId: string, - totalDeducted: number, - remainingInvestments: number, - investmentRiskProfile: { highRisk, mediumRisk, lowRisk }, - deductionPace: { perDay, perWeek, perMonth }, - projectedDeductionCompletion: Date - } - }
router.get(
  "/reports/financial-health",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, loanId } = req.query;

    if (!userId || !loanId) {
      throw new AppError(400, "Missing required query params: userId, loanId");
    }

    const health = await deductionReportingService.getFinancialHealth(
      userId as string,
      loanId as string
    );

    res.status(200).json({
      success: true,
      message: "Financial health assessment retrieved",
      data: health,
    });
  })
);

// POST /api/deductions/reports/sequence-validation - Get detailed FIFO sequence validation report - Body: - { - "loanId": "loan_123", - "userId": "user_456", - "deductionSequence": [ - { "investmentId": "inv_001", "amount": 50000 }, - { "investmentId": "inv_002", "amount": 30000 } - ] - } - Response: - { - success: true, - data: { - loanId: string, - userId: string, - timestamp: Date, - valid: boolean, - fifoCompliance: number, - violations: Array<{ position, investmentId, reason }>, - recommendations: string[] - } - }
router.post(
  "/reports/sequence-validation",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, userId, deductionSequence } = req.body;

    if (!loanId || !userId || !Array.isArray(deductionSequence)) {
      throw new AppError(
        400,
        "Missing required fields: loanId, userId, deductionSequence (array)"
      );
    }

    if (deductionSequence.length === 0) {
      throw new AppError(400, "Deduction sequence cannot be empty");
    }

    for (const deduction of deductionSequence) {
      if (!deduction.investmentId || typeof deduction.amount !== "number") {
        throw new AppError(
          400,
          "Each deduction must have investmentId and amount (number)"
        );
      }

      if (deduction.amount <= 0) {
        throw new AppError(400, "Deduction amounts must be positive");
      }
    }

    const report = await deductionReportingService.getSequenceValidationReport(
      loanId,
      userId,
      deductionSequence
    );

    res.status(200).json({
      success: report.valid,
      message: report.valid
        ? "Deduction sequence is FIFO compliant"
        : "Deduction sequence has FIFO violations",
      data: report,
    });
  })
);

// GET /api/deductions/reports/compliance-report - Get comprehensive compliance report for a period - Includes metrics on duplicates, orphaned transactions, audit trail completeness - Query params: - - startDate: ISO string (required) - - endDate: ISO string (required) - Response: - { - success: true, - data: { - period: { startDate, endDate }, - totalDeductions: number, - totalLoans: number, - totalUsers: number, - complianceMetrics: { - fifoComplianceRate: number, - auditTrailCompleteness: number, - duplicateRate: number, - orphanedTransactionRate: number - }, - flaggedItems: Array<{ itemId, issue, severity, requiredAction }> - } - }
router.get(
  "/reports/compliance-report",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new AppError(400, "Missing required query params: startDate, endDate");
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, "Invalid date format");
    }

    if (start > end) {
      throw new AppError(400, "startDate must be before endDate");
    }

    const report = await deductionReportingService.getComplianceReport(start, end);

    const allCompliant =
      report.complianceMetrics.fifoComplianceRate === 100 &&
      report.complianceMetrics.duplicateRate === 0 &&
      report.complianceMetrics.orphanedTransactionRate === 0;

    res.status(200).json({
      success: allCompliant,
      message: allCompliant
        ? "Full compliance - no issues detected"
        : "Compliance issues detected - see flaggedItems",
      data: report,
    });
  })
);

// GET /api/deductions/reports/investment-analysis/:investmentId - Analyze deduction patterns for a specific investment - Shows usage history, frequency, and completion projections - Response: - { - success: true, - data: { - investmentId: string, - totalDeducted: number, - remainingValue: number, - deductionPercentage: number, - timeSinceFirstDeduction: number, - deductionFrequency: number, - estimatedCompletionDate: Date, - deductionHistory: Array<{ date, amount, loanId, reason }> - } - }
router.get(
  "/reports/investment-analysis/:investmentId",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { investmentId } = req.params;

    if (!investmentId) {
      throw new AppError(400, "Missing required parameter: investmentId");
    }

    const analysis = await deductionReportingService.analyzeInvestmentDeductions(
      investmentId
    );

    res.status(200).json({
      success: true,
      message: "Investment deduction analysis retrieved",
      data: analysis,
    });
  })
);

// POST /api/deductions/reports/executive-summary - Generate executive summary combining multiple reports - Provides high-level overview for stakeholders - Body: - { - "loanId": "loan_123", - "userId": "user_456", - "startDate": "2024-01-01T00:00:00Z", - "endDate": "2024-01-31T23:59:59Z", - "includeProjections": true - } - Response: - { - success: true, - data: { - period: { startDate, endDate }, - overview: { ... }, - keyMetrics: { ... }, - risks: [ ... ], - recommendations: [ ... ] - } - }
router.post(
  "/reports/executive-summary",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { loanId, userId, startDate, endDate, includeProjections } = req.body;

    if (!loanId || !userId || !startDate || !endDate) {
      throw new AppError(
        400,
        "Missing required fields: loanId, userId, startDate, endDate"
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError(400, "Invalid date format");
    }

    if (start > end) {
      throw new AppError(400, "startDate must be before endDate");
    }

    try {
      // Gather all reports
      const [deductionReport, health, complianceReport] = await Promise.all([
        deductionReportingService.getDeductionReport(userId, loanId, start, end),
        deductionReportingService.getFinancialHealth(userId, loanId),
        deductionReportingService.getComplianceReport(start, end),
      ]);

      // Compile executive summary
      const summary = {
        period: { startDate: start, endDate: end },
        overview: {
          totalDeductions: deductionReport.summary.totalDeductions,
          averageDeductionSize: deductionReport.summary.averageDeduction,
          deductionCount: deductionReport.summary.deductionCount,
          investmentsImpacted: deductionReport.byInvestment.length,
          complianceStatus: complianceReport.flaggedItems.length === 0 ? "compliant" : "non-compliant",
        },
        keyMetrics: {
          deductionPace: health.deductionPace,
          investmentRiskProfile: health.investmentRiskProfile,
          fifoComplianceRate: complianceReport.complianceMetrics.fifoComplianceRate,
          auditTrailCompleteness: complianceReport.complianceMetrics.auditTrailCompleteness,
        },
        risks: complianceReport.flaggedItems.map((item) => ({
          issue: item.issue,
          severity: item.severity,
          action: item.requiredAction,
        })),
        recommendations: [
          ...deductionReport.byInvestment
            .slice(0, 3)
            .map(
              (inv) =>
                `Investment ${inv.investmentId} has been deducted ${inv.deductionCount} times - monitor for threshold breach`
            ),
          includeProjections && health.projectedDeductionCompletion
            ? `At current pace, deductions will complete by ${health.projectedDeductionCompletion.toISOString().split("T")[0]}`
            : null,
        ].filter(Boolean),
      };

      res.status(200).json({
        success: true,
        message: "Executive summary generated",
        data: summary,
      });
    } catch (error) {
      throw new AppError(500, "Failed to generate executive summary");
    }
  })
);

// GET /api/deductions/reports/dashboard-data - Get all dashboard data in a single request - Combines key metrics for admin dashboard - Query params: - - userId: string (required) - - loanId: string (required) - - days: number (optional, default 30 - last N days) - Response: - { - success: true, - data: { - summary: { ... }, - recentActivity: [ ... ], - healthScore: number, - alerts: [ ... ] - } - }
router.get(
  "/reports/dashboard-data",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, loanId, days } = req.query;

    if (!userId || !loanId) {
      throw new AppError(400, "Missing required query params: userId, loanId");
    }

    const daysPeriod = Math.min(parseInt(days as string) || 30, 365);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysPeriod * 24 * 60 * 60 * 1000);

    try {
      const [deductionReport, health] = await Promise.all([
        deductionReportingService.getDeductionReport(
          loanId as string,
          userId as string,
          startDate,
          endDate
        ),
        deductionReportingService.getFinancialHealth(
          userId as string,
          loanId as string
        ),
      ]);

      // Calculate health score (0-100)
      const healthScore = Math.max(
        0,
        Math.min(
          100,
          100 -
            (health.deductionPace.perMonth > 10 ? 20 : 0) -
            (health.investmentRiskProfile.highRisk > 2 ? 15 : 0) -
            (health.remainingInvestments < 2 ? 10 : 0)
        )
      );

      // Generate alerts
      const alerts: Array<{ severity: string; message: string }> = [];

      if (health.deductionPace.perMonth > 10) {
        alerts.push({
          severity: "warning",
          message: `High deduction rate: ${Math.round(health.deductionPace.perMonth)} per month`,
        });
      }

      if (health.investmentRiskProfile.highRisk > 0) {
        alerts.push({
          severity: "warning",
          message: `${health.investmentRiskProfile.highRisk} investments at high risk of further deductions`,
        });
      }

      if (health.remainingInvestments < 3) {
        alerts.push({
          severity: "critical",
          message: "Few investments remaining - deduction completion imminent",
        });
      }

      const dashboardData = {
        summary: {
          totalDeductions: deductionReport.summary.totalDeductions,
          deductionCount: deductionReport.summary.deductionCount,
          averageDeduction: deductionReport.summary.averageDeduction,
          dateRange: { startDate, endDate },
        },
        recentActivity: deductionReport.timeline.slice(-10),
        topInvestments: deductionReport.byInvestment.slice(0, 5),
        healthScore,
        alerts,
        projections: {
          estimatedCompletion: health.projectedDeductionCompletion,
          remainingInvestments: health.remainingInvestments,
          pace: health.deductionPace,
        },
      };

      res.status(200).json({
        success: true,
        message: "Dashboard data retrieved",
        data: dashboardData,
      });
    } catch (error) {
      throw new AppError(500, "Failed to retrieve dashboard data");
    }
  })
);

export default router;

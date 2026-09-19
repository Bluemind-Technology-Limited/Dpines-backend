import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import type {
  Investment,
  InvestmentStatus,
  PayoutFrequency,
} from "../../types/index.js";
import { calculateInvestmentCurrentValue, getMonthsBetweenDates } from "../../lib/utils.js";
import { ledgerService } from "../../services/ledger.service.js";
import { auditService } from "../../services/audit.service.js";
import notificationService from "../notifications/notification.service.js";
import { edgeFunctionService } from "../../services/edge-function.service.js";

export class InvestmentService {
  async createInvestment(
    userId: string,
    amount: number,
    interestRate: number,
    termMonths: number,
    payoutFrequency: PayoutFrequency
  ): Promise<Investment> {
    try {
      // Verify user exists
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      const investment = await prisma.investment.create({
        data: {
          user_id: userId,
          amount,
          initial_amount: amount,
          interest_rate: interestRate,
          term_months: termMonths,
          payout_frequency: payoutFrequency,
          current_value: amount,
        },
      });

      // Log transaction to ledger
      try {
        await ledgerService.logTransaction({
          userId,
          amount,
          type: "deposit" as any,
          sourceId: investment.id,
          method: "internal",
          description: `Investment created: ₦${amount.toLocaleString()} at ${interestRate}% for ${termMonths} months (${payoutFrequency})`,
        });
      } catch (ledgerError) {
        console.error("[LEDGER ERROR] Failed to log investment creation:", ledgerError);
        // Don't fail the investment creation if ledger logging fails
      }

      return investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create investment");
    }
  }

  async getInvestmentById(investmentId: string): Promise<Investment | null> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
        include: {
          users: true,
        },
      });

      if (!investment) {
        return null;
      }

      // Calculate current_value dynamically from ledger instead of using stored value
      const currentValue = await this.calculateCurrentValueFromLedger(investmentId);

      // Return investment with dynamically calculated current_value
      return {
        ...investment,
        current_value: currentValue,
      };
    } catch (error) {
      console.error("[INVESTMENT FETCH ERROR] investmentId:", investmentId, "Error:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, `Failed to fetch investment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getUserInvestments(userId: string, status?: InvestmentStatus) {
    try {
      const where: any = { user_id: userId };
      if (status) {
        where.status = status;
      }

      const investments = await prisma.investment.findMany({
        where,
        orderBy: {
          created_at: "desc",
        },
      });

      return investments;
    } catch (error) {
      throw new AppError(500, "Failed to fetch user investments");
    }
  }

  async getAllInvestments(
    status?: InvestmentStatus,
    skip: number = 0,
    take: number = 10
  ) {
    try {
      const where: any = {};
      if (status) {
        where.status = status;
      }

      const [investments, total] = await Promise.all([
        prisma.investment.findMany({
          where,
          include: {
            users: true,
          },
          skip,
          take,
          orderBy: {
            created_at: "desc",
          },
        }),
        prisma.investment.count({ where }),
      ]);

      return { investments, total };
    } catch (error) {
      throw new AppError(500, "Failed to fetch investments");
    }
  }

  async approveInvestment(investmentId: string): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "pending") {
        throw new AppError(400, "Investment is not in pending status");
      }

      const start_date = new Date();
      const end_date = new Date();
      end_date.setMonth(end_date.getMonth() + investment.term_months);

      const approvedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          status: "active" as any,
          // Preserve the original principal as the interest basis on activation.
          initial_amount: (investment as any).initial_amount ?? investment.amount,
          start_date,
          end_date,
          updated_at: new Date(),
        } as any,
      });

      // Record the lifecycle change (non-monetary) so history is complete.
      try {
        await ledgerService.logEvent(
          investment.user_id,
          investmentId,
          "status_change",
          `Investment approved — active ${start_date.toISOString().slice(0, 10)} → ${end_date.toISOString().slice(0, 10)}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log investment approval:", ledgerError);
      }

      return approvedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to approve investment");
    }
  }

  async rejectInvestment(
    investmentId: string,
    rejectionReason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "pending") {
        throw new AppError(400, "Investment is not in pending status");
      }

      const rejectedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          status: "rejected" as any,
          rejection_reason: rejectionReason,
          updated_at: new Date(),
        } as any,
      });

      try {
        await ledgerService.logEvent(
          investment.user_id,
          investmentId,
          "status_change",
          `Investment rejected — ${rejectionReason}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log investment rejection:", ledgerError);
      }

      return rejectedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reject investment");
    }
  }

  async setMaturityAction(
    investmentId: string,
    action: "withdraw" | "rollover"
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
        include: {
          users: true,
        },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active") {
        throw new AppError(400, "Investment is not active");
      }

      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          maturity_action: action,
          updated_at: new Date(),
        } as any,
      });

      try {
        await ledgerService.logEvent(
          investment.user_id,
          investmentId,
          "maturity_action",
          `Maturity action selected: ${action}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log maturity action:", ledgerError);
      }

      // Notify admin on maturity action asynchronously using Edge Function
      if (investment && !investment.maturity_action && action && (investment as any).users) {
        const user = (investment as any).users;
        const userName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "User";
        edgeFunctionService.notifyAdminMaturityAction(
          updatedInvestment.id,
          userName,
          action,
          Number(updatedInvestment.amount)
        ).catch((err) => {
          console.error("Failed to trigger maturity action admin notification edge function:", err);
        });
      }

      return updatedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to set maturity action");
    }
  }

  // Request a top-up — creates a PENDING request that an admin must approve.
  // The investment itself is NOT changed here.
  async requestInvestmentTopUp(
    investmentId: string,
    requestingUserId: string,
    isAdmin: boolean,
    amount: number,
    method: "bank_transfer" = "bank_transfer",
    receiptUrl: string,  // REQUIRED - no longer optional
    tenureExtensionType: string = "maintain",
    customExtensionMonths?: number
  ) {
    try {
      if (amount <= 0) {
        throw new AppError(400, "Top-up amount must be positive");
      }

      // Receipt is mandatory for audit trail and admin verification
      if (!receiptUrl || receiptUrl.trim() === "") {
        throw new AppError(400, "Receipt proof is required for top-up requests");
      }

      // Validate tenure extension parameters
      const validExtensionTypes = ["maintain", "extend_6", "extend_12", "custom"];
      if (!validExtensionTypes.includes(tenureExtensionType)) {
        throw new AppError(400, "Invalid tenure extension type");
      }

      if (tenureExtensionType === "custom" && (!customExtensionMonths || customExtensionMonths <= 0)) {
        throw new AppError(400, "Custom extension months must be positive");
      }

      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active" || !investment.start_date) {
        throw new AppError(400, "Investment is not active or has not started");
      }

      // A regular user may only top up their own investment; an admin
      // (admin / invest_admin) may initiate a top-up on the owner's behalf.
      if (!isAdmin && investment.user_id !== requestingUserId) {
        throw new AppError(403, "You can only top up your own investment");
      }

      // Always attribute the request to the investment owner, never to the
      // admin who initiated it on the owner's behalf.
      const ownerId = investment.user_id;

      const topUp = await prisma.investmentTopup.create({
        data: {
          investment_id: investmentId,
          user_id: ownerId,
          amount,
          method,
          receipt_url: receiptUrl,
          status: "pending",
          tenure_extension_type: tenureExtensionType,
          custom_extension_months: customExtensionMonths || null,
        },
      });

      try {
        await ledgerService.logEvent(
          ownerId,
          investmentId,
          "topup_request",
          `Top-up requested — ₦${amount.toLocaleString()} (${tenureExtensionType})${receiptUrl ? ", receipt attached" : ""}`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log top-up request:", ledgerError);
      }

      console.log(`[TOP-UP] Request created for investment ${investmentId} (amount ${amount}, extension: ${tenureExtensionType}, receipt provided)`);
      return topUp;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create top-up request");
    }
  }

  // Approve a pending top-up — applies the funds to the investment WITHOUT
  // resetting the timeline: start_date / term_months / end_date stay exactly
  // as scheduled, so the payout schedule and maturity date are preserved.
  // Top-up earns interest only for the remaining duration until original end_date.
  async approveInvestmentTopUp(topUpId: string) {
    try {
      const topUp = await prisma.investmentTopup.findUnique({
        where: { id: topUpId },
        include: {
          investments: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!topUp) {
        throw new AppError(404, "Top-up request not found");
      }

      if ((topUp as any).status !== "pending") {
        throw new AppError(400, "Top-up request is not pending");
      }

      const investment = (topUp as any).investments;
      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active") {
        throw new AppError(400, "Investment is not active");
      }

      if (!investment.end_date) {
        throw new AppError(400, "Investment end date not set");
      }

      const topUpAmount = Number((topUp as any).amount);
      const currentPrincipal = Number(investment.amount);  // Use actual principal, not current_value which includes accrued interest
      const newPrincipal = currentPrincipal + topUpAmount;

      // CRITICAL: Preserve accrued profit when applying top-up
      // current_value includes both principal AND accrued profit
      // We need to extract the profit and add it back to avoid losing it
      const currentValue = Number(investment.current_value);
      const accruedProfit = Math.max(0, currentValue - currentPrincipal);
      const newCurrentValue = newPrincipal + accruedProfit;

      console.log(`[TOP-UP] Profit preservation: currentPrincipal=${currentPrincipal}, currentValue=${currentValue}, accruedProfit=${accruedProfit}, newCurrentValue=${newCurrentValue}`);

      // Calculate remaining months from now until original end_date
      const now = new Date();
      const endDate = investment.end_date instanceof Date 
        ? investment.end_date 
        : new Date(investment.end_date);
      const remainingMonths = getMonthsBetweenDates(now, endDate);

      console.log(`[TOP-UP] Calculating interest for ${remainingMonths} remaining months until ${investment.end_date}`);

      // Handle tenure extension
      const tenureExtensionType = (topUp as any).tenure_extension_type || "maintain";
      let newEndDate = investment.end_date;
      let newTermMonths = investment.term_months;
      let extensionMonths = 0;

      if (tenureExtensionType === "maintain") {
        // Keep original end date - no changes
        console.log(`[TOP-UP] Tenure: MAINTAIN - No extension`);
      } else if (tenureExtensionType === "extend_6") {
        extensionMonths = 6;
        newEndDate = new Date(investment.end_date);
        newEndDate.setMonth(newEndDate.getMonth() + 6);
        newTermMonths = investment.term_months + 6;
        console.log(`[TOP-UP] Tenure: EXTEND BY 6 MONTHS - New end date: ${newEndDate.toISOString()}`);
      } else if (tenureExtensionType === "extend_12") {
        extensionMonths = 12;
        newEndDate = new Date(investment.end_date);
        newEndDate.setMonth(newEndDate.getMonth() + 12);
        newTermMonths = investment.term_months + 12;
        console.log(`[TOP-UP] Tenure: EXTEND BY 12 MONTHS - New end date: ${newEndDate.toISOString()}`);
      } else if (tenureExtensionType === "custom") {
        extensionMonths = (topUp as any).custom_extension_months || 0;
        if (extensionMonths > 0) {
          newEndDate = new Date(investment.end_date);
          newEndDate.setMonth(newEndDate.getMonth() + extensionMonths);
          newTermMonths = investment.term_months + extensionMonths;
          console.log(`[TOP-UP] Tenure: EXTEND BY ${extensionMonths} MONTHS - New end date: ${newEndDate.toISOString()}`);
        }
      }

      // Update investment with new principal and (optionally) new tenure
      await prisma.investment.update({
        where: { id: investment.id },
        data: {
          amount: newPrincipal,
          current_value: newCurrentValue,  // Now preserves accrued profit!
          ...(extensionMonths > 0 && {
            end_date: newEndDate,
            term_months: newTermMonths,
          }),
          // EXPLICITLY NOT modifying: start_date, status, initial_amount
        },
      });

      const approvedTopUp = await prisma.investmentTopup.update({
        where: { id: topUpId },
        data: {
          status: "approved",
          approved_at: new Date(),
        },
      });

      console.log(`[TOP-UP] Approved ${topUpId}: ${topUpAmount} applied to investment ${investment.id} (new principal ${newPrincipal}, remaining months: ${remainingMonths}, extension: ${extensionMonths}mo)`);

      // Log transaction to ledger with extension info
      try {
        const extensionNote = extensionMonths > 0 ? `, Tenure Extended by ${extensionMonths} months` : "";
        await ledgerService.logTransaction({
          userId: (topUp as any).user_id,
          amount: topUpAmount,
          type: "deposit" as any,
          method: ((topUp as any).method || "bank_transfer") as any,
          sourceId: investment.id,
          description: `Investment Top-Up of ₦${topUpAmount} (New Principal: ₦${newPrincipal}, Interest for ${remainingMonths} months${extensionNote})`,
          metadata: {
            topUpAmount,
            newPrincipal,
            approvedTopUpId: topUpId,
            remainingMonths,
            originalEndDate: investment.end_date.toISOString(),
            newEndDate: newEndDate.toISOString(),
            topUpApprovedDate: new Date().toISOString(),
            tenureExtension: extensionMonths,
          },
        });
      } catch (ledgerError) {
        console.error("Failed to log top-up transaction:", ledgerError);
      }

      // Trigger confirmation email via Edge Function
      if (investment.users) {
        const user = investment.users;
        edgeFunctionService.sendInvestmentTopUpEmail(
          user.email,
          user.first_name || "Investor",
          topUpAmount,
          newPrincipal,
          investment.id
        ).catch((err) => {
          console.error("Failed to trigger top-up email edge function:", err);
        });
      }

      return approvedTopUp;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to approve top-up");
    }
  }

  // Admin: apply a top-up immediately — no approval step and no receipt.
  // Records an approved top-up row for history, then reuses the standard
  // approval pipeline so the ledger, valuation and notifications stay identical.
  async adminApplyTopUp(
    investmentId: string,
    adminId: string,
    amount: number,
    tenureExtensionType: string = "maintain",
    customExtensionMonths?: number
  ) {
    try {
      if (amount <= 0) {
        throw new AppError(400, "Top-up amount must be positive");
      }

      const validExtensionTypes = ["maintain", "extend_6", "extend_12", "custom"];
      if (!validExtensionTypes.includes(tenureExtensionType)) {
        throw new AppError(400, "Invalid tenure extension type");
      }
      if (tenureExtensionType === "custom" && (!customExtensionMonths || customExtensionMonths <= 0)) {
        throw new AppError(400, "Custom extension months must be positive");
      }

      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }
      if (investment.status !== "active" || !investment.start_date) {
        throw new AppError(400, "Investment is not active or has not started");
      }

      // Record the top-up (attributed to the investment owner), then apply it
      // through the same pipeline used for approved requests.
      const topUp = await prisma.investmentTopup.create({
        data: {
          investment_id: investmentId,
          user_id: investment.user_id,
          amount,
          method: "bank_transfer",
          receipt_url: null,
          status: "pending",
          tenure_extension_type: tenureExtensionType,
          custom_extension_months: customExtensionMonths || null,
        },
      });

      let applied;
      try {
        applied = await this.approveInvestmentTopUp(topUp.id);
      } catch (applyError) {
        // Don't leave a dangling pending record if the application fails.
        await prisma.investmentTopup.delete({ where: { id: topUp.id } }).catch(() => undefined);
        throw applyError;
      }

      // Audit the admin action
      try {
        await auditService.logAction({
          adminId,
          targetUserId: investment.user_id,
          action: "manual_adjustment",
          newValues: {
            investmentId,
            topUpAmount: amount,
            tenureExtensionType,
            customExtensionMonths: customExtensionMonths || null,
          },
        });
      } catch (auditError) {
        console.error("[ADMIN TOP-UP] Failed to write audit log:", auditError);
      }

      return applied;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to apply top-up");
    }
  }

  // Reject a pending top-up request
  async rejectInvestmentTopUp(topUpId: string, reason: string) {
    try {
      const topUp = await prisma.investmentTopup.findUnique({
        where: { id: topUpId },
      });

      if (!topUp) {
        throw new AppError(404, "Top-up request not found");
      }

      if ((topUp as any).status !== "pending") {
        throw new AppError(400, "Top-up request is not pending");
      }

      const rejectedTopUp = await prisma.investmentTopup.update({
        where: { id: topUpId },
        data: {
          status: "rejected",
          admin_notes: reason,
        },
      });

      try {
        await ledgerService.logEvent(
          (topUp as any).user_id,
          (topUp as any).investment_id,
          "topup_rejected",
          `Top-up request rejected — ₦${Number((topUp as any).amount).toLocaleString()} (${reason || "no reason"})`
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log top-up rejection:", ledgerError);
      }

      console.log(`[TOP-UP] Rejected ${topUpId}: ${reason || "no reason"}`);
      return rejectedTopUp;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reject top-up");
    }
  }

  // List top-up requests — admins see all, a regular user sees only their own
  async getInvestmentTopUps(userId?: string, status?: string) {
    const where: any = {};
    if (userId) {
      where.user_id = userId;
    }
    if (status) {
      where.status = status;
    }

    return prisma.investmentTopup.findMany({
      where,
      include: {
        investments: {
          include: {
            users: true,
          },
        },
      },
      orderBy: { submitted_at: "desc" },
    });
  }

  async updateInvestmentValue(investmentId: string): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active" || !investment.start_date) {
        return investment;
      }

      const monthsElapsed = getMonthsBetweenDates(
        investment.start_date instanceof Date ? investment.start_date : new Date(investment.start_date),
        new Date()
      );

      const currentValue = calculateInvestmentCurrentValue(
        Number(investment.initial_amount) || Number(investment.amount),
        Number(investment.interest_rate),
        monthsElapsed,
        investment.payout_frequency
      );

      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          current_value: Math.max(0, currentValue),
        },
      });

      return updatedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update investment value");
    }
  }

  async getInvestmentStats(userId: string) {
    try {
      const investments = await prisma.investment.findMany({
        where: { user_id: userId },
      });

      const totalInvested = investments.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
      const totalCurrentValue = investments.reduce(
        (sum: number, i: any) => sum + Number(i.current_value),
        0
      );
      const totalEarnings = totalCurrentValue - totalInvested;
      const activeInvestments = investments.filter(
        (i: any) => i.status === "active"
      ).length;
      const completedInvestments = investments.filter(
        (i: any) => i.status === "completed"
      ).length;
      const averageInterestRate =
        investments.length > 0
          ? investments.reduce((sum: number, i: any) => sum + Number(i.interest_rate), 0) /
            investments.length
          : 0;

      return {
        totalInvested,
        totalCurrentValue,
        totalEarnings,
        activeInvestments,
        completedInvestments,
        averageInterestRate,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch investment stats");
    }
  }

  async completeInvestment(investmentId: string): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const completedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          status: "completed" as any,
          updated_at: new Date(),
        } as any,
      });

      try {
        await ledgerService.logEvent(
          investment.user_id,
          investmentId,
          "status_change",
          "Investment marked as completed"
        );
      } catch (ledgerError) {
        console.error("[LEDGER] Failed to log investment completion:", ledgerError);
      }

      return completedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to complete investment");
    }
  }

  // Mark investment payout as paid - Tracks which payout months have been distributed to prevent duplicates - Recalculates compound balance and updates current_value
  async markInvestmentPayout(
    investmentId: string,
    payoutMonthNumber: number,
    payoutAmount: number,
    adminId: string,
    _adminNotes?: string
  ): Promise<Investment> {
    try {
      // Verify investment exists and fetch user data
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
        include: {
          users: true,
        },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      console.log(`[MARK PAYOUT DEBUG] Investment ${investmentId}:`, {
        status: investment.status,
        start_date: investment.start_date,
        payoutMonthNumber,
        payoutAmount,
        marked_payouts: investment.marked_payouts,
        term_months: investment.term_months
      });

      // Allow marking payouts for active investments or investments that have been manually started (have start_date)
      if (investment.status !== "active" && !investment.start_date) {
        throw new AppError(400, "Investment must be active or have a start date to mark payouts");
      }

      // Check if payout already marked
      const markedPayouts = investment.marked_payouts || [];
      if (markedPayouts.includes(payoutMonthNumber)) {
        throw new AppError(
          400,
          `Payout month ${payoutMonthNumber} already marked as paid`
        );
      }

      // Verify payout month is valid (1 to term_months)
      if (payoutMonthNumber < 1 || payoutMonthNumber > investment.term_months) {
        throw new AppError(
          400,
          `Invalid payout month: ${payoutMonthNumber}. Must be between 1 and ${investment.term_months}`
        );
      }

      // Mark payout - NO NEED to manually update current_value
      // It will be calculated dynamically from the ledger when needed
      const updatedMarkedPayouts = [...markedPayouts, payoutMonthNumber];

      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          marked_payouts: updatedMarkedPayouts,
          // current_value is no longer manually updated here
          // It will be calculated from transaction ledger on-demand
        },
      });

      // Log transaction - payout distribution
      // This is the SOURCE OF TRUTH for the withdrawal impact
      // Pass positive amount - the type "withdrawal" indicates it's being subtracted
      await ledgerService.logTransaction({
        userId: investment.user_id,
        type: "withdrawal" as any,
        method: "admin_manual" as any,
        amount: payoutAmount,  // Positive amount - type indicates it's a withdrawal
        sourceId: investmentId,
        description: `Investment payout marked - month ${payoutMonthNumber}`,
        metadata: {
          payoutMonth: payoutMonthNumber,
          investmentId,
          payoutFrequency: investment.payout_frequency,
          previousMarkedPayouts: markedPayouts.length,
        },
      });

      // Log admin action - audit trail
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "manual_adjustment",
        oldValues: {
          markedPayouts,
        },
        newValues: {
          markedPayouts: updatedMarkedPayouts,
          payoutMonth: payoutMonthNumber,
          payoutAmount,
        },
      });

      // Send email notification to user
      try {
        const userEmail = investment.users?.email || '';
        const userName = investment.users?.first_name && investment.users?.last_name
          ? `${investment.users.first_name} ${investment.users.last_name}`
          : 'User';
        
        // Calculate payout date based on start date + payout month
        const payoutDate = new Date(investment.start_date);
        payoutDate.setMonth(payoutDate.getMonth() + payoutMonthNumber);

        if (userEmail) {
          console.log(`[MARK PAYOUT NOTIFY] Sending payout notification to ${userEmail} for payout #${payoutMonthNumber}`);
          
          await edgeFunctionService.callFunction('send-communication', {
            to: userEmail,
            subject: `Investment Payout #${payoutMonthNumber} - ₦${payoutAmount.toLocaleString()}`,
            body: `Hello ${userName},\n\nYour payout for Investment #${investmentId.slice(-6)} has been marked as paid.\n\nPayout Details:\n• Payout Number: ${payoutMonthNumber}\n• Amount: ₦${payoutAmount.toLocaleString()}\n• Date: ${payoutDate.toLocaleDateString('en-NG')}\n• Type: credited to your account\n\nThank you for investing with DPINES.`
          });

          console.log(`[MARK PAYOUT NOTIFY] ✓ Notification sent to ${userEmail}`);
        }
      } catch (notifyError) {
        console.error(`[MARK PAYOUT NOTIFY ERROR] Failed to send notification:`, notifyError);
        // Don't fail the entire operation if notification fails
      }

      console.log(`[MARK PAYOUT] ✓ Successfully marked payout #${payoutMonthNumber} for investment ${investmentId}. Amount: ₦${payoutAmount}. Current value will be recalculated from ledger.`);

      return updatedInvestment;
    } catch (error) {
      console.error(`[MARK PAYOUT ERROR] Failed for investment ${investmentId}, payout #${payoutMonthNumber}:`, error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, `Failed to mark investment payout: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get investment payout schedule - Returns calculated payout dates and amounts based on payout frequency
  // If a top-up was approved, interest on top-up is calculated only until original end_date
  async getPayoutSchedule(investmentId: string): Promise<{
    payoutSchedule: {
      payoutNumber: number;
      payoutDate: Date;
      payoutAmount: number;
      isPaid: boolean;
    }[];
    totalPayoutsEarned: number;
    totalPayoutsPaid: number;
  }> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (!investment.start_date) {
        throw new AppError(400, "Investment has not been started");
      }

      // Use dynamically calculated current value instead of stored value
      const currentValue = await this.calculateCurrentValueFromLedger(investmentId);

      // Check if there are approved top-ups to determine principal split
      const approvedTopUps = await prisma.investmentTopup.findMany({
        where: {
          investment_id: investmentId,
          status: "approved",
        },
        orderBy: { approved_at: "asc" },
      });

      const markedPayouts = investment.marked_payouts || [];
      const payoutSchedule: {
        payoutNumber: number;
        payoutDate: Date;
        payoutAmount: number;
        isPaid: boolean;
      }[] = [];

      // Determine payout frequency interval
      let payoutIntervalMonths = 1; // default monthly
      if (investment.payout_frequency === "month") payoutIntervalMonths = 6;
      if (investment.payout_frequency === "reinvestment") payoutIntervalMonths = 1;

      // Get the original principal before any top-ups
      const originalPrincipal = investment.initial_amount || investment.amount;

      // Create a map of top-ups by approval month for easy lookup
      const topUpsByMonth = new Map<number, number>();
      approvedTopUps.forEach((topUp: any) => {
        if (topUp.approved_at && investment.start_date) {
          const startDt = investment.start_date instanceof Date ? investment.start_date : new Date(investment.start_date);
          const approvedDt = topUp.approved_at instanceof Date ? topUp.approved_at : new Date(topUp.approved_at);
          const approvedMonth = getMonthsBetweenDates(startDt, approvedDt);
          const existingAmount = topUpsByMonth.get(approvedMonth) || 0;
          topUpsByMonth.set(approvedMonth, existingAmount + Number(topUp.amount));
          console.log(`[PAYOUT SCHEDULE] Top-up of ₦${topUp.amount} approved in month ${approvedMonth}`);
        }
      });

      // Log that we're using dynamic current value
      console.log(`[PAYOUT SCHEDULE] Using dynamically calculated current_value: ₦${currentValue.toFixed(2)}`);

      // Calculate payout based on frequency
      let payoutCount = 0;
      const now = new Date();
      const monthlyRate = Number(investment.interest_rate) / 100;
      
      for (
        let month = payoutIntervalMonths;
        month <= investment.term_months;
        month += payoutIntervalMonths
      ) {
        payoutCount++;

        const payoutDate = new Date(investment.start_date);
        payoutDate.setMonth(payoutDate.getMonth() + month);

        // Determine if payout date has passed (today >= payout date)
        const isPayoutDatePassed = now >= payoutDate;

        // Calculate interest based on frequency type
        let originalInterestThisPeriod = 0;
        let totalTopUpInterestThisPeriod = 0;

        if (investment.payout_frequency === "monthly") {
          // SIMPLE INTEREST: Fixed interest per month based on principal
          originalInterestThisPeriod = originalPrincipal * monthlyRate * payoutIntervalMonths;

          // Top-up interest (simple): starts accruing from approval month
          topUpsByMonth.forEach((topUpAmount, topUpApprovedMonth) => {
            if (month >= topUpApprovedMonth) {
              const topUpInterestThisMonth = topUpAmount * monthlyRate * payoutIntervalMonths;
              totalTopUpInterestThisPeriod += topUpInterestThisMonth;

              console.log(`[PAYOUT SCHEDULE] Month ${month}: TopUp(approved month ${topUpApprovedMonth}, amount ₦${topUpAmount}) earned ₦${topUpInterestThisMonth.toFixed(2)} (simple interest)`);
            }
          });
        } else {
          // COMPOUND INTEREST: For "reinvestment" and "month" (6-monthly) frequencies
          const originalBalance = this.calculateCompoundBalance(
            Number(originalPrincipal),
            Number(investment.interest_rate),
            month
          );
          const previousOriginalBalance = this.calculateCompoundBalance(
            Number(originalPrincipal),
            Number(investment.interest_rate),
            month - payoutIntervalMonths
          );
          originalInterestThisPeriod = originalBalance - previousOriginalBalance;

          // Interest on all top-ups (each earned from their approval month onwards)
          topUpsByMonth.forEach((topUpAmount, topUpApprovedMonth) => {
            if (month >= topUpApprovedMonth) {
              const monthsSinceTopUp = month - topUpApprovedMonth;
              const previousMonthsSinceTopUp = Math.max(0, month - payoutIntervalMonths - topUpApprovedMonth);

              const topUpBalance = this.calculateCompoundBalance(
                topUpAmount,
                Number(investment.interest_rate),
                monthsSinceTopUp
              );
              const previousTopUpBalance = this.calculateCompoundBalance(
                topUpAmount,
                Number(investment.interest_rate),
                previousMonthsSinceTopUp
              );
              const topUpInterestThisMonth = topUpBalance - previousTopUpBalance;
              totalTopUpInterestThisPeriod += topUpInterestThisMonth;

              console.log(`[PAYOUT SCHEDULE] Month ${month}: TopUp(approved month ${topUpApprovedMonth}, amount ₦${topUpAmount}) earned ₦${topUpInterestThisMonth.toFixed(2)} (compound)`);
            }
          });
        }

        // Total payout = original interest + all top-up interest
        const payoutAmount = originalInterestThisPeriod + totalTopUpInterestThisPeriod;

        // Check if already marked as paid
        const isPaid = markedPayouts.includes(month);

        payoutSchedule.push({
          payoutNumber: payoutCount,
          payoutDate,
          payoutAmount: Number(payoutAmount.toFixed(2)),
          isPaid,
        });

        const frequencyType = investment.payout_frequency === "monthly" ? "SIMPLE" : "COMPOUND";
        console.log(`[PAYOUT SCHEDULE] Month ${month}: Date=${payoutDate.toISOString()}, IsPassed=${isPayoutDatePassed}, Original=${originalInterestThisPeriod.toFixed(2)} + AllTopUps=${totalTopUpInterestThisPeriod.toFixed(2)} = Total=${payoutAmount.toFixed(2)}, Marked=${isPaid}, Type=${frequencyType}`);
      }

      const totalPayoutsPaid = markedPayouts.length;
      const totalPayoutsEarned = payoutSchedule.length;

      console.log(`[PAYOUT SCHEDULE] Complete: Total Payouts Earned=${totalPayoutsEarned}, Total Marked=${totalPayoutsPaid}, Current Value Used=₦${currentValue.toFixed(2)}`);

      return {
        payoutSchedule,
        totalPayoutsEarned,
        totalPayoutsPaid,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to fetch payout schedule");
    }
  }

  // Helper: Calculate compound balance - Used for both interest accrual and payout calculations
  private calculateCompoundBalance(
    principal: number,
    monthlyInterestRate: number,
    monthsElapsed: number
  ): number {
    const monthlyRate = monthlyInterestRate / 100;

    // Compound interest formula: A = P(1 + r)^n
    const balance = principal * Math.pow(1 + monthlyRate, monthsElapsed);

    return balance;
  }

  // Create auto-reinvestment on maturity - When investment matures and maturityAction is "rollover", create new investment - with the matured value as principal
  async createReinvestmentOnMaturity(investmentId: string): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
        include: {
          users: true,
        },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      // Check maturity conditions
      if (investment.status !== "active") {
        throw new AppError(400, "Investment is not active");
      }

      if (!investment.end_date) {
        throw new AppError(400, "Investment end date not set");
      }

      const now = new Date();
      if (now < investment.end_date) {
        throw new AppError(400, "Investment has not reached maturity date");
      }

      // Check if maturity action is rollover
      const maturityAction = investment.maturity_action;
      if (maturityAction !== "rollover") {
        throw new AppError(
          400,
          `Maturity action is set to "${maturityAction}", not "rollover"`
        );
      }

      // Calculate final matured value
      const monthsElapsed = investment.term_months;
      const maturedValue = this.calculateCompoundBalance(
        Number(investment.initial_amount) || Number(investment.amount),
        Number(investment.interest_rate),
        monthsElapsed
      );

      // Mark old investment as completed
      await prisma.investment.update({
        where: { id: investmentId },
        data: {
          status: "completed" as any,
          maturity_processed: true,
        },
      });

      // Create new investment with matured value as principal
      const newInvestment = await prisma.investment.create({
        data: {
          user_id: investment.user_id,
          amount: maturedValue,
          initial_amount: maturedValue,
          interest_rate: investment.interest_rate,
          term_months: investment.term_months,
          payout_frequency: investment.payout_frequency,
          current_value: maturedValue,
          status: "active" as any,
          start_date: now,
          marked_payouts: [],
        },
      });

      // Log transaction - reinvestment
      await ledgerService.logTransaction({
        userId: investment.user_id,
        type: "deposit" as any,
        method: "system_generated" as any,
        amount: maturedValue,
        sourceId: investmentId,
        description: `Auto-reinvestment from matured investment (original: ${investmentId})`,
        metadata: {
          sourceInvestmentId: investmentId,
          sourceMaturedValue: maturedValue,
          newInvestmentId: newInvestment.id,
          reinvestmentReason: "maturity_rollover",
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId: investment.user_id, // System action, use user as admin ID
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: {
          investmentId,
          status: "active",
          maturityAction: "rollover",
        },
        newValues: {
          oldInvestmentId: investmentId,
          oldInvestmentStatus: "completed",
          newInvestmentId: newInvestment.id,
          newInvestmentValue: maturedValue,
        },
      });

      // Send maturity notification
      try {
        await notificationService.notifyInvestmentMaturity(investmentId);
      } catch (notifError) {
        console.error("Failed to send investment maturity notification:", notifError);
      }

      // Send rollover email asynchronously using Edge Function
      if ((investment as any).users) {
        const user = (investment as any).users;
        edgeFunctionService.sendInvestmentRolloverEmail(
          user.email,
          user.first_name || "Investor",
          Number(maturedValue),
          investment.term_months,
          investment.id
        ).catch((err) => {
          console.error("Failed to trigger rollover email edge function:", err);
        });
      }

      return newInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create reinvestment on maturity");
    }
  }

  // Process all mature investments that have rollover action set - Typically called by a cron job to handle batch reinvestments
  async processMaturedInvestments(): Promise<{
    processed: number;
    failed: number;
    reinvestedAmount: number;
  }> {
    try {
      const now = new Date();

      // Find all active investments that have reached maturity with rollover action
      const maturedInvestments = await prisma.investment.findMany({
        where: {
          status: "active",
          end_date: {
            lte: now,
          },
          maturity_action: "rollover",
          maturity_processed: {
            not: true,
          },
        },
      });

      let processed = 0;
      let failed = 0;
      let reinvestedAmount = 0;

      // Process each matured investment
      for (const investment of maturedInvestments) {
        try {
          const newInvestment = await this.createReinvestmentOnMaturity(
            investment.id
          );
          processed++;
          reinvestedAmount += Number(newInvestment.amount);
        } catch (error) {
          failed++;
          console.error(
            `Failed to reinvest investment ${investment.id}:`,
            error
          );
        }
      }

      return {
        processed,
        failed,
        reinvestedAmount,
      };
    } catch (error) {
      throw new AppError(500, "Failed to process matured investments");
    }
  }

  // Check if investment is mature and ready for action
  async checkMaturityStatus(investmentId: string): Promise<{
    isMature: boolean;
    daysUntilMaturity: number;
    maturityDate: Date | null;
    maturityAction: string | null;
    status: string;
  }> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const now = new Date();
      let daysUntilMaturity = 0;
      let isMature = false;

      if (investment.end_date) {
        const timeDiff = investment.end_date.getTime() - now.getTime();
        daysUntilMaturity = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        isMature = daysUntilMaturity <= 0;
      }

      return {
        isMature,
        daysUntilMaturity,
        maturityDate: investment.end_date,
        maturityAction: investment.maturity_action,
        status: investment.status,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to check maturity status");
    }
  }

  // Admin: Update investment interest rate - For adjusting returns due to regulatory or market changes
  async adminUpdateInterestRate(
    investmentId: string,
    newInterestRate: number,
    adminId: string,
    _reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldInterestRate = Number(investment.interest_rate);

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          interest_rate: newInterestRate,
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: { interest_rate: oldInterestRate },
        newValues: { interest_rate: newInterestRate },
      });

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update investment interest rate");
    }
  }

  // Admin: Update investment term - For extending or adjusting investment duration
  async adminUpdateInvestmentTerm(
    investmentId: string,
    newTermMonths: number,
    adminId: string,
    _reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldTermMonths = investment.term_months;

      // Validate new term
      if (newTermMonths < 1 || newTermMonths > 360) {
        throw new AppError(400, "Investment term must be between 1 and 360 months");
      }

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          term_months: newTermMonths,
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: { term_months: oldTermMonths },
        newValues: { term_months: newTermMonths },
      });

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update investment term");
    }
  }

  // Admin: Adjust investment current value - For corrections or manual adjustments to invested amount
  async adminAdjustCurrentValue(
    investmentId: string,
    adjustmentAmount: number,
    adminId: string,
    reason: string,
    adjustmentType: "correction" | "bonus" | "penalty" = "correction"
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldCurrentValue = Number(investment.current_value);
      const newCurrentValue = Math.max(0, oldCurrentValue + adjustmentAmount);

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          current_value: newCurrentValue,
        },
      });

      // Log transaction
      if (adjustmentAmount !== 0) {
        await ledgerService.logTransaction({
          userId: investment.user_id,
          type: "adjustment" as any,
          method: "admin_manual" as any,
          amount: Math.abs(adjustmentAmount),
          sourceId: investmentId,
          description: `${adjustmentType} adjustment on investment value`,
          metadata: {
            adjustmentType,
            reason,
            oldValue: oldCurrentValue,
            newValue: newCurrentValue,
            adjustment: adjustmentAmount,
          },
        });
      }

      // Log audit action
      await auditService.logManualAdjustment(
        adminId,
        investment.user_id,
        investmentId,
        { current_value: oldCurrentValue },
        { current_value: newCurrentValue },
        reason
      );

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to adjust investment current value");
    }
  }

  // Admin: Override investment status - For exceptional circumstances (approve, complete, cancel, etc)
  async adminOverrideInvestmentStatus(
    investmentId: string,
    newStatus: "active" | "completed" | "withdrawn" | "cancelled",
    adminId: string,
    _reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldStatus = investment.status;

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          status: newStatus as any,
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "investment_status_override",
        oldValues: { status: oldStatus },
        newValues: { status: newStatus },
      });

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to override investment status");
    }
  }

  // Admin: Update payout frequency - For changing how often payouts are distributed (monthly, 6-month, reinvestment)
  async adminUpdatePayoutFrequency(
    investmentId: string,
    newPayoutFrequency: PayoutFrequency,
    adminId: string,
    _reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldPayoutFrequency = investment.payout_frequency;

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          payout_frequency: newPayoutFrequency,
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: { payout_frequency: oldPayoutFrequency },
        newValues: { payout_frequency: newPayoutFrequency },
      });

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update payout frequency");
    }
  }

  // Admin: Clear marked payouts - For resetting payout tracking (correction scenario)
  async adminClearMarkedPayouts(
    investmentId: string,
    adminId: string,
    reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldMarkedPayouts = investment.marked_payouts || [];

      // Clear marked payouts
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          marked_payouts: [],
        },
      });

      // Log audit action
      await auditService.logManualAdjustment(
        adminId,
        investment.user_id,
        investmentId,
        { marked_payouts: oldMarkedPayouts, cleared_payouts_count: oldMarkedPayouts.length },
        { marked_payouts: [], cleared_payouts_count: 0 },
        `Cleared ${oldMarkedPayouts.length} marked payouts: ${reason}`
      );

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to clear marked payouts");
    }
  }

  // Admin: Manually set maturity action - Override what happens at investment maturity (withdraw vs rollover)
  async adminSetMaturityAction(
    investmentId: string,
    action: "withdraw" | "rollover",
    adminId: string,
    _reason: string
  ): Promise<Investment> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
        include: {
          users: true,
        },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const oldAction = investment.maturity_action;

      // Update investment
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          maturity_action: action,
        },
      });

      // Notify admin on maturity action asynchronously using Edge Function
      if (investment && !investment.maturity_action && action && (investment as any).users) {
        const user = (investment as any).users;
        const userName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "User";
        edgeFunctionService.notifyAdminMaturityAction(
          updatedInvestment.id,
          userName,
          action,
          Number(updatedInvestment.amount)
        ).catch((err) => {
          console.error("Failed to trigger maturity action admin notification edge function:", err);
        });
      }

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: { maturity_action: oldAction },
        newValues: { maturity_action: action },
      });

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to set maturity action");
    }
  }

  async updateInvestmentFinancials(investmentId: string, updates: any, adminId?: string) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
    });

    if (!investment) {
      throw new AppError(404, "Investment not found");
    }

    // Guard: If there's a pending top-up, prevent timeline modification to preserve investment maturity
    if (updates.start_date !== undefined || updates.term_months !== undefined || updates.end_date !== undefined) {
      const pendingTopUp = await prisma.investmentTopup.findFirst({
        where: {
          investment_id: investmentId,
          status: "pending",
        },
      });

      if (pendingTopUp) {
        throw new AppError(
          400,
          "Cannot modify investment timeline while a top-up is pending approval. Please approve or reject the top-up first."
        );
      }
    }

    const updatedData: any = {};
    if (updates.amount !== undefined) updatedData.amount = updates.amount;
    // Only accept manual current_value if neither start_date, rate, nor amount changed (for manual edits)
    const shouldAutoCalculate = updates.start_date !== undefined || updates.interest_rate !== undefined || updates.amount !== undefined;
    if (updates.current_value !== undefined && !shouldAutoCalculate) {
      updatedData.current_value = updates.current_value;
    }
    if (updates.interest_rate !== undefined) updatedData.interest_rate = updates.interest_rate;
    if (updates.start_date !== undefined) updatedData.start_date = new Date(updates.start_date);
    if (updates.term_months !== undefined) updatedData.term_months = updates.term_months;
    if (updates.end_date !== undefined) updatedData.end_date = updates.end_date ? new Date(updates.end_date) : null;
    if (updates.status !== undefined && updates.status !== "") updatedData.status = updates.status;

    // Auto-calculate current value if start_date, rate, or amount changed
    // This recalculates accrued interest based on months elapsed
    if (shouldAutoCalculate) {
      const startDate = updates.start_date ? new Date(updates.start_date) : investment.start_date;
      const interestRate = updates.interest_rate !== undefined ? updates.interest_rate : investment.interest_rate;
      const principal = updates.amount !== undefined ? updates.amount : investment.amount;
      const payoutFrequency = investment.payout_frequency;

      if (startDate && principal && interestRate !== null && payoutFrequency) {
        // Calculate months elapsed from start date to now
        const startDt = startDate instanceof Date ? startDate : new Date(startDate);
        const tenureMonths = updates.term_months !== undefined ? updates.term_months : investment.term_months;
        const monthsElapsed = Math.max(
          0,
          Math.min(getMonthsBetweenDates(startDt, new Date()), tenureMonths || 0)
        );

        // Calculate current value based on payout frequency type
        let calculatedCurrentValue = principal;

        if (payoutFrequency === "reinvestment") {
          // Compound interest: A = P(1 + r)^n
          const monthlyRate = interestRate / 100;
          calculatedCurrentValue = principal * Math.pow(1 + monthlyRate, monthsElapsed);
        } else if (payoutFrequency === "monthly") {
          // Simple interest: A = P + (P × r × n)
          const totalInterest = principal * (interestRate / 100) * monthsElapsed;
          calculatedCurrentValue = principal + totalInterest;
        }

        updatedData.current_value = Math.max(principal, calculatedCurrentValue); // Never go below principal

        console.log(`[INVESTMENT UPDATE] Auto-calculated current_value for ${investmentId}: Principal=${principal}, Months=${monthsElapsed}, Rate=${interestRate}%, Type=${payoutFrequency}, NewValue=${calculatedCurrentValue.toFixed(2)}`);
      }
    }

    updatedData.updated_at = new Date();

    const result = await prisma.investment.update({
      where: { id: investmentId },
      data: updatedData,
    });

    // Record the timeline/financial edit so the system can track it and respect
    // it. This is append-only and non-monetary, so it never affects balances.
    const before: Record<string, any> = {
      start_date: investment.start_date,
      end_date: investment.end_date,
      interest_rate: investment.interest_rate,
      term_months: investment.term_months,
      amount: investment.amount,
      current_value: investment.current_value,
      status: investment.status,
    };
    const after: Record<string, any> = {
      start_date: updatedData.start_date,
      end_date: updatedData.end_date,
      interest_rate: updatedData.interest_rate,
      term_months: updatedData.term_months,
      amount: updatedData.amount,
      current_value: updatedData.current_value,
      status: updatedData.status,
    };

    const changes: Record<string, { from: any; to: any }> = {};
    for (const key of Object.keys(before)) {
      if (after[key] === undefined) continue;
      const fromVal = before[key] instanceof Date ? before[key].toISOString() : before[key];
      const toVal = after[key] instanceof Date ? after[key].toISOString() : after[key];
      if (String(fromVal) !== String(toVal)) changes[key] = { from: fromVal, to: toVal };
    }

    const changeSummary = Object.entries(changes)
      .map(([field, v]) => `${field}: ${v.from} → ${v.to}`)
      .join(", ") || "no field changes";

    try {
      await ledgerService.logEvent(
        investment.user_id,
        investmentId,
        "timeline_edit",
        `Financials edited by admin — ${changeSummary}`
      );
    } catch (ledgerError) {
      console.error("[LEDGER] Failed to log financial edit:", ledgerError);
    }

    try {
      await auditService.logAction({
        adminId: adminId || (investment.user_id as any),
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: before,
        newValues: { ...after, changes },
      });
    } catch (auditError) {
      console.error("[AUDIT] Failed to log financial edit:", auditError);
    }

    return result;
  }

  // Admin: Delete an investment (and its related transaction-ledger entries)
  async deleteInvestment(investmentId: string) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
    });

    if (!investment) {
      throw new AppError(404, "Investment not found");
    }

    // Clean up ledger references so they don't dangle after deletion
    await prisma.transactionLedger.deleteMany({
      where: { source_id: investmentId },
    });

    await prisma.investment.delete({
      where: { id: investmentId },
    });

    return { id: investmentId };
  }

  // Admin: Manually deduct from investment for any reason (fees, charges, withdrawals, etc)
  async manualDeductFromInvestment(
    investmentId: string,
    amount: number,
    purpose: string,
    adminId: string
  ): Promise<Investment> {
    try {
      // Validate investment exists
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active") {
        throw new AppError(400, "Investment is not active");
      }

      // Validate deduction amount
      if (amount <= 0) {
        throw new AppError(400, "Deduction amount must be positive");
      }

      // Calculate current value dynamically to ensure we have the latest value
      const currentValue = await this.calculateCurrentValueFromLedger(investmentId);
      if (amount > currentValue) {
        throw new AppError(400, `Deduction amount (₦${amount}) exceeds current investment value (₦${currentValue.toFixed(2)})`);
      }

      console.log(`[MANUAL DEDUCTION] Deducting ₦${amount} from investment ${investmentId} (${purpose}). Current dynamic value: ₦${currentValue.toFixed(2)}`);

      // NO NEED to update current_value in the database
      // It will be calculated dynamically from the ledger entry we're about to create

      // Log transaction - deduction entry (SOURCE OF TRUTH)
      // This entry will be used by calculateCurrentValueFromLedger to determine the new value
      await ledgerService.logTransaction({
        userId: investment.user_id,
        amount,
        type: "deduction" as any,
        sourceId: investmentId,
        method: "admin_manual" as any,
        description: `Manual deduction from investment: ${purpose}`,
        metadata: {
          deductionPurpose: purpose,
          adminId,
          deductionTime: new Date().toISOString(),
        },
      });

      // Log audit action
      await auditService.logAction({
        adminId,
        targetUserId: investment.user_id,
        action: "manual_adjustment",
        oldValues: {
          currentValue: currentValue,
          deductionAmount: amount,
          deductionPurpose: purpose,
        },
        newValues: {
          currentValue: currentValue - amount,
          deductionAmount: amount,
          deductionPurpose: purpose,
        },
      });

      console.log(`[MANUAL DEDUCTION] ✓ Successfully deducted ₦${amount} from investment ${investmentId}. Current value will be recalculated from ledger.`);

      // Return the investment with updated dynamic current_value
      const updatedInvestment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!updatedInvestment) {
        throw new AppError(404, "Investment not found after deduction");
      }

      // Calculate and attach the new dynamic current value
      const newDynamicValue = await this.calculateCurrentValueFromLedger(investmentId);
      return {
        ...updatedInvestment,
        current_value: newDynamicValue,
      } as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to deduct from investment");
    }
  }

  // Calculate investment current_value dynamically from transaction ledger
  // This ensures current_value always reflects the actual financial state
  // by reading from the source of truth (transaction history) rather than a denormalized field
  private async calculateCurrentValueFromLedger(investmentId: string): Promise<number> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      // For pending investments without a start_date, return the stored current_value (which is the principal amount)
      if (!investment.start_date) {
        console.log(`[CURRENT VALUE CALC] Investment ${investmentId} is pending (no start_date), returning stored value: ₦${investment.current_value}`);
        return Number(investment.current_value) || Number(investment.amount);
      }

      // Get all transactions for this investment from the ledger
      const transactions = await prisma.transactionLedger.findMany({
        where: { source_id: investmentId },
        orderBy: { created_at: "asc" },
      });

      // Determine principal (use initial_amount if set, else use amount)
      const principal = Number(investment.initial_amount) || Number(investment.amount);

      // Ensure start_date is a Date object
      const startDate = investment.start_date instanceof Date 
        ? investment.start_date 
        : new Date(investment.start_date);

      // Accrue only up to the tenure end (end_date, or start + term_months). This
      // keeps a back-dated start date from accruing interest beyond the term.
      const now = new Date();
      const tenureEnd = investment.end_date
        ? new Date(investment.end_date)
        : new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + (investment.term_months || 0)));
      const accrualDate = now < tenureEnd ? now : tenureEnd;
      const monthsElapsed = Math.max(
        0,
        Math.min(getMonthsBetweenDates(startDate, accrualDate), investment.term_months || 0)
      );

      // Approved top-ups are principal additions, but each one only earns from the
      // payout period it falls into onward — never retroactively. Because the
      // period is derived from the payout dates, editing the start date moves the
      // top-ups with the timeline instead of rewriting past periods.
      const topUps = transactions.filter(
        (tx: any) => tx.type === "deposit" && tx.description && tx.description.includes("Investment Top-Up")
      );
      const topUpPrincipal = topUps.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0);
      const investedPrincipal = principal + topUpPrincipal;

      const monthlyRate = Number(investment.interest_rate) / 100;
      const accrue = (base: number, months: number): number => {
        if (months <= 0) return 0;
        if (investment.payout_frequency === "reinvestment") {
          // Compound: A = P(1 + r)^n
          return Math.max(0, base * Math.pow(1 + monthlyRate, months) - base);
        }
        // Simple: A = P × r × n
        return base * monthlyRate * months;
      };
      // Months a top-up has been earning, based on how many payout periods were
      // already due when it was added.
      const activeMonthsFor = (addedAt: Date): number => {
        let periodsDue = 0;
        for (let k = 1; k <= (investment.term_months || 0); k++) {
          const pd = new Date(startDate);
          pd.setMonth(pd.getMonth() + k);
          if (pd <= addedAt) periodsDue++;
          else break;
        }
        return Math.max(0, monthsElapsed - periodsDue);
      };

      let interestEarned = accrue(principal, monthsElapsed);
      for (const tx of topUps) {
        interestEarned += accrue(Number((tx as any).amount), activeMonthsFor(new Date((tx as any).created_at)));
      }

      // Sum all transaction impacts
      // Deposits/interest increase value, withdrawals/deductions decrease it
      // IMPORTANT: Skip the initial creation deposit (marked as "Investment created:...")
      // because it's already counted in the principal
      // ALSO: Skip "Investment payout marked" withdrawals if there's no corresponding actual withdrawal/transfer
      let totalTransactionImpact = 0;

      transactions.forEach((tx: any) => {
        const amount = Number(tx.amount);

        // Skip the initial investment creation transaction
        if (tx.description && tx.description.includes("Investment created:")) {
          console.log(`[CURRENT VALUE CALC] Skipping initial creation deposit: ₦${amount}`);
          return;
        }

        // Skip payout marking withdrawals - these are just bookkeeping entries, not real deductions
        // Real payouts to users would be tracked separately (e.g., bank transfers)
        if (tx.type === "withdrawal" && tx.description && tx.description.includes("Investment payout marked")) {
          console.log(`[CURRENT VALUE CALC] Skipping payout marking withdrawal: ₦${amount}`);
          return;
        }

        // Skip top-up deposits - they are already counted in investedPrincipal,
        // so including them again here would double-count the top-up.
        if (tx.type === "deposit" && tx.description && tx.description.includes("Investment Top-Up")) {
          return;
        }

        if (tx.type === "deposit" || tx.type === "interest" || tx.type === "rollover") {
          // Positive impact: investment received more funds (top-ups, interest reinvested, etc.)
          totalTransactionImpact += amount;
        } else if (tx.type === "withdrawal" || tx.type === "deduction" || tx.type === "charge" || tx.type === "adjustment") {
          // Negative impact: investment reduced
          // For adjustments: check metadata, but generally adjustments reduce value for this calculation
          totalTransactionImpact -= amount;
        }
      });

      console.log(`[CURRENT VALUE CALC] Investment ${investmentId}:`);
      console.log(`  Principal: ₦${principal.toFixed(2)} (+ top-ups ₦${topUpPrincipal.toFixed(2)} = ₦${investedPrincipal.toFixed(2)})`);
      console.log(`  Months Elapsed: ${monthsElapsed}`);
      console.log(`  Interest Earned: ₦${interestEarned.toFixed(2)} (${investment.payout_frequency})`);
      console.log(`  Total Transaction Impact: ₦${totalTransactionImpact.toFixed(2)}`);

      // Current value = invested principal + interest earned + other transactions
      const currentValue = investedPrincipal + interestEarned + totalTransactionImpact;

      // Ensure never negative
      const finalValue = Math.max(0, currentValue);

      console.log(`  FINAL Current Value: ₦${finalValue.toFixed(2)}`);

      return finalValue;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error("[CURRENT VALUE CALC ERROR]", error);
      throw new AppError(500, "Failed to calculate current value");
    }
  }

  // Get current_value for an investment by reading from source (ledger + interest calculation)
  async getCurrentValue(investmentId: string): Promise<number> {
    return this.calculateCurrentValueFromLedger(investmentId);
  }
}

export const investmentService = new InvestmentService();

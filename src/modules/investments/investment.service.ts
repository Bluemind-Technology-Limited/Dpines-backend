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

      return investment;
    } catch (error) {
      throw new AppError(500, "Failed to fetch investment");
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
          start_date,
          end_date,
        },
      });

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
        },
      });

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

      return updatedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to set maturity action");
    }
  }

  async topUpInvestment(
    investmentId: string,
    amount: number,
    method: "bank_transfer" | "wallet" | "card" = "bank_transfer"
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

      if (investment.status !== "active" || !investment.start_date) {
        throw new AppError(400, "Investment is not active or has not started");
      }

      const now = new Date();

      // 1. Calculate accrued months elapsed up to today
      const monthsElapsed = getMonthsBetweenDates(
        investment.start_date,
        now
      );

      // 2. Calculate the current value (capitalized up to the top-up moment)
      const currentValue = calculateInvestmentCurrentValue(
        Number(investment.initial_amount) || Number(investment.amount),
        Number(investment.interest_rate),
        monthsElapsed,
        investment.payout_frequency
      );

      // 3. Compute new combined principal value
      const newPrincipal = currentValue + amount;

      // 4. Calculate remaining term months
      const remainingMonths = Math.max(1, investment.term_months - monthsElapsed);

      // 5. Update the investment in the database
      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          amount: newPrincipal,
          initial_amount: newPrincipal,
          current_value: newPrincipal,
          start_date: now, // Reset the baseline date for compound interest going forward
          term_months: remainingMonths,
        },
      });

      // 6. Log transaction to ledger
      await ledgerService.logTransaction({
        userId: investment.user_id,
        amount,
        type: "deposit" as any,
        method: method as any,
        sourceId: investmentId,
        description: `Investment Top-Up of ₦${amount} (New Balance: ₦${newPrincipal})`,
        metadata: {
          previousPrincipal: Number(investment.amount),
          capitalizedAccruedInterest: currentValue - Number(investment.amount),
          topUpAmount: amount,
          newPrincipal,
        },
      });

      // 7. Log audit action
      await auditService.logAction({
        adminId: investment.user_id, // Self or Admin, fallback to user
        targetUserId: investment.user_id,
        action: "investment_updated",
        oldValues: {
          amount: Number(investment.amount),
          term_months: investment.term_months,
          start_date: investment.start_date,
        },
        newValues: {
          amount: newPrincipal,
          term_months: remainingMonths,
          start_date: now,
        },
      });

      // 8. Trigger confirmation email via Edge Function
      if ((investment as any).users) {
        const user = (investment as any).users;
        edgeFunctionService.sendInvestmentTopUpEmail(
          user.email,
          user.first_name || "Investor",
          amount,
          newPrincipal,
          investment.id
        ).catch((err) => {
          console.error("Failed to trigger top-up email edge function:", err);
        });
      }

      return updatedInvestment as unknown as Investment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to top up investment");
    }
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
        investment.start_date,
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
        },
      });

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
      // Verify investment exists
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      if (investment.status !== "active") {
        throw new AppError(400, "Investment is not active");
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

      // Calculate compound balance after marking payout
      // Note: monthsElapsed calculation kept for reference but not used directly
      // const monthsElapsed = payoutMonthNumber;

      // For reinvestment frequency: interest stays invested (current_value increases)
      // For monthly payout frequency: interest is distributed (current_value = principal only after payout)
      let newCurrentValue = Number(investment.current_value);

      if (investment.payout_frequency === "monthly") {
        // Monthly payout: remove distributed interest from current_value
        newCurrentValue = Number(investment.initial_amount) || Number(investment.amount);
      } else if (investment.payout_frequency === "month") {
        // 6-month payout: remove distributed interest every 6 months
        if (payoutMonthNumber % 6 === 0) {
          newCurrentValue = Number(investment.initial_amount) || Number(investment.amount);
        }
      }
      // "reinvestment" frequency: keep full compound balance invested

      // Mark payout
      const updatedMarkedPayouts = [...markedPayouts, payoutMonthNumber];

      const updatedInvestment = await prisma.investment.update({
        where: { id: investmentId },
        data: {
          marked_payouts: updatedMarkedPayouts,
          current_value: newCurrentValue,
        },
      });

      // Log transaction - payout distribution
      await ledgerService.logTransaction({
        userId: investment.user_id,
        type: "withdrawal" as any,
        method: "admin_manual" as any,
        amount: payoutAmount,
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
          currentValue: investment.current_value,
        },
        newValues: {
          markedPayouts: updatedMarkedPayouts,
          currentValue: newCurrentValue,
          payoutMonth: payoutMonthNumber,
          payoutAmount,
        },
      });

      return updatedInvestment;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to mark investment payout");
    }
  }

  // Get investment payout schedule - Returns calculated payout dates and amounts based on payout frequency
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
      if (investment.payout_frequency === "reinvestment") payoutIntervalMonths = 1; // reinvestment still pays monthly but keeps principal invested

      // Calculate payouts based on frequency
      let payoutCount = 0;
      for (
        let month = payoutIntervalMonths;
        month <= investment.term_months;
        month += payoutIntervalMonths
      ) {
        payoutCount++;

        // Calculate payout amount for this period
        const compoundBalance = this.calculateCompoundBalance(
          Number(investment.initial_amount) || Number(investment.amount),
          Number(investment.interest_rate),
          month
        );

        // Interest earned in this period
        const previousBalance = this.calculateCompoundBalance(
          Number(investment.initial_amount) || Number(investment.amount),
          Number(investment.interest_rate),
          month - payoutIntervalMonths
        );

        const payoutAmount = compoundBalance - previousBalance;
        const payoutDate = new Date(investment.start_date);
        payoutDate.setMonth(payoutDate.getMonth() + month);

        const isPaid = markedPayouts.includes(month);

        payoutSchedule.push({
          payoutNumber: payoutCount,
          payoutDate,
          payoutAmount: Number(payoutAmount.toFixed(2)),
          isPaid,
        });
      }

      const totalPayoutsPaid = markedPayouts.length;
      const totalPayoutsEarned = payoutSchedule.length;

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

  async updateInvestmentFinancials(investmentId: string, updates: any) {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
    });

    if (!investment) {
      throw new AppError(404, "Investment not found");
    }

    const updatedData: any = {};
    if (updates.amount !== undefined) updatedData.amount = updates.amount;
    if (updates.current_value !== undefined) updatedData.current_value = updates.current_value;
    if (updates.interest_rate !== undefined) updatedData.interest_rate = updates.interest_rate;
    if (updates.start_date !== undefined) updatedData.start_date = new Date(updates.start_date);
    if (updates.term_months !== undefined) updatedData.term_months = updates.term_months;
    if (updates.end_date !== undefined) updatedData.end_date = updates.end_date ? new Date(updates.end_date) : null;
    if (updates.status !== undefined && updates.status !== "") updatedData.status = updates.status;

    const result = await prisma.investment.update({
      where: { id: investmentId },
      data: updatedData,
    });

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
}

export const investmentService = new InvestmentService();

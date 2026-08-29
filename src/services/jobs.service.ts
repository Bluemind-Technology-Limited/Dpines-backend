import { Client } from "@upstash/qstash";
import { env } from "@/configs/env";
import prisma from "@/configs/database";
import { loanService } from "@/modules/loans/loan.service";
import { investmentService } from "@/modules/investments/investment.service";
import notificationService from "@/modules/notifications/notification.service";
import emailService from "@/services/email.service";
import { AppError } from "@/middlewares/error.middleware";

interface JobResult {
  success: boolean;
  jobId?: string;
  message: string;
  error?: string;
  processedCount?: number;
  failedCount?: number;
  details?: any;
}

interface ScheduledJob {
  id: string;
  name: string;
  type: "payment_reminder" | "late_fee_application" | "maturity_processing";
  schedule: string; // Cron expression
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

// JobsService - Background Job Orchestration - Manages scheduled jobs via Upstash QStash for: - - Daily payment reminders (3 days before due date) - - Daily late fee application (for overdue loans) - - Daily maturity processing (for investments past end_date)
class JobsService {
  private qstash: Client;
  private baseUrl: string;

  constructor() {
    this.qstash = new Client({
      token: env.QSTASH_TOKEN,
    });
    this.baseUrl = env.SITE_URL;
  }

  // Schedule Payment Reminders Job - Runs daily at 8 AM, sends reminders for loans due in 3 days - Algorithm: - 1. Find all active loans with next_due_date = now + 3 days - 2. Filter by user notification preferences (loanReminders enabled) - 3. Send notification via notificationService.notifyLoanPaymentReminder() - 4. Log in queue_jobs table for monitoring - Cron: 0 8 * * * (Daily at 8 AM UTC)
  async schedulePaymentReminders(): Promise<JobResult> {
    try {
      const jobId = `payment_reminders_${Date.now()}`;

      const response = await this.qstash.publish({
        url: `${this.baseUrl}/api/jobs/trigger/payment_reminders`,
        method: "POST",
        cron: "0 8 * * *", // Daily at 8 AM UTC
        headers: {
          "X-Job-ID": jobId,
          "X-Job-Type": "payment_reminder",
        },
      });

      // Log scheduled job
      await this.logScheduledJob(jobId, "payment_reminder", response);

      return {
        success: true,
        jobId,
        message: "Payment reminder job scheduled successfully (daily at 8 AM UTC)",
        details: {
          schedule: "0 8 * * *",
          endpoint: "/api/jobs/trigger/payment_reminders",
          remindDays: 3,
        },
      };
    } catch (error) {
      console.error("Failed to schedule payment reminders:", error);
      return {
        success: false,
        message: "Failed to schedule payment reminders",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Execute Payment Reminders Job - Called by cron job - actually sends reminders - Algorithm: - 1. Find all active loans with next_due_date = today + 3 days (±1 day) - 2. Filter by user notification preferences (loanReminders enabled) - 3. Send notification via notificationService.notifyLoanPaymentReminder() - 4. Log in queue_jobs table for monitoring - 5. Send admin summary
  async executePaymentReminders(): Promise<JobResult> {
    try {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      // Query loans with next_due_date approximately 3 days from now
      // (within +/- 1 day tolerance for daily cron execution)
      const startDate = new Date(threeDaysFromNow);
      startDate.setDate(startDate.getDate() - 1);
      const endDate = new Date(threeDaysFromNow);
      endDate.setDate(endDate.getDate() + 1);

      const loansWithDueDate = await (prisma.loan as any).findMany({
        where: {
          status: "active",
          next_due_date: {
            gte: startDate,
            lte: endDate,
          },
          user_id: {
            not: null,
          },
        },
        include: {
          user_profile: true,
        },
      });

      let successCount = 0;
      let failedCount = 0;
      let totalAmountDue = 0;
      const processedLoans: Array<{
        loanId: string;
        borrowerId: string;
        amountDue: number;
        daysUntilDue: number;
      }> = [];

      // Send reminder for each loan
      for (const loan of loansWithDueDate) {
        try {
          const preferences = await notificationService.getUserNotificationPreferences(
            loan.user_id
          );

          if (preferences.loanReminders) {
            const daysUntilDue = Math.ceil(
              (new Date(loan.next_due_date).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24)
            );

            const amountDue = Number(loan.monthly_payment) || 0;

            await notificationService.notifyLoanPaymentReminder(
              loan.id,
              Math.max(0, daysUntilDue),
              amountDue
            );

            successCount++;
            totalAmountDue += amountDue;

            processedLoans.push({
              loanId: loan.id,
              borrowerId: loan.user_id,
              amountDue,
              daysUntilDue: Math.max(0, daysUntilDue),
            });
          }
        } catch (error) {
          failedCount++;
          console.error(`Failed to send reminder for loan ${loan.id}:`, error);
        }
      }

      // Send admin summary notification
      if (successCount > 0) {
        await this.sendAdminSummaryNotification({
          jobType: "payment_reminder",
          processedCount: successCount,
          failedCount,
          totalAmount: totalAmountDue,
          details: {
            loansProcessed: processedLoans.length,
            totalLoansFound: loansWithDueDate.length,
            dueWindowStart: startDate.toISOString(),
            dueWindowEnd: endDate.toISOString(),
            timestamp: new Date().toISOString(),
          },
        });
      }

      return {
        success: true,
        message: "Payment reminders executed",
        processedCount: successCount,
        failedCount,
        details: {
          totalLoansFound: loansWithDueDate.length,
          remindersSent: successCount,
          remindersFailed: failedCount,
          totalAmountReminded: Math.round(totalAmountDue * 100) / 100,
          loansProcessed: processedLoans,
          criteria: {
            status: "active",
            dueDateRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
            remindDays: 3,
          },
        },
      };
    } catch (error) {
      console.error("Failed to execute payment reminders:", error);
      return {
        success: false,
        message: "Failed to execute payment reminders",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Schedule Late Fee Application Job - Runs daily at 9 AM, applies 1% daily late fees to overdue loans - Algorithm: - 1. Find all active loans with next_due_date < now (overdue) - 2. For each loan, calculate days overdue - 3. Apply 1% late fee per day (max 7 days = 7% max) - 4. Use loanService.applyLateFeeWithNotification() - 5. Send notification to user - Cron: 0 9 * * * (Daily at 9 AM UTC)
  async scheduleLateFeeApplication(): Promise<JobResult> {
    try {
      const jobId = `late_fees_${Date.now()}`;

      const response = await this.qstash.publish({
        url: `${this.baseUrl}/api/jobs/trigger/late_fees`,
        method: "POST",
        cron: "0 9 * * *", // Daily at 9 AM UTC
        headers: {
          "X-Job-ID": jobId,
          "X-Job-Type": "late_fee_application",
        },
      });

      // Log scheduled job
      await this.logScheduledJob(jobId, "late_fee_application", response);

      return {
        success: true,
        jobId,
        message: "Late fee application job scheduled successfully (daily at 9 AM UTC)",
        details: {
          schedule: "0 9 * * *",
          endpoint: "/api/jobs/trigger/late_fees",
          feeRate: "1% per day",
          maxFeeDays: 7,
        },
      };
    } catch (error) {
      console.error("Failed to schedule late fee application:", error);
      return {
        success: false,
        message: "Failed to schedule late fee application",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Execute Late Fee Application Job - Called by cron job - actually applies late fees - Algorithm: - 1. Find all active loans with next_due_date < now (overdue) - 2. For each loan: - a. Get last fee application date from ledger - b. Skip if already charged today (duplicate prevention) - c. Calculate: monthlyPayment * (1% per day overdue, max 7 days) - d. Apply fee via loanService.applyLateFeeWithNotification() - e. Log transaction + audit - 3. Send admin summary notification - 4. Return: {processed, failed, totalFeesAmount, details}
  async executeLateFeeApplication(): Promise<JobResult> {
    try {
      const now = new Date();

      // Find all active loans where next_due_date is in the past
      const overdueLoans = await (prisma.loan as any).findMany({
        where: {
          status: "active",
          next_due_date: {
            lt: now,
          },
        },
      });

      let successCount = 0;
      let failedCount = 0;
      let totalFeesApplied = 0;
      const processedLoans: Array<{
        loanId: string;
        borrowerId: string;
        feeApplied: number;
        daysOverdue: number;
      }> = [];

      // Apply late fees to each overdue loan
      for (let loan of overdueLoans) {
        try {
          // Check if fee already applied for today
          const feeAlreadyApplied = await this.checkDailyFeeApplied(loan.id);
          if (feeAlreadyApplied) {
            continue;
          }

          let nextDueDate = new Date(loan.next_due_date);
          let daysOverdue = Math.floor(
            (now.getTime() - nextDueDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          let totalAccruedFee = 0;

          // Process 7-day rollover cycles (Capitalization & Term extension)
          while (daysOverdue >= 7) {
            const currentRolled = Number(loan.rolled_balance || 0);
            const baseAmount = Number(loan.amount) + Number(loan.total_interest) + currentRolled;
            const feeToCapitalize = baseAmount * 0.07;
            await loanService.capitalizeAndRollOverLoan(
              loan.id,
              Math.round(feeToCapitalize * 100) / 100
            );

            // Fetch updated loan state for subsequent iterations
            const updatedLoan = await prisma.loan.findUnique({
              where: { id: loan.id },
            });
            if (!updatedLoan) break;
            loan = updatedLoan;

            nextDueDate = new Date(loan.next_due_date);
            daysOverdue = Math.floor(
              (now.getTime() - nextDueDate.getTime()) / (1000 * 60 * 60 * 24)
            );
          }

          // Apply remaining daily default charges (overdue days < 7)
          if (daysOverdue > 0) {
            const currentRolled = Number(loan.rolled_balance || 0);
            const baseAmount = Number(loan.amount) + Number(loan.total_interest) + currentRolled;
            const feeAmount = baseAmount * (daysOverdue * 0.01);
            await loanService.applyLateFeeWithNotification(
              loan.id,
              Math.round(feeAmount * 100) / 100, // Round to 2 decimals
              daysOverdue
            );
            totalAccruedFee += feeAmount;
          }

          totalFeesApplied += totalAccruedFee;
          successCount++;

          processedLoans.push({
            loanId: loan.id,
            borrowerId: loan.user_id,
            feeApplied: Math.round(totalAccruedFee * 100) / 100,
            daysOverdue,
          });
        } catch (error) {
          failedCount++;
          console.error(
            `Failed to apply late fees for loan ${loan.id}:`,
            error
          );
        }
      }

      // Send admin summary notification
      if (successCount > 0) {
        await this.sendAdminSummaryNotification({
          jobType: "late_fee_application",
          processedCount: successCount,
          failedCount,
          totalAmount: totalFeesApplied,
          details: {
            loansProcessed: processedLoans.length,
            totalLoansOverdue: overdueLoans.length,
            timestamp: now.toISOString(),
          },
        });
      }

      return {
        success: true,
        message: "Late fee application executed",
        processedCount: successCount,
        failedCount,
        details: {
          totalOverdueLoans: overdueLoans.length,
          feesAppliedCount: successCount,
          totalFeesAmount: Math.round(totalFeesApplied * 100) / 100,
          feesFailed: failedCount,
          loansProcessed: processedLoans,
          criteria: {
            status: "active",
            nextDueDate: `< ${now.toISOString()}`,
            feeRate: "1% of monthly payment per day",
            maxFeeDays: 7,
          },
        },
      };
    } catch (error) {
      console.error("Failed to execute late fee application:", error);
      return {
        success: false,
        message: "Failed to execute late fee application",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Schedule Maturity Processing Job - Runs daily at 10 AM, processes investments that reached maturity date - Algorithm: - 1. Find all active investments where end_date <= now - 2. With maturity_action = "rollover" and maturity_processed = false - 3. Use investmentService.processMaturedInvestments() - 4. Auto-creates new reinvestment with matured amount as principal - 5. Sends maturity notification - Cron: 0 10 * * * (Daily at 10 AM UTC)
  async scheduleMaturityProcessing(): Promise<JobResult> {
    try {
      const jobId = `maturity_processing_${Date.now()}`;

      const response = await this.qstash.publish({
        url: `${this.baseUrl}/api/jobs/trigger/maturity`,
        method: "POST",
        cron: "0 10 * * *", // Daily at 10 AM UTC
        headers: {
          "X-Job-ID": jobId,
          "X-Job-Type": "maturity_processing",
        },
      });

      // Log scheduled job
      await this.logScheduledJob(jobId, "maturity_processing", response);

      return {
        success: true,
        jobId,
        message: "Maturity processing job scheduled successfully (daily at 10 AM UTC)",
        details: {
          schedule: "0 10 * * *",
          endpoint: "/api/jobs/trigger/maturity",
          action: "Auto-reinvestment for mature investments",
        },
      };
    } catch (error) {
      console.error("Failed to schedule maturity processing:", error);
      return {
        success: false,
        message: "Failed to schedule maturity processing",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Execute Maturity Processing Job - Called by cron job - actually processes mature investments - Algorithm: - 1. Find all active investments where end_date <= now - 2. With maturity_action = "rollover" and maturity_processed = false - 3. For each investment: - a. Calculate final matured value (compound interest over full term) - b. Mark old investment as "completed" - c. Create NEW investment with matured value as principal - d. Log transaction (reinvestment deposit) - e. Log audit action (system generated) - f. Send maturity notification to investor - 4. Send admin summary notification - 5. Return: {processed, failed, totalReinvestedAmount, details}
  async executeMaturityProcessing(): Promise<JobResult> {
    try {
      const now = new Date();

      // Process matured investments via investment service
      const result = await investmentService.processMaturedInvestments();

      // Note: Detailed processed investments tracking - using service summary instead
      // Detailed breakdown would come from investmentService.processMaturedInvestments() in Phase 8
      const totalInvestedAmount = result.reinvestedAmount;
      const avgReinvestmentAmount =
        result.processed > 0 ? totalInvestedAmount / result.processed : 0;

      // Send admin summary notification
      if (result.processed > 0) {
        await this.sendAdminSummaryNotification({
          jobType: "maturity_processing",
          processedCount: result.processed,
          failedCount: result.failed,
          totalAmount: totalInvestedAmount,
          details: {
            investmentsMatured: result.processed,
            investmentsFailed: result.failed,
            totalReinvestedAmount: totalInvestedAmount.toFixed(2),
            averageReinvestmentAmount: avgReinvestmentAmount.toFixed(2),
            maturityDate: now.toISOString(),
            criteria: {
              status: "active",
              endDate: `<= ${now.toISOString()}`,
              maturityAction: "rollover",
              maturityProcessed: false,
            },
          },
        });
      }

      return {
        success: true,
        message: "Maturity processing executed",
        processedCount: result.processed,
        failedCount: result.failed,
        details: {
          investmentsMatured: result.processed,
          investmentsFailed: result.failed,
          totalReinvestedAmount: totalInvestedAmount.toFixed(2),
          averageReinvestment:
            result.processed > 0
              ? (totalInvestedAmount / result.processed).toFixed(2)
              : "0.00",
          reinvestmentChain: {
            oldInvestments: result.processed,
            newInvestments: result.processed,
            continuousValue: totalInvestedAmount.toFixed(2),
          },
          criteria: {
            status: "active",
            endDate: `<= ${now.toISOString()}`,
            maturityAction: "rollover",
            maturityProcessed: false,
          },
          timestamp: now.toISOString(),
        },
      };
    } catch (error) {
      console.error("Failed to execute maturity processing:", error);
      return {
        success: false,
        message: "Failed to execute maturity processing",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Schedule All Jobs - Convenience method to schedule all three job types at once
  async scheduleAllJobs(): Promise<{
    paymentReminders: JobResult;
    lateFees: JobResult;
    maturityProcessing: JobResult;
    databaseKeepAlive: JobResult;
  }> {
    const [paymentReminders, lateFees, maturityProcessing, databaseKeepAlive] = await Promise.all([
      this.schedulePaymentReminders(),
      this.scheduleLateFeeApplication(),
      this.scheduleMaturityProcessing(),
      this.scheduleDatabaseKeepAlive(),
    ]);

    return {
      paymentReminders,
      lateFees,
      maturityProcessing,
      databaseKeepAlive,
    };
  }

  // Schedule Database Keep-Alive Job - Runs every 5 minutes to keep Supabase pooler connections warm and avoid cold starts
  async scheduleDatabaseKeepAlive(): Promise<JobResult> {
    try {
      const jobId = `db_keep_alive_${Date.now()}`;

      const response = await this.qstash.publish({
        url: `${this.baseUrl}/health`,
        method: "GET",
        cron: "*/5 * * * *", // Every 5 minutes
        headers: {
          "X-Job-ID": jobId,
          "X-Job-Type": "db_keep_alive",
        },
      });

      return {
        success: true,
        message: "Database keep-alive job scheduled in QStash",
        jobId,
        details: response,
      };
    } catch (error) {
      return {
        success: false,
        message: "Failed to schedule database keep-alive job",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Check if daily fee already applied for a loan - Prevents duplicate fee application in same calendar day
  private async checkDailyFeeApplied(loanId: string): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const recentFee = await (prisma.transactionLedger as any).findFirst({
        where: {
          source_id: loanId,
          type: "charge",
          created_at: {
            gte: today,
          },
        },
        orderBy: {
          created_at: "desc",
        },
      });

      return !!recentFee;
    } catch (error) {
      // If check fails, assume fee not applied (better to apply than skip)
      return false;
    }
  }

  // Log scheduled job for monitoring/debugging
  private async logScheduledJob(
    jobId: string,
    jobType: string,
    qstashResponse: any
  ): Promise<void> {
    try {
      // This would log to a queue_jobs table if it existed
      // For now, just console log
      console.log(`Scheduled job ${jobId}:`, {
        type: jobType,
        qstashMessageId: qstashResponse?.messageId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to log scheduled job:", error);
    }
  }

  // Send admin summary notification after job execution - Notifies admin of job completion with statistics
  private async sendAdminSummaryNotification(data: {
    jobType: string;
    processedCount: number;
    failedCount: number;
    totalAmount?: number;
    details?: Record<string, any>;
  }): Promise<void> {
    try {
      // Get admin notification email from env
      const adminEmail = env.ADMIN_NOTIFICATION_EMAIL;
      if (!adminEmail) {
        console.warn("Admin notification email not configured");
        return;
      }

      const title =
        data.jobType === "late_fee_application"
          ? "Late Fee Application Summary"
          : data.jobType === "payment_reminder"
            ? "Payment Reminder Summary"
            : "Job Execution Summary";

      const message =
        `Job: ${data.jobType}\n` +
        `Processed: ${data.processedCount}\n` +
        `Failed: ${data.failedCount}\n` +
        (data.totalAmount ? `Total Amount: ₦${data.totalAmount.toFixed(2)}\n` : "") +
        `Timestamp: ${new Date().toISOString()}`;

      // Send via email service (non-blocking)
      if (emailService) {
        try {
          await emailService.sendEmail(adminEmail, "admin_notification", {
            subject: title,
            message,
            jobType: data.jobType,
            ...data.details,
          });
        } catch (emailError) {
          console.error("Failed to send admin notification email:", emailError);
        }
      }
    } catch (error) {
      console.error("Failed to send admin summary notification:", error);
    }
  }

  // Get Job Status - Returns information about a scheduled job
  async getJobStatus(jobId: string): Promise<any> {
    try {
      // This would query QStash API or local queue_jobs table
      return {
        jobId,
        status: "scheduled",
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      throw new AppError(500, "Failed to get job status");
    }
  }

  // List All Scheduled Jobs
  async listScheduledJobs(): Promise<ScheduledJob[]> {
    return [
      {
        id: "payment_reminders",
        name: "Payment Reminders",
        type: "payment_reminder",
        schedule: "0 8 * * *",
        enabled: true,
        nextRun: this.getNextCronRun("0 8 * * *"),
      },
      {
        id: "late_fees",
        name: "Late Fee Application",
        type: "late_fee_application",
        schedule: "0 9 * * *",
        enabled: true,
        nextRun: this.getNextCronRun("0 9 * * *"),
      },
      {
        id: "maturity_processing",
        name: "Maturity Processing",
        type: "maturity_processing",
        schedule: "0 10 * * *",
        enabled: true,
        nextRun: this.getNextCronRun("0 10 * * *"),
      },
    ];
  }

  // Helper: Calculate next run time for a cron expression - Simplified for standard daily times (0 HH * * *)
  private getNextCronRun(cronExpression: string): Date {
    const [, hour] = cronExpression.split(" ");
    const next = new Date();
    next.setHours(parseInt(hour) || 0, 0, 0, 0);

    if (next <= new Date()) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  // Manually Trigger Job (for testing/admin) - Bypasses cron schedule and runs immediately
  async manuallyTriggerJob(
    jobType: "payment_reminder" | "late_fee_application" | "maturity_processing"
  ): Promise<JobResult> {
    console.log(`Manually triggering ${jobType} job...`);

    switch (jobType) {
      case "payment_reminder":
        return this.executePaymentReminders();
      case "late_fee_application":
        return this.executeLateFeeApplication();
      case "maturity_processing":
        return this.executeMaturityProcessing();
      default:
        return {
          success: false,
          message: `Unknown job type: ${jobType}`,
        };
    }
  }
}

export const jobsService = new JobsService();

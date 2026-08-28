// Notification Service - Phase 5.1 - Comprehensive notification system for DPINES platform - Supports: - - Email notifications - - SMS notifications - - In-app notifications - - Notification preferences & history - - Bulk notification dispatching - Integration points: - - Loan payment reminders - - Investment maturity alerts - - Default/late fee notifications - - Administrative notifications - - System alerts

import prisma from "@/configs/database";
import { AppError } from "@/middlewares/error.middleware";
import emailService from "@/services/email.service";

type NotificationType = 
  | "loan_payment_reminder"
  | "loan_payment_received"
  | "loan_default_warning"
  | "loan_overdue_alert"
  | "investment_maturity_alert"
  | "investment_payout_alert"
  | "withdrawal_confirmation"
  | "deposit_confirmation"
  | "fee_charged"
  | "account_alert"
  | "system_alert"
  | "admin_notice";

type NotificationChannel = "email" | "sms" | "in_app";

interface NotificationPreferences {
  emailNotifications: boolean;
  smsNotifications: boolean;
  inAppNotifications: boolean;
  loanReminders: boolean;
  investmentAlerts: boolean;
  paymentConfirmations: boolean;
}

interface CreateNotificationInput {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  channels: NotificationChannel[];
  metadata?: Record<string, any>;
  sendAt?: Date; // For scheduled notifications
}

interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  channels: NotificationChannel[];
  isRead: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

interface NotificationHistory {
  total: number;
  read: number;
  unread: number;
  notifications: NotificationRecord[];
}

export class NotificationService {
  // Create and dispatch a notification - Saves to database and queues for delivery via specified channels
  async createNotification(input: CreateNotificationInput): Promise<NotificationRecord> {
    try {
      // Verify user exists
      const user = await prisma.userProfile.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Get user preferences
      const preferences = await this.getUserNotificationPreferences(input.userId);

      // Filter channels based on preferences
      const enabledChannels = input.channels.filter((channel) => {
        switch (channel) {
          case "email":
            return preferences.emailNotifications;
          case "sms":
            return preferences.smsNotifications;
          case "in_app":
            return preferences.inAppNotifications;
          default:
            return false;
        }
      });

      // Save in-app notification
      const notification = await prisma.userNotification.create({
        data: {
          user_id: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
          is_read: false,
        },
      });

      // Queue for delivery via enabled channels
      if (enabledChannels.length > 0) {
        await this.queueNotificationDelivery({
          notificationId: notification.id,
          userId: input.userId,
          channels: enabledChannels,
          title: input.title,
          message: input.message,
          type: input.type,
          sendAt: input.sendAt,
        });
      }

      return {
        id: notification.id,
        userId: notification.user_id,
        title: notification.title,
        message: notification.message,
        type: notification.type as NotificationType,
        channels: enabledChannels,
        isRead: notification.is_read || false,
        createdAt: notification.created_at || new Date(),
        metadata: {
          channels: enabledChannels,
          scheduledFor: input.sendAt,
          ...input.metadata,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create notification");
    }
  }

  // Mark notification as read
  async markAsRead(notificationId: string): Promise<NotificationRecord> {
    try {
      const notification = await prisma.userNotification.update({
        where: { id: notificationId },
        data: { is_read: true },
      });

      return {
        id: notification.id,
        userId: notification.user_id,
        title: notification.title,
        message: notification.message,
        type: notification.type as NotificationType,
        channels: ["in_app"],
        isRead: notification.is_read || false,
        createdAt: notification.created_at || new Date(),
        metadata: {},
      };
    } catch (error) {
      throw new AppError(500, "Failed to mark notification as read");
    }
  }

  // Mark all notifications as read for user
  async markAllAsRead(userId: string): Promise<{ marked: number }> {
    try {
      const result = await prisma.userNotification.updateMany({
        where: {
          user_id: userId,
          is_read: false,
        },
        data: {
          is_read: true,
        },
      });

      return { marked: result.count };
    } catch (error) {
      throw new AppError(500, "Failed to mark notifications as read");
    }
  }

  // Get user's notification history with pagination
  async getNotificationHistory(
    userId: string,
    skip: number = 0,
    take: number = 20,
    filter?: { type?: NotificationType; isRead?: boolean }
  ): Promise<NotificationHistory> {
    try {
      const where: any = { user_id: userId };

      if (filter?.type) {
        where.type = filter.type;
      }
      if (filter?.isRead !== undefined) {
        where.is_read = filter.isRead;
      }

      const [total, notifications] = await Promise.all([
        prisma.userNotification.count({ where }),
        prisma.userNotification.findMany({
          where,
          skip,
          take,
          orderBy: { created_at: "desc" },
        }),
      ]);

      const read = await prisma.userNotification.count({
        where: { ...where, is_read: true },
      });

      return {
        total,
        read,
        unread: total - read,
        notifications: notifications.map((n) => ({
          id: n.id,
          userId: n.user_id,
          title: n.title,
          message: n.message,
          type: n.type as NotificationType,
          channels: ["in_app"],
          isRead: n.is_read || false,
          createdAt: n.created_at || new Date(),
          metadata: {},
        })),
      };
    } catch (error) {
      throw new AppError(500, "Failed to retrieve notification history");
    }
  }

  // Get user's notification preferences
  async getUserNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Get preferences from user metadata or use defaults
      const metadata = (user.metadata as any) || {};
      const preferences = metadata.notificationPreferences || {};

      return {
        emailNotifications: preferences.emailNotifications !== false,
        smsNotifications: preferences.smsNotifications !== false,
        inAppNotifications: preferences.inAppNotifications !== false,
        loanReminders: preferences.loanReminders !== false,
        investmentAlerts: preferences.investmentAlerts !== false,
        paymentConfirmations: preferences.paymentConfirmations !== false,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to retrieve notification preferences");
    }
  }

  // Update user's notification preferences
  async updateNotificationPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      const metadata = (user.metadata as any) || {};
      const currentPrefs = metadata.notificationPreferences || {};
      const updatedPrefs = { ...currentPrefs, ...preferences };

      await prisma.userProfile.update({
        where: { id: userId },
        data: {
          metadata: {
            ...metadata,
            notificationPreferences: updatedPrefs,
          },
        },
      });

      return {
        emailNotifications: updatedPrefs.emailNotifications !== false,
        smsNotifications: updatedPrefs.smsNotifications !== false,
        inAppNotifications: updatedPrefs.inAppNotifications !== false,
        loanReminders: updatedPrefs.loanReminders !== false,
        investmentAlerts: updatedPrefs.investmentAlerts !== false,
        paymentConfirmations: updatedPrefs.paymentConfirmations !== false,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update notification preferences");
    }
  }

  // Delete old notifications (archive)
  async deleteOldNotifications(olderThanDays: number = 30): Promise<{ deleted: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await prisma.userNotification.deleteMany({
        where: {
          created_at: {
            lt: cutoffDate,
          },
          is_read: true, // Only delete read notifications
        },
      });

      return { deleted: result.count };
    } catch (error) {
      throw new AppError(500, "Failed to delete old notifications");
    }
  }

  // Queue notification for delivery via email/SMS - This integrates with Resend for email, SMS provider for SMS
  private async queueNotificationDelivery(data: {
    notificationId: string;
    userId: string;
    channels: NotificationChannel[];
    title: string;
    message: string;
    type: NotificationType;
    sendAt?: Date;
    templateName?: string;
    templateVariables?: Record<string, any>;
  }): Promise<void> {
    try {
      // Get user email
      const user = await prisma.userProfile.findUnique({
        where: { id: data.userId },
      });

      if (!user || !user.email) {
        console.warn(`Cannot send notification - user ${data.userId} has no email`);
        return;
      }

      // Send via enabled channels
      for (const channel of data.channels) {
        if (channel === "email" && data.templateName) {
          // Send email via Resend
          await emailService.sendEmailWithRetry(
            user.email,
            data.templateName,
            data.templateVariables || {
              firstName: user.first_name || "User",
              title: data.title,
              message: data.message,
            }
          );
        } else if (channel === "sms") {
          // TODO: Phase 5.3 - Integrate SMS provider
          console.log(
            `[SMS QUEUED] Recipient: ${user.phone_number || "N/A"} | Message: ${data.message}`
          );
        } else if (channel === "in_app") {
          // Already saved to database
          console.log(`[IN-APP] Notification ${data.notificationId} saved to database`);
        }
      }
    } catch (error) {
      console.error("Failed to queue notification delivery:", error);
      // Don't throw - notification is already saved, delivery is best-effort
    }
  }

  // Get unread notification count for user
  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await prisma.userNotification.count({
        where: {
          user_id: userId,
          is_read: false,
        },
      });
    } catch (error) {
      throw new AppError(500, "Failed to get unread notification count");
    }
  }

  // Bulk create notifications for multiple users (admin use)
  async createBulkNotifications(
    userIds: string[],
    notification: Omit<CreateNotificationInput, "userId">
  ): Promise<{ created: number; failed: number }> {
    try {
      let created = 0;
      let failed = 0;

      for (const userId of userIds) {
        try {
          await this.createNotification({ ...notification, userId });
          created++;
        } catch (error) {
          failed++;
          console.error(`Failed to create notification for user ${userId}:`, error);
        }
      }

      return { created, failed };
    } catch (error) {
      throw new AppError(500, "Failed to create bulk notifications");
    }
  }

  // Send notification for specific loan event
  async notifyLoanPaymentReminder(
    loanId: string,
    daysUntilDue: number,
    amountDue?: number
  ): Promise<void> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const preferences = await this.getUserNotificationPreferences(loan.user_id);

      if (!preferences.loanReminders) {
        return; // User opted out
      }

      const user = await prisma.userProfile.findUnique({
        where: { id: loan.user_id },
      });

      await this.createNotification({
        userId: loan.user_id,
        title: "Loan Payment Due Soon",
        message: `Your loan payment is due in ${daysUntilDue} day(s). Amount due: ₦${amountDue || loan.monthly_payment}`,
        type: "loan_payment_reminder",
        channels: ["in_app", "email"],
        metadata: {
          loanId,
          daysUntilDue,
          amountDue: amountDue || loan.monthly_payment,
        },
      });

      // Send email via Resend
      if (preferences.emailNotifications) {
        await emailService.sendEmailWithRetry(
          user?.email || "",
          "loan_payment_reminder",
          {
            firstName: user?.first_name || "User",
            daysUntilDue,
            amountDue: amountDue || loan.monthly_payment,
          }
        );
      }
    } catch (error) {
      console.error("Failed to send loan payment reminder:", error);
    }
  }

  // Send notification for investment maturity
  async notifyInvestmentMaturity(investmentId: string): Promise<void> {
    try {
      const investment = await prisma.investment.findUnique({
        where: { id: investmentId },
      });

      if (!investment) {
        throw new AppError(404, "Investment not found");
      }

      const preferences = await this.getUserNotificationPreferences(investment.user_id);

      if (!preferences.investmentAlerts) {
        return; // User opted out
      }

      const user = await prisma.userProfile.findUnique({
        where: { id: investment.user_id },
      });

      const currentValue = (investment.current_value as any) || 0;
      const initialAmount = (investment.amount as any) || 0;
      const interestEarned = currentValue - initialAmount;
      const roi = initialAmount > 0 ? ((interestEarned / initialAmount) * 100).toFixed(2) : "0";

      await this.createNotification({
        userId: investment.user_id,
        title: "Investment Mature",
        message: `Your investment has matured. Current value: ₦${currentValue}. Action required: Rollover or Withdraw`,
        type: "investment_maturity_alert",
        channels: ["in_app", "email"],
        metadata: {
          investmentId,
          currentValue,
          maturityAction: investment.maturity_action,
        },
      });

      // Send email via Resend
      if (preferences.emailNotifications) {
        await emailService.sendEmailWithRetry(
          user?.email || "",
          "investment_maturity_alert",
          {
            firstName: user?.first_name || "User",
            initialAmount,
            currentValue,
            interestEarned,
            roi,
            maturityAction: investment.maturity_action || "rollover",
          }
        );
      }
    } catch (error) {
      console.error("Failed to send investment maturity notification:", error);
    }
  }

  // Send notification for default/late fees
  async notifyDefaultFeeCharged(
    loanId: string,
    feeAmount: number,
    daysOverdue?: number,
    feeRate?: string
  ): Promise<void> {
    try {
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
      });

      if (!loan) {
        throw new AppError(404, "Loan not found");
      }

      const user = await prisma.userProfile.findUnique({
        where: { id: loan.user_id },
      });

      await this.createNotification({
        userId: loan.user_id,
        title: "Late Fee Charged",
        message: `A late fee of ₦${feeAmount} has been charged to your loan account due to overdue payment.`,
        type: "fee_charged",
        channels: ["in_app", "email"],
        metadata: {
          loanId,
          feeAmount,
          daysOverdue,
        },
      });

      // Send email via Resend
      const preferences = await this.getUserNotificationPreferences(loan.user_id);
      if (preferences.emailNotifications && user?.email) {
        await emailService.sendEmailWithRetry(
          user.email,
          "late_fee_charged",
          {
            firstName: user.first_name || "User",
            feeAmount,
            originalDueDate: loan.next_due_date
              ? new Date(loan.next_due_date).toLocaleDateString()
              : "N/A",
            daysOverdue: daysOverdue || 0,
            feeRate: feeRate || "1% per day",
          }
        );
      }
    } catch (error) {
      console.error("Failed to send default fee notification:", error);
    }
  }
}

export default new NotificationService();

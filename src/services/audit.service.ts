// Audit Logging Service - Tracks all administrative actions and sensitive state changes - Captures: who, what, when, old_values → new_values for complete accountability - Required for regulatory compliance, dispute resolution, and security investigation

import prisma from "@/configs/database";
import { AppError } from "@/middlewares/error.middleware";

type AuditAction =
  | "loan_approved"
  | "loan_rejected"
  | "loan_updated"
  | "loan_status_override"
  | "investment_approved"
  | "investment_rejected"
  | "investment_updated"
  | "investment_status_override"
  | "payment_approved"
  | "payment_rejected"
  | "deduction_processed"
  | "user_updated"
  | "user_role_changed"
  | "manual_adjustment"
  | "data_correction"
  | "exception_granted"
  | "limit_override"
  | "other";

interface AuditLogInput {
  adminId: string;
  targetUserId?: string;
  action: AuditAction;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
}

interface AuditLogEntry {
  id: string;
  admin_id: string;
  target_user_id?: string;
  action: AuditAction;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  created_at: Date;
}

export class AuditService {
  // Log an administrative action
  async logAction(input: AuditLogInput): Promise<AuditLogEntry> {
    try {
      let resolvedAdminId = input.adminId;
      if (resolvedAdminId === "00000000-0000-0000-0000-000000000000" || resolvedAdminId === "system") {
        const firstAdmin = await prisma.userProfile.findFirst({
          where: { role: "admin" },
        });
        if (firstAdmin) {
          resolvedAdminId = firstAdmin.id;
        } else {
          const anyUser = await prisma.userProfile.findFirst();
          if (anyUser) resolvedAdminId = anyUser.id;
        }
      }

      // Verify admin exists
      const admin = await prisma.userProfile.findUnique({
        where: { id: resolvedAdminId },
      });

      if (!admin) {
        throw new AppError(404, "Admin user not found");
      }

      // Create audit log entry
      const auditLog = await prisma.auditLog.create({
        data: {
          admin_id: resolvedAdminId,
          target_user_id: input.targetUserId,
          action: input.action,
          old_values: input.oldValues,
          new_values: input.newValues,
        },
      });

      return auditLog as unknown as AuditLogEntry;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to create audit log");
    }
  }

  // Log loan approval
  async logLoanApproval(
    adminId: string,
    loanId: string,
    userId: string,
    approvalNote?: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "loan_approved",
      newValues: { loanId, approvalNote },
    });
  }

  // Log loan rejection
  async logLoanRejection(
    adminId: string,
    loanId: string,
    userId: string,
    rejectionReason: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "loan_rejected",
      newValues: { loanId, rejectionReason },
    });
  }

  // Log loan update with before/after values
  async logLoanUpdate(
    adminId: string,
    loanId: string,
    userId: string,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
    _reason?: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "loan_updated",
      oldValues: { ...oldValues, loanId },
      newValues: { ...newValues, loanId },
    });
  }

  // Log loan status override
  async logLoanStatusOverride(
    adminId: string,
    loanId: string,
    userId: string,
    oldStatus: string,
    newStatus: string,
    reason: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "loan_status_override",
      oldValues: { loanId, status: oldStatus, reason },
      newValues: { loanId, status: newStatus },
    });
  }

  // Log investment approval
  async logInvestmentApproval(
    adminId: string,
    investmentId: string,
    userId: string,
    approvalNote?: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "investment_approved",
      newValues: { investmentId, approvalNote },
    });
  }

  // Log investment rejection
  async logInvestmentRejection(
    adminId: string,
    investmentId: string,
    userId: string,
    rejectionReason: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "investment_rejected",
      newValues: { investmentId, rejectionReason },
    });
  }

  // Log payment approval
  async logPaymentApproval(
    adminId: string,
    paymentId: string,
    userId: string,
    amount: number
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "payment_approved",
      newValues: { paymentId, amount },
    });
  }

  // Log payment rejection
  async logPaymentRejection(
    adminId: string,
    paymentId: string,
    userId: string,
    rejectionReason: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "payment_rejected",
      newValues: { paymentId, rejectionReason },
    });
  }

  // Log deduction processing
  async logDeductionProcessed(
    adminId: string,
    loanId: string,
    userId: string,
    investmentId: string,
    amount: number,
    approved: boolean
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId: userId,
      action: "deduction_processed",
      newValues: {
        loanId,
        investmentId,
        amount,
        status: approved ? "approved" : "rejected",
      },
    });
  }

  // Log manual adjustment/correction
  async logManualAdjustment(
    adminId: string,
    targetUserId: string,
    resourceId: string,
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
    reason: string
  ): Promise<AuditLogEntry> {
    return this.logAction({
      adminId,
      targetUserId,
      action: "manual_adjustment",
      oldValues: { ...oldValues, resourceId, reason },
      newValues: { ...newValues, resourceId },
    });
  }

  // Get audit logs for a specific user (as target)
  async getAuditLogsForUser(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    logs: AuditLogEntry[];
    total: number;
  }> {
    try {
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { target_user_id: userId },
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where: { target_user_id: userId } }),
      ]);

      return {
        logs: logs as unknown as AuditLogEntry[],
        total,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch audit logs");
    }
  }

  // Get audit logs by admin
  async getAuditLogsByAdmin(
    adminId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    logs: AuditLogEntry[];
    total: number;
  }> {
    try {
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { admin_id: adminId },
          orderBy: { created_at: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where: { admin_id: adminId } }),
      ]);

      return {
        logs: logs as unknown as AuditLogEntry[],
        total,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch audit logs");
    }
  }

  // Get audit logs for a date range
  async getAuditLogsByDateRange(
    startDate: Date,
    endDate: Date,
    action?: string,
    limit: number = 100
  ): Promise<AuditLogEntry[]> {
    try {
      const where: any = {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      };

      if (action) {
        where.action = action;
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
      });

      return logs as unknown as AuditLogEntry[];
    } catch (error) {
      throw new AppError(500, "Failed to fetch audit logs");
    }
  }
}

export const auditService = new AuditService();

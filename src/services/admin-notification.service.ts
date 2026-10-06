// Admin Alert Service - writes rows to `admin_notifications` for the Admin
// Alert Center (/admin/notifications) and the admin notification bell.
//
// Historically these rows were created by Postgres triggers, but the business
// logic now lives in the Express app, so the backend is the source of truth.
// Creating an alert is best-effort: a failure here must never break the
// caller's business flow, so errors are logged and swallowed.

import prisma from "../configs/database.js";

export interface AdminAlertInput {
  title: string;
  message: string;
  type: string;
  metadata?: Record<string, unknown>;
}

class AdminNotificationService {
  async create(input: AdminAlertInput): Promise<void> {
    try {
      await prisma.admin_notifications.create({
        data: {
          title: input.title,
          message: input.message,
          type: input.type,
          metadata: (input.metadata ?? {}) as any,
        },
      });
    } catch (error) {
      console.error("[ADMIN ALERT] Failed to create admin notification:", error);
    }
  }
}

export const adminNotificationService = new AdminNotificationService();
export default adminNotificationService;

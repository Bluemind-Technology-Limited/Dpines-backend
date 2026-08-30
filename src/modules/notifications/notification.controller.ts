// Notification Controller - Phase 5.1 - Exposes notification management endpoints

import { Router, Request, Response } from "express";
import notificationService from "./notification.service.js";
import { asyncHandler } from "../../middlewares/async.middleware.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const router: Router = Router();

// GET /notifications - Get user's notification history with pagination - Query: - - skip: number (default: 0) - - take: number (default: 20) - - type: notification type (optional) - - unread: boolean (optional)
router.get(
  "/",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const skip = parseInt(req.query.skip as string) || 0;
    const take = parseInt(req.query.take as string) || 20;
    const type = req.query.type as string | undefined;
    const unread = req.query.unread === "true" ? false : undefined;

    const history = await notificationService.getNotificationHistory(
      userId,
      skip,
      take,
      {
        type: type as any,
        isRead: unread !== undefined ? !unread : undefined,
      }
    );

    res.status(200).json({
      success: true,
      data: history,
    });
  })
);

// GET /notifications/unread/count - Get count of unread notifications
router.get(
  "/unread/count",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const count = await notificationService.getUnreadCount(userId);

    res.status(200).json({
      success: true,
      unreadCount: count,
    });
  })
);

// PUT /notifications/:id/read - Mark specific notification as read
router.put(
  "/:id/read",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const notification = await notificationService.markAsRead(id);

    res.status(200).json({
      success: true,
      data: notification,
    });
  })
);

// PUT /notifications/read-all - Mark all notifications as read
router.put(
  "/read-all",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    const result = await notificationService.markAllAsRead(userId);

    res.status(200).json({
      success: true,
      message: `Marked ${result.marked} notifications as read`,
      data: result,
    });
  })
);

// GET /notifications/preferences - Get user's notification preferences
router.get(
  "/preferences",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    const preferences = await notificationService.getUserNotificationPreferences(userId);

    res.status(200).json({
      success: true,
      data: preferences,
    });
  })
);

// PUT /notifications/preferences - Update user's notification preferences - Body: - { - "emailNotifications": boolean, - "smsNotifications": boolean, - "inAppNotifications": boolean, - "loanReminders": boolean, - "investmentAlerts": boolean, - "paymentConfirmations": boolean - }
router.put(
  "/preferences",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const preferences = req.body;

    const updated = await notificationService.updateNotificationPreferences(
      userId,
      preferences
    );

    res.status(200).json({
      success: true,
      message: "Notification preferences updated",
      data: updated,
    });
  })
);

// DELETE /notifications/old - Delete old notifications (admin only, for cleanup) - Query: - - days: number (default: 30) - delete notifications older than this many days
router.delete(
  "/old",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string) || 30;

    const result = await notificationService.deleteOldNotifications(days);

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deleted} old notifications`,
      data: result,
    });
  })
);

// GET /notifications/admin - Get all admin notifications
router.get(
  "/admin",
  authenticate,
  asyncHandler(async (_req: Request, res: Response) => {
    const prisma = (await import("@/configs/database")).default;
    const notifications = await prisma.admin_notifications.findMany({
      orderBy: { created_at: "desc" },
    });
    res.status(200).json({
      success: true,
      data: notifications,
    });
  })
);

// PUT /notifications/admin/:id/read - Mark admin notification as read
router.put(
  "/admin/:id/read",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const prisma = (await import("@/configs/database")).default;
    const updated = await prisma.admin_notifications.update({
      where: { id },
      data: { is_read: true },
    });
    res.status(200).json({
      success: true,
      data: updated,
    });
  })
);

// PUT /notifications/admin/read-all - Mark all admin notifications as read
router.put(
  "/admin/read-all",
  authenticate,
  asyncHandler(async (_req: Request, res: Response) => {
    const prisma = (await import("@/configs/database")).default;
    const result = await prisma.admin_notifications.updateMany({
      where: { is_read: false },
      data: { is_read: true },
    });
    res.status(200).json({
      success: true,
      marked: result.count,
    });
  })
);

export default router;

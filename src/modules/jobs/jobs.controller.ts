import { Request, Response, Router, type Router as ExpressRouter } from "express";
import { jobsService } from "@/services/jobs.service";
import { asyncHandler } from "@/middlewares/async.middleware";
import { authenticate, adminOnly } from "@/middlewares/auth.middleware";
import { AppError } from "@/middlewares/error.middleware";

const router: ExpressRouter = Router();

// POST /api/jobs/setup - Admin only - Initial setup of all background jobs - Schedules payment reminders, late fees, and maturity processing
router.post(
  "/setup",
  authenticate,
  adminOnly,
  asyncHandler(async (_req: Request, res: Response) => {
    // Admin verification - already done by adminOnly middleware
    const userId = (_req as any).user?.id;
    if (!userId) {
      throw new AppError(401, "Unauthorized");
    }

    // Check admin status (optional - implement if admin field exists)
    // For now, allow any authenticated user to set up jobs in dev

    const result = await jobsService.scheduleAllJobs();

    res.status(200).json({
      success: true,
      message: "All background jobs scheduled successfully",
      data: result,
    });
  })
);

// POST /api/jobs/trigger/payment_reminders - Manually trigger payment reminder job (for testing/cron) - Can be called by QStash cron or manual test
router.post(
  "/trigger/payment_reminders",
  asyncHandler(async (req: Request, res: Response) => {
    const cronKey = req.headers["x-cron-key"];
    if (process.env.CRON_KEY && cronKey !== process.env.CRON_KEY) {
      throw new AppError(401, "Unauthorized: Invalid Cron Key");
    }

    const result = await jobsService.executePaymentReminders();

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result,
    });
  })
);

// POST /api/jobs/trigger/late_fees - Manually trigger late fee application job (for testing/cron) - Can be called by QStash cron or manual test
router.post(
  "/trigger/late_fees",
  asyncHandler(async (req: Request, res: Response) => {
    const cronKey = req.headers["x-cron-key"];
    if (process.env.CRON_KEY && cronKey !== process.env.CRON_KEY) {
      throw new AppError(401, "Unauthorized: Invalid Cron Key");
    }

    const result = await jobsService.executeLateFeeApplication();

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result,
    });
  })
);

// POST /api/jobs/trigger/maturity - Manually trigger maturity processing job (for testing/cron) - Can be called by QStash cron or manual test
router.post(
  "/trigger/maturity",
  asyncHandler(async (req: Request, res: Response) => {
    const cronKey = req.headers["x-cron-key"];
    if (process.env.CRON_KEY && cronKey !== process.env.CRON_KEY) {
      throw new AppError(401, "Unauthorized: Invalid Cron Key");
    }

    const result = await jobsService.executeMaturityProcessing();

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result,
    });
  })
);

// GET /api/jobs/status - Get status of all scheduled jobs
router.get(
  "/status",
  authenticate,
  asyncHandler(async (_req: Request, res: Response) => {
    const jobs = await jobsService.listScheduledJobs();

    res.status(200).json({
      success: true,
      message: "Scheduled jobs retrieved",
      data: jobs,
    });
  })
);

// GET /api/jobs/status/:jobId - Get status of a specific job
router.get(
  "/status/:jobId",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const status = await jobsService.getJobStatus(jobId);

    res.status(200).json({
      success: true,
      message: "Job status retrieved",
      data: status,
    });
  })
);

// POST /api/jobs/manual-trigger - Admin only - Manually trigger any job immediately - Useful for testing and manual enforcement
router.post(
  "/manual-trigger",
  authenticate,
  adminOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobType } = req.body;

    // Validate job type
    const validJobTypes = [
      "payment_reminder",
      "late_fee_application",
      "maturity_processing",
    ];

    if (!jobType || !validJobTypes.includes(jobType)) {
      throw new AppError(
        400,
        `Invalid job type. Must be one of: ${validJobTypes.join(", ")}`
      );
    }

    const result = await jobsService.manuallyTriggerJob(jobType);

    res.status(200).json({
      success: result.success,
      message: result.message,
      data: result,
    });
  })
);

export default router;

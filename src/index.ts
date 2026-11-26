import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./configs/env.js";
import { errorHandler } from "./middlewares/error.middleware.js";

// Import routers
import authRouter from "./modules/auth/auth.router.js";
import loanRouter from "./modules/loans/loan.router.js";
import investmentRouter from "./modules/investments/investment.router.js";
import ticketRouter from "./modules/tickets/ticket.router.js";
import advertRouter from "./modules/adverts/advert.router.js";
import userRouter from "./modules/users/user.router.js";
import deductionRouter from "./modules/deductions/deduction.controller.js";
import notificationRouter from "./modules/notifications/notification.controller.js";
import communicationsRouter from "./modules/communications/communications.router.js";
import { jobsRouter } from "./modules/jobs/index.js";
import {
  fifoValidatorRouter,
  ledgerReconciliationRouter,
  financialReportingRouter,
} from "./modules/deductions/index.js";

const app: Application = express();

// Middleware
app.use(helmet());

// CORS origins is now an array from env
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

import prisma from "./configs/database.js";
import { withDbRetry } from "./lib/db-retry.js";

// Root check
app.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "DPINES Nigeria API Server is running!",
    // Vercel injects this so you can verify exactly which commit is deployed.
    commit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    env: env.NODE_ENV,
  });
});

// Health check with Database Keep-Alive query
app.get("/health", async (_req: Request, res: Response) => {
  try {
    // Retry once or twice: the pooler may have recycled the idle socket.
    await withDbRetry(() => prisma.$executeRawUnsafe("SELECT 1"), {
      label: "health check",
      attempts: 3,
      baseDelayMs: 150,
    });
    res.json({ status: "ok", database: "connected", timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Database connection failed" });
  }
});

// API Routes
app.use("/api/auth", authRouter);
app.use("/api/loans", loanRouter);
app.use("/api/investments", investmentRouter);
app.use("/api/tickets", ticketRouter);
app.use("/api/adverts", advertRouter);
app.use("/api/users", userRouter);
app.use("/api/deductions", deductionRouter);
app.use("/api/deductions", fifoValidatorRouter);
app.use("/api/deductions", ledgerReconciliationRouter);
app.use("/api/deductions", financialReportingRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/communications", communicationsRouter);
app.use("/api/jobs", jobsRouter);

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.path,
  });
});

// Error Handler (must be last)
app.use(errorHandler);

// Start the HTTP server only for long-lived processes. On Vercel the app is
// imported by api/index.ts and invoked per-request, so binding a port here is
// wrong and can make the serverless function misbehave.
if (!process.env.VERCEL) {
// Start server
const PORT = env.PORT;
const server = app.listen(PORT, async () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Environment: ${env.NODE_ENV}`);
  console.log(`✓ CORS enabled for: ${env.CORS_ORIGIN.join(", ")}`);

  // Establish the first connection explicitly instead of racing a fixed delay.
  // The Supabase pooler can take a moment on cold start; if it drops us here we
  // would otherwise fail the very first query (the template seed).
  try {
    await withDbRetry(() => prisma.$executeRawUnsafe("SELECT 1"), {
      label: "startup warm-up",
      attempts: 5,
      baseDelayMs: 400,
    });
    console.log("✓ Database connection established");
  } catch (err) {
    console.error(
      "Database warm-up failed — the server is up and will retry on the first request:",
      err
    );
  }

  // NOTE: the previous startup job recomputed every loan's rolled_balance from
  // its rollover ledger entries. It is intentionally disabled: rollovers now
  // update rolled_balance and write their ledger entry atomically at the moment
  // they happen, and the startup pass would silently overwrite any manual
  // correction an admin made through Edit Financials. The ledger remains the
  // audit trail; the stored balance is no longer rebuilt behind the user's back.

  // Seed default admin account created template if it doesn't exist
  try {
    await withDbRetry(
      () =>
        prisma.communication_templates.upsert({
          where: { name: "admin_account_created" },
          update: {},
          create: {
            name: "admin_account_created",
            subject: "Your DPINES Account Has Been Created",
            body: "Hello {{first_name}},\n\nYour account has been created by the administrator on DPINES Nigeria.\n\nYou can access your account using your email: {{email}}.\n\nTo log in and set up your password, please go to the login screen and click 'Forgot Password' or reset your password using OTP.\n\nThank you,\nDPINES Support",
            type: "email",
            is_active: true,
          },
        }),
      { label: "seed communication templates" }
    );
    console.log("✓ Communication templates seeded successfully");
  } catch (err) {
    console.error("Failed to seed default communication templates:", err);
    // Don't fail the server startup if seeding fails
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
}

export default app;

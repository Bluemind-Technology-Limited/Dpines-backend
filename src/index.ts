import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "@/configs/env";
import { errorHandler } from "@/middlewares/error.middleware";

// Import routers
import authRouter from "@/modules/auth/auth.router";
import loanRouter from "@/modules/loans/loan.router";
import investmentRouter from "@/modules/investments/investment.router";
import ticketRouter from "@/modules/tickets/ticket.router";
import advertRouter from "@/modules/adverts/advert.router";
import userRouter from "@/modules/users/user.router";
import deductionRouter from "@/modules/deductions/deduction.controller";
import notificationRouter from "@/modules/notifications/notification.controller";
import communicationsRouter from "@/modules/communications/communications.router";
import { jobsRouter } from "@/modules/jobs";
import {
  fifoValidatorRouter,
  ledgerReconciliationRouter,
  financialReportingRouter,
} from "@/modules/deductions";

const app: Application = express();

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

// Start server
const PORT = env.PORT;
const server = app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Environment: ${env.NODE_ENV}`);
  console.log(`✓ CORS enabled for: ${env.CORS_ORIGIN}`);
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

export default app;

import { Request, Response } from "express";
import { loanService } from "./loan.service.js";
import { sendSuccess, sendPaginated, asyncHandler } from "../../lib/utils.js";
import { AppError } from "../../middlewares/error.middleware.js";
import {
  createLoanSchema,
  approveLoanSchema,
  rejectLoanSchema,
  processDeductionSchema,
  loanPaymentSchema,
} from "../../lib/validators.js";

export const createLoan = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const body = createLoanSchema.parse(req.body);

  const loan = await loanService.createLoan(
    req.user.sub,
    body.amount,
    body.interestRate,
    body.termMonths,
    body.purpose
  );

  sendSuccess(res, loan, "Loan created successfully", 201);
});

export const getLoanById = asyncHandler(async (req: Request, res: Response) => {
  const { loanId } = req.params;

  const loan = await loanService.getLoanById(loanId);

  if (!loan) {
    throw new AppError(404, "Loan not found");
  }

  sendSuccess(res, loan, "Loan fetched successfully");
});

export const getUserLoans = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { status } = req.query;

    const loans = await loanService.getUserLoans(
      req.user.sub,
      status as any
    );

    sendSuccess(res, loans, "User loans fetched successfully");
  }
);

export const getAllLoans = asyncHandler(
  async (req: Request, res: Response) => {
    const status = req.query.status as string;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const { loans, total } = await loanService.getAllLoans(
      status as any,
      skip,
      take
    );

    sendPaginated(
      res,
      loans,
      total,
      page,
      pageSize
    );
  }
);

export const approveLoan = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    approveLoanSchema.parse(req.body);

    const loan = await loanService.approveLoan(loanId);

    sendSuccess(res, loan, "Loan approved successfully");
  }
);

export const rejectLoan = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const body = rejectLoanSchema.parse(req.body);

    const loan = await loanService.rejectLoan(
      loanId,
      body.rejectionReason
    );

    sendSuccess(res, loan, "Loan rejected successfully");
  }
);

export const createLoanPayment = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { loanId } = req.params;
    const body = loanPaymentSchema.parse(req.body);

    const payment = await loanService.createLoanPayment(
      loanId,
      body.amount,
      body.paymentMethod,
      body.monthNumber,
      body.receiptUrl
    );

    sendSuccess(res, payment, "Loan payment created successfully", 201);
  }
);

export const approveLoanPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { paymentId } = req.params;

    const payment = await loanService.approveLoanPayment(paymentId);

    sendSuccess(res, payment, "Loan payment approved successfully");
  }
);

export const rejectLoanPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const { paymentId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      throw new AppError(400, "Rejection reason is required");
    }

    const payment = await loanService.rejectLoanPayment(
      paymentId,
      rejectionReason
    );

    sendSuccess(res, payment, "Loan payment rejected successfully");
  }
);

export const processDeduction = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const body = processDeductionSchema.parse(req.body);

    const result = await loanService.processDeduction(loanId, body.amount);

    sendSuccess(res, result, "Deduction processed successfully");
  }
);

export const getLoanStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const stats = await loanService.getLoanStats(req.user.sub);

    sendSuccess(res, stats, "Loan stats fetched successfully");
  }
);

export const getPendingPayments = asyncHandler(
  async (_req: Request, res: Response) => {
    const payments = await loanService.getPendingPayments();
    sendSuccess(res, payments, "Pending payments fetched successfully");
  }
);

export const getLoanPayments = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const payments = await loanService.getLoanPayments(loanId);
    sendSuccess(res, payments, "Loan payments fetched successfully");
  }
);

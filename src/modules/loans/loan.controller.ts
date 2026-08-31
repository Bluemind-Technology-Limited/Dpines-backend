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
  updateLoanFinancialsSchema,
  sendLoanReminderSchema,
} from "../../lib/validators.js";
import notificationService from "../notifications/notification.service.js";
import prisma from "../../configs/prisma-wrapper.js";

export const createLoan = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const body = createLoanSchema.parse(req.body);
  const userRole = (req.user as any).role?.toLowerCase() || "user";
  const isAdmin = ["admin", "loans_admin"].includes(userRole);

  // RIGID BUSINESS LOGIC:
  // 1. Regular users can only create loans for themselves
  // 2. Admins MUST provide userId in the request body
  // 3. Admins cannot create loans for themselves

  let borrowerId: string;

  if (isAdmin) {
    // Admin must explicitly provide userId
    if (!body.userId) {
      throw new AppError(400, "Admins must specify which user to create the loan for via userId parameter");
    }
    
    borrowerId = body.userId;

    // Prevent admin from creating loan for themselves
    if (borrowerId === req.user.sub) {
      throw new AppError(400, "Admins cannot create loans for themselves. Use the regular loan application form if you need a personal loan.");
    }
  } else {
    // Regular user - can only apply for themselves
    if (body.userId && body.userId !== req.user.sub) {
      throw new AppError(403, "You can only create loans for yourself");
    }
    borrowerId = req.user.sub;
  }

  // Verify the borrower exists
  const borrower = await prisma.userProfile.findUnique({
    where: { id: borrowerId },
  });

  if (!borrower) {
    throw new AppError(404, `User with ID ${borrowerId} not found`);
  }

  console.log(`[LOAN CREATE] ${isAdmin ? "Admin" : "User"} ${req.user.sub} creating loan for ${borrowerId} (${borrower.email})`);

  const loan = await loanService.createLoan(
    borrowerId,
    body.amount,
    body.interestRate,
    body.termMonths,
    body.purpose,
    body.monthlyPayment,
    body.totalInterest
    // isAdmin ? req.user.sub : undefined  // Track who created the loan (TODO: uncomment when database is migrated)
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

    console.log(`[GET USER LOANS] User ${req.user.sub} requesting their loans`);

    const { status } = req.query;

    const loans = await loanService.getUserLoans(
      req.user.sub,
      status as any
    );

    console.log(`[GET USER LOANS RESPONSE] Sending ${loans.length} loans to user ${req.user.sub}`);
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
  async (req: Request, res: Response) => {
    const userRole = (req.user as any).role?.toLowerCase() || "user";
    const userId = (req.user as any).sub;
    
    // Admins get all pending payments, regular users get only their own
    const payments = ["admin", "loans_admin"].includes(userRole)
      ? await loanService.getPendingPayments()
      : await loanService.getUserPendingPayments(userId);
    
    sendSuccess(res, payments, "Pending payments fetched successfully");
  }
);

export const getRepaymentRequests = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { loanId } = req.query;
    const userRole = (req.user as any).role?.toLowerCase() || "user";
    const userId = (req.user as any).sub;

    // Admins can see all requests, users see only their own or for their loans
    const requests = await loanService.getRepaymentRequests(
      loanId as string | undefined,
      ["admin", "loans_admin"].includes(userRole) ? undefined : userId
    );

    console.log(`\n========== REPAYMENT REQUESTS API RESPONSE ==========`);
    console.log(`Total requests: ${requests.length}`);
    if (requests.length > 0) {
      console.log(`First request structure:`, JSON.stringify(requests[0], null, 2));
    }
    console.log(`====================================================\n`);
    sendSuccess(res, requests, "Repayment requests fetched successfully");
  }
);

export const getLoanPayments = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const payments = await loanService.getLoanPayments(loanId);
    sendSuccess(res, payments, "Loan payments fetched successfully");
  }
);

export const deleteLoanController = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const result = await loanService.deleteLoan(loanId);
    sendSuccess(res, result, "Loan deleted successfully");
  }
);

export const updateLoanFinancialsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const body = updateLoanFinancialsSchema.parse(req.body);
    const result = await loanService.updateLoanFinancials(loanId, body);
    sendSuccess(res, result, "Loan financials updated successfully");
  }
);

export const sendLoanReminderController = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;
    const body = sendLoanReminderSchema.parse(req.body);

    const loan = await loanService.getLoanById(loanId);
    if (!loan) {
      throw new AppError(404, "Loan not found");
    }

    // Fetch the actual borrower (loan owner) from user_profiles using the loan's user_id
    const borrower = await prisma.userProfile.findUnique({
      where: { id: (loan as any).user_id },
    });

    if (!borrower) {
      throw new AppError(404, "Borrower not found");
    }

    const borrowerEmail = borrower.email;
    const borrowerName = `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim();

    console.log(`[REMINDER DEBUG] Borrower fetched by user_id: ${(loan as any).user_id}`);
    console.log(`[REMINDER DEBUG] Borrower email: ${borrowerEmail}, name: ${borrowerName}`);

    if (!borrowerEmail) {
      throw new AppError(400, "Borrower email not found");
    }

    // Send via edge function - send to BORROWER, not admin
    const reminderResult = await notificationService.sendLoanReminderViaEdgeFunction({
      loanId: loan.id,
      paymentMonth: body.paymentMonth,
      userEmail: borrowerEmail,
      userName: borrowerName,
      loanAmount: Number(loan.amount),
      monthlyPayment: body.monthlyPayment,
      paymentDate: body.paymentDate,
    });

    if (!reminderResult.success) {
      throw new AppError(500, reminderResult.error || "Failed to send reminder");
    }

    // Create in-app notification for the borrower
    await notificationService.createNotification({
      userId: (loan as any).user_id,
      title: "Loan Payment Reminder",
      message: `Your loan payment reminder for Month ${body.paymentMonth} (₦${body.monthlyPayment.toLocaleString()}) has been sent.`,
      type: "loan_payment_reminder",
      channels: ["in_app"],
      metadata: {
        loanId,
        paymentMonth: body.paymentMonth,
        amountDue: body.monthlyPayment,
        dueDate: body.paymentDate,
      },
    });

    sendSuccess(res, reminderResult, "Reminder sent successfully");
  }
);

import { z } from "zod";

// Loan Validators
export const createLoanSchema = z.object({
  // userId: For admins only - specifies which user to create the loan for
  // Regular users should NOT provide this - they apply for themselves
  userId: z.string().uuid("Invalid user ID").optional(),
  amount: z.number().positive("Amount must be positive"),
  interestRate: z.number().min(0).max(100, "Interest rate must be between 0 and 100"),
  termMonths: z.number().int().min(1, "Term must be at least 1 month"),
  purpose: z.string().optional(),
  monthlyPayment: z.number().positive("Monthly payment must be positive").optional(),
  totalInterest: z.number().nonnegative("Total interest must be non-negative").optional(),
});

export const approveLoanSchema = z.object({
  approvalNote: z.string().optional(),
});

export const rejectLoanSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});

export const processDeductionSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
});

export const loanPaymentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  paymentMethod: z.enum(["bank_transfer", "contribution_deduction"]),
  receiptUrl: z.string().url().optional(),
  monthNumber: z.number().int().min(1),
});

// Investment Validators
export const createInvestmentSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  interestRate: z.number().min(0).max(100, "Interest rate must be between 0 and 100"),
  termMonths: z.number().int().min(1, "Term must be at least 1 month"),
  payoutFrequency: z.enum(["monthly", "month", "reinvestment"]),
});

export const approveInvestmentSchema = z.object({
  approvalNote: z.string().optional(),
});

export const rejectInvestmentSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});

export const setMaturityActionSchema = z.object({
  action: z.enum(["withdraw", "rollover"]),
});

// Ticket Validators
export const createTicketSchema = z.object({
  subject: z.string().min(3, "Subject must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

export const addTicketMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty"),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "closed"]),
});

// User Validators
export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

// Advert Validators
export const createAdvertSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().optional(),
  imageUrl: z.string().url().optional(),
  linkUrl: z.string().url().optional(),
  isActive: z.boolean().optional(),
});

export const updateAdvertSchema = createAdvertSchema.partial();

// Pagination Validator
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

// Type exports for better TypeScript support
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type CreateInvestmentInput = z.infer<typeof createInvestmentSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateLoanFinancialsSchema = z.object({
  amount: z.number().positive(),
  principal_balance: z.number().nonnegative(),
  interest_rate: z.number().nonnegative(),
  start_date: z.string().or(z.date()),
  term_months: z.number().int().positive().optional(),
  end_date: z.string().or(z.date()).nullable().optional(),
  status: z.string().optional(),
  monthly_payment: z.number().nonnegative().optional(),
  rolled_balance: z.number().nonnegative().optional(),
  compounded_interest: z.number().nonnegative().optional(),
});

export const updateInvestmentFinancialsSchema = z.object({
  amount: z.number().positive(),
  current_value: z.number().nonnegative(),
  interest_rate: z.number().nonnegative(),
  start_date: z.string().or(z.date()),
  term_months: z.number().int().positive().optional(),
  end_date: z.string().or(z.date()).nullable().optional(),
  status: z.string().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const sendLoanReminderSchema = z.object({
  paymentMonth: z.number().int().positive(),
  userEmail: z.string().optional().or(z.literal("")),
  userName: z.string().optional().or(z.literal("")),
  loanAmount: z.number().positive(),
  monthlyPayment: z.number().positive(),
  paymentDate: z.string(),
});

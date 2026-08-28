import { Request, Response } from "express";
import { investmentService } from "./investment.service";
import { sendSuccess, sendPaginated, asyncHandler } from "@/lib/utils";
import { AppError } from "@/middlewares/error.middleware";
import {
  createInvestmentSchema,
  approveInvestmentSchema,
  rejectInvestmentSchema,
  setMaturityActionSchema,
} from "@/lib/validators";

export const createInvestment = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const body = createInvestmentSchema.parse(req.body);

    const investment = await investmentService.createInvestment(
      req.user.sub,
      body.amount,
      body.interestRate,
      body.termMonths,
      body.payoutFrequency
    );

    sendSuccess(res, investment, "Investment created successfully", 201);
  }
);

export const getInvestmentById = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;

    const investment = await investmentService.getInvestmentById(investmentId);

    if (!investment) {
      throw new AppError(404, "Investment not found");
    }

    sendSuccess(res, investment, "Investment fetched successfully");
  }
);

export const getUserInvestments = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { status } = req.query;

    const investments = await investmentService.getUserInvestments(
      req.user.sub,
      status as any
    );

    sendSuccess(res, investments, "User investments fetched successfully");
  }
);

export const getAllInvestments = asyncHandler(
  async (req: Request, res: Response) => {
    const status = req.query.status as string;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const { investments, total } = await investmentService.getAllInvestments(
      status as any,
      skip,
      take
    );

    sendPaginated(
      res,
      investments,
      total,
      page,
      pageSize
    );
  }
);

export const approveInvestment = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;
    approveInvestmentSchema.parse(req.body);

    const investment = await investmentService.approveInvestment(investmentId);

    sendSuccess(res, investment, "Investment approved successfully");
  }
);

export const rejectInvestment = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;
    const body = rejectInvestmentSchema.parse(req.body);

    const investment = await investmentService.rejectInvestment(
      investmentId,
      body.rejectionReason
    );

    sendSuccess(res, investment, "Investment rejected successfully");
  }
);

export const setMaturityAction = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;
    const body = setMaturityActionSchema.parse(req.body);

    const investment = await investmentService.setMaturityAction(
      investmentId,
      body.action
    );

    sendSuccess(res, investment, "Maturity action set successfully");
  }
);

export const updateInvestmentValue = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;

    const investment = await investmentService.updateInvestmentValue(
      investmentId
    );

    sendSuccess(res, investment, "Investment value updated successfully");
  }
);

export const getInvestmentStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const stats = await investmentService.getInvestmentStats(req.user.sub);

    sendSuccess(res, stats, "Investment stats fetched successfully");
  }
);

export const completeInvestment = asyncHandler(
  async (req: Request, res: Response) => {
    const { investmentId } = req.params;

    const investment = await investmentService.completeInvestment(investmentId);

    sendSuccess(res, investment, "Investment completed successfully");
  }
);

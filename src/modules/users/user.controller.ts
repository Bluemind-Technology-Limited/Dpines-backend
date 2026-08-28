import { Request, Response } from "express";
import { userService } from "./user.service";
import { sendSuccess, sendPaginated, asyncHandler } from "@/lib/utils";
import { AppError } from "@/middlewares/error.middleware";
import { updateProfileSchema } from "@/lib/validators";

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const user = await userService.getUserById(req.user.sub);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  sendSuccess(res, user, "Profile fetched successfully");
});

export const updateProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const body = updateProfileSchema.parse(req.body);

    const user = await userService.updateUserProfile(req.user.sub, body);

    sendSuccess(res, user, "Profile updated successfully");
  }
);

export const getDashboardStats = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const stats = await userService.getUserDashboardStats(req.user.sub);

    sendSuccess(res, stats, "Dashboard stats fetched successfully");
  }
);

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await userService.getUserById(userId);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  sendSuccess(res, user, "User fetched successfully");
});

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 10);

  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const { users, total } = await userService.getAllUsers(skip, take);

  sendPaginated(
    res,
    users,
    total,
    page,
    pageSize
  );
});

export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const { q, page = 1, pageSize = 10 } = req.query;

  if (!q || typeof q !== "string") {
    throw new AppError(400, "Search query is required");
  }

  const skip = ((page as number) - 1) * (pageSize as number);
  const take = pageSize as number;

  const users = await userService.searchUsers(q, skip, take);

  sendSuccess(res, users, "Users search results fetched successfully");
});

export const updateUserRole = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role) {
      throw new AppError(400, "Role is required");
    }

    const user = await userService.updateUserRole(userId, role);

    sendSuccess(res, user, "User role updated successfully");
  }
);

export const getUsersStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const stats = await userService.getUsersStats();

    sendSuccess(res, stats, "User stats fetched successfully");
  }
);

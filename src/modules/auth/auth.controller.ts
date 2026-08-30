import { Request, Response } from "express";
import { authService } from "./auth.service.js";
import { sendSuccess, asyncHandler } from "../../lib/utils.js";
import { AppError } from "../../middlewares/error.middleware.js";
import { z } from "zod";

const generateOTPSchema = z.object({
  email: z.string().email(),
});

const verifyOTPSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "OTP must be 6 digits"),
});

const updateProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  newPassword: z.string().min(6),
});

export const generateOTP = asyncHandler(async (req: Request, res: Response) => {
  const body = generateOTPSchema.parse(req.body);

  const otp = await authService.generateOTP(body.email);

  // In production, send OTP via email
  console.log(`OTP for ${body.email}: ${otp}`);

  sendSuccess(res, { message: "OTP sent to your email" }, "OTP generated successfully");
});

export const verifyOTP = asyncHandler(async (req: Request, res: Response) => {
  const body = verifyOTPSchema.parse(req.body);

  const verified = await authService.verifyOTP(body.email, body.code);

  sendSuccess(res, { verified }, "OTP verified successfully");
});

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const user = await authService.getUserProfile(req.user.sub);

  const mappedUser = {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    phoneNumber: user.phone_number,
    address: user.address,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
    isActiveInvestor: user.is_active_investor,
    metadata: user.metadata ? (typeof user.metadata === "string" ? JSON.parse(user.metadata) : user.metadata) : {},
  };

  sendSuccess(res, mappedUser, "Profile fetched successfully");
});

export const updateProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const body = updateProfileSchema.parse(req.body);

    const updated = await authService.updateUserProfile(req.user.sub, body);

    const mappedUser = {
      id: updated.id,
      email: updated.email,
      firstName: updated.first_name,
      lastName: updated.last_name,
      role: updated.role,
      phoneNumber: updated.phone_number,
      address: updated.address,
      avatarUrl: updated.avatar_url,
      createdAt: updated.created_at,
      isActiveInvestor: updated.is_active_investor,
      metadata: updated.metadata ? (typeof updated.metadata === "string" ? JSON.parse(updated.metadata) : updated.metadata) : {},
    };

    sendSuccess(res, mappedUser, "Profile updated successfully");
  }
);

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const body = changePasswordSchema.parse(req.body);

    // Verify current password by attempting to sign in
    // This would typically be done with Supabase's signInWithPassword method
    // For now, we'll just update the password

    await authService.changePassword(req.user.sub, body.newPassword);

    sendSuccess(res, {}, "Password changed successfully");
  }
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const body = resetPasswordSchema.parse(req.body);

    await authService.resetPassword(body.email, body.newPassword);

    sendSuccess(res, {}, "Password reset successfully");
  }
);

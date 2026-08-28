import prisma from "@/configs/database";
import supabaseAdmin from "@/configs/supabase";
import { AppError } from "@/middlewares/error.middleware";
import type { UserRole } from "@/types";

export class AuthService {
  async generateOTP(email: string): Promise<string> {
    try {
      // Check if user exists
      const user = await prisma.userProfile.findUnique({
        where: { email },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Generate random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Save OTP to database
      await prisma.otpRecord.create({
        data: {
          email,
          code: otp,
          expires_at: expiresAt,
        },
      });

      return otp;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to generate OTP");
    }
  }

  async verifyOTP(email: string, code: string): Promise<boolean> {
    try {
      const otpRecord = await prisma.otpRecord.findFirst({
        where: {
          email,
          code,
          expires_at: {
            gt: new Date(),
          },
        },
      });

      if (!otpRecord) {
        throw new AppError(400, "Invalid or expired OTP");
      }

      // Delete the OTP after successful verification
      await prisma.otpRecord.delete({
        where: { id: otpRecord.id },
      });

      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to verify OTP");
    }
  }

  async createUserProfile(
    id: string,
    email: string,
    firstName: string,
    lastName: string,
    role: UserRole = "user"
  ) {
    try {
      const existingUser = await prisma.userProfile.findUnique({
        where: { id },
      });

      if (existingUser) {
        return existingUser;
      }

      const userProfile = await prisma.userProfile.create({
        data: {
          id,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
        },
      });

      return userProfile;
    } catch (error) {
      throw new AppError(500, "Failed to create user profile");
    }
  }

  async getUserProfile(userId: string) {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      return user;
    } catch (error) {
      console.error("Prisma error in getUserProfile:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to fetch user profile");
    }
  }

  async updateUserProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      address?: string;
      avatarUrl?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    try {
      const updatedUser = await prisma.userProfile.update({
        where: { id: userId },
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          phone_number: data.phoneNumber,
          address: data.address,
          avatar_url: data.avatarUrl,
          ...(data.metadata && { metadata: JSON.stringify(data.metadata) }),
          updated_at: new Date(),
        },
      });

      return updatedUser;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update user profile");
    }
  }

  async verifySupabaseToken(token: string) {
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !data.user) {
        throw new AppError(401, "Invalid token");
      }

      return data.user;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Token verification failed");
    }
  }

  async changePassword(userId: string, newPassword: string) {
    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        {
          password: newPassword,
        }
      );

      if (error) {
        throw new AppError(400, error.message);
      }

      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to change password");
    }
  }

  async resetPassword(email: string, newPassword: string) {
    try {
      // Find user by email
      const user = await prisma.userProfile.findUnique({
        where: { email },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Update password in Supabase
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        {
          password: newPassword,
        }
      );

      if (error) {
        throw new AppError(400, error.message);
      }

      return true;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to reset password");
    }
  }
}

export const authService = new AuthService();

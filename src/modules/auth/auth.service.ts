import prisma from "../../configs/database.js";
import supabaseAdmin from "../../configs/supabase.js";
import { edgeFunctionService } from "../../services/edge-function.service.js";
import { AppError } from "../../middlewares/error.middleware.js";
import type { UserRole } from "../../types/index.js";

export class AuthService {
  async generateOTP(email: string): Promise<string> {
    try {
      // Check if user exists
      const user = await prisma.userProfile.findFirst({
        where: { email: { equals: email.trim(), mode: "insensitive" } },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Generate random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Save OTP to database (stored against the lower-cased email)
      await prisma.otpRecord.create({
        data: {
          email: email.trim().toLowerCase(),
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

  /** Wrong guesses allowed per code before it is locked out. */
  private static readonly MAX_OTP_ATTEMPTS = 5;

  // Latest non-expired OTP row for an email, regardless of code — so a wrong
  // guess can be counted. Case-insensitive because codes are generated against
  // the lower-cased address (send-otp calls generate_otp with email.toLowerCase()).
  private async resolveActiveOtp(email: string) {
    return prisma.otpRecord.findFirst({
      where: {
        email: { equals: email.trim(), mode: "insensitive" },
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: "desc" },
    });
  }

  private assertOtpNotExhausted(record: { attempts: number }) {
    if (record.attempts >= AuthService.MAX_OTP_ATTEMPTS) {
      throw new AppError(
        429,
        "Too many incorrect attempts. Please request a new code."
      );
    }
  }

  // Counts a wrong guess; locks the code out once the budget is spent.
  private async registerFailedAttempt(record: { id: string; attempts: number }) {
    const next = (record.attempts ?? 0) + 1;
    await prisma.otpRecord.update({
      where: { id: record.id },
      data: { attempts: next },
    });
    if (next >= AuthService.MAX_OTP_ATTEMPTS) {
      throw new AppError(
        429,
        "Too many incorrect attempts. Please request a new code."
      );
    }
  }

  /**
   * Non-consuming validation ("peek") used by the Verify-OTP screen, so it can
   * give immediate feedback WITHOUT spending the code — /reset-password is the
   * single place that actually consumes it. Wrong guesses still count toward the
   * lockout budget.
   */
  async checkOTP(email: string, code: string): Promise<boolean> {
    try {
      const record = await this.resolveActiveOtp(email);
      if (!record) {
        throw new AppError(400, "Invalid or expired OTP");
      }
      this.assertOtpNotExhausted(record);

      if (record.code === code.trim()) {
        return true;
      }

      await this.registerFailedAttempt(record);
      throw new AppError(400, "Invalid or expired OTP");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to check OTP");
    }
  }

  /** Consuming verification — deletes the code on success. */
  async verifyOTP(email: string, code: string): Promise<boolean> {
    try {
      const record = await this.resolveActiveOtp(email);
      if (!record) {
        throw new AppError(400, "Invalid or expired OTP");
      }
      this.assertOtpNotExhausted(record);

      if (record.code !== code.trim()) {
        await this.registerFailedAttempt(record);
        throw new AppError(400, "Invalid or expired OTP");
      }

      // Delete the OTP after successful verification
      await prisma.otpRecord.delete({
        where: { id: record.id },
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

      // Send welcome email asynchronously using Edge Function
      edgeFunctionService.sendWelcomeEmail(email, firstName, lastName).catch((err) => {
        console.error("Failed to trigger welcome email edge function:", err);
      });

      return userProfile;
    } catch (error) {
      throw new AppError(500, "Failed to create user profile");
    }
  }

  /**
   * Runs immediately after a Supabase sign-up. Guarantees the user_profiles row
   * exists (idempotent — normally created by the handle_new_user DB trigger) and
   * sends the welcome email exactly once, tracked via metadata.welcome_email_sent
   * so a retry cannot double-send.
   */
  async completeSignup(
    userId: string,
    fallback?: { email?: string; firstName?: string; lastName?: string }
  ) {
    try {
      let profile = await prisma.userProfile.findUnique({ where: { id: userId } });

      if (!profile) {
        if (!fallback?.email) {
          throw new AppError(404, "User profile not found");
        }
        profile = await prisma.userProfile.create({
          data: {
            id: userId,
            email: fallback.email,
            first_name: fallback.firstName || "User",
            last_name: fallback.lastName || "",
            role: "user",
          },
        });
      }

      const rawMetadata = profile.metadata;
      const metadata: Record<string, unknown> =
        rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
          ? (rawMetadata as Record<string, unknown>)
          : {};

      if (!metadata.welcome_email_sent) {
        edgeFunctionService
          .sendWelcomeEmail(profile.email, profile.first_name, profile.last_name)
          .catch((err) => {
            console.error("Failed to trigger welcome email edge function:", err);
          });

        await prisma.userProfile.update({
          where: { id: userId },
          data: {
            metadata: { ...metadata, welcome_email_sent: true } as any,
            updated_at: new Date(),
          },
        });
      }

      return profile;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to complete signup");
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

  async resetPassword(email: string, code: string, newPassword: string) {
    try {
      // Find user by email (case-insensitive — the email may be entered with
      // different casing than it was stored).
      const user = await prisma.userProfile.findFirst({
        where: { email: { equals: email.trim(), mode: "insensitive" } },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // The OTP is the only proof of ownership. Verify AND consume it before the
      // password is touched — without a valid code this call cannot succeed, so
      // knowing the email alone is no longer enough to reset the password.
      await this.verifyOTP(email, code);

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

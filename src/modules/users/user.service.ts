import prisma from "../../configs/database.js";
import { AppError } from "../../middlewares/error.middleware.js";
import { auditService } from "../../services/audit.service.js";
import type { UserProfile, UserRole } from "../../types/index.js";

export class UserService {
  async getUserById(userId: string): Promise<UserProfile | null> {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      return user;
    } catch (error) {
      throw new AppError(500, "Failed to fetch user");
    }
  }

  async getUserByEmail(email: string): Promise<UserProfile | null> {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { email },
      });

      return user;
    } catch (error) {
      throw new AppError(500, "Failed to fetch user");
    }
  }

  async getAllUsers(skip: number = 0, take: number = 10) {
    try {
      const [users, total] = await Promise.all([
        prisma.userProfile.findMany({
          skip,
          take,
          orderBy: {
            created_at: "desc",
          },
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            role: true,
            phone_number: true,
            address: true,
            avatar_url: true,
            metadata: true,
            is_active_investor: true,
            created_at: true,
            updated_at: true,
          },
        }),
        prisma.userProfile.count(),
      ]);

      return { users, total };
    } catch (error) {
      throw new AppError(500, "Failed to fetch users");
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
  ): Promise<UserProfile> {
    try {
      const user = await prisma.userProfile.update({
        where: { id: userId },
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          phone_number: data.phoneNumber,
          address: data.address,
          avatar_url: data.avatarUrl,
          ...(data.metadata && { metadata: data.metadata as any }),
          updated_at: new Date(),
        },
      });

      return user;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update user profile");
    }
  }

  async updateUserRole(userId: string, role: UserRole): Promise<UserProfile> {
    try {
      const user = await prisma.userProfile.update({
        where: { id: userId },
        data: {
          role,
          updated_at: new Date(),
        },
      });

      return user;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update user role");
    }
  }

  // Admin-only: update any user's profile. Unlike the self-service update this
  // also persists `role` and `is_active_investor` (the flag that drives the 10%
  // loan rate for active investors).
  async updateUserProfileAdmin(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      address?: string;
      avatarUrl?: string;
      metadata?: Record<string, unknown>;
      role?: UserRole;
      isActiveInvestor?: boolean;
    },
    adminId?: string
  ): Promise<UserProfile> {
    try {
      const existing = await prisma.userProfile.findUnique({
        where: { id: userId },
      });

      if (!existing) {
        throw new AppError(404, "User not found");
      }

      const updated = await prisma.userProfile.update({
        where: { id: userId },
        data: {
          ...(data.firstName !== undefined && { first_name: data.firstName }),
          ...(data.lastName !== undefined && { last_name: data.lastName }),
          ...(data.phoneNumber !== undefined && { phone_number: data.phoneNumber }),
          ...(data.address !== undefined && { address: data.address }),
          ...(data.avatarUrl !== undefined && { avatar_url: data.avatarUrl }),
          ...(data.metadata !== undefined && { metadata: data.metadata as any }),
          ...(data.role !== undefined && { role: data.role }),
          ...(data.isActiveInvestor !== undefined && {
            is_active_investor: data.isActiveInvestor,
          }),
          updated_at: new Date(),
        },
      });

      // Accountability: record the field-level change set (append-only).
      try {
        const changes: Record<string, { from: any; to: any }> = {};
        const record = (field: string, before: any, after: any) => {
          if (after === undefined) return;
          if (String(before ?? "") !== String(after ?? "")) {
            changes[field] = { from: before ?? null, to: after };
          }
        };
        record("first_name", (existing as any).first_name, data.firstName);
        record("last_name", (existing as any).last_name, data.lastName);
        record("phone_number", (existing as any).phone_number, data.phoneNumber);
        record("address", (existing as any).address, data.address);
        record("avatar_url", (existing as any).avatar_url, data.avatarUrl);
        record("role", (existing as any).role, data.role);
        record("is_active_investor", (existing as any).is_active_investor, data.isActiveInvestor);

        if (Object.keys(changes).length > 0) {
          await auditService.logAction({
            adminId: adminId || "system",
            targetUserId: userId,
            action: "user_updated",
            newValues: { changes },
          });
        }
      } catch (auditError) {
        console.error("[AUDIT] Failed to log admin user update:", auditError);
      }

      return updated;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update user profile");
    }
  }

  async getUserDashboardStats(userId: string) {
    try {
      // Fetch loans data
      const loans = await prisma.loan.findMany({
        where: { user_id: userId },
      });

      // Fetch investments data
      const investments = await prisma.investment.findMany({
        where: { user_id: userId },
      });

      const activeLoan = loans.find((l: any) => l.status === "active");
      const totalBorrowed = loans.reduce((sum: number, l: any) => sum + Number(l.amount), 0);
      const totalPaid = loans.reduce((sum: number, l: any) => sum + Number(l.amount_paid), 0);
      const totalInvested = investments.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
      const totalCurrentValue = investments.reduce(
        (sum: number, i: any) => sum + Number(i.current_value),
        0
      );

      return {
        loans: {
          totalLoans: loans.length,
          activeLoan: activeLoan || null,
          totalBorrowed,
          totalPaid,
          pendingLoans: loans.filter((l: any) => l.status === "pending").length,
          completedLoans: loans.filter((l: any) => l.status === "completed").length,
        },
        investments: {
          totalInvestments: investments.length,
          totalInvested,
          totalCurrentValue,
          totalEarnings: totalCurrentValue - totalInvested,
          activeInvestments: investments.filter(
            (i: any) => i.status === "active"
          ).length,
        },
        recentLoans: loans.slice(0, 5),
        recentInvestments: investments.slice(0, 5),
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch dashboard stats");
    }
  }

  async searchUsers(query: string, skip: number = 0, take: number = 10) {
    try {
      const users = await prisma.userProfile.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { first_name: { contains: query, mode: "insensitive" } },
            { last_name: { contains: query, mode: "insensitive" } },
            { phone_number: { contains: query, mode: "insensitive" } },
          ],
        },
        skip,
        take,
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          role: true,
          phone_number: true,
          created_at: true,
        },
      });

      return users;
    } catch (error) {
      throw new AppError(500, "Failed to search users");
    }
  }

  async getUsersStats() {
    try {
      const totalUsers = await prisma.userProfile.count();
      const adminUsers = await prisma.userProfile.count({
        where: { role: "admin" },
      });
      const regularUsers = await prisma.userProfile.count({
        where: { role: "user" },
      });

      const usersWithLoans = await prisma.userProfile.count({
        where: {
          loans: {
            some: {},
          },
        },
      });

      const usersWithInvestments = await prisma.userProfile.count({
        where: {
          investments: {
            some: {},
          },
        },
      });

      return {
        totalUsers,
        adminUsers,
        regularUsers,
        usersWithLoans,
        usersWithInvestments,
      };
    } catch (error) {
      throw new AppError(500, "Failed to fetch user stats");
    }
  }

  async createUserByAdmin(
    email: string,
    firstName: string,
    lastName: string,
    phoneNumber: string,
    address: string
  ): Promise<UserProfile> {
    try {
      // 1. Check if user already exists
      const existingUser = await prisma.userProfile.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new AppError(400, "User with this email already exists");
      }

      // 2. Create user in Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
        },
      });

      if (authError || !authData.user) {
        throw new AppError(400, authError?.message || "Failed to create auth user in Supabase");
      }

      // 3. Create profile in database using Prisma
      const userProfile = await prisma.userProfile.create({
        data: {
          id: authData.user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          phone_number: phoneNumber,
          address,
          role: "user",
        },
      });

      // 4. Fetch the admin template using Prisma
      const template = await prisma.communication_templates.findFirst({
        where: {
          name: "admin_account_created",
          is_active: true,
        },
      });

      const subject = template?.subject || "Your DPINES Account Has Been Created";
      let body = template?.body || "Hello {{first_name}},\n\nYour account has been created by the administrator on DPINES Nigeria.\n\nYou can access your account using your email: {{email}}.\n\nTo log in and set up your password, please go to the login screen and click 'Forgot Password' or reset your password using OTP.\n\nThank you,\nDPINES Support";

      // Replace place holders
      body = body.replace(/\{\{first_name\}\}/g, firstName);
      body = body.replace(/\{\{email\}\}/g, email);

      // 5. Send communication email
      edgeFunctionService.callFunction("send-communication", {
        to: email,
        subject,
        body,
      }).catch((err) => {
        console.error("Failed to send admin welcome email:", err);
      });

      return userProfile;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, error instanceof Error ? error.message : "Failed to create user by admin");
    }
  }
}

import supabaseAdmin from "../../configs/supabase.js";
import { edgeFunctionService } from "../../services/edge-function.service.js";

export const userService = new UserService();

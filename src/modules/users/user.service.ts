import prisma from "@/configs/database";
import { AppError } from "@/middlewares/error.middleware";
import type { UserProfile, UserRole } from "@/types";

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
          ...(data.metadata && { metadata: JSON.stringify(data.metadata) }),
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

      const activeLoan = loans.find((l) => l.status === "active");
      const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.amount), 0);
      const totalPaid = loans.reduce((sum, l) => sum + Number(l.amount_paid), 0);
      const totalInvested = investments.reduce((sum, i) => sum + Number(i.amount), 0);
      const totalCurrentValue = investments.reduce(
        (sum, i) => sum + Number(i.current_value),
        0
      );

      return {
        loans: {
          totalLoans: loans.length,
          activeLoan: activeLoan || null,
          totalBorrowed,
          totalPaid,
          pendingLoans: loans.filter((l) => l.status === "pending").length,
          completedLoans: loans.filter((l) => l.status === "completed").length,
        },
        investments: {
          totalInvestments: investments.length,
          totalInvested,
          totalCurrentValue,
          totalEarnings: totalCurrentValue - totalInvested,
          activeInvestments: investments.filter(
            (i) => i.status === "active"
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

import supabaseAdmin from "@/configs/supabase";
import { edgeFunctionService } from "@/services/edge-function.service";

export const userService = new UserService();

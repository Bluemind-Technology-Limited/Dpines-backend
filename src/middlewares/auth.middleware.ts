import { Request, Response, NextFunction } from "express";
import supabaseAdmin from "../configs/supabase.js";
import { AppError } from "./error.middleware.js";

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const verifySupabaseToken = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return next(new AppError(401, "No authorization token provided"));
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return next(new AppError(401, "Invalid or expired token"));
    }

    // Fetch user profile from database
    const prisma = (await import("@/configs/database")).default;
    const dbUser = await prisma.userProfile.findUnique({
      where: { id: data.user.id },
    });

    if (!dbUser) {
      return next(new AppError(404, "User profile not found in database"));
    }

    // Attach user profile to request (maintaining compatibility with req.user.sub)
    req.user = {
      ...dbUser,
      sub: dbUser.id,
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      role: dbUser.role,
      phoneNumber: dbUser.phone_number,
      address: dbUser.address,
      avatarUrl: dbUser.avatar_url,
      isActiveInvestor: dbUser.is_active_investor,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(401, "Authentication failed"));
  }
};

export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }
  next();
};

export const requireRole = (roles: string[]) => {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        return next(new AppError(401, "Authentication required"));
      }

      // Fetch user role from database
      const prisma = (await import("@/configs/database")).default;
      const user = await prisma.userProfile.findUnique({
        where: { id: req.user.sub },
      });

      if (!user || !roles.includes(user.role)) {
        return next(new AppError(403, "You do not have permission to access this resource"));
      }

      next();
    } catch (error) {
      return next(error);
    }
  };
};

// Aliases for convenience
export const authenticate = verifySupabaseToken;
export const requirePermission = requireRole;
export const adminOnly = requireRole(["admin"]);

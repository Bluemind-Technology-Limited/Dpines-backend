import { Request, Response, NextFunction } from "express";
import supabaseAdmin from "../configs/supabase.js";
import { AppError } from "./error.middleware.js";

declare global {
  namespace Express {
    interface Request {
      user?: any;
      /** Set when an admin is impersonating another user ("Admin Mode"). */
      impersonator?: any;
    }
  }
}

// Roles allowed to act on behalf of another user via the X-Acting-As header.
const IMPERSONATION_ROLES = new Set(["admin", "loans_admin", "invest_admin", "support"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRequestUser(dbUser: any) {
  return {
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
      console.error(
        `[AUTH] Token verification failed for ${req.method} ${req.path} (supabase=${process.env.SUPABASE_URL || "NOT SET"}):`,
        error?.message || "no user returned"
      );
      return next(new AppError(401, "Invalid or expired token"));
    }

    // Fetch user profile from database
      const prisma = (await import("../configs/database.js")).default;
    const dbUser = await prisma.userProfile.findUnique({
      where: { id: data.user.id },
    });

    if (!dbUser) {
      return next(new AppError(404, "User profile not found in database"));
    }

    // Impersonation: an admin may act on behalf of a user by sending
    // `X-Acting-As: <targetUserId>`. The request is then scoped to the target
    // user for both reads and writes (req.user = target), while the admin stays
    // available on req.impersonator for audit trails. The header is ignored for
    // non-admin callers, so it can never escalate privileges.
    const actingAsId = req.headers["x-acting-as"] as string | undefined;
    if (actingAsId && IMPERSONATION_ROLES.has(dbUser.role)) {
      if (!UUID_RE.test(actingAsId)) {
        return next(new AppError(400, "Invalid impersonation target"));
      }

      const targetUser = await prisma.userProfile.findUnique({
        where: { id: actingAsId },
      });

      if (!targetUser) {
        return next(new AppError(404, "User to impersonate not found"));
      }

      req.impersonator = toRequestUser(dbUser);
      req.user = toRequestUser(targetUser);
      return next();
    }

    // Attach user profile to request (maintaining compatibility with req.user.sub)
    req.user = toRequestUser(dbUser);

    next();
  } catch (error) {
    console.error(
      `[AUTH] Unexpected error verifying token for ${req.method} ${req.path} (supabase=${process.env.SUPABASE_URL || "NOT SET"}):`,
      error
    );
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
        const prisma = (await import("../configs/database.js")).default;
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

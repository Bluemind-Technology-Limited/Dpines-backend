import { Request, Response, NextFunction } from "express";
import { Receiver } from "@upstash/qstash";
import { env } from "../configs/env.js";
import { AppError } from "./error.middleware.js";

const receiver = new Receiver({
  currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
});

export const verifyQStashSignature = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const signature = req.headers["upstash-signature"] as string;

    if (!signature) {
      throw new AppError(401, "Missing QStash signature");
    }

    const isValid = await receiver.verify({
      signature,
      body: JSON.stringify(req.body),
    });

    if (!isValid) {
      throw new AppError(401, "Invalid QStash signature");
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(401, "QStash verification failed");
  }
};

/**
 * Guards the /api/jobs/trigger/* endpoints.
 *
 * Primary (production) path: GitHub Actions publishes the sweep to QStash,
 * which delivers it with an `Upstash-Signature` header that we verify here.
 * Fallback: if no QStash signing keys are configured (local/dev, or a direct
 * GitHub Actions call), the shared `CRON_KEY` secret is accepted instead.
 * With neither configured the route is left open, matching the previous,
 * non-breaking behaviour.
 */
export const requireCronAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const hasQstashKeys = Boolean(
      env.QSTASH_CURRENT_SIGNING_KEY || env.QSTASH_NEXT_SIGNING_KEY
    );

    if (hasQstashKeys) {
      const signature = req.headers["upstash-signature"] as string | undefined;
      if (signature) {
        const isValid = await receiver.verify({
          signature,
          body: JSON.stringify(req.body ?? {}),
        });
        if (!isValid) {
          return next(new AppError(401, "Invalid QStash signature"));
        }
        return next();
      }
    }

    const cronKey = req.headers["x-cron-key"];
    if (process.env.CRON_KEY && cronKey !== process.env.CRON_KEY) {
      return next(new AppError(401, "Unauthorized: Invalid cron credentials"));
    }

    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, "Cron authorization failed"));
  }
};

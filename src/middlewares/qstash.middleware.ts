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

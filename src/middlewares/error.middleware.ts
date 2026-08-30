import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export { AppError };

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log only unexpected server errors (500) to keep console clean from expected client errors
  const isClientError = (err instanceof AppError && err.statusCode < 500) || (err instanceof ZodError);
  if (!isClientError) {
    console.error("Unexpected Server Error:", err);
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  if (err instanceof Error) {
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: "An unexpected error occurred",
  });
};

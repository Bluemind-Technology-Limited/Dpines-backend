import { Response } from "express";
import { ApiResponse, PaginatedResponse } from "@/types/common";

export const keysToCamel = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  
  if (typeof obj === "object") {
    if (obj.constructor && obj.constructor.name !== "Object" && obj.constructor.name !== "Array") {
      if (obj.constructor.name === "Decimal") {
        return Number(obj);
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(v => keysToCamel(v));
    }
    const n: Record<string, any> = {};
    Object.keys(obj).forEach(k => {
      const camelKey = k.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      n[camelKey] = keysToCamel(obj[k]);
    });
    return n;
  }
  return obj;
};

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message: string = "Success",
  statusCode: number = 200
): void => {
  const response: ApiResponse<T> = {
    success: true,
    data: keysToCamel(data),
    message,
  };
  res.status(statusCode).json(response);
};

export const sendPaginated = <T>(
  res: Response,
  data: T[],
  total: number,
  page: number = 1,
  pageSize: number = 10,
  statusCode: number = 200
): void => {
  const totalPages = Math.ceil(total / pageSize);
  const response: ApiResponse<PaginatedResponse<T>> = {
    success: true,
    data: {
      data: keysToCamel(data),
      total,
      page,
      pageSize,
      totalPages,
    },
    message: "Paginated results",
  };
  res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  error: string,
  statusCode: number = 500
): void => {
  const response: ApiResponse = {
    success: false,
    error,
  };
  res.status(statusCode).json(response);
};

export const calculateMonthlyPayment = (
  principal: number,
  annualRate: number,
  termMonths: number
): number => {
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) {
    return principal / termMonths;
  }
  return (
    (principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
    (Math.pow(1 + monthlyRate, termMonths) - 1)
  );
};

export const calculateTotalInterest = (
  principal: number,
  monthlyPayment: number,
  termMonths: number
): number => {
  return monthlyPayment * termMonths - principal;
};

export const calculateInvestmentCurrentValue = (
  principal: number,
  annualRate: number,
  monthsElapsed: number,
  frequency: string
): number => {
  const monthlyRate = annualRate / 100 / 12;

  if (frequency === "reinvestment") {
    // Compound interest monthly
    return principal * Math.pow(1 + monthlyRate, monthsElapsed);
  }

  // For monthly and 6-monthly: simple interest
  return principal + principal * monthlyRate * monthsElapsed;
};

export const getMonthsBetweenDates = (start: Date, end: Date): number => {
  return Math.floor(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  );
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(amount);
};

export const asyncHandler = (
  fn: (req: any, res: any, next: any) => Promise<void>
) => {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

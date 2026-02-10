import type { Response, NextFunction } from "express";
import { logger } from "../config/logger.js";
import type { EngineRequest, ErrorResponse } from "../types/index.js";

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  req: EngineRequest,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.context?.requestId ?? "unknown";

  if (err instanceof AppError) {
    logger.warn({
      action: "request_error",
      requestId,
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
    });

    const body: ErrorResponse = {
      error: {
        message: err.message,
        type: err.name,
        code: err.code,
        requestId,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error({
    action: "unhandled_error",
    requestId,
    error: err.message,
    stack: err.stack,
  });

  const body: ErrorResponse = {
    error: {
      message: "Internal server error",
      type: "internal_error",
      code: "internal_error",
      requestId,
    },
  };
  res.status(500).json(body);
}

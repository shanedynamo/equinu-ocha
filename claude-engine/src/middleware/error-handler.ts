import type { Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
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

  // Handle Anthropic SDK errors (authentication, rate limits, etc.)
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    const upstreamMessage =
      (err.error as { error?: { message?: string } })?.error?.message ?? err.message;
    const code = status === 401
      ? "upstream_auth_error"
      : status === 429
        ? "rate_limited"
        : status === 529
          ? "api_overloaded"
          : "upstream_error";

    logger.error({
      action: "anthropic_api_error",
      requestId,
      status,
      code,
      error: upstreamMessage,
    });

    const body: ErrorResponse = {
      error: {
        message: status === 401
          ? "Claude API authentication failed. Check the ANTHROPIC_API_KEY configuration."
          : status === 429
            ? "Claude API rate limit reached. Please retry in a moment."
            : status === 529
              ? "Claude API is temporarily overloaded. Please retry in a moment."
              : `Claude API error: ${upstreamMessage}`,
        type: "upstream_error",
        code,
        requestId,
      },
    };
    res.status(status >= 500 ? 502 : status).json(body);
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

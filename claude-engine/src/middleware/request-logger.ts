import type { Response, NextFunction } from "express";
import { logger } from "../config/logger.js";
import type { EngineRequest } from "../types/index.js";

export function requestLogger(
  req: EngineRequest,
  res: Response,
  next: NextFunction,
): void {
  const { requestId, userId } = req.context;

  logger.info({
    action: "request_received",
    requestId,
    userId,
    method: req.method,
    path: req.path,
  });

  res.on("finish", () => {
    const duration = Date.now() - req.context.startTime;
    logger.info({
      action: "request_completed",
      requestId,
      userId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}

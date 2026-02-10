import type { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger.js";
import { scanText, buildBlockMessage } from "../services/sensitiveDataScanner.js";
import { extractPromptText } from "../services/auditLogger.js";
import { buildSecurityAlert, publishAlert } from "../services/alertService.js";
import { AppError } from "./error-handler.js";
import type { EngineRequest } from "../types/index.js";

export function sensitiveDataScanner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const engineReq = req as EngineRequest;
  const promptText = engineReq.context.audit?.promptText ?? extractPromptText(req.body ?? {});

  // No text to scan — pass through
  if (!promptText) {
    next();
    return;
  }

  const result = scanText(promptText);
  engineReq.context.scanResult = result;

  // Clean — no findings
  if (!result.hasHighSeverity && !result.hasMediumSeverity) {
    next();
    return;
  }

  const alertContext = {
    requestId: engineReq.context.requestId,
    userId: engineReq.context.userId,
    userEmail: engineReq.context.userEmail,
    route: req.originalUrl,
  };

  if (result.hasHighSeverity) {
    logger.warn({
      action: "sensitive_data_blocked",
      requestId: engineReq.context.requestId,
      findingTypes: result.findings.map((f) => f.type),
    });

    // Fire-and-forget alert
    const alert = buildSecurityAlert(result.findings, alertContext);
    publishAlert(alert).catch(() => {});

    const message = buildBlockMessage(result.findings);
    next(new AppError(message, 400, "sensitive_data_blocked"));
    return;
  }

  // Medium severity — warn but allow
  logger.info({
    action: "sensitive_data_warning",
    requestId: engineReq.context.requestId,
    findingTypes: result.findings.map((f) => f.type),
  });

  res.setHeader("X-Sensitive-Data-Warning", "Medium-severity sensitive data detected in request");

  // Fire-and-forget alert
  const alert = buildSecurityAlert(result.findings, alertContext);
  publishAlert(alert).catch(() => {});

  next();
}

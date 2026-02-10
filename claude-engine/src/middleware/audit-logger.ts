import type { Request, Response, NextFunction } from "express";
import {
  hashPrompt,
  extractPreview,
  detectSource,
  extractPromptText,
} from "../services/auditLogger.js";
import { classify } from "../services/classifier.js";
import type { EngineRequest } from "../types/index.js";
import type { AuditContext } from "../services/auditLogger.js";

export function auditSetup(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const engineReq = req as EngineRequest;
  const promptText = extractPromptText(req.body ?? {});
  const source = detectSource(req.headers["user-agent"] as string | undefined);
  const classification = classify(promptText, source);

  const audit: AuditContext = {
    promptText,
    promptHash: hashPrompt(promptText),
    promptPreview: extractPreview(promptText),
    source,
    requestCategory: classification.category,
    startTime: engineReq.context.startTime,
  };

  engineReq.context.audit = audit;
  next();
}

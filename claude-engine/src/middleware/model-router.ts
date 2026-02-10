import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { ROLE_DEFINITIONS, DEFAULT_ROLE } from "../config/roles.js";
import { getModelTier } from "../config/models.js";
import type { EngineRequest } from "../types/index.js";

export interface ModelRoutingResult {
  resolvedModel: string;
  downgraded: boolean;
  role: string;
}

export function resolveModel(
  requestedModel: string | undefined,
  role: string | undefined,
): ModelRoutingResult {
  const effectiveRole = role && ROLE_DEFINITIONS[role] ? role : DEFAULT_ROLE;
  const roleDef = ROLE_DEFINITIONS[effectiveRole]!;
  const model = requestedModel || config.anthropic.defaultModel;

  // Admin bypass — any model is permitted
  if (effectiveRole === "admin") {
    return { resolvedModel: model, downgraded: false, role: effectiveRole };
  }

  // Check if the requested model is in the role's permitted list
  if (roleDef.permittedModels.includes(model)) {
    return { resolvedModel: model, downgraded: false, role: effectiveRole };
  }

  // Downgrade to the highest-tier permitted model
  const best = roleDef.permittedModels
    .slice()
    .sort((a, b) => getModelTier(b) - getModelTier(a))[0];

  return {
    resolvedModel: best ?? config.anthropic.defaultModel,
    downgraded: true,
    role: effectiveRole,
  };
}

export function modelRouter(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const engineReq = req as EngineRequest;
  const role = engineReq.context.role ?? (req.headers["x-user-role"] as string | undefined)?.toLowerCase();
  const requestedModel: string | undefined = req.body?.model;

  const result = resolveModel(requestedModel, role);

  // Stamp the resolved model back onto the body so downstream handlers use it
  if (req.body) {
    req.body.model = result.resolvedModel;
  }

  if (result.downgraded) {
    res.setHeader("X-Model-Downgraded", "true");
  }

  // Store role on context for downstream logging
  engineReq.context.role = result.role;

  logger.info({
    action: "model_routed",
    requestId: engineReq.context.requestId,
    userId: engineReq.context.userId,
    role: result.role,
    requestedModel: requestedModel ?? "(default)",
    resolvedModel: result.resolvedModel,
    downgraded: result.downgraded,
  });

  next();
}

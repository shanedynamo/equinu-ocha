import type { Request, Response, NextFunction } from "express";
import { hashKey, isValidKeyFormat, lookupKeyByHash } from "../services/apiKeyService.js";
import { AppError } from "./error-handler.js";
import type { EngineRequest } from "../types/common.js";

export function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  // Only handle dynamo-sk-* tokens; pass through anything else
  if (!token.startsWith("dynamo-sk-")) {
    next();
    return;
  }

  if (!isValidKeyFormat(token)) {
    next(new AppError("Invalid or revoked API key", 401, "invalid_api_key"));
    return;
  }

  const keyHash = hashKey(token);

  lookupKeyByHash(keyHash)
    .then((result) => {
      if (!result) {
        next(new AppError("Invalid or revoked API key", 401, "invalid_api_key"));
        return;
      }

      const engineReq = req as EngineRequest;
      engineReq.context.userId = result.userId;
      engineReq.context.userEmail = result.userEmail;
      engineReq.context.role = result.role;
      engineReq.context.apiKeyId = result.id;

      next();
    })
    .catch(next);
}

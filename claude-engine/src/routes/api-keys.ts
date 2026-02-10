import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  createApiKey,
  revokeApiKey,
  listActiveKeys,
  rotateApiKey,
  isValidRole,
} from "../services/apiKeyService.js";
import { AppError } from "../middleware/error-handler.js";
import type { EngineRequest } from "../types/common.js";

export const apiKeysRouter = Router();

function requireAdmin(req: Request): void {
  const engineReq = req as EngineRequest;
  const role = engineReq.context.role ?? "business";
  if (role !== "admin") {
    throw new AppError("Admin access required", 403, "forbidden");
  }
}

// POST / — Generate a new API key
apiKeysRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req);

      const { user_email, role } = req.body;

      if (!user_email || typeof user_email !== "string") {
        throw new AppError("user_email is required", 400, "invalid_request");
      }

      if (!role || typeof role !== "string") {
        throw new AppError("role is required", 400, "invalid_request");
      }

      if (!isValidRole(role)) {
        throw new AppError(`Invalid role: ${role}`, 400, "invalid_request");
      }

      const result = await createApiKey(user_email, role);

      res.status(201).json({
        id: result.id,
        key: result.rawKey,
        key_prefix: result.keyPrefix,
        user_email: result.userEmail,
        role: result.role,
        created_at: result.createdAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET / — List active API keys
apiKeysRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req);

      const keys = await listActiveKeys();

      const redacted = keys.map((k) => ({
        id: k.id,
        user_id: k.userId,
        user_email: k.userEmail,
        key_hint: `...${k.keyPrefix.slice(-8)}`,
        role: k.role,
        created_at: k.createdAt,
        last_used_at: k.lastUsedAt,
      }));

      res.json({ keys: redacted, count: redacted.length });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /:keyId — Revoke an API key
apiKeysRouter.delete(
  "/:keyId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req);

      const keyId = Number(req.params.keyId);
      if (Number.isNaN(keyId)) {
        throw new AppError("Invalid key ID", 400, "invalid_request");
      }

      const revoked = await revokeApiKey(keyId);
      if (!revoked) {
        throw new AppError("API key not found or already revoked", 404, "not_found");
      }

      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /:keyId/rotate — Rotate an API key
apiKeysRouter.post(
  "/:keyId/rotate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      requireAdmin(req);

      const keyId = Number(req.params.keyId);
      if (Number.isNaN(keyId)) {
        throw new AppError("Invalid key ID", 400, "invalid_request");
      }

      const result = await rotateApiKey(keyId);
      if (!result) {
        throw new AppError("API key not found or already revoked", 404, "not_found");
      }

      res.json({
        id: result.id,
        key: result.rawKey,
        key_prefix: result.keyPrefix,
        user_email: result.userEmail,
        role: result.role,
        created_at: result.createdAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

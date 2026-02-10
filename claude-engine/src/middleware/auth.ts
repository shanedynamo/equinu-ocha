import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { DEFAULT_ROLE } from "../config/roles.js";
import { hashKey, isValidKeyFormat, lookupKeyByHash } from "../services/apiKeyService.js";
import { getPool } from "../services/db.js";
import { AppError } from "./error-handler.js";
import type { EngineRequest, AuthMethod } from "../types/common.js";

// ── Entra ID group → platform role mapping ──────────────────────────────────

const GROUP_ROLE_MAP: Record<string, string> = {
  "AI-Platform-Admins": "admin",
  "AI-Platform-Engineers": "engineer",
  "AI-Platform-Power": "power_user",
  "AI-Platform-Business": "business",
};

// Priority order: first match wins (admin > engineer > power_user > business)
const GROUP_PRIORITY = [
  "AI-Platform-Admins",
  "AI-Platform-Engineers",
  "AI-Platform-Power",
  "AI-Platform-Business",
];

/**
 * Map an array of Entra ID group names to the highest-priority platform role.
 * Exported for testing.
 */
export function mapGroupsToRole(groups: string[]): string {
  for (const group of GROUP_PRIORITY) {
    if (groups.includes(group)) {
      return GROUP_ROLE_MAP[group];
    }
  }
  return DEFAULT_ROLE;
}

// ── JWT payload shape ───────────────────────────────────────────────────────

interface JwtPayload {
  sub?: string;
  id?: string;
  email?: string;
  name?: string;
  groups?: string[];
  role?: string;
}

/**
 * Decode and verify a JWT token. Returns the payload or null on failure.
 * Exported for testing.
 */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

// ── User profile auto-provisioning ──────────────────────────────────────────

async function upsertUserProfile(
  userId: string,
  email: string,
  displayName: string | undefined,
  role: string,
  groups: string[],
): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, email, display_name, role, entra_groups, first_login, last_login)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = COALESCE(EXCLUDED.display_name, user_profiles.display_name),
         role = EXCLUDED.role,
         entra_groups = EXCLUDED.entra_groups,
         last_login = NOW(),
         updated_at = NOW()`,
      [userId, email, displayName ?? null, role, groups],
    );
  } catch (err) {
    // Fire-and-forget: don't block the request on profile upsert failure
    logger.error({
      action: "user_profile_upsert_failed",
      userId,
      error: (err as Error).message,
    });
  }
}

// ── Auth detection helpers ──────────────────────────────────────────────────

function extractBearerToken(req: EngineRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Detect which auth method to use based on the Authorization header.
 * Exported for testing.
 */
export function detectAuthMethod(token: string | null): AuthMethod {
  if (!token) return "none";
  if (token.startsWith("dynamo-sk-")) return "api_key";
  if (token.startsWith("eyJ")) return "jwt";
  return "none";
}

// ── API key auth path ───────────────────────────────────────────────────────

async function authenticateApiKey(
  req: EngineRequest,
  token: string,
): Promise<void> {
  if (!isValidKeyFormat(token)) {
    throw new AppError("Invalid or revoked API key", 401, "invalid_api_key");
  }

  const keyHash = hashKey(token);
  const result = await lookupKeyByHash(keyHash);

  if (!result) {
    throw new AppError("Invalid or revoked API key", 401, "invalid_api_key");
  }

  req.context.userId = result.userId;
  req.context.userEmail = result.userEmail;
  req.context.role = result.role;
  req.context.apiKeyId = result.id;
  req.context.authMethod = "api_key";
}

// ── JWT auth path ───────────────────────────────────────────────────────────

async function authenticateJwt(
  req: EngineRequest,
  token: string,
): Promise<void> {
  const payload = verifyJwt(token, config.jwtSecret);

  if (!payload) {
    throw new AppError("Invalid or expired token", 401, "invalid_token");
  }

  const userId = payload.sub ?? payload.id ?? payload.email ?? "unknown";
  const email = payload.email ?? "";
  const displayName = payload.name;
  const groups = payload.groups ?? [];
  const role = groups.length > 0 ? mapGroupsToRole(groups) : (payload.role ?? DEFAULT_ROLE);

  req.context.userId = userId;
  req.context.userEmail = email;
  req.context.displayName = displayName;
  req.context.role = role;
  req.context.authMethod = "jwt";

  // Auto-provision user profile on first login (fire-and-forget)
  upsertUserProfile(userId, email, displayName, role, groups).catch(() => {});
}

// ── Mock auth path (local development) ──────────────────────────────────────

function authenticateMock(req: EngineRequest): void {
  // Mock headers take first priority
  const mockEmail = req.headers["x-mock-user-email"] as string | undefined;
  const mockRole = req.headers["x-mock-user-role"] as string | undefined;

  // Fall back to standard headers (X-User-Id, X-User-Email, X-User-Role)
  // already populated by requestContext middleware, then to defaults
  const email = mockEmail
    ?? req.context.userEmail
    ?? (req.headers["x-user-email"] as string | undefined)
    ?? "test@dynamo.works";
  const userId = req.context.userId
    ?? (req.headers["x-user-id"] as string | undefined)
    ?? email;
  const role = mockRole
    ?? (req.headers["x-user-role"] as string | undefined)
    ?? DEFAULT_ROLE;

  req.context.userId = userId;
  req.context.userEmail = email;
  req.context.role = role;
  req.context.authMethod = "mock";
}

// ── Unified auth middleware ─────────────────────────────────────────────────

/**
 * Unified authentication middleware. Detects auth method from the
 * Authorization header format and routes to the appropriate handler.
 *
 * In mock mode (AUTH_MODE=mock): uses X-Mock-User-Email/Role headers
 * or defaults to test@dynamo.works / business.
 *
 * In OIDC mode (AUTH_MODE=oidc):
 *   - "Bearer dynamo-sk-*" → API key auth (CLI users)
 *   - "Bearer eyJ*"        → JWT token auth (Open WebUI sessions)
 *   - No auth header       → 401 Unauthorized
 */
export function auth(
  req: EngineRequest,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearerToken(req);
  const method = detectAuthMethod(token);

  // ── Mock mode: always authenticate with mock credentials ──────────
  if (config.authMode === "mock") {
    // Even in mock mode, honor API keys if provided (for testing API key flow)
    if (method === "api_key" && token) {
      authenticateApiKey(req, token).then(() => next()).catch(next);
      return;
    }

    authenticateMock(req);
    next();
    return;
  }

  // ── OIDC mode ─────────────────────────────────────────────────────
  if (method === "api_key" && token) {
    authenticateApiKey(req, token).then(() => next()).catch(next);
    return;
  }

  if (method === "jwt" && token) {
    authenticateJwt(req, token).then(() => next()).catch(next);
    return;
  }

  // No valid auth provided in OIDC mode
  next(new AppError("Authentication required", 401, "auth_required"));
}

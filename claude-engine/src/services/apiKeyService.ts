import crypto from "node:crypto";
import { getPool } from "./db.js";
import { logger } from "../config/logger.js";
import { ROLE_DEFINITIONS } from "../config/roles.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: number;
  userId: string;
  userEmail: string;
  keyPrefix: string;
  role: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface ApiKeyCreateResult {
  id: number;
  rawKey: string;
  keyPrefix: string;
  userEmail: string;
  role: string;
  createdAt: Date;
}

export interface ApiKeyLookupResult {
  id: number;
  userId: string;
  userEmail: string;
  role: string;
}

// ── Pure functions (no DB dependency) ───────────────────────────────────────

export function generateRawKey(): string {
  return "dynamo-sk-" + crypto.randomBytes(24).toString("hex");
}

export function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function extractKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

export function isValidKeyFormat(key: string): boolean {
  return /^dynamo-sk-[0-9a-f]{48}$/.test(key);
}

export function isValidRole(role: string): boolean {
  return role in ROLE_DEFINITIONS;
}

// ── DB-backed functions ─────────────────────────────────────────────────────

export async function createApiKey(
  userEmail: string,
  role: string,
): Promise<ApiKeyCreateResult> {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = extractKeyPrefix(rawKey);
  const userId = userEmail.split("@")[0];

  const result = await pool.query(
    `INSERT INTO api_keys (user_id, user_email, key_hash, key_prefix, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [userId, userEmail, keyHash, keyPrefix, role],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    rawKey,
    keyPrefix,
    userEmail,
    role,
    createdAt: row.created_at,
  };
}

export async function revokeApiKey(keyId: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const result = await pool.query(
    `UPDATE api_keys
     SET is_active = FALSE, revoked_at = NOW()
     WHERE id = $1 AND is_active = TRUE`,
    [keyId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function listActiveKeys(): Promise<ApiKeyRecord[]> {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const result = await pool.query(
    `SELECT id, user_id, user_email, key_prefix, role, created_at, last_used_at
     FROM api_keys
     WHERE is_active = TRUE
     ORDER BY created_at DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    keyPrefix: row.key_prefix,
    role: row.role,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function rotateApiKey(
  keyId: number,
): Promise<ApiKeyCreateResult | null> {
  const pool = getPool();
  if (!pool) throw new Error("Database not configured");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT user_id, user_email, role
       FROM api_keys
       WHERE id = $1 AND is_active = TRUE
       FOR UPDATE`,
      [keyId],
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const { user_id, user_email, role } = existing.rows[0];

    // Revoke old key
    await client.query(
      `UPDATE api_keys SET is_active = FALSE, revoked_at = NOW() WHERE id = $1`,
      [keyId],
    );

    // Create new key
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = extractKeyPrefix(rawKey);

    const inserted = await client.query(
      `INSERT INTO api_keys (user_id, user_email, key_hash, key_prefix, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [user_id, user_email, keyHash, keyPrefix, role],
    );

    await client.query("COMMIT");

    const row = inserted.rows[0];
    return {
      id: row.id,
      rawKey,
      keyPrefix,
      userEmail: user_email,
      role,
      createdAt: row.created_at,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function lookupKeyByHash(
  keyHash: string,
): Promise<ApiKeyLookupResult | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query(
    `SELECT id, user_id, user_email, role
     FROM api_keys
     WHERE key_hash = $1 AND is_active = TRUE`,
    [keyHash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Fire-and-forget last_used_at update
  pool
    .query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
    .catch((err) => {
      logger.error({
        action: "api_key_last_used_update_failed",
        keyId: row.id,
        error: (err as Error).message,
      });
    });

  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    role: row.role,
  };
}

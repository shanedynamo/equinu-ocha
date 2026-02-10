import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { estimateCost } from "./budgetService.js";
import { logger } from "../config/logger.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  requestId: string;
  userId?: string;
  userEmail?: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  requestCategory?: string;
  source: "web" | "cli";
  promptHash: string;
  promptPreview: string;
  responsePreview: string;
  latencyMs: number;
  status: "success" | "error" | "blocked";
}

export interface AuditContext {
  promptText: string;
  promptHash: string;
  promptPreview: string;
  source: "web" | "cli";
  requestCategory: string;
  startTime: number;
}

// ── Sensitive data patterns ─────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,                              // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,         // credit card
  /\bsk-[a-zA-Z0-9_-]{20,}\b/,                           // Anthropic/OpenAI API key
  /\bAKIA[0-9A-Z]{16}\b/,                                // AWS access key
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,             // PEM private key
];

// ── Pure helpers (exported for testing) ─────────────────────────────────────

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function extractPreview(text: string, maxLen = 200): string {
  if (!text) return "";
  if (containsSensitiveData(text)) return "[REDACTED]";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function detectSource(userAgent: string | undefined): "web" | "cli" {
  if (!userAgent) return "web";
  const ua = userAgent.toLowerCase();
  if (
    ua.includes("curl") ||
    ua.includes("cli") ||
    ua.includes("node") ||
    ua.includes("python-requests") ||
    ua.includes("httpie")
  ) {
    return "cli";
  }
  return "web";
}

export function extractPromptText(body: Record<string, unknown>): string {
  const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (!Array.isArray(messages)) return "";

  const parts: string[] = [];

  // Include system prompt if present (Anthropic native format)
  if (typeof body.system === "string") {
    parts.push(body.system);
  }

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          (block as { type: string }).type === "text" &&
          "text" in block
        ) {
          parts.push((block as { text: string }).text);
        }
      }
    }
  }

  return parts.join("\n");
}

// ── Dual-write audit log ────────────────────────────────────────────────────

export async function commitAuditLog(entry: AuditEntry): Promise<void> {
  // 1. Structured JSON to stdout (CloudWatch / Docker logs)
  logger.info({
    action: "audit_log",
    requestId: entry.requestId,
    userId: entry.userId,
    userEmail: entry.userEmail,
    timestamp: entry.timestamp,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costEstimate: entry.costEstimate,
    requestCategory: entry.requestCategory,
    source: entry.source,
    promptHash: entry.promptHash,
    promptPreview: entry.promptPreview,
    responsePreview: entry.responsePreview,
    latencyMs: entry.latencyMs,
    status: entry.status,
  });

  // 2. Write to PostgreSQL
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO audit_logs (
        request_id, user_id, user_email, timestamp, model,
        input_tokens, output_tokens, cost_estimate, request_category,
        source, prompt_hash, prompt_preview, response_preview,
        latency_ms, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        entry.requestId,
        entry.userId ?? null,
        entry.userEmail ?? null,
        entry.timestamp,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        entry.costEstimate,
        entry.requestCategory ?? null,
        entry.source,
        entry.promptHash,
        entry.promptPreview,
        entry.responsePreview,
        entry.latencyMs,
        entry.status,
      ],
    );
  } catch (err) {
    logger.error({
      action: "audit_log_db_failed",
      requestId: entry.requestId,
      error: (err as Error).message,
    });
  }
}

export function buildAuditEntry(
  ctx: AuditContext,
  opts: {
    requestId: string;
    userId?: string;
    userEmail?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    requestCategory?: string;
    responsePreview: string;
    status: "success" | "error" | "blocked";
  },
): AuditEntry {
  return {
    requestId: opts.requestId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    timestamp: new Date().toISOString(),
    model: opts.model,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costEstimate: estimateCost(opts.model, opts.inputTokens, opts.outputTokens),
    requestCategory: opts.requestCategory,
    source: ctx.source,
    promptHash: ctx.promptHash,
    promptPreview: ctx.promptPreview,
    responsePreview: extractPreview(opts.responsePreview),
    latencyMs: Date.now() - ctx.startTime,
    status: opts.status,
  };
}

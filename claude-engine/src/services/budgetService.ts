import { getPool } from "./db.js";
import { logger } from "../config/logger.js";
import { MODEL_CATALOG } from "../config/models.js";
import { ROLE_DEFINITIONS, DEFAULT_ROLE } from "../config/roles.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface BudgetStatus {
  userId: string;
  role: string;
  monthlyLimit: number | null;
  currentUsage: number;
  percentUsed: number;
  remaining: number | null;
  periodStart: string;
  resetDate: string;
  exceeded: boolean;
  warningThreshold: boolean;
}

export interface RecordUsageParams {
  userId: string;
  userEmail?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requestCategory?: string;
}

// ── Pure logic (testable without DB) ────────────────────────────────────────

export function getCurrentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function getNextResetDate(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toISOString().slice(0, 10);
}

export function getMonthlyBudget(role: string): number | null {
  const roleDef = ROLE_DEFINITIONS[role] ?? ROLE_DEFINITIONS[DEFAULT_ROLE];
  return roleDef?.monthlyTokenBudget ?? null;
}

export function evaluateBudget(
  currentUsage: number,
  monthlyLimit: number | null,
): { exceeded: boolean; warningThreshold: boolean; percentUsed: number } {
  if (monthlyLimit === null || monthlyLimit <= 0) {
    return { exceeded: false, warningThreshold: false, percentUsed: 0 };
  }
  const percentUsed = Math.round((currentUsage / monthlyLimit) * 100);
  return {
    exceeded: currentUsage >= monthlyLimit,
    warningThreshold: currentUsage >= monthlyLimit * 0.8,
    percentUsed,
  };
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const modelDef = MODEL_CATALOG[model];
  if (!modelDef) return 0;
  const inputCost = (inputTokens / 1_000_000) * modelDef.costPerMillionTokens.input;
  const outputCost = (outputTokens / 1_000_000) * modelDef.costPerMillionTokens.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

// ── DB-backed functions ─────────────────────────────────────────────────────

export async function getUserBudget(
  userId: string,
  role: string,
): Promise<BudgetStatus> {
  const periodStart = getCurrentPeriodStart();
  const monthlyLimit = getMonthlyBudget(role);
  let currentUsage = 0;

  const pool = getPool();
  if (pool) {
    const result = await pool.query(
      `SELECT current_usage FROM user_budgets
       WHERE user_id = $1 AND period_start = $2`,
      [userId, periodStart],
    );
    if (result.rows.length > 0) {
      currentUsage = result.rows[0].current_usage;
    }
  }

  const { exceeded, warningThreshold, percentUsed } = evaluateBudget(
    currentUsage,
    monthlyLimit,
  );

  return {
    userId,
    role,
    monthlyLimit,
    currentUsage,
    percentUsed,
    remaining: monthlyLimit !== null ? Math.max(0, monthlyLimit - currentUsage) : null,
    periodStart,
    resetDate: getNextResetDate(),
    exceeded,
    warningThreshold,
  };
}

export async function recordUsage(params: RecordUsageParams): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const totalTokens = params.inputTokens + params.outputTokens;
  const cost = estimateCost(params.model, params.inputTokens, params.outputTokens);
  const periodStart = getCurrentPeriodStart();
  const role = DEFAULT_ROLE; // role resolved upstream, but we default for safety

  try {
    await pool.query("BEGIN");

    await pool.query(
      `INSERT INTO token_usage (user_id, user_email, model, input_tokens, output_tokens, cost_estimate, request_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.userId,
        params.userEmail ?? null,
        params.model,
        params.inputTokens,
        params.outputTokens,
        cost,
        params.requestCategory ?? null,
      ],
    );

    await pool.query(
      `INSERT INTO user_budgets (user_id, role, monthly_limit, current_usage, period_start, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, period_start)
       DO UPDATE SET
         current_usage = user_budgets.current_usage + $4,
         updated_at = NOW()`,
      [params.userId, role, null, totalTokens, periodStart],
    );

    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    logger.error({
      action: "record_usage_failed",
      userId: params.userId,
      error: (err as Error).message,
    });
  }
}

export async function getAllBudgets(): Promise<BudgetStatus[]> {
  const pool = getPool();
  if (!pool) return [];

  const periodStart = getCurrentPeriodStart();
  const result = await pool.query(
    `SELECT user_id, role, monthly_limit, current_usage
     FROM user_budgets
     WHERE period_start = $1
     ORDER BY current_usage DESC`,
    [periodStart],
  );

  return result.rows.map((row) => {
    const monthlyLimit: number | null = row.monthly_limit;
    const currentUsage: number = row.current_usage;
    const { exceeded, warningThreshold, percentUsed } = evaluateBudget(
      currentUsage,
      monthlyLimit,
    );

    return {
      userId: row.user_id,
      role: row.role,
      monthlyLimit,
      currentUsage,
      percentUsed,
      remaining: monthlyLimit !== null ? Math.max(0, monthlyLimit - currentUsage) : null,
      periodStart,
      resetDate: getNextResetDate(),
      exceeded,
      warningThreshold,
    };
  });
}

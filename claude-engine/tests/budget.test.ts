import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateBudget,
  getMonthlyBudget,
  estimateCost,
  getCurrentPeriodStart,
  getNextResetDate,
} from "../src/services/budgetService.js";

// ── evaluateBudget (pure logic) ─────────────────────────────────────────────

describe("evaluateBudget", () => {
  it("returns not exceeded and no warning when well under limit", () => {
    const result = evaluateBudget(50_000, 200_000);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(false);
    expect(result.percentUsed).toBe(25);
  });

  it("triggers warning at exactly 80%", () => {
    const result = evaluateBudget(160_000, 200_000);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(true);
    expect(result.percentUsed).toBe(80);
  });

  it("triggers warning between 80% and 100%", () => {
    const result = evaluateBudget(180_000, 200_000);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(true);
    expect(result.percentUsed).toBe(90);
  });

  it("marks exceeded at exactly 100%", () => {
    const result = evaluateBudget(200_000, 200_000);
    expect(result.exceeded).toBe(true);
    expect(result.warningThreshold).toBe(true);
    expect(result.percentUsed).toBe(100);
  });

  it("marks exceeded when over 100%", () => {
    const result = evaluateBudget(250_000, 200_000);
    expect(result.exceeded).toBe(true);
    expect(result.warningThreshold).toBe(true);
    expect(result.percentUsed).toBe(125);
  });

  it("never exceeds when limit is null (unlimited)", () => {
    const result = evaluateBudget(999_999_999, null);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(false);
    expect(result.percentUsed).toBe(0);
  });

  it("never exceeds when limit is 0", () => {
    const result = evaluateBudget(100, 0);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(false);
  });

  it("handles zero usage", () => {
    const result = evaluateBudget(0, 200_000);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(false);
    expect(result.percentUsed).toBe(0);
  });
});

// ── getMonthlyBudget ────────────────────────────────────────────────────────

describe("getMonthlyBudget", () => {
  it("returns 500,000 for engineer", () => {
    expect(getMonthlyBudget("engineer")).toBe(500_000);
  });

  it("returns 200,000 for business", () => {
    expect(getMonthlyBudget("business")).toBe(200_000);
  });

  it("returns 350,000 for power_user", () => {
    expect(getMonthlyBudget("power_user")).toBe(350_000);
  });

  it("returns null (unlimited) for admin", () => {
    expect(getMonthlyBudget("admin")).toBeNull();
  });

  it("falls back to business budget for unknown role", () => {
    expect(getMonthlyBudget("intern")).toBe(200_000);
  });
});

// ── estimateCost ────────────────────────────────────────────────────────────

describe("estimateCost", () => {
  it("calculates cost for sonnet correctly", () => {
    // Sonnet: $3/M input, $15/M output
    const cost = estimateCost("claude-sonnet-4-20250514", 1_000, 500);
    // input: 1000/1M * 3 = 0.003, output: 500/1M * 15 = 0.0075
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("calculates cost for opus correctly", () => {
    // Opus: $15/M input, $75/M output
    const cost = estimateCost("claude-opus-4-20250514", 10_000, 2_000);
    // input: 10000/1M * 15 = 0.15, output: 2000/1M * 75 = 0.15
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it("calculates cost for haiku correctly", () => {
    // Haiku: $0.8/M input, $4/M output
    const cost = estimateCost("claude-haiku-4-20250514", 5_000, 1_000);
    // input: 5000/1M * 0.8 = 0.004, output: 1000/1M * 4 = 0.004
    expect(cost).toBeCloseTo(0.008, 6);
  });

  it("returns 0 for unknown model", () => {
    expect(estimateCost("unknown-model", 1000, 500)).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("claude-sonnet-4-20250514", 0, 0)).toBe(0);
  });
});

// ── Period helpers ───────────────────────────────────────────────────────────

describe("getCurrentPeriodStart", () => {
  it("returns first of current month in YYYY-MM-DD format", () => {
    const result = getCurrentPeriodStart();
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(result).toBe(expected);
  });
});

describe("getNextResetDate", () => {
  it("returns first of next month in YYYY-MM-DD format", () => {
    const result = getNextResetDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const expected = next.toISOString().slice(0, 10);
    expect(result).toBe(expected);
  });
});

// ── Budget enforcer integration scenarios (pure logic) ──────────────────────

describe("budget enforcement scenarios", () => {
  it("engineer at 79% — no warning, not exceeded", () => {
    const limit = getMonthlyBudget("engineer")!; // 500,000
    const usage = Math.floor(limit * 0.79);
    const result = evaluateBudget(usage, limit);
    expect(result.warningThreshold).toBe(false);
    expect(result.exceeded).toBe(false);
  });

  it("business at 85% — warning, not exceeded", () => {
    const limit = getMonthlyBudget("business")!; // 200,000
    const usage = Math.floor(limit * 0.85);
    const result = evaluateBudget(usage, limit);
    expect(result.warningThreshold).toBe(true);
    expect(result.exceeded).toBe(false);
  });

  it("power_user at 100% — warning and exceeded", () => {
    const limit = getMonthlyBudget("power_user")!; // 350,000
    const result = evaluateBudget(limit, limit);
    expect(result.warningThreshold).toBe(true);
    expect(result.exceeded).toBe(true);
  });

  it("admin with massive usage — never exceeded", () => {
    const limit = getMonthlyBudget("admin"); // null
    const result = evaluateBudget(10_000_000, limit);
    expect(result.exceeded).toBe(false);
    expect(result.warningThreshold).toBe(false);
  });
});

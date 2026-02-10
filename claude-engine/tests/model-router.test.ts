import { describe, it, expect } from "vitest";
import { resolveModel } from "../src/middleware/model-router.js";

// ─── Permitted access ───────────────────────────────────────────────────────

describe("resolveModel — permitted access", () => {
  it("allows an engineer to use opus", () => {
    const result = resolveModel("claude-opus-4-20250514", "engineer");
    expect(result.resolvedModel).toBe("claude-opus-4-20250514");
    expect(result.downgraded).toBe(false);
    expect(result.role).toBe("engineer");
  });

  it("allows an engineer to use sonnet", () => {
    const result = resolveModel("claude-sonnet-4-20250514", "engineer");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("allows an engineer to use haiku", () => {
    const result = resolveModel("claude-haiku-4-20250514", "engineer");
    expect(result.resolvedModel).toBe("claude-haiku-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("allows business to use sonnet", () => {
    const result = resolveModel("claude-sonnet-4-20250514", "business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("allows business to use haiku", () => {
    const result = resolveModel("claude-haiku-4-20250514", "business");
    expect(result.resolvedModel).toBe("claude-haiku-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("allows power_user to use sonnet", () => {
    const result = resolveModel("claude-sonnet-4-20250514", "power_user");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
    expect(result.role).toBe("power_user");
  });
});

// ─── Downgrade behavior ─────────────────────────────────────────────────────

describe("resolveModel — downgrade behavior", () => {
  it("downgrades business from opus to sonnet", () => {
    const result = resolveModel("claude-opus-4-20250514", "business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(true);
    expect(result.role).toBe("business");
  });

  it("downgrades power_user from opus to sonnet", () => {
    const result = resolveModel("claude-opus-4-20250514", "power_user");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(true);
  });

  it("downgrades to highest-tier permitted model, not arbitrary", () => {
    // business has sonnet (tier 2) and haiku (tier 1) — should pick sonnet
    const result = resolveModel("claude-opus-4-20250514", "business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
  });

  it("downgrades an unknown model to the best permitted model", () => {
    const result = resolveModel("claude-ultra-9000", "engineer");
    expect(result.resolvedModel).toBe("claude-opus-4-20250514");
    expect(result.downgraded).toBe(true);
  });
});

// ─── Admin bypass ───────────────────────────────────────────────────────────

describe("resolveModel — admin bypass", () => {
  it("allows admin to use opus", () => {
    const result = resolveModel("claude-opus-4-20250514", "admin");
    expect(result.resolvedModel).toBe("claude-opus-4-20250514");
    expect(result.downgraded).toBe(false);
    expect(result.role).toBe("admin");
  });

  it("allows admin to use any arbitrary model string", () => {
    const result = resolveModel("claude-ultra-9000", "admin");
    expect(result.resolvedModel).toBe("claude-ultra-9000");
    expect(result.downgraded).toBe(false);
  });

  it("allows admin to use haiku", () => {
    const result = resolveModel("claude-haiku-4-20250514", "admin");
    expect(result.resolvedModel).toBe("claude-haiku-4-20250514");
    expect(result.downgraded).toBe(false);
  });
});

// ─── Unknown / missing role handling ────────────────────────────────────────

describe("resolveModel — unknown role handling", () => {
  it("falls back to default role (business) for unknown role", () => {
    const result = resolveModel("claude-opus-4-20250514", "intern");
    expect(result.role).toBe("business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(true);
  });

  it("falls back to default role when role is undefined", () => {
    const result = resolveModel("claude-sonnet-4-20250514", undefined);
    expect(result.role).toBe("business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("falls back to default role for empty string role", () => {
    const result = resolveModel("claude-opus-4-20250514", "");
    expect(result.role).toBe("business");
    expect(result.downgraded).toBe(true);
  });

  it("uses default model when no model is requested", () => {
    const result = resolveModel(undefined, "engineer");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
  });

  it("uses default model for undefined role and undefined model", () => {
    const result = resolveModel(undefined, undefined);
    expect(result.role).toBe("business");
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
    expect(result.downgraded).toBe(false);
  });
});

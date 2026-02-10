import { describe, it, expect } from "vitest";
import {
  generateRawKey,
  hashKey,
  extractKeyPrefix,
  isValidKeyFormat,
  isValidRole,
} from "../src/services/apiKeyService.js";

// ── generateRawKey ──────────────────────────────────────────────────────────

describe("generateRawKey", () => {
  it("starts with dynamo-sk- prefix", () => {
    const key = generateRawKey();
    expect(key.startsWith("dynamo-sk-")).toBe(true);
  });

  it("is exactly 58 characters long (10 prefix + 48 hex)", () => {
    const key = generateRawKey();
    expect(key.length).toBe(58);
  });

  it("contains only hex characters after the prefix", () => {
    const key = generateRawKey();
    const hexPart = key.slice(10);
    expect(hexPart).toMatch(/^[0-9a-f]{48}$/);
  });

  it("generates unique keys on successive calls", () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateRawKey()));
    expect(keys.size).toBe(10);
  });
});

// ── hashKey ─────────────────────────────────────────────────────────────────

describe("hashKey", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashKey("dynamo-sk-abc123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same output", () => {
    const key = "dynamo-sk-abcdef1234567890abcdef1234567890abcdef12345678";
    expect(hashKey(key)).toBe(hashKey(key));
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = hashKey("dynamo-sk-aaa");
    const hash2 = hashKey("dynamo-sk-bbb");
    expect(hash1).not.toBe(hash2);
  });
});

// ── extractKeyPrefix ────────────────────────────────────────────────────────

describe("extractKeyPrefix", () => {
  it("extracts the first 12 characters", () => {
    const key = "dynamo-sk-abcdef1234567890abcdef1234567890abcdef12345678";
    expect(extractKeyPrefix(key)).toBe("dynamo-sk-ab");
  });

  it("handles a shorter string gracefully", () => {
    expect(extractKeyPrefix("short")).toBe("short");
  });
});

// ── isValidKeyFormat ────────────────────────────────────────────────────────

describe("isValidKeyFormat", () => {
  it("accepts a valid key", () => {
    const key = generateRawKey();
    expect(isValidKeyFormat(key)).toBe(true);
  });

  it("rejects a key with wrong prefix", () => {
    expect(isValidKeyFormat("sk-live-abcdef1234567890abcdef1234567890abcdef12345678")).toBe(false);
  });

  it("rejects a key that is too short", () => {
    expect(isValidKeyFormat("dynamo-sk-abc123")).toBe(false);
  });

  it("rejects a key with uppercase hex characters", () => {
    expect(
      isValidKeyFormat("dynamo-sk-ABCDEF1234567890abcdef1234567890abcdef12345678"),
    ).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidKeyFormat("")).toBe(false);
  });

  it("rejects a JWT-like token", () => {
    expect(isValidKeyFormat("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig")).toBe(false);
  });
});

// ── isValidRole ─────────────────────────────────────────────────────────────

describe("isValidRole", () => {
  it("accepts admin", () => {
    expect(isValidRole("admin")).toBe(true);
  });

  it("accepts engineer", () => {
    expect(isValidRole("engineer")).toBe(true);
  });

  it("accepts power_user", () => {
    expect(isValidRole("power_user")).toBe(true);
  });

  it("accepts business", () => {
    expect(isValidRole("business")).toBe(true);
  });

  it("rejects an invalid role", () => {
    expect(isValidRole("superadmin")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidRole("")).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { mapGroupsToRole, verifyJwt, detectAuthMethod } from "../src/middleware/auth.js";

// ── Pure function tests (no mocking needed) ─────────────────────────────────

describe("mapGroupsToRole", () => {
  it("maps AI-Platform-Admins to admin", () => {
    expect(mapGroupsToRole(["AI-Platform-Admins"])).toBe("admin");
  });

  it("maps AI-Platform-Engineers to engineer", () => {
    expect(mapGroupsToRole(["AI-Platform-Engineers"])).toBe("engineer");
  });

  it("maps AI-Platform-Power to power_user", () => {
    expect(mapGroupsToRole(["AI-Platform-Power"])).toBe("power_user");
  });

  it("maps AI-Platform-Business to business", () => {
    expect(mapGroupsToRole(["AI-Platform-Business"])).toBe("business");
  });

  it("returns default role for empty groups", () => {
    expect(mapGroupsToRole([])).toBe("business");
  });

  it("returns default role for unrecognized groups", () => {
    expect(mapGroupsToRole(["Unknown-Group", "Another-Group"])).toBe("business");
  });

  it("uses highest-priority group when multiple match (admin wins)", () => {
    expect(mapGroupsToRole(["AI-Platform-Engineers", "AI-Platform-Admins"])).toBe("admin");
  });

  it("uses highest-priority group when multiple match (engineer > power_user)", () => {
    expect(mapGroupsToRole(["AI-Platform-Power", "AI-Platform-Engineers"])).toBe("engineer");
  });

  it("uses highest-priority group when multiple match (power_user > business)", () => {
    expect(mapGroupsToRole(["AI-Platform-Business", "AI-Platform-Power"])).toBe("power_user");
  });

  it("ignores non-matching groups mixed with matching ones", () => {
    expect(mapGroupsToRole(["HR-Team", "AI-Platform-Engineers", "Finance"])).toBe("engineer");
  });
});

describe("verifyJwt", () => {
  const secret = "test-secret-key";

  it("returns payload for valid token", () => {
    const token = jwt.sign(
      { sub: "user123", email: "test@example.com", name: "Test User" },
      secret,
    );
    const payload = verifyJwt(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user123");
    expect(payload!.email).toBe("test@example.com");
    expect(payload!.name).toBe("Test User");
  });

  it("returns payload with groups", () => {
    const token = jwt.sign(
      { sub: "user456", email: "eng@example.com", groups: ["AI-Platform-Engineers"] },
      secret,
    );
    const payload = verifyJwt(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.groups).toEqual(["AI-Platform-Engineers"]);
  });

  it("returns null for wrong secret", () => {
    const token = jwt.sign({ sub: "user789" }, secret);
    const payload = verifyJwt(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("returns null for expired token", () => {
    const token = jwt.sign(
      { sub: "expired", exp: Math.floor(Date.now() / 1000) - 3600 },
      secret,
    );
    const payload = verifyJwt(token, secret);
    expect(payload).toBeNull();
  });

  it("returns null for malformed token", () => {
    const payload = verifyJwt("not-a-jwt-token", secret);
    expect(payload).toBeNull();
  });

  it("returns null for empty string", () => {
    const payload = verifyJwt("", secret);
    expect(payload).toBeNull();
  });
});

describe("detectAuthMethod", () => {
  it("detects API key tokens", () => {
    expect(detectAuthMethod("dynamo-sk-abc123def456")).toBe("api_key");
  });

  it("detects JWT tokens by eyJ prefix", () => {
    expect(detectAuthMethod("eyJhbGciOiJIUzI1NiJ9.test")).toBe("jwt");
  });

  it("returns none for null token", () => {
    expect(detectAuthMethod(null)).toBe("none");
  });

  it("returns none for unrecognized token format", () => {
    expect(detectAuthMethod("some-random-token")).toBe("none");
  });

  it("returns none for empty string", () => {
    expect(detectAuthMethod("")).toBe("none");
  });
});

// ── Middleware integration tests ────────────────────────────────────────────

// Mock DB pool
vi.mock("../src/services/db.js", () => ({
  getPool: vi.fn(() => null),
  closePool: vi.fn(),
}));

// Mock the Anthropic service (required by app import chain)
vi.mock("../src/services/anthropic.js", () => ({
  createMessage: vi.fn(),
  createMessageStream: vi.fn(),
}));

// Mock alert service
vi.mock("../src/services/alertService.js", () => ({
  buildSecurityAlert: vi.fn(() => ({
    type: "sensitive_data_detected",
    severity: "high",
    timestamp: new Date().toISOString(),
    context: {},
    findings: [],
  })),
  publishAlert: vi.fn(() => Promise.resolve()),
}));

import request from "supertest";
import app from "../src/index.js";
import { config } from "../src/config/index.js";
import { createMessage } from "../src/services/anthropic.js";
import { getPool } from "../src/services/db.js";

const mockedCreateMessage = vi.mocked(createMessage);
const mockedGetPool = vi.mocked(getPool);

const mockQuery = vi.fn();
const mockPool = { query: mockQuery, connect: vi.fn() };

function makeAnthropicResponse() {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetPool.mockReturnValue(null);
});

describe("auth middleware — mock mode", () => {
  // The default AUTH_MODE is "mock" in test environment

  it("uses X-Mock-User-Email and X-Mock-User-Role headers", async () => {
    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-Mock-User-Email", "custom@dynamo.works")
      .set("X-Mock-User-Role", "engineer")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Verify the request went through (mock auth accepted it)
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
  });

  it("falls back to X-User-Id/X-User-Email/X-User-Role headers", async () => {
    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-User-Id", "legacy-user")
      .set("X-User-Email", "legacy@dynamo.works")
      .set("X-User-Role", "admin")
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Admin role was honored (no downgrade)
    expect(res.headers["x-model-downgraded"]).toBeUndefined();
  });

  it("defaults to test@dynamo.works / business when no headers", async () => {
    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
  });

  it("defaults to business role which downgrades Opus to Sonnet", async () => {
    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Default business role can't use Opus → downgraded
    expect(res.headers["x-model-downgraded"]).toBe("true");
  });

  it("honors API key even in mock mode", async () => {
    const { generateRawKey } = await import("../src/services/apiKeyService.js");
    const rawKey = generateRawKey();

    mockedGetPool.mockReturnValue(mockPool as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("api_keys") && sql.includes("key_hash")) {
        return {
          rows: [{ id: 1, user_id: "api-user", user_email: "api@dynamo.works", role: "engineer" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
  });
});

describe("auth middleware — OIDC mode", () => {
  const originalAuthMode = config.authMode;
  const jwtSecret = config.jwtSecret;

  beforeEach(() => {
    Object.defineProperty(config, "authMode", { value: "oidc", writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(config, "authMode", { value: originalAuthMode, writable: true, configurable: true });
  });

  it("authenticates with valid JWT token", async () => {
    const token = jwt.sign(
      { sub: "oidc-user", email: "oidc@dynamo.works", name: "OIDC User", groups: ["AI-Platform-Engineers"] },
      jwtSecret,
    );

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
  });

  it("maps Entra ID groups to roles", async () => {
    // Admin group should allow Opus
    const token = jwt.sign(
      { sub: "admin-user", email: "admin@dynamo.works", groups: ["AI-Platform-Admins"] },
      jwtSecret,
    );

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Admin — no downgrade
    expect(res.headers["x-model-downgraded"]).toBeUndefined();
  });

  it("defaults to business role when no matching groups", async () => {
    const token = jwt.sign(
      { sub: "nogroup-user", email: "nogroup@dynamo.works", groups: ["Some-Other-Group"] },
      jwtSecret,
    );

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Business can't use Opus → downgraded
    expect(res.headers["x-model-downgraded"]).toBe("true");
  });

  it("rejects invalid JWT", async () => {
    const token = jwt.sign({ sub: "user" }, "wrong-secret");

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_token");
    expect(mockedCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects expired JWT", async () => {
    const token = jwt.sign(
      { sub: "expired", exp: Math.floor(Date.now() / 1000) - 3600 },
      jwtSecret,
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_token");
  });

  it("returns 401 when no auth header in OIDC mode", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("auth_required");
    expect(mockedCreateMessage).not.toHaveBeenCalled();
  });

  it("authenticates API key in OIDC mode", async () => {
    const { generateRawKey } = await import("../src/services/apiKeyService.js");
    const rawKey = generateRawKey();

    mockedGetPool.mockReturnValue(mockPool as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("api_keys") && sql.includes("key_hash")) {
        return {
          rows: [{ id: 2, user_id: "cli-user", user_email: "cli@dynamo.works", role: "engineer" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
  });

  it("uses fallback role from token when no groups present", async () => {
    const token = jwt.sign(
      { sub: "user-no-groups", email: "nogroups@dynamo.works", role: "engineer" },
      jwtSecret,
    );

    mockedCreateMessage.mockResolvedValue(makeAnthropicResponse() as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Engineer role allows Opus
    expect(res.headers["x-model-downgraded"]).toBeUndefined();
  });
});

// Need afterEach import
import { afterEach } from "vitest";

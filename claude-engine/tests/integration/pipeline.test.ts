import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import request from "supertest";

// ── Mocks (must be hoisted before app import) ───────────────────────────────

// Mock the Anthropic service
vi.mock("../../src/services/anthropic.js", () => ({
  createMessage: vi.fn(),
  createMessageStream: vi.fn(),
}));

// Mock the DB pool — return null by default (no DB) to keep tests simple
const mockQuery = vi.fn();
const mockPool = {
  query: mockQuery,
  connect: vi.fn(),
};

vi.mock("../../src/services/db.js", () => ({
  getPool: vi.fn(() => null),
  closePool: vi.fn(),
}));

// Mock the alert service to prevent SNS calls
vi.mock("../../src/services/alertService.js", () => ({
  buildSecurityAlert: vi.fn(() => ({
    type: "sensitive_data_detected",
    severity: "high",
    timestamp: new Date().toISOString(),
    context: {},
    findings: [],
  })),
  publishAlert: vi.fn(() => Promise.resolve()),
}));

// Now import modules after mocks are set up
import app from "../../src/index.js";
import { createMessage, createMessageStream } from "../../src/services/anthropic.js";
import { getPool } from "../../src/services/db.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeAnthropicResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello! How can I help you?" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 25, output_tokens: 15 },
    ...overrides,
  };
}

/**
 * Creates a mock async iterable that emits Anthropic streaming events.
 */
function createMockStream(opts: {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  textChunks?: string[];
} = {}) {
  const model = opts.model ?? "claude-sonnet-4-20250514";
  const inputTokens = opts.inputTokens ?? 25;
  const outputTokens = opts.outputTokens ?? 15;
  const textChunks = opts.textChunks ?? ["Hello", "! How ", "can I help?"];

  const events: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: {
        id: "msg_stream_test",
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
  ];

  for (const chunk of textChunks) {
    events.push({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: chunk },
    });
  }

  events.push(
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
    { type: "message_stop" },
  );

  // Create async generator-based iterable
  async function* generateEvents() {
    for (const event of events) {
      yield event;
    }
  }

  const iterator = generateEvents();
  // The Anthropic SDK Stream type uses for-await-of directly on the stream object
  // and also has a .controller property
  return Object.assign(iterator, { controller: { abort: vi.fn() } });
}

// ── Setup ───────────────────────────────────────────────────────────────────

const mockedCreateMessage = vi.mocked(createMessage);
const mockedCreateMessageStream = vi.mocked(createMessageStream);
const mockedGetPool = vi.mocked(getPool);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no DB
  mockedGetPool.mockReturnValue(null);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Integration: Full Request Pipeline", () => {

  // ── Test 1: Business user sends a request -> routed to Sonnet, logged, classified
  it("Test 1: business user request is routed to Sonnet, logged, and classified", async () => {
    const anthropicResponse = makeAnthropicResponse();
    mockedCreateMessage.mockResolvedValue(anthropicResponse as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-User-Id", "jdoe")
      .set("X-User-Email", "jdoe@company.com")
      .set("X-User-Role", "business")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Write a function to sort an array" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.model).toBe("claude-sonnet-4-20250514");
    expect(res.body.choices[0].message.content).toBe("Hello! How can I help you?");
    expect(res.body.usage.prompt_tokens).toBe(25);
    expect(res.body.usage.completion_tokens).toBe(15);

    // Verify the Anthropic SDK was called with the correct model
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
    const callArgs = mockedCreateMessage.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-20250514");
  });

  // ── Test 2: Engineer sends Opus request -> allowed, logged
  it("Test 2: engineer Opus request is allowed and proxied", async () => {
    const anthropicResponse = makeAnthropicResponse({
      model: "claude-opus-4-20250514",
    });
    mockedCreateMessage.mockResolvedValue(anthropicResponse as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-User-Id", "eng1")
      .set("X-User-Email", "eng1@company.com")
      .set("X-User-Role", "engineer")
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Review this code for bugs" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe("claude-opus-4-20250514");

    // Verify Opus was passed through to the SDK
    const callArgs = mockedCreateMessage.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-opus-4-20250514");

    // No downgrade header
    expect(res.headers["x-model-downgraded"]).toBeUndefined();
  });

  // ── Test 3: Business user requests Opus -> downgraded to Sonnet
  it("Test 3: business user requesting Opus is downgraded to Sonnet", async () => {
    const anthropicResponse = makeAnthropicResponse({
      model: "claude-sonnet-4-20250514",
    });
    mockedCreateMessage.mockResolvedValue(anthropicResponse as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-User-Id", "biz1")
      .set("X-User-Email", "biz1@company.com")
      .set("X-User-Role", "business")
      .send({
        model: "claude-opus-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    expect(res.status).toBe(200);
    // Model was downgraded
    expect(res.headers["x-model-downgraded"]).toBe("true");

    // Verify the SDK was called with the downgraded model (Sonnet, not Opus)
    const callArgs = mockedCreateMessage.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-20250514");
  });

  // ── Test 4: Request with AWS key in prompt -> blocked, alert logged
  it("Test 4: request with AWS key in prompt is blocked", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .set("X-User-Id", "user1")
      .set("X-User-Email", "user1@company.com")
      .set("X-User-Role", "business")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: "Here is my AWS key: AKIAIOSFODNN7EXAMPLE and my secret aws secret credential abcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("sensitive_data_blocked");
    expect(res.body.error.message).toContain("sensitive data detected");

    // Anthropic SDK should NOT have been called
    expect(mockedCreateMessage).not.toHaveBeenCalled();
  });

  // ── Test 5: User at 100% budget (hard mode) -> 429 returned
  it("Test 5: user at 100% budget in hard enforcement mode returns 429", async () => {
    // Enable DB and mock budget query
    mockedGetPool.mockReturnValue(mockPool as never);
    mockQuery.mockResolvedValue({
      rows: [{ current_usage: 200_000 }],
      rowCount: 1,
    });

    // Override budget enforcement to "hard" via config
    const { config } = await import("../../src/config/index.js");
    const originalEnforcement = config.budgetEnforcement;
    const originalDbUrl = config.databaseUrl;
    // Force hard enforcement and a DB URL
    Object.defineProperty(config, "budgetEnforcement", { value: "hard", writable: true, configurable: true });
    Object.defineProperty(config, "databaseUrl", { value: "postgres://test:test@localhost/test", writable: true, configurable: true });

    try {
      const res = await request(app)
        .post("/v1/chat/completions")
        .set("X-User-Id", "broke_user")
        .set("X-User-Email", "broke@company.com")
        .set("X-User-Role", "business")
        .send({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Hello" }],
        });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("budget_exceeded");
      expect(res.body.error.message).toContain("budget exceeded");

      // Anthropic SDK should NOT have been called
      expect(mockedCreateMessage).not.toHaveBeenCalled();
    } finally {
      // Restore original config
      Object.defineProperty(config, "budgetEnforcement", { value: originalEnforcement, writable: true, configurable: true });
      Object.defineProperty(config, "databaseUrl", { value: originalDbUrl, writable: true, configurable: true });
    }
  });

  // ── Test 6: CLI user with valid API key -> authenticated, proxied
  it("Test 6: CLI user with valid API key is authenticated and proxied", async () => {
    // We need to mock the lookupKeyByHash function
    const { lookupKeyByHash } = await import("../../src/services/apiKeyService.js");
    const mockedLookup = vi.mocked(lookupKeyByHash);

    // Generate a properly formatted key
    const { generateRawKey, hashKey } = await import("../../src/services/apiKeyService.js");
    const rawKey = generateRawKey();

    // Mock the DB lookup to return a valid result
    mockedGetPool.mockReturnValue(mockPool as never);
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("api_keys") && sql.includes("key_hash")) {
        return {
          rows: [{
            id: 1,
            user_id: "cli_user",
            user_email: "cli@company.com",
            role: "engineer",
          }],
          rowCount: 1,
        };
      }
      // Budget query — return zero usage so budget doesn't block
      if (typeof sql === "string" && sql.includes("user_budgets")) {
        return { rows: [], rowCount: 0 };
      }
      // Default — usage recording / audit
      return { rows: [], rowCount: 0 };
    });

    const anthropicResponse = makeAnthropicResponse({
      model: "claude-sonnet-4-20250514",
    });
    mockedCreateMessage.mockResolvedValue(anthropicResponse as never);

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello from CLI" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(mockedCreateMessage).toHaveBeenCalledOnce();
  });

  // ── Test 7: CLI user with invalid key -> 401
  it("Test 7: CLI user with invalid API key gets 401", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer dynamo-sk-0000000000000000000000000000000000000000000000ab")
      .send({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });

    // With no DB, lookupKeyByHash returns null → 401
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_api_key");

    // Anthropic SDK should NOT have been called
    expect(mockedCreateMessage).not.toHaveBeenCalled();
  });

  // ── Test 8: Streaming response -> tokens counted correctly
  it("Test 8: streaming response counts tokens correctly", async () => {
    mockedCreateMessageStream.mockImplementation(async () => {
      return createMockStream({
        model: "claude-sonnet-4-20250514",
        inputTokens: 30,
        outputTokens: 42,
        textChunks: ["Hello", " world", "!"],
      }) as never;
    });

    // Supertest marks req.destroyed=true which aborts the stream loop.
    // Use a real HTTP server + raw http.request to keep the connection alive.
    const server = app.listen(0); // random port
    const port = (server.address() as { port: number }).port;

    try {
      const sseText = await new Promise<string>((resolve, reject) => {
        const body = JSON.stringify({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "Stream a response" }],
          stream: true,
        });

        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/v1/chat/completions",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              "X-User-Id": "streamer",
              "X-User-Email": "streamer@company.com",
              "X-User-Role": "engineer",
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk.toString(); });
            res.on("end", () => resolve(data));
            res.on("error", reject);
          },
        );

        req.on("error", reject);
        req.write(body);
        req.end();
      });

      // Verify mock was called
      expect(mockedCreateMessageStream).toHaveBeenCalledOnce();

      // Parse SSE data lines
      const dataLines = sseText
        .split("\n")
        .filter((line: string) => line.startsWith("data: "))
        .map((line: string) => line.slice(6));

      // There should be data lines with SSE events
      expect(dataLines.length).toBeGreaterThan(0);

      // Should end with [DONE]
      expect(dataLines[dataLines.length - 1]).toBe("[DONE]");

      // Parse the chunk events (excluding [DONE])
      const chunks = dataLines
        .filter((d: string) => d !== "[DONE]")
        .map((d: string) => JSON.parse(d));

      expect(chunks.length).toBeGreaterThan(1);

      // First chunk should have role
      expect(chunks[0].choices[0].delta.role).toBe("assistant");

      // Content chunks should contain our text
      const contentChunks = chunks.filter(
        (c: { choices: Array<{ delta: { content?: string } }> }) => c.choices[0].delta.content,
      );
      const fullText = contentChunks
        .map((c: { choices: Array<{ delta: { content?: string } }> }) => c.choices[0].delta.content)
        .join("");
      expect(fullText).toBe("Hello world!");

      // Last non-[DONE] chunk should have finish_reason
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.choices[0].finish_reason).toBe("stop");
    } finally {
      server.close();
    }
  });
});

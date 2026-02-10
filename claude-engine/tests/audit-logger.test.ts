import { describe, it, expect } from "vitest";
import {
  hashPrompt,
  containsSensitiveData,
  extractPreview,
  detectSource,
  extractPromptText,
  buildAuditEntry,
} from "../src/services/auditLogger.js";
import type { AuditContext } from "../src/services/auditLogger.js";

// ── hashPrompt ──────────────────────────────────────────────────────────────

describe("hashPrompt", () => {
  it("returns a 64-char hex SHA-256 hash", () => {
    const hash = hashPrompt("hello world");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns deterministic output", () => {
    expect(hashPrompt("test")).toBe(hashPrompt("test"));
  });

  it("returns different hashes for different input", () => {
    expect(hashPrompt("a")).not.toBe(hashPrompt("b"));
  });

  it("handles empty string", () => {
    const hash = hashPrompt("");
    expect(hash).toHaveLength(64);
  });
});

// ── containsSensitiveData ───────────────────────────────────────────────────

describe("containsSensitiveData", () => {
  it("detects SSN pattern", () => {
    expect(containsSensitiveData("my ssn is 123-45-6789")).toBe(true);
  });

  it("detects credit card number", () => {
    expect(containsSensitiveData("card: 4111-1111-1111-1111")).toBe(true);
  });

  it("detects credit card without dashes", () => {
    expect(containsSensitiveData("card 4111111111111111")).toBe(true);
  });

  it("detects Anthropic/OpenAI API key pattern", () => {
    expect(containsSensitiveData("key is sk-ant-api03-abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("detects AWS access key", () => {
    expect(containsSensitiveData("AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("detects PEM private key", () => {
    expect(containsSensitiveData("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(containsSensitiveData("Hello, how are you doing today?")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsSensitiveData("")).toBe(false);
  });

  it("returns false for code without secrets", () => {
    expect(containsSensitiveData("function hello() { return 42; }")).toBe(false);
  });
});

// ── extractPreview ──────────────────────────────────────────────────────────

describe("extractPreview", () => {
  it("returns full text when under limit", () => {
    expect(extractPreview("short text")).toBe("short text");
  });

  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(300);
    const preview = extractPreview(long);
    expect(preview).toHaveLength(201); // 200 chars + ellipsis
    expect(preview.endsWith("…")).toBe(true);
  });

  it("respects custom maxLen", () => {
    const preview = extractPreview("hello world", 5);
    expect(preview).toBe("hello…");
  });

  it("returns [REDACTED] when sensitive data detected", () => {
    expect(extractPreview("my ssn is 123-45-6789")).toBe("[REDACTED]");
  });

  it("returns [REDACTED] for API key even if short", () => {
    expect(extractPreview("sk-ant-api03-abcdefghijklmnopqrstuv")).toBe("[REDACTED]");
  });

  it("returns empty string for empty input", () => {
    expect(extractPreview("")).toBe("");
  });
});

// ── detectSource ────────────────────────────────────────────────────────────

describe("detectSource", () => {
  it("returns 'cli' for curl user agent", () => {
    expect(detectSource("curl/8.1.2")).toBe("cli");
  });

  it("returns 'cli' for node user agent", () => {
    expect(detectSource("node-fetch/3.0")).toBe("cli");
  });

  it("returns 'cli' for python-requests", () => {
    expect(detectSource("python-requests/2.31.0")).toBe("cli");
  });

  it("returns 'cli' for httpie", () => {
    expect(detectSource("HTTPie/3.2.2")).toBe("cli");
  });

  it("returns 'cli' for Claude CLI", () => {
    expect(detectSource("claude-cli/1.0")).toBe("cli");
  });

  it("returns 'web' for browser user agent", () => {
    expect(detectSource("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("web");
  });

  it("returns 'web' for undefined user agent", () => {
    expect(detectSource(undefined)).toBe("web");
  });

  it("returns 'web' for empty string", () => {
    expect(detectSource("")).toBe("web");
  });
});

// ── extractPromptText ───────────────────────────────────────────────────────

describe("extractPromptText", () => {
  it("extracts text from OpenAI-format messages", () => {
    const body = {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    };
    const text = extractPromptText(body);
    expect(text).toContain("You are helpful.");
    expect(text).toContain("Hello");
  });

  it("extracts text from Anthropic-format messages with string content", () => {
    const body = {
      system: "Be concise.",
      messages: [
        { role: "user", content: "What is 2+2?" },
      ],
    };
    const text = extractPromptText(body);
    expect(text).toContain("Be concise.");
    expect(text).toContain("What is 2+2?");
  });

  it("extracts text from Anthropic-format messages with content blocks", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Describe this image" }],
        },
      ],
    };
    const text = extractPromptText(body);
    expect(text).toContain("Describe this image");
  });

  it("returns empty string for missing messages", () => {
    expect(extractPromptText({})).toBe("");
  });

  it("returns empty string for empty messages array", () => {
    expect(extractPromptText({ messages: [] })).toBe("");
  });

  it("handles mixed content types", () => {
    const body = {
      messages: [
        { role: "user", content: "plain text" },
        { role: "assistant", content: "response" },
        {
          role: "user",
          content: [
            { type: "text", text: "block text" },
            { type: "image", source: {} }, // non-text block, should be skipped
          ],
        },
      ],
    };
    const text = extractPromptText(body);
    expect(text).toContain("plain text");
    expect(text).toContain("response");
    expect(text).toContain("block text");
  });
});

// ── buildAuditEntry ─────────────────────────────────────────────────────────

describe("buildAuditEntry", () => {
  const ctx: AuditContext = {
    promptText: "What is the meaning of life?",
    promptHash: hashPrompt("What is the meaning of life?"),
    promptPreview: "What is the meaning of life?",
    source: "web",
    startTime: Date.now() - 500,
  };

  it("builds a complete audit entry", () => {
    const entry = buildAuditEntry(ctx, {
      requestId: "req-123",
      userId: "user-1",
      userEmail: "user@example.com",
      model: "claude-sonnet-4-20250514",
      inputTokens: 100,
      outputTokens: 50,
      requestCategory: "chat_completion",
      responsePreview: "The meaning of life is 42.",
      status: "success",
    });

    expect(entry.requestId).toBe("req-123");
    expect(entry.userId).toBe("user-1");
    expect(entry.userEmail).toBe("user@example.com");
    expect(entry.model).toBe("claude-sonnet-4-20250514");
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.costEstimate).toBeGreaterThan(0);
    expect(entry.requestCategory).toBe("chat_completion");
    expect(entry.source).toBe("web");
    expect(entry.promptHash).toBe(ctx.promptHash);
    expect(entry.promptPreview).toBe("What is the meaning of life?");
    expect(entry.responsePreview).toBe("The meaning of life is 42.");
    expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(entry.status).toBe("success");
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts response preview containing sensitive data", () => {
    const entry = buildAuditEntry(ctx, {
      requestId: "req-456",
      model: "claude-sonnet-4-20250514",
      inputTokens: 10,
      outputTokens: 20,
      responsePreview: "Your SSN is 123-45-6789",
      status: "success",
    });

    expect(entry.responsePreview).toBe("[REDACTED]");
  });

  it("truncates long response preview", () => {
    const entry = buildAuditEntry(ctx, {
      requestId: "req-789",
      model: "claude-sonnet-4-20250514",
      inputTokens: 10,
      outputTokens: 20,
      responsePreview: "x".repeat(500),
      status: "success",
    });

    expect(entry.responsePreview.length).toBeLessThanOrEqual(201);
  });

  it("calculates latency from context startTime", () => {
    const oldCtx: AuditContext = {
      ...ctx,
      startTime: Date.now() - 1234,
    };
    const entry = buildAuditEntry(oldCtx, {
      requestId: "req-lat",
      model: "claude-sonnet-4-20250514",
      inputTokens: 10,
      outputTokens: 20,
      responsePreview: "ok",
      status: "success",
    });

    expect(entry.latencyMs).toBeGreaterThanOrEqual(1200);
  });

  it("sets status correctly for errors", () => {
    const entry = buildAuditEntry(ctx, {
      requestId: "req-err",
      model: "claude-sonnet-4-20250514",
      inputTokens: 0,
      outputTokens: 0,
      responsePreview: "",
      status: "error",
    });

    expect(entry.status).toBe("error");
  });
});

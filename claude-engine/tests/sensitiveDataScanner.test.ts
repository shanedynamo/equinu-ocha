import { describe, it, expect } from "vitest";
import {
  luhnCheck,
  redactValue,
  scanText,
  buildBlockMessage,
  type ScanFinding,
} from "../src/services/sensitiveDataScanner.js";
import { buildSecurityAlert } from "../src/services/alertService.js";

// ── luhnCheck ──────────────────────────────────────────────────────────────

describe("luhnCheck", () => {
  it("returns true for a valid Visa number", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
  });

  it("returns true for a valid Mastercard number", () => {
    expect(luhnCheck("5500000000000004")).toBe(true);
  });

  it("returns true for a valid Discover number", () => {
    expect(luhnCheck("6011111111111117")).toBe(true);
  });

  it("returns false for an invalid card number", () => {
    expect(luhnCheck("4111111111111112")).toBe(false);
  });

  it("returns false for a non-numeric string", () => {
    expect(luhnCheck("abcdefghijklmnop")).toBe(false);
  });

  it("returns false for too-short digits", () => {
    expect(luhnCheck("1234")).toBe(false);
  });
});

// ── redactValue ────────────────────────────────────────────────────────────

describe("redactValue", () => {
  it("shows first 4 chars + **** for normal-length values", () => {
    expect(redactValue("sk-ant-api03-abcdef")).toBe("sk-a****");
  });

  it("shows first char + **** for 4-char values", () => {
    expect(redactValue("abcd")).toBe("a****");
  });

  it("shows first char + **** for single-char values", () => {
    expect(redactValue("x")).toBe("x****");
  });

  it("shows first char + **** for 3-char values", () => {
    expect(redactValue("abc")).toBe("a****");
  });
});

// ── scanText HIGH severity ─────────────────────────────────────────────────

describe("scanText — HIGH severity", () => {
  it("detects AWS access key", () => {
    const result = scanText("my key is AKIAIOSFODNN7EXAMPLE here");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].type).toBe("aws_access_key");
  });

  it("detects AWS secret key near context word", () => {
    const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const result = scanText(`aws_secret_access_key = ${secret}`);
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings.some((f) => f.type === "aws_secret_key")).toBe(true);
  });

  it("detects sk- API key", () => {
    const result = scanText("key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("api_key_sk");
  });

  it("detects GitHub personal access token", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const result = scanText(`token: ${token}`);
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("api_key_github");
  });

  it("detects Slack token", () => {
    const result = scanText("SLACK_TOKEN=xoxb-1234567890-abcdef");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("api_key_slack");
  });

  it("detects Bearer token", () => {
    const result = scanText("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("bearer_token");
  });

  it("detects valid SSN", () => {
    const result = scanText("SSN: 123-45-6789");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("ssn");
  });

  it("rejects SSN with area 000", () => {
    const result = scanText("SSN: 000-45-6789");
    expect(result.findings.filter((f) => f.type === "ssn")).toHaveLength(0);
  });

  it("rejects SSN with area 666", () => {
    const result = scanText("SSN: 666-45-6789");
    expect(result.findings.filter((f) => f.type === "ssn")).toHaveLength(0);
  });

  it("rejects SSN with area 900+", () => {
    const result = scanText("SSN: 900-45-6789");
    expect(result.findings.filter((f) => f.type === "ssn")).toHaveLength(0);
  });

  it("detects credit card with valid Luhn", () => {
    const result = scanText("Card: 4111 1111 1111 1111");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("credit_card");
  });

  it("detects credit card with dashes", () => {
    const result = scanText("Card: 4111-1111-1111-1111");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("credit_card");
  });

  it("rejects credit card failing Luhn", () => {
    const result = scanText("Number: 1234 5678 9012 3456");
    expect(result.findings.filter((f) => f.type === "credit_card")).toHaveLength(0);
  });

  it("detects RSA private key header", () => {
    const result = scanText("-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("private_key");
  });

  it("detects EC private key header", () => {
    const result = scanText("-----BEGIN EC PRIVATE KEY-----");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("private_key");
  });

  it("detects OPENSSH private key header", () => {
    const result = scanText("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings[0].type).toBe("private_key");
  });

  it("detects database password in connection string", () => {
    const result = scanText("DATABASE_URL=postgres://admin:s3cretP4ss@db.example.com:5432/mydb");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings.some((f) => f.type === "db_password")).toBe(true);
  });

  it("detects MongoDB connection string with password", () => {
    const result = scanText("MONGO_URI=mongodb://root:hunter2@mongo.internal:27017/app");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings.some((f) => f.type === "db_password")).toBe(true);
  });

  it("detects Redis connection string with password", () => {
    const result = scanText("REDIS_URL=redis://default:mypass@redis.internal:6379");
    expect(result.hasHighSeverity).toBe(true);
    expect(result.findings.some((f) => f.type === "db_password")).toBe(true);
  });
});

// ── scanText MEDIUM severity ───────────────────────────────────────────────

describe("scanText — MEDIUM severity", () => {
  it("detects connection string without password as medium", () => {
    const result = scanText("REDIS_URL=redis://redis.internal:6379/0");
    expect(result.hasMediumSeverity).toBe(true);
    expect(result.hasHighSeverity).toBe(false);
    expect(result.findings[0].type).toBe("connection_string");
  });

  it("deduplicates: db_password high suppresses connection_string medium", () => {
    const result = scanText("postgres://admin:secret@db.example.com:5432/mydb");
    const connStringFindings = result.findings.filter((f) => f.type === "connection_string");
    expect(connStringFindings).toHaveLength(0);
    expect(result.findings.some((f) => f.type === "db_password")).toBe(true);
  });

  it("detects bulk email (>10 distinct addresses)", () => {
    const emails = Array.from({ length: 12 }, (_, i) => `user${i}@example.com`);
    const result = scanText(emails.join("\n"));
    expect(result.hasMediumSeverity).toBe(true);
    expect(result.findings.some((f) => f.type === "bulk_email")).toBe(true);
  });

  it("does not flag 10 or fewer distinct emails", () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`);
    const result = scanText(emails.join("\n"));
    expect(result.findings.filter((f) => f.type === "bulk_email")).toHaveLength(0);
  });

  it("detects internal IP 10.x.x.x", () => {
    const result = scanText("server at 10.0.1.50");
    expect(result.hasMediumSeverity).toBe(true);
    expect(result.findings[0].type).toBe("internal_ip");
  });

  it("detects internal IP 172.16.x.x", () => {
    const result = scanText("host: 172.16.0.1");
    expect(result.hasMediumSeverity).toBe(true);
    expect(result.findings[0].type).toBe("internal_ip");
  });

  it("detects internal IP 192.168.x.x", () => {
    const result = scanText("gateway 192.168.1.1");
    expect(result.hasMediumSeverity).toBe(true);
    expect(result.findings[0].type).toBe("internal_ip");
  });
});

// ── False positive avoidance ───────────────────────────────────────────────

describe("scanText — false positive avoidance", () => {
  it("does not flag 'API key management' without an actual key", () => {
    const result = scanText("We use API key management to rotate credentials.");
    expect(result.hasHighSeverity).toBe(false);
  });

  it("does not flag words like 'skip' or 'skill' as sk- keys", () => {
    const result = scanText("You can skip this step or use your skill set.");
    expect(result.hasHighSeverity).toBe(false);
  });

  it("does not flag dates as SSNs", () => {
    const result = scanText("The date is 2024-01-15 and the time is 10:30.");
    expect(result.findings.filter((f) => f.type === "ssn")).toHaveLength(0);
  });

  it("does not flag short numbers as credit cards", () => {
    const result = scanText("Order #1234 5678 received.");
    expect(result.findings.filter((f) => f.type === "credit_card")).toHaveLength(0);
  });

  it("does not flag public IPs as internal", () => {
    const result = scanText("The server is at 8.8.8.8 and 1.1.1.1");
    expect(result.findings.filter((f) => f.type === "internal_ip")).toHaveLength(0);
  });

  it("does not flag BEGIN PUBLIC KEY as private key", () => {
    const result = scanText("-----BEGIN PUBLIC KEY-----");
    expect(result.findings.filter((f) => f.type === "private_key")).toHaveLength(0);
  });

  it("returns clean result for a normal prompt", () => {
    const result = scanText("Write a Python function that sorts a list of numbers.");
    expect(result.hasHighSeverity).toBe(false);
    expect(result.hasMediumSeverity).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("handles repeated scans without stale lastIndex issues", () => {
    // Ensures fresh RegExp instances each call
    const text = "key: AKIAIOSFODNN7EXAMPLE";
    const r1 = scanText(text);
    const r2 = scanText(text);
    expect(r1.findings).toHaveLength(r2.findings.length);
    expect(r1.hasHighSeverity).toBe(r2.hasHighSeverity);
  });
});

// ── buildBlockMessage ──────────────────────────────────────────────────────

describe("buildBlockMessage", () => {
  it("builds a message with human-readable type labels", () => {
    const findings: ScanFinding[] = [
      { type: "ssn", severity: "high", redactedValue: "123-****", index: 0 },
    ];
    const msg = buildBlockMessage(findings);
    expect(msg).toContain("Social Security Number");
    expect(msg).toContain("Request blocked");
  });

  it("deduplicates repeated types in the message", () => {
    const findings: ScanFinding[] = [
      { type: "credit_card", severity: "high", redactedValue: "4111****", index: 0 },
      { type: "credit_card", severity: "high", redactedValue: "5500****", index: 20 },
    ];
    const msg = buildBlockMessage(findings);
    const occurrences = msg.split("Credit Card Number").length - 1;
    expect(occurrences).toBe(1);
  });

  it("excludes medium-severity findings from block message", () => {
    const findings: ScanFinding[] = [
      { type: "ssn", severity: "high", redactedValue: "123-****", index: 0 },
      { type: "internal_ip", severity: "medium", redactedValue: "10.0****", index: 30 },
    ];
    const msg = buildBlockMessage(findings);
    expect(msg).toContain("Social Security Number");
    expect(msg).not.toContain("Internal IP");
  });

  it("returns empty string when no high-severity findings", () => {
    const findings: ScanFinding[] = [
      { type: "internal_ip", severity: "medium", redactedValue: "10.0****", index: 0 },
    ];
    expect(buildBlockMessage(findings)).toBe("");
  });

  it("lists multiple distinct high-severity types", () => {
    const findings: ScanFinding[] = [
      { type: "ssn", severity: "high", redactedValue: "123-****", index: 0 },
      { type: "credit_card", severity: "high", redactedValue: "4111****", index: 20 },
    ];
    const msg = buildBlockMessage(findings);
    expect(msg).toContain("Social Security Number");
    expect(msg).toContain("Credit Card Number");
  });
});

// ── buildSecurityAlert ─────────────────────────────────────────────────────

describe("buildSecurityAlert", () => {
  it("builds a well-structured alert", () => {
    const findings: ScanFinding[] = [
      { type: "ssn", severity: "high", redactedValue: "123-****", index: 0 },
    ];
    const alert = buildSecurityAlert(findings, {
      requestId: "req-1",
      userId: "user-1",
      route: "/v1/messages",
    });
    expect(alert.type).toBe("sensitive_data_detected");
    expect(alert.severity).toBe("high");
    expect(alert.context.requestId).toBe("req-1");
    expect(alert.findings).toHaveLength(1);
    expect(alert.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("escalates severity to high when any high finding exists", () => {
    const findings: ScanFinding[] = [
      { type: "internal_ip", severity: "medium", redactedValue: "10.0****", index: 0 },
      { type: "ssn", severity: "high", redactedValue: "123-****", index: 20 },
    ];
    const alert = buildSecurityAlert(findings, {
      requestId: "req-2",
      route: "/v1/messages",
    });
    expect(alert.severity).toBe("high");
  });

  it("reports medium severity when no high findings", () => {
    const findings: ScanFinding[] = [
      { type: "internal_ip", severity: "medium", redactedValue: "10.0****", index: 0 },
    ];
    const alert = buildSecurityAlert(findings, {
      requestId: "req-3",
      route: "/v1/messages",
    });
    expect(alert.severity).toBe("medium");
  });
});

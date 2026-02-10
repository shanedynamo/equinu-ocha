#!/usr/bin/env tsx
/**
 * seed-dev.ts — Populate the database with realistic fake data for local
 * development and analytics dashboard testing.
 *
 * Creates:
 *   - 10 users across roles (5 business, 3 engineer, 1 admin, 1 power_user)
 *   - User profiles with department info
 *   - User budgets for the current billing period
 *   - 500 audit log entries spread across the past 30 days
 *   - Matching token_usage records
 *   - 3 API keys for the engineer users
 *
 * Usage:
 *   npx tsx src/db/seed-dev.ts
 *
 * Requires DATABASE_URL in the environment. Idempotent — checks for existing
 * data and skips if the database is already seeded.
 */

import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

// ── Database connection ─────────────────────────────────────────────────────

function createPool(): pg.Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(1);
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 5_000,
  });
}

// ── Deterministic random (seeded for reproducibility) ───────────────────────

let rngState = 42;
function seededRandom(): number {
  rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = seededRandom() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function randInt(min: number, max: number): number {
  return Math.floor(seededRandom() * (max - min + 1)) + min;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-haiku-4-20250514",
] as const;

// Weights: Sonnet 60%, Haiku 25%, Opus 15%
const MODEL_WEIGHTS = [60, 15, 25];

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-20250514": { input: 0.8, output: 4 },
};

const CATEGORIES = [
  "code_generation",
  "document_creation",
  "business_development",
  "data_analysis",
  "email_drafting",
  "summarization",
  "research",
  "translation",
] as const;

// Weights: code gen and document creation dominate
const CATEGORY_WEIGHTS = [30, 20, 12, 10, 10, 8, 6, 4];

const SOURCES = ["web", "cli"] as const;
const SOURCE_WEIGHTS = [70, 30];

const STATUSES = ["success", "error", "blocked"] as const;
const STATUS_WEIGHTS = [92, 5, 3];

const DEPARTMENTS = [
  "Engineering",
  "Sales",
  "Marketing",
  "Legal",
  "Product",
] as const;

// ── Fake users ──────────────────────────────────────────────────────────────

interface FakeUser {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  department: string;
  monthly_limit: number | null;
}

const USERS: FakeUser[] = [
  // 1 admin
  { user_id: "u_admin_01", email: "alice.chen@dynamo-ai.local", display_name: "Alice Chen", role: "admin", department: "Engineering", monthly_limit: null },
  // 3 engineers
  { user_id: "u_eng_01", email: "bob.martinez@dynamo-ai.local", display_name: "Bob Martinez", role: "engineer", department: "Engineering", monthly_limit: 500_000 },
  { user_id: "u_eng_02", email: "carol.jones@dynamo-ai.local", display_name: "Carol Jones", role: "engineer", department: "Engineering", monthly_limit: 500_000 },
  { user_id: "u_eng_03", email: "dan.kim@dynamo-ai.local", display_name: "Dan Kim", role: "engineer", department: "Engineering", monthly_limit: 500_000 },
  // 1 power_user
  { user_id: "u_power_01", email: "elena.ross@dynamo-ai.local", display_name: "Elena Ross", role: "power_user", department: "Product", monthly_limit: 350_000 },
  // 5 business
  { user_id: "u_biz_01", email: "frank.liu@dynamo-ai.local", display_name: "Frank Liu", role: "business", department: "Sales", monthly_limit: 200_000 },
  { user_id: "u_biz_02", email: "grace.patel@dynamo-ai.local", display_name: "Grace Patel", role: "business", department: "Marketing", monthly_limit: 200_000 },
  { user_id: "u_biz_03", email: "henry.wong@dynamo-ai.local", display_name: "Henry Wong", role: "business", department: "Sales", monthly_limit: 200_000 },
  { user_id: "u_biz_04", email: "isabel.garcia@dynamo-ai.local", display_name: "Isabel Garcia", role: "business", department: "Legal", monthly_limit: 200_000 },
  { user_id: "u_biz_05", email: "jake.moore@dynamo-ai.local", display_name: "Jake Moore", role: "business", department: "Marketing", monthly_limit: 200_000 },
];

// Usage weights: engineers/admin use more, business less
const USER_WEIGHTS = [
  12,  // admin - moderate usage
  18,  // engineer - heavy
  15,  // engineer - heavy
  14,  // engineer - heavy
  10,  // power_user - moderate
  7,   // business
  6,   // business
  7,   // business
  6,   // business
  5,   // business
];

// ── Helper functions ────────────────────────────────────────────────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

function randomTimestamp(daysAgo: number): Date {
  const now = new Date();
  const msAgo = daysAgo * 24 * 60 * 60 * 1000;
  const earliest = now.getTime() - msAgo;
  const ts = earliest + seededRandom() * msAgo;
  const date = new Date(ts);
  // Weight toward business hours (8am-6pm)
  const hour = randInt(0, 23);
  if (hour < 8 || hour > 18) {
    // 30% chance to keep off-hours, otherwise shift to business hours
    if (seededRandom() > 0.3) {
      date.setHours(randInt(8, 18));
    }
  }
  return date;
}

function hashString(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateKeyPrefix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "dyn_";
  for (let i = 0; i < 8; i++) {
    key += chars[Math.floor(seededRandom() * chars.length)];
  }
  return key;
}

function getCurrentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── Prompt previews for realism ─────────────────────────────────────────────

const PROMPT_PREVIEWS: Record<string, string[]> = {
  code_generation: [
    "Write a Python function that validates email addresses...",
    "Create a React component for a paginated data table...",
    "Implement a rate limiter middleware for Express...",
    "Write unit tests for the authentication service...",
    "Generate a SQL migration for adding a comments table...",
  ],
  document_creation: [
    "Draft a technical specification for the new API gateway...",
    "Write a project status update for the Q1 release...",
    "Create a runbook for database failover procedures...",
    "Draft release notes for version 2.3.0...",
    "Write an architecture decision record for moving to microservices...",
  ],
  business_development: [
    "Help me draft a proposal for the enterprise contract...",
    "Write a competitive analysis comparing our platform to...",
    "Create a slide outline for the investor presentation...",
    "Draft a follow-up email after the client demo...",
    "Summarize key differentiators for the RFP response...",
  ],
  data_analysis: [
    "Analyze this CSV data and identify trends in user retention...",
    "Write a SQL query to calculate monthly recurring revenue...",
    "Help me interpret these A/B test results...",
    "Create a summary of our Q4 usage metrics...",
    "Calculate the statistical significance of this experiment...",
  ],
  email_drafting: [
    "Draft a professional response to this client complaint...",
    "Write a team announcement about the upcoming hackathon...",
    "Compose an email requesting budget approval for the new tool...",
    "Help me write a tactful message declining a meeting request...",
    "Draft a customer onboarding welcome email...",
  ],
  summarization: [
    "Summarize the key points from this 20-page report...",
    "Provide a TL;DR of this research paper on transformer models...",
    "Summarize the action items from today's meeting transcript...",
    "Condense this legal agreement into bullet points...",
    "Create an executive summary of the quarterly financial review...",
  ],
  research: [
    "Compare the pros and cons of PostgreSQL vs MySQL for our use case...",
    "Research best practices for implementing SSO with Azure AD...",
    "What are the latest OWASP top 10 vulnerabilities for 2025...",
    "Explain the differences between OAuth 2.0 and OIDC...",
    "Research compliance requirements for SOC 2 Type II...",
  ],
  translation: [
    "Translate this product description to Spanish...",
    "Convert this technical documentation to Japanese...",
    "Translate the user interface strings to French...",
    "Help localize this error message set for German users...",
    "Translate this marketing copy to Portuguese...",
  ],
};

const RESPONSE_PREVIEWS = [
  "Here's the implementation you requested...",
  "I've analyzed the data and found the following patterns...",
  "Based on the requirements, I recommend...",
  "Here's a draft that addresses your key points...",
  "I've created the following structure...",
];

// ── Seed functions ──────────────────────────────────────────────────────────

async function seedUserProfiles(pool: pg.Pool): Promise<void> {
  console.log("    Seeding user_profiles...");
  const firstLogin = new Date();
  firstLogin.setDate(firstLogin.getDate() - 60); // first login 60 days ago

  for (const user of USERS) {
    await pool.query(
      `INSERT INTO user_profiles (user_id, email, display_name, role, department, entra_groups, first_login, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [
        user.user_id,
        user.email,
        user.display_name,
        user.role,
        user.department,
        [`${user.department}-team`, "all-employees"],
        firstLogin,
      ],
    );
  }
  console.log(`    Inserted ${USERS.length} user profiles.`);
}

async function seedUserBudgets(pool: pg.Pool): Promise<void> {
  console.log("    Seeding user_budgets...");
  const periodStart = getCurrentPeriodStart();

  for (const user of USERS) {
    // Start with some partial usage (will be updated by audit log seeding)
    await pool.query(
      `INSERT INTO user_budgets (user_id, role, monthly_limit, current_usage, period_start)
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT (user_id, period_start) DO NOTHING`,
      [user.user_id, user.role, user.monthly_limit, periodStart],
    );
  }
  console.log(`    Inserted ${USERS.length} user budgets.`);
}

interface AuditEntry {
  user: FakeUser;
  model: string;
  category: string;
  source: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  timestamp: Date;
  promptHash: string;
  promptPreview: string;
  responsePreview: string;
  latencyMs: number;
  requestId: string;
}

function generateAuditEntries(count: number): AuditEntry[] {
  const entries: AuditEntry[] = [];

  for (let i = 0; i < count; i++) {
    const user = pickWeighted(USERS, USER_WEIGHTS);
    const model = pickWeighted([...MODELS], MODEL_WEIGHTS);
    const category = pickWeighted([...CATEGORIES], CATEGORY_WEIGHTS);
    const source = pickWeighted([...SOURCES], SOURCE_WEIGHTS);
    const status = pickWeighted([...STATUSES], STATUS_WEIGHTS);

    // Token counts vary by model tier and category
    let inputBase: number;
    let outputBase: number;
    if (category === "code_generation") {
      inputBase = randInt(200, 2000);
      outputBase = randInt(500, 4000);
    } else if (category === "document_creation") {
      inputBase = randInt(300, 1500);
      outputBase = randInt(400, 3000);
    } else if (category === "summarization") {
      inputBase = randInt(1000, 5000);
      outputBase = randInt(200, 800);
    } else {
      inputBase = randInt(100, 1500);
      outputBase = randInt(100, 2000);
    }

    // Opus requests tend to be longer
    if (model === "claude-opus-4-20250514") {
      inputBase = Math.round(inputBase * 1.5);
      outputBase = Math.round(outputBase * 1.8);
    }
    // Haiku requests tend to be shorter
    if (model === "claude-haiku-4-20250514") {
      inputBase = Math.round(inputBase * 0.7);
      outputBase = Math.round(outputBase * 0.6);
    }

    const costEstimate = estimateCost(model, inputBase, outputBase);
    const timestamp = randomTimestamp(30);
    const promptPreview = pick(PROMPT_PREVIEWS[category] ?? ["..."]);
    const latencyMs = model === "claude-opus-4-20250514"
      ? randInt(3000, 15000)
      : model === "claude-sonnet-4-20250514"
        ? randInt(1000, 8000)
        : randInt(200, 3000);

    entries.push({
      user,
      model,
      category,
      source,
      status,
      inputTokens: inputBase,
      outputTokens: status === "success" ? outputBase : 0,
      costEstimate: status === "success" ? costEstimate : 0,
      timestamp,
      promptHash: hashString(`${user.user_id}-${i}-${promptPreview}`),
      promptPreview,
      responsePreview: status === "success" ? pick(RESPONSE_PREVIEWS) : "",
      latencyMs: status === "success" ? latencyMs : randInt(50, 500),
      requestId: crypto.randomUUID(),
    });
  }

  // Sort by timestamp for realistic ordering
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return entries;
}

async function seedAuditLogsAndTokenUsage(pool: pg.Pool): Promise<void> {
  console.log("    Generating 500 audit log entries...");
  const entries = generateAuditEntries(500);

  // Track per-user token totals for budget updates
  const userTokenTotals = new Map<string, number>();

  console.log("    Inserting audit_logs and token_usage...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const entry of entries) {
      // Insert audit log
      await client.query(
        `INSERT INTO audit_logs
         (request_id, user_id, user_email, timestamp, model, input_tokens, output_tokens,
          cost_estimate, request_category, source, prompt_hash, prompt_preview,
          response_preview, latency_ms, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          entry.requestId,
          entry.user.user_id,
          entry.user.email,
          entry.timestamp,
          entry.model,
          entry.inputTokens,
          entry.outputTokens,
          entry.costEstimate,
          entry.category,
          entry.source,
          entry.promptHash,
          entry.promptPreview,
          entry.responsePreview,
          entry.latencyMs,
          entry.status,
        ],
      );

      // Insert matching token_usage (only for successful requests)
      if (entry.status === "success") {
        await client.query(
          `INSERT INTO token_usage
           (user_id, user_email, model, input_tokens, output_tokens, cost_estimate, request_category, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            entry.user.user_id,
            entry.user.email,
            entry.model,
            entry.inputTokens,
            entry.outputTokens,
            entry.costEstimate,
            entry.category,
            entry.timestamp,
          ],
        );

        // Accumulate tokens for this user (current period only)
        const periodStart = new Date(getCurrentPeriodStart());
        if (entry.timestamp >= periodStart) {
          const prev = userTokenTotals.get(entry.user.user_id) ?? 0;
          userTokenTotals.set(
            entry.user.user_id,
            prev + entry.inputTokens + entry.outputTokens,
          );
        }
      }
    }

    // Update user_budgets with accumulated totals
    const periodStart = getCurrentPeriodStart();
    for (const [userId, totalTokens] of userTokenTotals) {
      await client.query(
        `UPDATE user_budgets
         SET current_usage = $1, updated_at = NOW()
         WHERE user_id = $2 AND period_start = $3`,
        [totalTokens, userId, periodStart],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`    Inserted 500 audit_logs and matching token_usage records.`);
  console.log(`    Updated ${userTokenTotals.size} user budget totals.`);
}

async function seedApiKeys(pool: pg.Pool): Promise<void> {
  console.log("    Seeding api_keys for engineer users...");

  // Create API keys for the 3 engineer users
  const engineers = USERS.filter((u) => u.role === "engineer");

  for (const eng of engineers) {
    const prefix = generateKeyPrefix();
    const rawKey = `${prefix}${"x".repeat(40)}`; // fake full key
    const keyHash = hashString(rawKey);

    await pool.query(
      `INSERT INTO api_keys (user_id, user_email, key_hash, key_prefix, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [eng.user_id, eng.email, keyHash, prefix, eng.role],
    );
  }

  console.log(`    Inserted ${engineers.length} API keys.`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pool = createPool();

  try {
    // Check if data already exists
    const existing = await pool.query(
      "SELECT COUNT(*)::int AS count FROM audit_logs",
    );
    if (existing.rows[0].count > 0) {
      console.log(
        `==> Database already has ${existing.rows[0].count} audit log entries.`,
      );
      console.log("    Skipping seed to avoid duplicates.");
      console.log("    To re-seed, truncate tables first:");
      console.log(
        "    TRUNCATE audit_logs, token_usage, user_budgets, user_profiles, api_keys CASCADE;",
      );
      return;
    }

    console.log("==> Seeding development data...");

    await seedUserProfiles(pool);
    await seedUserBudgets(pool);
    await seedAuditLogsAndTokenUsage(pool);
    await seedApiKeys(pool);

    console.log("");
    console.log("==> Seed complete!");
    console.log("    Users:      10 (5 business, 3 engineer, 1 admin, 1 power_user)");
    console.log("    Audit logs: 500 entries (past 30 days)");
    console.log("    API keys:   3 (for engineer users)");
    console.log("");
    console.log("    Departments: Engineering, Sales, Marketing, Legal, Product");
    console.log("    Model mix:   ~60% Sonnet, ~25% Haiku, ~15% Opus");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});

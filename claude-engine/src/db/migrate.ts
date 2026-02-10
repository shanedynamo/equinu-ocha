#!/usr/bin/env tsx
/**
 * migrate.ts — Lightweight SQL migration runner for Claude Engine.
 *
 * Reads .sql files from src/db/migrations/ in numeric order and applies
 * them idempotently, tracking state in a `schema_migrations` table.
 *
 * Usage:
 *   npx tsx src/db/migrate.ts          # apply pending migrations
 *   npx tsx src/db/migrate.ts status   # show migration status
 *
 * Requires DATABASE_URL in the environment.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import pg from "pg";

const { Pool } = pg;

// ── Resolve paths ───────────────────────────────────────────────────────────
// Works in both CJS (__dirname) and ESM (import.meta) contexts via tsx.

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// ── Database connection ─────────────────────────────────────────────────────
// Reads DATABASE_URL directly — this script runs standalone, not through
// the app's Zod config (which requires ANTHROPIC_API_KEY).

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

// ── Schema migrations table ─────────────────────────────────────────────────

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL      PRIMARY KEY,
      filename    TEXT        NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  return new Set(result.rows.map((r: { filename: string }) => r.filename));
}

// ── Discover migration files ────────────────────────────────────────────────

function discoverMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`ERROR: Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// ── Apply a single migration ────────────────────────────────────────────────

async function applyMigration(
  pool: pg.Pool,
  filename: string,
): Promise<void> {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, "utf-8");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [filename],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  const pool = createPool();

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const files = discoverMigrations();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("==> All migrations are up to date.");
      return;
    }

    console.log(`==> ${pending.length} pending migration(s) to apply.`);

    for (const filename of pending) {
      console.log(`    Applying ${filename}...`);
      await applyMigration(pool, filename);
      console.log(`    Applied  ${filename}.`);
    }

    console.log(`==> ${pending.length} migration(s) applied successfully.`);
  } finally {
    await pool.end();
  }
}

async function showStatus(): Promise<void> {
  const pool = createPool();

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);
    const files = discoverMigrations();

    console.log("==> Migration status:");
    console.log("");
    for (const filename of files) {
      const status = applied.has(filename) ? "applied" : "pending";
      const marker = status === "applied" ? "[x]" : "[ ]";
      console.log(`    ${marker} ${filename}`);
    }
    console.log("");

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log("    All migrations applied.");
    } else {
      console.log(`    ${pending.length} pending migration(s).`);
    }
  } finally {
    await pool.end();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === "status") {
  showStatus().catch((err) => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
} else {
  runMigrations().catch((err) => {
    console.error("ERROR:", err.message);
    process.exit(1);
  });
}

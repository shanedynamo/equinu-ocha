-- 006_create_indexes.sql
-- Performance indexes for analytics queries and hot-path lookups

-- ── audit_logs ──────────────────────────────────────────────────────────────

-- Single-column indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_model      ON audit_logs (model);
CREATE INDEX IF NOT EXISTS idx_audit_logs_hash       ON audit_logs (prompt_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status     ON audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_source     ON audit_logs (source);

-- Composite indexes for analytics dashboard queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON audit_logs (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created
    ON audit_logs (request_category, created_at);

-- ── token_usage ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_token_usage_user_id     ON token_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at  ON token_usage (created_at);

-- Composite index for per-user period queries (budget calculations)
CREATE INDEX IF NOT EXISTS idx_token_usage_user_period
    ON token_usage (user_id, created_at);

-- ── api_keys ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id  ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active   ON api_keys (is_active);

-- Unique index on key_hash (full uniqueness constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash_unique
    ON api_keys (key_hash);

-- Partial index for the auth hot path (only active keys)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash_active
    ON api_keys (key_hash) WHERE is_active = TRUE;

-- ── user_budgets ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_user_budgets_period
    ON user_budgets (period_start);

-- ── user_profiles ───────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email_unique
    ON user_profiles (email);

CREATE INDEX IF NOT EXISTS idx_user_profiles_department
    ON user_profiles (department);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role
    ON user_profiles (role);

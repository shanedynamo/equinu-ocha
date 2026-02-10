-- 004_create_user_budgets.sql
-- Materialized per-user budget summary: one row per user per billing period

CREATE TABLE IF NOT EXISTS user_budgets (
    user_id         TEXT        NOT NULL,
    role            TEXT        NOT NULL,
    monthly_limit   INTEGER,         -- NULL = unlimited
    current_usage   INTEGER     NOT NULL DEFAULT 0,
    period_start    DATE        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, period_start)
);

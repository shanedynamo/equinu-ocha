-- Token usage tracking: one row per API request
CREATE TABLE IF NOT EXISTS token_usage (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    user_email      TEXT,
    model           TEXT        NOT NULL,
    input_tokens    INTEGER     NOT NULL DEFAULT 0,
    output_tokens   INTEGER     NOT NULL DEFAULT 0,
    cost_estimate   NUMERIC(12, 6) NOT NULL DEFAULT 0,
    request_category TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_user_id     ON token_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at  ON token_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_user_period  ON token_usage (user_id, created_at);

-- Materialized per-user budget summary: one row per user per period
CREATE TABLE IF NOT EXISTS user_budgets (
    user_id         TEXT        NOT NULL,
    role            TEXT        NOT NULL,
    monthly_limit   INTEGER,         -- NULL = unlimited
    current_usage   INTEGER     NOT NULL DEFAULT 0,
    period_start    DATE        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_budgets_period ON user_budgets (period_start);

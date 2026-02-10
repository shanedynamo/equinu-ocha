-- 001_create_token_usage.sql
-- Per-request token consumption tracking

CREATE TABLE IF NOT EXISTS token_usage (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         TEXT            NOT NULL,
    user_email      TEXT,
    model           TEXT            NOT NULL,
    input_tokens    INTEGER         NOT NULL DEFAULT 0,
    output_tokens   INTEGER         NOT NULL DEFAULT 0,
    cost_estimate   NUMERIC(12, 6)  NOT NULL DEFAULT 0,
    request_category TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

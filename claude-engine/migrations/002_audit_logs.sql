CREATE TABLE IF NOT EXISTS audit_logs (
    id                BIGSERIAL PRIMARY KEY,
    request_id        UUID        NOT NULL,
    user_id           TEXT,
    user_email        TEXT,
    timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    model             TEXT        NOT NULL,
    input_tokens      INTEGER     NOT NULL DEFAULT 0,
    output_tokens     INTEGER     NOT NULL DEFAULT 0,
    cost_estimate     NUMERIC(12, 6) NOT NULL DEFAULT 0,
    request_category  TEXT,
    source            TEXT,                  -- "web" | "cli"
    prompt_hash       TEXT        NOT NULL,
    prompt_preview    TEXT,
    response_preview  TEXT,
    latency_ms        INTEGER     NOT NULL DEFAULT 0,
    status            TEXT        NOT NULL DEFAULT 'success',  -- "success" | "error" | "blocked"
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_model      ON audit_logs (model);
CREATE INDEX IF NOT EXISTS idx_audit_logs_hash       ON audit_logs (prompt_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status     ON audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_source     ON audit_logs (source);

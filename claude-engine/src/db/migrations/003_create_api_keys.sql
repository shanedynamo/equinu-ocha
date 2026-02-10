-- 003_create_api_keys.sql
-- API key storage for CLI / programmatic access

CREATE TABLE IF NOT EXISTS api_keys (
    id            BIGSERIAL     PRIMARY KEY,
    user_id       TEXT          NOT NULL,
    user_email    TEXT          NOT NULL,
    key_hash      TEXT          NOT NULL,      -- SHA-256 of the raw key
    key_prefix    TEXT          NOT NULL,      -- first 12 chars for display (e.g. "dyn_abc12345")
    role          TEXT          NOT NULL DEFAULT 'business',
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE
);

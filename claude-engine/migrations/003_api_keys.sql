CREATE TABLE IF NOT EXISTS api_keys (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL,
    user_email   TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,    -- SHA-256 of the raw key
    key_prefix   TEXT NOT NULL,           -- first 12 chars for display
    role         TEXT NOT NULL DEFAULT 'business',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);
-- Partial index for auth hot path (only searches active keys)
CREATE INDEX idx_api_keys_key_hash  ON api_keys (key_hash) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_user_id   ON api_keys (user_id);
CREATE INDEX idx_api_keys_is_active ON api_keys (is_active);

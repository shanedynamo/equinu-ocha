-- 005_create_user_profiles.sql
-- User profiles synced from OIDC (Entra ID / Azure AD)

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id       TEXT          PRIMARY KEY,
    email         TEXT          NOT NULL,
    display_name  TEXT,
    role          TEXT          NOT NULL DEFAULT 'business',
    department    TEXT,
    entra_groups  TEXT[],       -- Azure AD group memberships
    first_login   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

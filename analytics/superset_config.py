import os

# =============================================================================
# Superset Configuration — Dynamo AI Platform
# =============================================================================

# ── Secret key ───────────────────────────────────────────────────────────────

SECRET_KEY = os.environ.get("SUPERSET_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION")

# ── Database ─────────────────────────────────────────────────────────────────
# Superset's own metadata database (stores dashboards, charts, users, etc.)

SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SQLALCHEMY_DATABASE_URI",
    os.environ.get(
        "DATABASE_URL",
        "postgresql://dynamo:localdev@postgres:5432/dynamo_ai",
    ),
)

# ── Redis / Caching ──────────────────────────────────────────────────────────

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))

CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 300,
    "CACHE_KEY_PREFIX": "superset_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
}

DATA_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 600,
    "CACHE_KEY_PREFIX": "superset_data_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
}

FILTER_STATE_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": 600,
    "CACHE_KEY_PREFIX": "superset_filter_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
}

# ── Authentication ───────────────────────────────────────────────────────────

AUTH_TYPE = 1  # AUTH_DB — database-based authentication
AUTH_USER_REGISTRATION = False

# Admin account created via init-superset.sh; additional users created in UI
ADMIN_USERNAME = os.environ.get("SUPERSET_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("SUPERSET_ADMIN_PASSWORD", "admin")
ADMIN_EMAIL = os.environ.get("SUPERSET_ADMIN_EMAIL", "admin@dynamo-ai.local")

# ── Query limits ─────────────────────────────────────────────────────────────

ROW_LIMIT = 10000
SQL_MAX_ROW = 100000
SUPERSET_WEBSERVER_TIMEOUT = 120
SQLLAB_TIMEOUT = 120
SQLLAB_DEFAULT_DBID = 1

# ── Feature flags ────────────────────────────────────────────────────────────

FEATURE_FLAGS = {
    "ENABLE_TEMPLATE_PROCESSING": True,
    "DASHBOARD_NATIVE_FILTERS": True,
    "DASHBOARD_CROSS_FILTERS": True,
    "DASHBOARD_NATIVE_FILTERS_SET": True,
    "ALERT_REPORTS": False,
}

# ── Misc ─────────────────────────────────────────────────────────────────────

# Superset application name shown in the browser tab
APP_NAME = "Dynamo AI Analytics"

# Prevent Superset from phoning home
STATS_LOGGER = None

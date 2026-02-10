#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# init-superset.sh — Initialize Apache Superset with admin user and DB connection
# =============================================================================
# Usage:
#   ./scripts/init-superset.sh              # Uses defaults from .env
#   docker compose exec superset bash -c "/app/scripts/init-superset.sh"
# =============================================================================
# This script:
#   1. Waits for the Superset container to be reachable
#   2. Runs Superset DB migrations (creates internal metadata tables)
#   3. Creates an admin user
#   4. Registers the Dynamo AI PostgreSQL database as a data source
# =============================================================================

# ── Config (read from env or use defaults matching .env) ─────────────────────

SUPERSET_CONTAINER="${SUPERSET_CONTAINER:-superset}"
SUPERSET_ADMIN_USERNAME="${SUPERSET_ADMIN_USERNAME:-admin}"
SUPERSET_ADMIN_PASSWORD="${SUPERSET_ADMIN_PASSWORD:-admin}"
SUPERSET_ADMIN_EMAIL="${SUPERSET_ADMIN_EMAIL:-admin@dynamo-ai.local}"
SUPERSET_ADMIN_FIRST="${SUPERSET_ADMIN_FIRST:-Admin}"
SUPERSET_ADMIN_LAST="${SUPERSET_ADMIN_LAST:-User}"

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-dynamo_ai}"
DB_USER="${POSTGRES_USER:-dynamo}"
DB_PASSWORD="${POSTGRES_PASSWORD:-localdev}"

# The SQLAlchemy URI that Superset will use to connect to the analytics DB
ANALYTICS_DB_URI="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ── Helper: run command inside the Superset container ────────────────────────

superset_exec() {
  docker compose exec -T "$SUPERSET_CONTAINER" "$@"
}

# ── Step 1: Wait for Superset container ──────────────────────────────────────

echo "==> Waiting for Superset container to be ready..."

retries=0
max_retries=60
until docker compose exec -T "$SUPERSET_CONTAINER" superset --help > /dev/null 2>&1; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "ERROR: Superset container did not become ready after ${max_retries} attempts."
    exit 1
  fi
  sleep 2
done

echo "==> Superset container is ready."

# ── Step 2: Run Superset DB migrations ───────────────────────────────────────

echo "==> Running Superset database migrations..."
superset_exec superset db upgrade
echo "==> Migrations complete."

# ── Step 3: Create admin user ────────────────────────────────────────────────

echo "==> Creating admin user: ${SUPERSET_ADMIN_USERNAME}..."
superset_exec superset fab create-admin \
  --username "$SUPERSET_ADMIN_USERNAME" \
  --firstname "$SUPERSET_ADMIN_FIRST" \
  --lastname "$SUPERSET_ADMIN_LAST" \
  --email "$SUPERSET_ADMIN_EMAIL" \
  --password "$SUPERSET_ADMIN_PASSWORD" \
  || echo "    (admin user may already exist — continuing)"

# ── Step 4: Initialize Superset (roles, permissions) ─────────────────────────

echo "==> Initializing Superset roles and permissions..."
superset_exec superset init
echo "==> Superset initialization complete."

# ── Step 5: Register Dynamo AI database as a data source ─────────────────────

echo "==> Registering Dynamo AI database as a Superset data source..."

# Use the Superset CLI to set the database connection via a Python one-liner
superset_exec python -c "
from superset.app import create_app
from superset.models.core import Database
from superset.extensions import db as sa_db

app = create_app()
with app.app_context():
    existing = sa_db.session.query(Database).filter_by(database_name='Dynamo AI').first()
    if existing:
        existing.sqlalchemy_uri = '${ANALYTICS_DB_URI}'
        print('    Updated existing Dynamo AI database connection.')
    else:
        new_db = Database(
            database_name='Dynamo AI',
            sqlalchemy_uri='${ANALYTICS_DB_URI}',
            expose_in_sqllab=True,
            allow_run_async=True,
        )
        sa_db.session.add(new_db)
        print('    Created Dynamo AI database connection.')
    sa_db.session.commit()
"

echo "==> Dynamo AI database registered in Superset."

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "==> Superset initialization complete!"
echo "    Dashboard: http://localhost:${SUPERSET_PORT:-8088}"
echo "    Username:  ${SUPERSET_ADMIN_USERNAME}"
echo "    Password:  ${SUPERSET_ADMIN_PASSWORD}"

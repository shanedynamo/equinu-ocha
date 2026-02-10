#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# init-db.sh — Run SQL migrations against the Dynamo AI PostgreSQL database
# =============================================================================
# Usage:
#   ./scripts/init-db.sh                  # Uses Docker Compose postgres service
#   ./scripts/init-db.sh localhost 5432   # Custom host/port (e.g. local dev)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$ROOT_DIR/claude-engine/migrations"

DB_HOST="${1:-localhost}"
DB_PORT="${2:-5432}"
DB_NAME="${POSTGRES_DB:-dynamo_ai}"
DB_USER="${POSTGRES_USER:-dynamo}"
DB_PASSWORD="${POSTGRES_PASSWORD:-localdev}"

export PGPASSWORD="$DB_PASSWORD"

echo "==> Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."

retries=0
max_retries=30
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "ERROR: PostgreSQL did not become ready after ${max_retries} attempts."
    exit 1
  fi
  sleep 1
done

echo "==> PostgreSQL is ready."

# Run each migration file in order
for migration in "$MIGRATIONS_DIR"/*.sql; do
  filename="$(basename "$migration")"
  echo "==> Applying migration: ${filename}"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration" --quiet
done

echo "==> All migrations applied successfully."
echo ""
echo "Tables created:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" \
  --tuples-only | sed '/^$/d' | sed 's/^ */  - /'

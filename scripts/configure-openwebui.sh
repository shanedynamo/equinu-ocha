#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# configure-openwebui.sh — Configure Open WebUI with model presets and defaults
# =============================================================================
# Usage:
#   ./scripts/configure-openwebui.sh
#
# Prerequisites: curl, jq
# =============================================================================
# This script:
#   1. Waits for the Open WebUI health endpoint to respond
#   2. Creates (or signs into) the admin account
#   3. Creates model presets for Claude Opus, Sonnet, and Haiku
#   4. Sets the default model and model ordering
# =============================================================================

# ── Config (read from env or use defaults matching .env) ─────────────────────

OPENWEBUI_URL="${OPENWEBUI_URL:-http://localhost:8080}"
OPENWEBUI_ADMIN_EMAIL="${OPENWEBUI_ADMIN_EMAIL:-admin@dynamo-ai.local}"
OPENWEBUI_ADMIN_PASSWORD="${OPENWEBUI_ADMIN_PASSWORD:-admin}"
OPENWEBUI_ADMIN_NAME="${OPENWEBUI_ADMIN_NAME:-Admin}"

# ── Dependency check ─────────────────────────────────────────────────────────

for cmd in curl jq; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

# ── Organization system prompt ───────────────────────────────────────────────

SYSTEM_PROMPT="You are a helpful AI assistant deployed by Dynamo AI. \
Be concise, accurate, and professional. If you are unsure about something, \
say so rather than guessing. Follow the user's instructions carefully."

# ── Step 1: Wait for Open WebUI ──────────────────────────────────────────────

echo "==> Waiting for Open WebUI at ${OPENWEBUI_URL}..."

retries=0
max_retries=60
until curl -sf "${OPENWEBUI_URL}/health" > /dev/null 2>&1; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "ERROR: Open WebUI did not become ready after ${max_retries} attempts."
    exit 1
  fi
  sleep 2
done

echo "==> Open WebUI is ready."

# ── Step 2: Authenticate (signup first user or sign in) ──────────────────────

echo "==> Authenticating as ${OPENWEBUI_ADMIN_EMAIL}..."

# Try signup first (first user becomes admin)
SIGNUP_RESPONSE=$(curl -sf -X POST "${OPENWEBUI_URL}/api/v1/auths/signup" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg email "$OPENWEBUI_ADMIN_EMAIL" \
    --arg password "$OPENWEBUI_ADMIN_PASSWORD" \
    --arg name "$OPENWEBUI_ADMIN_NAME" \
    '{email: $email, password: $password, name: $name}')" \
  2>/dev/null) || true

TOKEN=""
if [ -n "$SIGNUP_RESPONSE" ]; then
  TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.token // empty')
fi

# If signup didn't return a token, try signin
if [ -z "$TOKEN" ]; then
  SIGNIN_RESPONSE=$(curl -sf -X POST "${OPENWEBUI_URL}/api/v1/auths/signin" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg email "$OPENWEBUI_ADMIN_EMAIL" \
      --arg password "$OPENWEBUI_ADMIN_PASSWORD" \
      '{email: $email, password: $password}')")

  TOKEN=$(echo "$SIGNIN_RESPONSE" | jq -r '.token // empty')
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to authenticate with Open WebUI."
  echo "    Check admin credentials and try again."
  exit 1
fi

echo "==> Authenticated successfully."

# ── Helper: create model preset ──────────────────────────────────────────────

create_model_preset() {
  local id="$1"
  local name="$2"
  local base_model_id="$3"
  local description="$4"

  echo "    Creating model preset: ${name} (${id})..."

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPENWEBUI_URL}/api/v1/models/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$(jq -n \
      --arg id "$id" \
      --arg name "$name" \
      --arg base_model_id "$base_model_id" \
      --arg description "$description" \
      --arg system_prompt "$SYSTEM_PROMPT" \
      '{
        id: $id,
        name: $name,
        base_model_id: $base_model_id,
        is_active: true,
        meta: {
          description: $description
        },
        params: {
          system: $system_prompt
        }
      }')")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "    Created ${name}."
  else
    # Check if model already exists
    ERROR_MSG=$(echo "$BODY" | jq -r '.detail // .message // empty' 2>/dev/null)
    echo "    Skipped ${name} (${HTTP_CODE}: ${ERROR_MSG:-already exists or error})."
  fi
}

# ── Step 3: Create model presets ─────────────────────────────────────────────

echo "==> Creating model presets..."

create_model_preset \
  "dynamo-claude-opus" \
  "Claude Opus 4" \
  "claude-opus-4-20250514" \
  "Most capable model. Best for complex analysis, research, and nuanced writing."

create_model_preset \
  "dynamo-claude-sonnet" \
  "Claude Sonnet 4" \
  "claude-sonnet-4-20250514" \
  "Balanced model. Great for everyday tasks, coding, and general assistance."

create_model_preset \
  "dynamo-claude-haiku" \
  "Claude Haiku 4" \
  "claude-haiku-4-20250514" \
  "Fastest model. Ideal for quick answers, summarization, and lightweight tasks."

echo "==> Model presets configured."

# ── Step 4: Set default model and ordering ───────────────────────────────────

echo "==> Setting default model and ordering..."

curl -sf -X POST "${OPENWEBUI_URL}/api/v1/configs/models" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "DEFAULT_MODELS": "dynamo-claude-sonnet",
    "MODEL_ORDER_LIST": ["dynamo-claude-sonnet", "dynamo-claude-opus", "dynamo-claude-haiku"]
  }' > /dev/null

echo "==> Default model set to Claude Sonnet 4."

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "==> Open WebUI configuration complete!"
echo "    URL:      ${OPENWEBUI_URL}"
echo "    Email:    ${OPENWEBUI_ADMIN_EMAIL}"
echo "    Password: ${OPENWEBUI_ADMIN_PASSWORD}"
echo ""
echo "    Models available:"
echo "      - Claude Sonnet 4 (default)"
echo "      - Claude Opus 4"
echo "      - Claude Haiku 4"

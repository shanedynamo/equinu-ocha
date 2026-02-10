#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh -- End-to-end smoke tests for Dynamo AI Platform
# =============================================================================
# Usage:
#   ./scripts/smoke-test.sh
#
# Prerequisites:
#   - All services running via docker compose
#   - curl, jq, psql available on PATH
#   - ANTHROPIC_API_KEY set in the Claude Engine container
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed
# =============================================================================
set -uo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

ENGINE_URL="${ENGINE_URL:-http://localhost:3001}"
OPENWEBUI_URL="${OPENWEBUI_URL:-http://localhost:8080}"
SUPERSET_URL="${SUPERSET_URL:-http://localhost:8088}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-dynamo_ai}"
DB_USER="${DB_USER:-dynamo}"
DB_PASSWORD="${DB_PASSWORD:-localdev}"

REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Test identity (unique to avoid collisions with real users)
TEST_USER_EMAIL="smoke-test@dynamo-ai.local"
TEST_USER_ID="$TEST_USER_EMAIL"
ENGINEER_EMAIL="engineer-smoke@dynamo-ai.local"
API_KEY_EMAIL="smoke-apikey@dynamo-ai.local"

MODEL_OPUS="claude-opus-4-20250514"
MODEL_SONNET="claude-sonnet-4-20250514"
MODEL_HAIKU="claude-haiku-4-20250514"

# Fire-and-forget DB writes need time to propagate
ASYNC_WAIT="${ASYNC_WAIT:-3}"

# ── Results tracking ─────────────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0
TEST_RESULTS=()

record_pass() {
  local name="$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  TEST_RESULTS+=("[PASS] $name")
  echo "  [PASS] $name"
}

record_fail() {
  local name="$1"
  local detail="${2:-}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  if [ -n "$detail" ]; then
    TEST_RESULTS+=("[FAIL] $name -- $detail")
    echo "  [FAIL] $name -- $detail"
  else
    TEST_RESULTS+=("[FAIL] $name")
    echo "  [FAIL] $name"
  fi
}

# ── Helper functions ─────────────────────────────────────────────────────────

check_dependencies() {
  local missing=0
  for cmd in curl jq psql; do
    if ! command -v "$cmd" &>/dev/null; then
      echo "ERROR: Required command '$cmd' is not installed."
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    exit 1
  fi
}

db_query() {
  PGPASSWORD="$DB_PASSWORD" psql \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -tAc "$1" 2>/dev/null
}

# HTTP helpers — capture body, status code, and headers
# After calling, read: HTTP_BODY, HTTP_CODE, HTTP_HEADERS

HTTP_BODY=""
HTTP_CODE=""
HTTP_HEADERS=""

http_get() {
  local url="$1"; shift
  local tmpfile
  tmpfile=$(mktemp)
  local raw
  raw=$(curl -s -D "$tmpfile" -w "\n%{http_code}" "$@" "$url") || true
  HTTP_CODE=$(echo "$raw" | tail -1)
  HTTP_BODY=$(echo "$raw" | sed '$d')
  HTTP_HEADERS=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

http_post() {
  local url="$1"; shift
  local body="$1"; shift
  local tmpfile
  tmpfile=$(mktemp)
  local raw
  raw=$(curl -s -D "$tmpfile" -w "\n%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    -d "$body" "$@" "$url") || true
  HTTP_CODE=$(echo "$raw" | tail -1)
  HTTP_BODY=$(echo "$raw" | sed '$d')
  HTTP_HEADERS=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

http_delete() {
  local url="$1"; shift
  local tmpfile
  tmpfile=$(mktemp)
  local raw
  raw=$(curl -s -D "$tmpfile" -w "\n%{http_code}" \
    -X DELETE "$@" "$url") || true
  HTTP_CODE=$(echo "$raw" | tail -1)
  HTTP_BODY=$(echo "$raw" | sed '$d')
  HTTP_HEADERS=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

get_header() {
  echo "$HTTP_HEADERS" | grep -i "^$1:" | sed 's/^[^:]*: *//' | tr -d '\r'
}

# ── Section 1: Service Health Checks ─────────────────────────────────────────

test_service_health() {
  echo ""
  echo "==> Section 1: Service Health Checks"

  # 1a. Claude Engine
  http_get "${ENGINE_URL}/health"
  if [ "$HTTP_CODE" = "200" ]; then
    local status version
    status=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    version=$(echo "$HTTP_BODY" | jq -r '.version // empty')
    if [ "$status" = "ok" ] && [ -n "$version" ]; then
      record_pass "Claude Engine health (v${version})"
    else
      record_fail "Claude Engine health" "status=$status, version=$version"
    fi
  else
    record_fail "Claude Engine health" "HTTP $HTTP_CODE"
  fi

  # 1b. PostgreSQL
  if PGPASSWORD="$DB_PASSWORD" pg_isready \
       -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; then
    record_pass "PostgreSQL ready"
  else
    record_fail "PostgreSQL ready" "pg_isready failed"
  fi

  # 1c. Redis
  if command -v redis-cli &>/dev/null; then
    local pong
    pong=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null) || true
    if [ "$pong" = "PONG" ]; then
      record_pass "Redis ping"
    else
      record_fail "Redis ping" "Expected PONG, got: $pong"
    fi
  else
    # Fallback: TCP connect check
    if (echo > "/dev/tcp/${REDIS_HOST}/${REDIS_PORT}") 2>/dev/null; then
      record_pass "Redis reachable (TCP, redis-cli not installed)"
    else
      record_fail "Redis reachable" "Cannot connect to ${REDIS_HOST}:${REDIS_PORT}"
    fi
  fi

  # 1d. Open WebUI
  http_get "${OPENWEBUI_URL}/health"
  if [ "$HTTP_CODE" = "200" ]; then
    record_pass "Open WebUI health"
  else
    record_fail "Open WebUI health" "HTTP $HTTP_CODE"
  fi

  # 1e. Superset
  http_get "${SUPERSET_URL}/health"
  if [ "$HTTP_CODE" = "200" ]; then
    record_pass "Superset health"
  else
    record_fail "Superset health" "HTTP $HTTP_CODE"
  fi
}

# ── Section 2: Chat Completions (Business User) ─────────────────────────────

test_chat_completions() {
  echo ""
  echo "==> Section 2: Chat Completions (business user)"

  local before_ts
  before_ts=$(date -u +"%Y-%m-%dT%H:%M:%S")

  http_post "${ENGINE_URL}/v1/chat/completions" \
    "$(jq -n --arg model "$MODEL_SONNET" '{
      model: $model,
      messages: [{role: "user", content: "Say exactly: SMOKE_TEST_OK"}],
      max_tokens: 64
    }')" \
    -H "X-Mock-User-Email: ${TEST_USER_EMAIL}" \
    -H "X-Mock-User-Role: business"

  if [ "$HTTP_CODE" != "200" ]; then
    local err_msg
    err_msg=$(echo "$HTTP_BODY" | jq -r '.error.message // empty' 2>/dev/null)
    record_fail "Chat completion request" "HTTP $HTTP_CODE: $err_msg"
    return
  fi

  # 2a. Response shape
  local resp_obj resp_id content
  resp_obj=$(echo "$HTTP_BODY" | jq -r '.object // empty')
  resp_id=$(echo "$HTTP_BODY" | jq -r '.id // empty')
  content=$(echo "$HTTP_BODY" | jq -r '.choices[0].message.content // empty')

  if [ "$resp_obj" = "chat.completion" ] && [ -n "$resp_id" ] && [ -n "$content" ]; then
    record_pass "Response shape (id=$resp_id)"
  else
    record_fail "Response shape" "object=$resp_obj, id=$resp_id"
  fi

  # 2b. Usage fields
  local prompt_tokens completion_tokens
  prompt_tokens=$(echo "$HTTP_BODY" | jq -r '.usage.prompt_tokens // 0')
  completion_tokens=$(echo "$HTTP_BODY" | jq -r '.usage.completion_tokens // 0')

  if [ "$prompt_tokens" -gt 0 ] 2>/dev/null && [ "$completion_tokens" -gt 0 ] 2>/dev/null; then
    record_pass "Usage tokens (in=$prompt_tokens, out=$completion_tokens)"
  else
    record_fail "Usage tokens" "prompt=$prompt_tokens, completion=$completion_tokens"
  fi

  # Wait for fire-and-forget DB writes
  echo "  (waiting ${ASYNC_WAIT}s for async DB writes...)"
  sleep "$ASYNC_WAIT"

  # 2c. Audit log written
  local audit_count
  audit_count=$(db_query \
    "SELECT COUNT(*) FROM audit_logs WHERE user_email = '${TEST_USER_EMAIL}' AND timestamp >= '${before_ts}' AND status = 'success';")

  if [ "${audit_count:-0}" -ge 1 ] 2>/dev/null; then
    record_pass "Audit log written (count=$audit_count)"
  else
    record_fail "Audit log written" "Expected >= 1, got ${audit_count:-null}"
  fi

  # 2d. Audit source detection (curl User-Agent -> cli)
  local audit_source
  audit_source=$(db_query \
    "SELECT source FROM audit_logs WHERE user_email = '${TEST_USER_EMAIL}' AND timestamp >= '${before_ts}' ORDER BY id DESC LIMIT 1;")

  if [ "$audit_source" = "cli" ]; then
    record_pass "Audit source=cli (curl User-Agent)"
  else
    record_fail "Audit source=cli" "Got '$audit_source'"
  fi

  # 2e. Token usage recorded
  local usage_count
  usage_count=$(db_query \
    "SELECT COUNT(*) FROM token_usage WHERE user_id = '${TEST_USER_ID}' AND created_at >= '${before_ts}';")

  if [ "${usage_count:-0}" -ge 1 ] 2>/dev/null; then
    record_pass "Token usage recorded (count=$usage_count)"
  else
    record_fail "Token usage recorded" "Expected >= 1, got ${usage_count:-null}"
  fi
}

# ── Section 3: Model Routing ─────────────────────────────────────────────────

test_model_routing() {
  echo ""
  echo "==> Section 3: Model Routing"

  # 3a-b. Business user requests Opus -> downgraded to Sonnet
  http_post "${ENGINE_URL}/v1/chat/completions" \
    "$(jq -n --arg model "$MODEL_OPUS" '{
      model: $model,
      messages: [{role: "user", content: "Say exactly: DOWNGRADE_TEST"}],
      max_tokens: 64
    }')" \
    -H "X-Mock-User-Email: ${TEST_USER_EMAIL}" \
    -H "X-Mock-User-Role: business"

  if [ "$HTTP_CODE" = "200" ]; then
    local downgraded
    downgraded=$(get_header "X-Model-Downgraded")
    if [ "$downgraded" = "true" ]; then
      record_pass "Business Opus -> downgraded (X-Model-Downgraded: true)"
    else
      record_fail "Business Opus -> downgraded" "Header missing or not 'true'"
    fi

    local resolved_model
    resolved_model=$(echo "$HTTP_BODY" | jq -r '.model // empty')
    if echo "$resolved_model" | grep -q "sonnet"; then
      record_pass "Business Opus -> resolved to Sonnet ($resolved_model)"
    else
      record_fail "Business Opus -> resolved to Sonnet" "Got $resolved_model"
    fi
  else
    record_fail "Business Opus request" "HTTP $HTTP_CODE"
    record_fail "Business Opus resolve" "Skipped (request failed)"
  fi

  # 3c-d. Engineer requests Opus -> no downgrade
  http_post "${ENGINE_URL}/v1/chat/completions" \
    "$(jq -n --arg model "$MODEL_OPUS" '{
      model: $model,
      messages: [{role: "user", content: "Say exactly: ENGINEER_OPUS_TEST"}],
      max_tokens: 64
    }')" \
    -H "X-Mock-User-Email: ${ENGINEER_EMAIL}" \
    -H "X-Mock-User-Role: engineer"

  if [ "$HTTP_CODE" = "200" ]; then
    local downgraded
    downgraded=$(get_header "X-Model-Downgraded")
    if [ -z "$downgraded" ]; then
      record_pass "Engineer Opus -> no downgrade"
    else
      record_fail "Engineer Opus -> no downgrade" "X-Model-Downgraded='$downgraded'"
    fi

    local resolved_model
    resolved_model=$(echo "$HTTP_BODY" | jq -r '.model // empty')
    if echo "$resolved_model" | grep -q "opus"; then
      record_pass "Engineer Opus -> resolved to Opus ($resolved_model)"
    else
      record_fail "Engineer Opus -> resolved to Opus" "Got $resolved_model"
    fi
  else
    record_fail "Engineer Opus request" "HTTP $HTTP_CODE"
    record_fail "Engineer Opus resolve" "Skipped (request failed)"
  fi
}

# ── Section 4: Sensitive Data Detection ──────────────────────────────────────

test_sensitive_data() {
  echo ""
  echo "==> Section 4: Sensitive Data Detection"

  # Send a fake AWS access key (AKIA + 16 uppercase alphanumeric)
  http_post "${ENGINE_URL}/v1/chat/completions" \
    "$(jq -n '{
      model: "claude-sonnet-4-20250514",
      messages: [{role: "user", content: "Here is my AWS key: AKIAIOSFODNN7EXAMPLE"}]
    }')" \
    -H "X-Mock-User-Email: ${TEST_USER_EMAIL}" \
    -H "X-Mock-User-Role: business"

  # 4a. Should return 400
  if [ "$HTTP_CODE" = "400" ]; then
    record_pass "Sensitive data blocked (HTTP 400)"
  else
    record_fail "Sensitive data blocked" "Expected 400, got HTTP $HTTP_CODE"
  fi

  # 4b. Error code
  local error_code
  error_code=$(echo "$HTTP_BODY" | jq -r '.error.code // empty')
  if [ "$error_code" = "sensitive_data_blocked" ]; then
    record_pass "Error code=sensitive_data_blocked"
  else
    record_fail "Error code=sensitive_data_blocked" "Got '$error_code'"
  fi

  # 4c. Error message mentions the finding
  local error_message
  error_message=$(echo "$HTTP_BODY" | jq -r '.error.message // empty')
  if echo "$error_message" | grep -qi "AWS"; then
    record_pass "Error message mentions AWS key"
  else
    record_fail "Error message mentions AWS key" "message: $error_message"
  fi
}

# ── Section 5: Budget Tracking ───────────────────────────────────────────────

test_budget_tracking() {
  echo ""
  echo "==> Section 5: Budget Tracking"

  # Budget endpoint uses :userId in the path. In mock auth, userId = email.
  http_get "${ENGINE_URL}/v1/budget/${TEST_USER_ID}" \
    -H "X-Mock-User-Email: ${TEST_USER_EMAIL}" \
    -H "X-Mock-User-Role: business"

  if [ "$HTTP_CODE" != "200" ]; then
    record_fail "Budget endpoint" "HTTP $HTTP_CODE"
    return
  fi

  # 5a. Response structure
  local user_id period_start reset_date
  user_id=$(echo "$HTTP_BODY" | jq -r '.userId // empty')
  period_start=$(echo "$HTTP_BODY" | jq -r '.periodStart // empty')
  reset_date=$(echo "$HTTP_BODY" | jq -r '.resetDate // empty')

  if [ -n "$user_id" ] && [ -n "$period_start" ] && [ -n "$reset_date" ]; then
    record_pass "Budget response structure (userId=$user_id)"
  else
    record_fail "Budget response structure" "userId=$user_id, periodStart=$period_start"
  fi

  # 5b. Usage reflects test requests (should be > 0)
  local current_usage
  current_usage=$(echo "$HTTP_BODY" | jq -r '.currentUsage // 0')
  if [ "$current_usage" -gt 0 ] 2>/dev/null; then
    record_pass "Budget reflects usage (currentUsage=$current_usage)"
  else
    record_fail "Budget reflects usage" "currentUsage=$current_usage (expected > 0)"
  fi

  # 5c. Role and monthly limit (business = 200,000)
  local role monthly_limit
  role=$(echo "$HTTP_BODY" | jq -r '.role // empty')
  monthly_limit=$(echo "$HTTP_BODY" | jq -r '.monthlyLimit // empty')
  if [ "$role" = "business" ] && [ "$monthly_limit" = "200000" ]; then
    record_pass "Budget role=business, limit=200000"
  else
    record_fail "Budget role and limit" "role=$role, limit=$monthly_limit"
  fi

  # 5d. Not exceeded (only used a few hundred tokens)
  local exceeded
  exceeded=$(echo "$HTTP_BODY" | jq -r '.exceeded // empty')
  if [ "$exceeded" = "false" ]; then
    record_pass "Budget not exceeded"
  else
    record_fail "Budget not exceeded" "exceeded=$exceeded"
  fi
}

# ── Section 6: API Key Auth ──────────────────────────────────────────────────

test_api_key_auth() {
  echo ""
  echo "==> Section 6: API Key Auth"

  # 6a. Create an API key (requires admin role)
  http_post "${ENGINE_URL}/v1/admin/api-keys" \
    "$(jq -n --arg email "$API_KEY_EMAIL" '{user_email: $email, role: "engineer"}')" \
    -H "X-Mock-User-Email: admin@dynamo-ai.local" \
    -H "X-Mock-User-Role: admin"

  local key_id="" raw_key=""

  if [ "$HTTP_CODE" = "201" ]; then
    key_id=$(echo "$HTTP_BODY" | jq -r '.id // empty')
    raw_key=$(echo "$HTTP_BODY" | jq -r '.key // empty')
    local key_role key_email
    key_role=$(echo "$HTTP_BODY" | jq -r '.role // empty')
    key_email=$(echo "$HTTP_BODY" | jq -r '.user_email // empty')

    if [ -n "$key_id" ] && [ -n "$raw_key" ] && [ "$key_role" = "engineer" ] && [ "$key_email" = "$API_KEY_EMAIL" ]; then
      record_pass "Create API key (id=$key_id, prefix=${raw_key:0:12}...)"
    else
      record_fail "Create API key" "id=$key_id, role=$key_role, email=$key_email"
    fi
  else
    record_fail "Create API key" "HTTP $HTTP_CODE"
    echo "  (skipping remaining API key tests -- creation failed)"
    return
  fi

  # 6b. Use the API key for a chat completion
  local before_ts
  before_ts=$(date -u +"%Y-%m-%dT%H:%M:%S")

  http_post "${ENGINE_URL}/v1/chat/completions" \
    "$(jq -n --arg model "$MODEL_HAIKU" '{
      model: $model,
      messages: [{role: "user", content: "Say exactly: API_KEY_TEST"}],
      max_tokens: 64
    }')" \
    -H "Authorization: Bearer ${raw_key}"

  if [ "$HTTP_CODE" = "200" ]; then
    local content
    content=$(echo "$HTTP_BODY" | jq -r '.choices[0].message.content // empty')
    if [ -n "$content" ]; then
      record_pass "Chat with API key (HTTP 200, got response)"
    else
      record_fail "Chat with API key" "HTTP 200 but empty content"
    fi
  else
    record_fail "Chat with API key" "HTTP $HTTP_CODE"
  fi

  # 6c. Verify audit log has source=cli and correct user
  echo "  (waiting ${ASYNC_WAIT}s for async DB writes...)"
  sleep "$ASYNC_WAIT"

  local api_source api_email
  api_source=$(db_query \
    "SELECT source FROM audit_logs WHERE user_email = '${API_KEY_EMAIL}' AND timestamp >= '${before_ts}' ORDER BY id DESC LIMIT 1;")
  api_email=$(db_query \
    "SELECT user_email FROM audit_logs WHERE user_email = '${API_KEY_EMAIL}' AND timestamp >= '${before_ts}' ORDER BY id DESC LIMIT 1;")

  if [ "$api_source" = "cli" ] && [ "$api_email" = "$API_KEY_EMAIL" ]; then
    record_pass "API key audit (source=cli, email=$api_email)"
  else
    record_fail "API key audit" "source='$api_source', email='$api_email'"
  fi

  # 6d. Revoke the API key
  http_delete "${ENGINE_URL}/v1/admin/api-keys/${key_id}" \
    -H "X-Mock-User-Email: admin@dynamo-ai.local" \
    -H "X-Mock-User-Role: admin"

  if [ "$HTTP_CODE" = "200" ]; then
    local revoked
    revoked=$(echo "$HTTP_BODY" | jq -r '.revoked // empty')
    if [ "$revoked" = "true" ]; then
      record_pass "Revoke API key (id=$key_id)"
    else
      record_fail "Revoke API key" "revoked=$revoked"
    fi
  else
    record_fail "Revoke API key" "HTTP $HTTP_CODE"
  fi

  # 6e. Verify revoked key is rejected
  http_post "${ENGINE_URL}/v1/chat/completions" \
    '{"model":"claude-haiku-4-20250514","messages":[{"role":"user","content":"test"}]}' \
    -H "Authorization: Bearer ${raw_key}"

  if [ "$HTTP_CODE" = "401" ]; then
    record_pass "Revoked key returns 401"
  else
    record_fail "Revoked key returns 401" "Got HTTP $HTTP_CODE"
  fi
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

cleanup_test_data() {
  echo ""
  echo "==> Cleanup: Removing smoke test data"

  local test_emails="'${TEST_USER_EMAIL}','${ENGINEER_EMAIL}','${API_KEY_EMAIL}'"

  db_query "DELETE FROM audit_logs WHERE user_email IN (${test_emails});" || true
  db_query "DELETE FROM token_usage WHERE user_id IN (${test_emails});" || true
  db_query "DELETE FROM user_budgets WHERE user_id IN (${test_emails});" || true
  db_query "DELETE FROM api_keys WHERE user_email IN (${test_emails});" || true
  db_query "DELETE FROM user_profiles WHERE email IN (${test_emails});" || true

  echo "  Done."
}

# ── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
  local total=$((PASS_COUNT + FAIL_COUNT))

  echo ""
  echo "============================================================================="
  echo "  SMOKE TEST RESULTS"
  echo "============================================================================="

  for result in "${TEST_RESULTS[@]}"; do
    echo "  $result"
  done

  echo ""
  echo "  Total: ${PASS_COUNT}/${total} passed"

  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "  Status: FAILED (${FAIL_COUNT} failure(s))"
  else
    echo "  Status: ALL PASSED"
  fi
  echo "============================================================================="
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  check_dependencies

  echo "============================================================================="
  echo "  Dynamo AI Platform -- Smoke Tests"
  echo "============================================================================="
  echo "  Engine:    ${ENGINE_URL}"
  echo "  WebUI:     ${OPENWEBUI_URL}"
  echo "  Superset:  ${SUPERSET_URL}"
  echo "  Postgres:  ${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "  Redis:     ${REDIS_HOST}:${REDIS_PORT}"
  echo "  Test user: ${TEST_USER_EMAIL}"
  echo "============================================================================="

  test_service_health
  test_chat_completions
  test_model_routing
  test_sensitive_data
  test_budget_tracking
  test_api_key_auth

  cleanup_test_data
  print_summary

  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

main "$@"

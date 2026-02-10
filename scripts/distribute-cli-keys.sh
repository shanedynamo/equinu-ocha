#!/usr/bin/env bash
set -euo pipefail

# Distributes per-user Claude API keys via AWS Secrets Manager.
# Usage: distribute-cli-keys.sh <users-csv>
#   CSV format: email,api_key

CSV_FILE="${1:?Usage: distribute-cli-keys.sh <users.csv>}"
SECRET_PREFIX="dynamo-ai/cli-keys"

echo "==> Distributing CLI keys from ${CSV_FILE}..."

while IFS=, read -r email api_key; do
  [ -z "$email" ] && continue
  secret_name="${SECRET_PREFIX}/${email}"
  echo "  Storing key for ${email}..."
  aws secretsmanager create-secret \
    --name "$secret_name" \
    --secret-string "$api_key" \
    --description "Claude API key for ${email}" \
    2>/dev/null \
  || aws secretsmanager update-secret \
    --secret-id "$secret_name" \
    --secret-string "$api_key"
done < "$CSV_FILE"

echo "==> Done. ${CSV_FILE} keys distributed."

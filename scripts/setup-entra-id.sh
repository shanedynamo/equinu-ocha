#!/usr/bin/env bash
set -euo pipefail

# Registers an Entra ID (Azure AD) app for the Dynamo AI Platform.
# Requires: az CLI authenticated with sufficient privileges.

APP_NAME="${1:-dynamo-ai-platform}"
REDIRECT_URI="${2:-http://localhost:3000/auth/callback}"

echo "==> Creating Entra ID app registration: ${APP_NAME}..."

APP_ID=$(az ad app create \
  --display-name "$APP_NAME" \
  --web-redirect-uris "$REDIRECT_URI" \
  --query appId -o tsv)

echo "==> App registered. Client ID: ${APP_ID}"

echo "==> Creating client secret..."
SECRET=$(az ad app credential reset \
  --id "$APP_ID" \
  --query password -o tsv)

TENANT_ID=$(az account show --query tenantId -o tsv)

echo ""
echo "Add these to your .env:"
echo "  AZURE_AD_CLIENT_ID=${APP_ID}"
echo "  AZURE_AD_CLIENT_SECRET=${SECRET}"
echo "  AZURE_AD_TENANT_ID=${TENANT_ID}"

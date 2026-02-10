#!/usr/bin/env bash
set -euo pipefail

ENV="${1:?Usage: deploy.sh <dev|prod>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Deploying dynamo-ai-platform to ${ENV}..."

# Build images
echo "==> Building Docker images..."
if [ "$ENV" = "prod" ]; then
  docker compose -f "$ROOT_DIR/docker-compose.yml" \
                 -f "$ROOT_DIR/docker-compose.prod.yml" \
                 build
else
  docker compose -f "$ROOT_DIR/docker-compose.yml" build
fi

# Apply Terraform
echo "==> Applying Terraform for ${ENV}..."
cd "$ROOT_DIR/terraform/environments/$ENV"
terraform init -upgrade
terraform apply -auto-approve

echo "==> Deployment to ${ENV} complete."

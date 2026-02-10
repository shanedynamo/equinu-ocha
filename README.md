```
╔═══════════════════════════════════════════╗
║   ___              _           _          ║
║  | _ \ _ _  ___   (_) ___  __ | |_        ║
║  |  _/| '_|/ _ \  | |/ -_)/ _||  _|       ║
║  |_|  |_|  \___/ _/ |\___|\__| \__|       ║
║               |__/                        ║
║   ___          _                 ___  _   ║
║  | __|  __ _ _(_) _ _   ___  _ | _ \| |  ║
║  | _|  / _` | | || ' \ (_-< | || _ \| |  ║
║  |___| \__, |_|_||_||_|/__/  \_/|___/|_|  ║
║           |_|                             ║
║                ___       _                ║
║               / _ \  __ | |_   __ _       ║
║              | (_) |/ _|| ' \ / _` |      ║
║               \___/ \__||_||_|\__,_|      ║
╚═══════════════════════════════════════════╝
```

# Dynamo AI Platform

Enterprise middleware for managed Claude AI access — authentication via Entra ID, usage analytics via Superset, and infrastructure on AWS.

## Project Structure

```
dynamo-ai-platform/
├─ docker-compose.yml          # Local development services
├─ docker-compose.prod.yml     # Production overrides
├─ .env.example                # Environment variable template
│
├─ claude-engine/              # Node.js/Express middleware
│  ├─ src/
│  │  ├─ index.ts              # App entrypoint
│  │  ├─ config/               # Env validation & logger
│  │  ├─ middleware/            # Error handling, auth, rate limiting
│  │  ├─ routes/               # HTTP route handlers
│  │  ├─ services/             # Business logic (Claude API, DB)
│  │  └─ types/                # TypeScript type definitions
│  └─ tests/                   # Unit & integration tests
│
├─ analytics/                  # Apache Superset configuration
│  ├─ Dockerfile
│  └─ superset_config.py
│
├─ terraform/                  # AWS infrastructure-as-code
│  ├─ environments/
│  │  ├─ dev/
│  │  └─ prod/
│  └─ modules/
│     ├─ networking/           # VPC, subnets, security groups
│     ├─ compute/              # ECS tasks & services
│     ├─ database/             # RDS PostgreSQL
│     ├─ observability/        # CloudWatch, dashboards, alarms
│     └─ security/             # IAM, secrets, SNS alerts
│
├─ scripts/                    # Operational helpers
│  ├─ deploy.sh                # Build & deploy to dev or prod
│  ├─ setup-entra-id.sh        # Register Entra ID app
│  ├─ distribute-cli-keys.sh   # Push per-user API keys to Secrets Manager
│  └─ smoke-test.sh            # End-to-end smoke tests for the local stack
│
└─ docs/
   ├─ architecture.md          # System design overview
   ├─ user-guide.md            # End-user documentation
   └─ admin-guide.md           # Admin & ops runbook
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2
- [Node.js](https://nodejs.org/) >= 22 (for local development without Docker)
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.6 (for infrastructure)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) (for Entra ID setup)
- [AWS CLI](https://aws.amazon.com/cli/) (for deployment and key distribution)

## Local Development

### 1. Clone and configure

```bash
git clone <repo-url> && cd dynamo-ai-platform
cp .env.example .env
# Fill in the required values in .env
```

### 2. Start services

```bash
docker compose up
```

This starts:

| Service          | URL                        |
| ---------------- | -------------------------- |
| Claude Engine    | http://localhost:3000       |
| PostgreSQL       | localhost:5432              |
| Redis            | localhost:6379              |
| Superset         | http://localhost:8088       |

### 3. Develop without Docker (optional)

```bash
cd claude-engine
npm install
npm run dev          # starts with hot-reload via tsx
npm test             # runs vitest
```

### 4. Verify

```bash
curl http://localhost:3001/health
# => {"status":"ok"}
```

### 5. Smoke tests

Validate the full stack end-to-end:

```bash
docker compose up -d && sleep 30 && ./scripts/smoke-test.sh
```

This runs 27 assertions across service health, API proxying, model routing,
sensitive data detection, budget tracking, and API key auth.
Requires `curl`, `jq`, and `psql`.

## Deployment

```bash
# Dev environment
./scripts/deploy.sh dev

# Production
./scripts/deploy.sh prod
```

See [docs/admin-guide.md](docs/admin-guide.md) for Entra ID setup, key distribution, and monitoring.

## Documentation

- [Architecture](docs/architecture.md) — system design and data flow
- [User Guide](docs/user-guide.md) — end-user quickstart
- [Admin Guide](docs/admin-guide.md) — operations and configuration

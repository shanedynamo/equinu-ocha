# Architecture

This document describes the high-level architecture of the Dynamo AI Platform.

## Components

- **Claude Engine** — Node.js/Express middleware that proxies requests to the Anthropic API, enforces authentication via Entra ID, and logs usage to PostgreSQL.
- **Analytics (Superset)** — Apache Superset dashboards connected to the shared PostgreSQL database for usage analytics and cost reporting.
- **PostgreSQL** — Primary datastore for conversation logs, user records, and audit trails.
- **Redis** — Session cache and rate-limiting store.
- **Terraform** — Infrastructure-as-code for AWS (VPC, ECS, RDS, CloudWatch, SNS alerts).

## Data Flow

1. User authenticates via Entra ID (Azure AD).
2. Requests are sent to Claude Engine which validates the session, applies rate limits, and forwards prompts to the Anthropic API.
3. Responses and metadata are logged to PostgreSQL.
4. Superset reads from PostgreSQL for analytics dashboards.
5. Security events publish to SNS for alerting.

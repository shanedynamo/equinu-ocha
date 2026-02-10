# Admin Guide

## Accessing the Admin Panel

Open WebUI serves as the chat frontend for Dynamo AI. After running `docker compose up`, access it at:

- **URL**: [http://localhost:8080](http://localhost:8080)
- **Email**: `admin@dynamo-ai.local` (or the value of `OPENWEBUI_ADMIN_EMAIL` in `.env`)
- **Password**: `admin` (or the value of `OPENWEBUI_ADMIN_PASSWORD` in `.env`)

The first user account is automatically created as an admin on first boot. Public signup is disabled by default (`ENABLE_SIGNUP=false`).

## Initial Setup

After starting the platform with `docker compose up -d`, run the configuration script to set up model presets and defaults:

```bash
./scripts/configure-openwebui.sh
```

This script:
1. Waits for Open WebUI to be ready
2. Authenticates as the admin user
3. Creates model presets for Claude Opus 4, Sonnet 4, and Haiku 4
4. Sets Claude Sonnet 4 as the default model

You can customize the admin credentials by setting environment variables before running:

```bash
OPENWEBUI_ADMIN_EMAIL=admin@example.com \
OPENWEBUI_ADMIN_PASSWORD=secure-password \
./scripts/configure-openwebui.sh
```

**Prerequisites**: `curl` and `jq` must be installed on the host.

## Managing Models

Models are configured as presets in Open WebUI, each mapping to an underlying Claude model via Claude Engine.

**Preconfigured presets** (created by `configure-openwebui.sh`):

| Preset | Base Model | Use Case |
|--------|-----------|----------|
| Claude Sonnet 4 (default) | `claude-sonnet-4-20250514` | Everyday tasks, coding, general assistance |
| Claude Opus 4 | `claude-opus-4-20250514` | Complex analysis, research, nuanced writing |
| Claude Haiku 4 | `claude-haiku-4-20250514` | Quick answers, summarization, lightweight tasks |

**To manage models in the UI:**

1. Log in as admin
2. Navigate to **Admin Panel** > **Workspace** > **Models**
3. From here you can:
   - Edit existing presets (name, description, system prompt)
   - Toggle models active/inactive
   - Change the default model
   - Create new presets pointing to different base models

**System prompts**: Each model preset includes a per-model system prompt. Edit the preset to customize it. There is no global system prompt setting — it must be configured per model.

## Updating Branding

**App name**: Set via the `WEBUI_NAME` environment variable in `docker-compose.yml` (currently `"Dynamo AI"`). Changing this requires a container restart.

**Logo**: Upload a custom logo through the admin panel:

1. Log in as admin
2. Navigate to **Admin Panel** > **Settings** > **Interface**
3. Upload your logo image

A placeholder SVG logo is available at `docs/assets/dynamo-logo.svg`.

## Managing Users and Roles

**Creating users**: With `ENABLE_SIGNUP=false`, admins must create user accounts manually:

1. Navigate to **Admin Panel** > **Users**
2. Click **Add User** and fill in the details
3. Assign a role: **Admin**, **User**, or **Pending**

**Roles**:
- **Admin**: Full access to settings, models, and user management
- **User**: Can chat with available models
- **Pending**: Account created but not yet approved

**Enabling self-registration**: If you want users to sign up on their own, set `ENABLE_SIGNUP: "true"` in the `open-webui` service in `docker-compose.yml` and restart.

**OAuth / Entra ID**: For SSO via Microsoft Entra ID, see the [Entra ID Setup](#entra-id-setup) section below.

## Installing Plugins

The platform includes two Open WebUI plugins that integrate with Claude Engine. The plugin source files are mounted into the Open WebUI container at `/app/plugins/` for reference.

### Claude Engine Pipe (Required)

This pipe routes all chat requests through Claude Engine for budget enforcement, audit logging, and access control.

1. Log in as admin
2. Navigate to **Admin Panel** > **Settings** > **Functions**
3. Click **Add (+)**
4. Paste the contents of `open-webui-pipeline/claude_engine_pipe.py`
5. Set the function type to **Pipe**
6. Click **Save**

The pipe registers three models: Claude Sonnet 4, Claude Opus 4, and Claude Haiku 4. Configure the **CLAUDE_ENGINE_URL** valve if your Claude Engine runs at a different address (default: `http://claude-engine:3001`).

### Budget Check Function (Optional)

Lets users check their token budget by selecting "Budget Check" as a model in the chat interface.

1. Navigate to **Admin Panel** > **Settings** > **Functions**
2. Click **Add (+)**
3. Paste the contents of `open-webui-functions/budget_check.py`
4. Set the function type to **Pipe**
5. Click **Save**

Users can then select **Budget Check** from the model dropdown to see their current usage, monthly limit, and remaining budget.

### Plugin Configuration

Both plugins support configurable valves (settings) accessible from the function editor:

| Valve | Default | Description |
|-------|---------|-------------|
| `CLAUDE_ENGINE_URL` | `http://claude-engine:3001` | Claude Engine base URL |
| `REQUEST_TIMEOUT` | `120` (pipe) / `10` (budget) | HTTP timeout in seconds |
| `SHOW_USAGE_FOOTER` | `true` (pipe only) | Append token usage info to responses |

## Entra ID Setup

Run the setup script to register the application:

```bash
./scripts/setup-entra-id.sh dynamo-ai-platform http://localhost:3000/auth/callback
```

Copy the output values into your `.env` file.

## Distributing CLI Keys

Prepare a CSV file with `email,api_key` rows, then run:

```bash
./scripts/distribute-cli-keys.sh users.csv
```

## Deployment

```bash
# Dev
./scripts/deploy.sh dev

# Production
./scripts/deploy.sh prod
```

## Monitoring

- Application logs: `docker compose logs -f claude-engine`
- Chat frontend logs: `docker compose logs -f open-webui`
- Analytics dashboard: `http://localhost:8088`
- AWS SNS alerts are configured via the `SNS_SECURITY_TOPIC_ARN` environment variable.

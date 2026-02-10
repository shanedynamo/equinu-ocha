#!/usr/bin/env python3
"""
init-dashboards.py — Create Dynamo AI analytics dashboards in Apache Superset.

Usage:
    python analytics/init-dashboards.py

    Or from inside the Superset container:
    docker compose exec superset python /app/init-dashboards.py

Prerequisites:
    - Superset is running and initialized (run scripts/init-superset.sh first)
    - The "Dynamo AI" database is registered as a Superset data source

Environment variables:
    SUPERSET_URL            (default: http://localhost:8088)
    SUPERSET_ADMIN_USERNAME (default: admin)
    SUPERSET_ADMIN_PASSWORD (default: admin)
"""

import json
import os
import sys
import time

import requests

# =============================================================================
# Configuration
# =============================================================================

SUPERSET_URL = os.environ.get("SUPERSET_URL", "http://localhost:8088")
ADMIN_USER = os.environ.get("SUPERSET_ADMIN_USERNAME", "admin")
ADMIN_PASS = os.environ.get("SUPERSET_ADMIN_PASSWORD", "admin")

DATABASE_NAME = "Dynamo AI"

# =============================================================================
# Superset API client
# =============================================================================


class SupersetClient:
    """Minimal Superset REST API client."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.csrf_token = None
        self.access_token = None

    # ── Auth ─────────────────────────────────────────────────────────────

    def login(self, username: str, password: str) -> None:
        """Authenticate and obtain access + CSRF tokens."""
        resp = self.session.post(
            f"{self.base_url}/api/v1/security/login",
            json={
                "username": username,
                "password": password,
                "provider": "db",
                "refresh": True,
            },
        )
        resp.raise_for_status()
        self.access_token = resp.json()["access_token"]
        self.session.headers.update(
            {"Authorization": f"Bearer {self.access_token}"}
        )
        # Fetch CSRF token for mutating requests
        csrf_resp = self.session.get(
            f"{self.base_url}/api/v1/security/csrf_token/"
        )
        csrf_resp.raise_for_status()
        self.csrf_token = csrf_resp.json()["result"]
        self.session.headers.update({"X-CSRFToken": self.csrf_token})

    # ── Generic helpers ──────────────────────────────────────────────────

    def get(self, path: str, **kwargs) -> dict:
        resp = self.session.get(f"{self.base_url}{path}", **kwargs)
        resp.raise_for_status()
        return resp.json()

    def post(self, path: str, payload: dict) -> dict:
        resp = self.session.post(
            f"{self.base_url}{path}",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code == 422:
            # Already exists — not an error
            return resp.json()
        resp.raise_for_status()
        return resp.json()

    def put(self, path: str, payload: dict) -> dict:
        resp = self.session.put(
            f"{self.base_url}{path}",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()

    # ── Database ─────────────────────────────────────────────────────────

    def get_database_id(self, name: str) -> int | None:
        data = self.get(
            "/api/v1/database/",
            params={"q": json.dumps({"filters": [{"col": "database_name", "opr": "eq", "value": name}]})},
        )
        results = data.get("result", [])
        return results[0]["id"] if results else None

    # ── Datasets ─────────────────────────────────────────────────────────

    def find_dataset(self, table_name: str) -> int | None:
        data = self.get(
            "/api/v1/dataset/",
            params={"q": json.dumps({"filters": [{"col": "table_name", "opr": "eq", "value": table_name}]})},
        )
        results = data.get("result", [])
        return results[0]["id"] if results else None

    def create_dataset(self, database_id: int, table_name: str, sql: str, description: str = "") -> int:
        """Create a virtual (SQL) dataset. Returns the dataset ID."""
        # Check if dataset with this name already exists
        existing_id = self.find_dataset(table_name)
        if existing_id:
            print(f"    Dataset '{table_name}' already exists (id={existing_id}), skipping.")
            return existing_id

        payload = {
            "database": database_id,
            "table_name": table_name,
            "sql": sql,
            "description": description,
            "schema": None,
        }
        resp = self.post("/api/v1/dataset/", payload)
        dataset_id = resp.get("id")
        if dataset_id:
            print(f"    Created dataset '{table_name}' (id={dataset_id}).")
        else:
            # Try to extract ID from response
            print(f"    Dataset '{table_name}' response: {resp}")
            dataset_id = resp.get("result", {}).get("id", 0)
        return dataset_id

    # ── Charts ───────────────────────────────────────────────────────────

    def find_chart(self, name: str) -> int | None:
        data = self.get(
            "/api/v1/chart/",
            params={"q": json.dumps({"filters": [{"col": "slice_name", "opr": "eq", "value": name}]})},
        )
        results = data.get("result", [])
        return results[0]["id"] if results else None

    def create_chart(self, name: str, viz_type: str, dataset_id: int, params: dict) -> int:
        """Create a chart (slice). Returns the chart ID."""
        existing_id = self.find_chart(name)
        if existing_id:
            print(f"    Chart '{name}' already exists (id={existing_id}), skipping.")
            return existing_id

        payload = {
            "slice_name": name,
            "viz_type": viz_type,
            "datasource_id": dataset_id,
            "datasource_type": "table",
            "params": json.dumps(params),
        }
        resp = self.post("/api/v1/chart/", payload)
        chart_id = resp.get("id", resp.get("result", {}).get("id", 0))
        print(f"    Created chart '{name}' (id={chart_id}).")
        return chart_id

    # ── Dashboards ───────────────────────────────────────────────────────

    def find_dashboard(self, title: str) -> int | None:
        data = self.get(
            "/api/v1/dashboard/",
            params={"q": json.dumps({"filters": [{"col": "dashboard_title", "opr": "eq", "value": title}]})},
        )
        results = data.get("result", [])
        return results[0]["id"] if results else None

    def create_dashboard(self, title: str, slug: str, chart_ids: list[int]) -> int:
        """Create a dashboard with the given charts arranged in a grid."""
        existing_id = self.find_dashboard(title)
        if existing_id:
            print(f"    Dashboard '{title}' already exists (id={existing_id}), skipping.")
            return existing_id

        # Build a simple grid layout: 2 columns, charts stacked
        position_json = self._build_layout(chart_ids)

        payload = {
            "dashboard_title": title,
            "slug": slug,
            "published": True,
            "position_json": json.dumps(position_json),
        }
        resp = self.post("/api/v1/dashboard/", payload)
        dash_id = resp.get("id", resp.get("result", {}).get("id", 0))
        print(f"    Created dashboard '{title}' (id={dash_id}).")
        return dash_id

    @staticmethod
    def _build_layout(chart_ids: list[int]) -> dict:
        """Build a Superset dashboard position JSON with a 2-column grid."""
        ROOT_ID = "ROOT_ID"
        GRID_ID = "GRID_ID"
        HEADER_ID = "HEADER_ID"

        layout = {
            ROOT_ID: {"type": "ROOT", "id": ROOT_ID, "children": [GRID_ID]},
            GRID_ID: {"type": "GRID", "id": GRID_ID, "children": [], "parents": [ROOT_ID]},
            HEADER_ID: {
                "type": "HEADER",
                "id": HEADER_ID,
                "meta": {"text": "Dynamo AI"},
            },
            "DASHBOARD_VERSION_KEY": "v2",
        }

        row_idx = 0
        col_in_row = 0
        current_row_id = None

        for chart_id in chart_ids:
            # Start a new row every 2 charts
            if col_in_row == 0:
                current_row_id = f"ROW-{row_idx}"
                layout[current_row_id] = {
                    "type": "ROW",
                    "id": current_row_id,
                    "children": [],
                    "parents": [ROOT_ID, GRID_ID],
                    "meta": {"background": "BACKGROUND_TRANSPARENT"},
                }
                layout[GRID_ID]["children"].append(current_row_id)

            chart_component_id = f"CHART-{chart_id}"
            layout[chart_component_id] = {
                "type": "CHART",
                "id": chart_component_id,
                "children": [],
                "parents": [ROOT_ID, GRID_ID, current_row_id],
                "meta": {
                    "chartId": chart_id,
                    "width": 6,  # half of 12-column grid
                    "height": 50,
                    "sliceName": "",
                },
            }
            layout[current_row_id]["children"].append(chart_component_id)

            col_in_row += 1
            if col_in_row >= 2:
                col_in_row = 0
                row_idx += 1

        return layout


# =============================================================================
# SQL Dataset Definitions
# =============================================================================
# Each dataset is a SQL query that Superset treats as a virtual table.

DATASETS = {
    # ── Executive Overview ────────────────────────────────────────────────
    "daily_active_users": {
        "sql": """
SELECT
    DATE(timestamp) AS day,
    COUNT(DISTINCT user_id) AS active_users
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(timestamp)
ORDER BY day
""",
        "description": "Count of distinct active users per day over the last 30 days.",
    },
    "total_tokens_consumed": {
        "sql": """
SELECT
    SUM(input_tokens + output_tokens) AS total_tokens,
    SUM(input_tokens + output_tokens) FILTER (
        WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    ) AS tokens_this_month,
    SUM(input_tokens + output_tokens) FILTER (
        WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
            AND created_at < DATE_TRUNC('month', CURRENT_DATE)
    ) AS tokens_last_month
FROM token_usage
""",
        "description": "Total token consumption with month-over-month comparison.",
    },
    "estimated_monthly_cost": {
        "sql": """
SELECT
    SUM(cost_estimate) AS monthly_cost
FROM token_usage
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
""",
        "description": "Estimated cost for the current calendar month.",
    },
    "adoption_by_department": {
        "sql": """
SELECT
    COALESCE(
        SPLIT_PART(user_email, '@', 1),
        user_id
    ) AS department_proxy,
    ub.role AS department,
    COUNT(DISTINCT al.user_id) AS user_count
FROM audit_logs al
LEFT JOIN user_budgets ub
    ON al.user_id = ub.user_id
    AND ub.period_start = DATE_TRUNC('month', CURRENT_DATE)::date
WHERE al.status = 'success'
    AND al.timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY ub.role, department_proxy
ORDER BY user_count DESC
""",
        "description": "User adoption grouped by role (proxy for department).",
    },
    "top_use_cases": {
        "sql": """
SELECT
    COALESCE(request_category, 'uncategorized') AS use_case,
    COUNT(*) AS request_count
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY request_category
ORDER BY request_count DESC
LIMIT 5
""",
        "description": "Top 5 request categories (use cases) this month.",
    },

    # ── User Leaderboard ─────────────────────────────────────────────────
    "top_users_by_tokens": {
        "sql": """
SELECT
    COALESCE(user_email, user_id) AS user_label,
    SUM(input_tokens + output_tokens) AS total_tokens
FROM token_usage
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY user_label
ORDER BY total_tokens DESC
LIMIT 20
""",
        "description": "Top 20 users by token consumption this month.",
    },
    "user_model_distribution": {
        "sql": """
SELECT
    COALESCE(user_email, user_id) AS user_label,
    model,
    SUM(input_tokens + output_tokens) AS total_tokens
FROM token_usage
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY user_label, model
ORDER BY total_tokens DESC
""",
        "description": "Per-user token consumption broken down by model.",
    },
    "budget_utilization": {
        "sql": """
SELECT
    ub.user_id,
    ub.role,
    ub.monthly_limit,
    ub.current_usage,
    CASE
        WHEN ub.monthly_limit IS NULL THEN 0
        WHEN ub.monthly_limit <= 0 THEN 0
        ELSE ROUND((ub.current_usage::numeric / ub.monthly_limit) * 100, 1)
    END AS percent_used,
    CASE
        WHEN ub.monthly_limit IS NULL THEN 'unlimited'
        WHEN ub.current_usage >= ub.monthly_limit THEN 'over_budget'
        WHEN ub.current_usage >= ub.monthly_limit * 0.8 THEN 'warning'
        ELSE 'ok'
    END AS budget_status
FROM user_budgets ub
WHERE ub.period_start = DATE_TRUNC('month', CURRENT_DATE)::date
ORDER BY percent_used DESC
""",
        "description": "Budget utilization by user with status flags for conditional formatting.",
    },

    # ── Request Analytics ────────────────────────────────────────────────
    "requests_by_category_over_time": {
        "sql": """
SELECT
    DATE(timestamp) AS day,
    COALESCE(request_category, 'uncategorized') AS category,
    COUNT(*) AS request_count
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY day, category
ORDER BY day, category
""",
        "description": "Daily request counts by category over the last 30 days.",
    },
    "request_category_breakdown": {
        "sql": """
SELECT
    COALESCE(request_category, 'uncategorized') AS category,
    COUNT(*) AS request_count
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY category
ORDER BY request_count DESC
""",
        "description": "Request count by category for the current month.",
    },
    "web_vs_cli": {
        "sql": """
SELECT
    COALESCE(source, 'unknown') AS source,
    COUNT(*) AS request_count
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY source
""",
        "description": "Web vs CLI usage breakdown for the current month.",
    },
    "avg_tokens_per_request_by_model": {
        "sql": """
SELECT
    model,
    ROUND(AVG(input_tokens + output_tokens)) AS avg_tokens,
    ROUND(AVG(input_tokens)) AS avg_input,
    ROUND(AVG(output_tokens)) AS avg_output
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY model
ORDER BY avg_tokens DESC
""",
        "description": "Average tokens per request broken down by model.",
    },
    "requests_heatmap": {
        "sql": """
SELECT
    EXTRACT(DOW FROM timestamp)::int AS day_of_week,
    EXTRACT(HOUR FROM timestamp)::int AS hour_of_day,
    COUNT(*) AS request_count
FROM audit_logs
WHERE status = 'success'
    AND timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY day_of_week, hour_of_day
ORDER BY day_of_week, hour_of_day
""",
        "description": "Request volume heatmap by day of week and hour of day.",
    },

    # ── Cost & Budget Tracking ───────────────────────────────────────────
    "daily_cost_by_model": {
        "sql": """
SELECT
    DATE(created_at) AS day,
    model,
    SUM(cost_estimate) AS daily_cost
FROM token_usage
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY day, model
ORDER BY day, model
""",
        "description": "Daily API cost broken down by model over the last 30 days.",
    },
    "projected_vs_actual_spend": {
        "sql": """
WITH daily AS (
    SELECT
        DATE(created_at) AS day,
        SUM(cost_estimate) AS daily_cost
    FROM token_usage
    WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    GROUP BY day
),
running AS (
    SELECT
        day,
        daily_cost,
        SUM(daily_cost) OVER (ORDER BY day) AS cumulative_cost,
        -- Project monthly total based on current run rate
        SUM(daily_cost) OVER () /
            GREATEST(COUNT(*) OVER (), 1) *
            EXTRACT(DAY FROM (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day'))
            AS projected_monthly
    FROM daily
)
SELECT
    day,
    daily_cost,
    cumulative_cost,
    projected_monthly
FROM running
ORDER BY day
""",
        "description": "Cumulative actual spend vs projected monthly total.",
    },
    "cost_per_department": {
        "sql": """
SELECT
    COALESCE(ub.role, 'unknown') AS department,
    SUM(tu.cost_estimate) AS total_cost
FROM token_usage tu
LEFT JOIN user_budgets ub
    ON tu.user_id = ub.user_id
    AND ub.period_start = DATE_TRUNC('month', CURRENT_DATE)::date
WHERE tu.created_at >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY department
ORDER BY total_cost DESC
""",
        "description": "Cost by department (role) for the current month.",
    },
    "budget_overages": {
        "sql": """
SELECT
    ub.user_id,
    ub.role,
    ub.monthly_limit,
    ub.current_usage,
    ub.current_usage - ub.monthly_limit AS overage_tokens,
    ROUND(
        (ub.current_usage - ub.monthly_limit)::numeric
        / GREATEST(ub.monthly_limit, 1) * 100, 1
    ) AS overage_percent
FROM user_budgets ub
WHERE ub.period_start = DATE_TRUNC('month', CURRENT_DATE)::date
    AND ub.monthly_limit IS NOT NULL
    AND ub.current_usage > ub.monthly_limit
ORDER BY overage_tokens DESC
""",
        "description": "Users who have exceeded their monthly token budget.",
    },
}


# =============================================================================
# Chart Definitions
# =============================================================================
# Maps chart name -> (dataset_key, viz_type, superset params dict)

CHARTS = {
    # ── Executive Overview ────────────────────────────────────────────────
    "Active Users (Daily)": {
        "dataset": "daily_active_users",
        "viz_type": "echarts_timeseries_line",
        "params": {
            "x_axis": "day",
            "metrics": [{"label": "Active Users", "expressionType": "SIMPLE", "column": {"column_name": "active_users"}, "aggregate": "MAX"}],
            "time_grain_sqla": "P1D",
            "row_limit": 100,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "rich_tooltip": True,
        },
    },
    "Total Tokens Consumed": {
        "dataset": "total_tokens_consumed",
        "viz_type": "big_number_total",
        "params": {
            "metric": {"label": "Total Tokens", "expressionType": "SIMPLE", "column": {"column_name": "tokens_this_month"}, "aggregate": "MAX"},
            "subheader": "This month",
            "y_axis_format": ",.0f",
            "color_scheme": "supersetColors",
        },
    },
    "Estimated Monthly Cost": {
        "dataset": "estimated_monthly_cost",
        "viz_type": "big_number_total",
        "params": {
            "metric": {"label": "Monthly Cost", "expressionType": "SIMPLE", "column": {"column_name": "monthly_cost"}, "aggregate": "MAX"},
            "subheader": "Current month estimated spend",
            "y_axis_format": "$,.2f",
            "color_scheme": "supersetColors",
        },
    },
    "Adoption Rate by Department": {
        "dataset": "adoption_by_department",
        "viz_type": "pie",
        "params": {
            "groupby": ["department"],
            "metric": {"label": "Users", "expressionType": "SIMPLE", "column": {"column_name": "user_count"}, "aggregate": "SUM"},
            "row_limit": 10,
            "color_scheme": "supersetColors",
            "show_labels": True,
            "label_type": "key_value_percent",
            "donut": False,
        },
    },
    "Top 5 Use Cases": {
        "dataset": "top_use_cases",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "use_case",
            "metrics": [{"label": "Requests", "expressionType": "SIMPLE", "column": {"column_name": "request_count"}, "aggregate": "MAX"}],
            "orientation": "horizontal",
            "row_limit": 5,
            "color_scheme": "supersetColors",
            "show_legend": False,
        },
    },

    # ── User Leaderboard ─────────────────────────────────────────────────
    "Top 20 Users by Token Consumption": {
        "dataset": "top_users_by_tokens",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "user_label",
            "metrics": [{"label": "Total Tokens", "expressionType": "SIMPLE", "column": {"column_name": "total_tokens"}, "aggregate": "MAX"}],
            "row_limit": 20,
            "color_scheme": "supersetColors",
            "show_legend": False,
            "y_axis_format": ",.0f",
        },
    },
    "Per-User Model Distribution": {
        "dataset": "user_model_distribution",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "user_label",
            "groupby": ["model"],
            "metrics": [{"label": "Tokens", "expressionType": "SIMPLE", "column": {"column_name": "total_tokens"}, "aggregate": "MAX"}],
            "stack": True,
            "row_limit": 50,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "y_axis_format": ",.0f",
        },
    },
    "Budget Utilization by User": {
        "dataset": "budget_utilization",
        "viz_type": "table",
        "params": {
            "all_columns": ["user_id", "role", "monthly_limit", "current_usage", "percent_used", "budget_status"],
            "row_limit": 100,
            "order_desc": True,
            "conditional_formatting": [
                {
                    "column": "percent_used",
                    "colorScheme": "#ACE1AF",
                    "operator": "<",
                    "targetValue": 80,
                },
                {
                    "column": "percent_used",
                    "colorScheme": "#FFD700",
                    "operator": ">=",
                    "targetValue": 80,
                    "targetValueRight": 100,
                },
                {
                    "column": "percent_used",
                    "colorScheme": "#FF6B6B",
                    "operator": ">",
                    "targetValue": 100,
                },
            ],
        },
    },

    # ── Request Analytics ────────────────────────────────────────────────
    "Requests by Category Over Time": {
        "dataset": "requests_by_category_over_time",
        "viz_type": "echarts_area",
        "params": {
            "x_axis": "day",
            "groupby": ["category"],
            "metrics": [{"label": "Requests", "expressionType": "SIMPLE", "column": {"column_name": "request_count"}, "aggregate": "MAX"}],
            "stack": True,
            "time_grain_sqla": "P1D",
            "row_limit": 1000,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "opacity": 0.7,
        },
    },
    "Request Category Breakdown": {
        "dataset": "request_category_breakdown",
        "viz_type": "pie",
        "params": {
            "groupby": ["category"],
            "metric": {"label": "Requests", "expressionType": "SIMPLE", "column": {"column_name": "request_count"}, "aggregate": "SUM"},
            "row_limit": 10,
            "color_scheme": "supersetColors",
            "show_labels": True,
            "label_type": "key_value_percent",
            "donut": False,
        },
    },
    "Web vs CLI Usage": {
        "dataset": "web_vs_cli",
        "viz_type": "pie",
        "params": {
            "groupby": ["source"],
            "metric": {"label": "Requests", "expressionType": "SIMPLE", "column": {"column_name": "request_count"}, "aggregate": "SUM"},
            "row_limit": 10,
            "color_scheme": "supersetColors",
            "show_labels": True,
            "label_type": "key_value_percent",
            "donut": True,
            "innerRadius": 40,
        },
    },
    "Avg Tokens per Request by Model": {
        "dataset": "avg_tokens_per_request_by_model",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "model",
            "metrics": [
                {"label": "Avg Input", "expressionType": "SIMPLE", "column": {"column_name": "avg_input"}, "aggregate": "MAX"},
                {"label": "Avg Output", "expressionType": "SIMPLE", "column": {"column_name": "avg_output"}, "aggregate": "MAX"},
            ],
            "groupby": [],
            "row_limit": 10,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "y_axis_format": ",.0f",
        },
    },
    "Requests per Hour Heatmap": {
        "dataset": "requests_heatmap",
        "viz_type": "heatmap",
        "params": {
            "all_columns_x": "hour_of_day",
            "all_columns_y": "day_of_week",
            "metric": {"label": "Requests", "expressionType": "SIMPLE", "column": {"column_name": "request_count"}, "aggregate": "SUM"},
            "linear_color_scheme": "blue_white_yellow",
            "xscale_interval": 1,
            "yscale_interval": 1,
            "show_legend": True,
            "show_values": True,
        },
    },

    # ── Cost & Budget Tracking ───────────────────────────────────────────
    "Daily API Cost by Model": {
        "dataset": "daily_cost_by_model",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "day",
            "groupby": ["model"],
            "metrics": [{"label": "Cost ($)", "expressionType": "SIMPLE", "column": {"column_name": "daily_cost"}, "aggregate": "MAX"}],
            "stack": True,
            "time_grain_sqla": "P1D",
            "row_limit": 500,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "y_axis_format": "$,.2f",
        },
    },
    "Projected vs Actual Spend": {
        "dataset": "projected_vs_actual_spend",
        "viz_type": "echarts_timeseries_line",
        "params": {
            "x_axis": "day",
            "metrics": [
                {"label": "Cumulative Cost", "expressionType": "SIMPLE", "column": {"column_name": "cumulative_cost"}, "aggregate": "MAX"},
                {"label": "Projected Monthly", "expressionType": "SIMPLE", "column": {"column_name": "projected_monthly"}, "aggregate": "MAX"},
            ],
            "time_grain_sqla": "P1D",
            "row_limit": 100,
            "color_scheme": "supersetColors",
            "show_legend": True,
            "y_axis_format": "$,.2f",
            "rich_tooltip": True,
        },
    },
    "Cost per Department": {
        "dataset": "cost_per_department",
        "viz_type": "echarts_timeseries_bar",
        "params": {
            "x_axis": "department",
            "metrics": [{"label": "Total Cost ($)", "expressionType": "SIMPLE", "column": {"column_name": "total_cost"}, "aggregate": "MAX"}],
            "orientation": "horizontal",
            "row_limit": 20,
            "color_scheme": "supersetColors",
            "show_legend": False,
            "y_axis_format": "$,.2f",
        },
    },
    "Budget Overages": {
        "dataset": "budget_overages",
        "viz_type": "table",
        "params": {
            "all_columns": ["user_id", "role", "monthly_limit", "current_usage", "overage_tokens", "overage_percent"],
            "row_limit": 50,
            "order_desc": True,
            "conditional_formatting": [
                {
                    "column": "overage_percent",
                    "colorScheme": "#FF6B6B",
                    "operator": ">",
                    "targetValue": 0,
                },
            ],
        },
    },
}


# =============================================================================
# Dashboard Definitions
# =============================================================================

DASHBOARDS = [
    {
        "title": "Executive Overview",
        "slug": "executive-overview",
        "charts": [
            "Active Users (Daily)",
            "Total Tokens Consumed",
            "Estimated Monthly Cost",
            "Adoption Rate by Department",
            "Top 5 Use Cases",
        ],
    },
    {
        "title": "User Leaderboard",
        "slug": "user-leaderboard",
        "charts": [
            "Top 20 Users by Token Consumption",
            "Per-User Model Distribution",
            "Budget Utilization by User",
        ],
    },
    {
        "title": "Request Analytics",
        "slug": "request-analytics",
        "charts": [
            "Requests by Category Over Time",
            "Request Category Breakdown",
            "Web vs CLI Usage",
            "Avg Tokens per Request by Model",
            "Requests per Hour Heatmap",
        ],
    },
    {
        "title": "Cost & Budget Tracking",
        "slug": "cost-budget-tracking",
        "charts": [
            "Daily API Cost by Model",
            "Projected vs Actual Spend",
            "Cost per Department",
            "Budget Overages",
        ],
    },
]


# =============================================================================
# Main
# =============================================================================


def wait_for_superset(url: str, max_retries: int = 60) -> None:
    """Wait for Superset to be reachable."""
    print(f"==> Waiting for Superset at {url}...")
    for attempt in range(max_retries):
        try:
            resp = requests.get(f"{url}/health", timeout=5)
            if resp.status_code == 200:
                print("==> Superset is ready.")
                return
        except requests.ConnectionError:
            pass
        time.sleep(2)
    print(f"ERROR: Superset did not become ready after {max_retries} attempts.")
    sys.exit(1)


def main() -> None:
    wait_for_superset(SUPERSET_URL)

    client = SupersetClient(SUPERSET_URL)

    # ── Authenticate ─────────────────────────────────────────────────────
    print(f"==> Logging in as '{ADMIN_USER}'...")
    client.login(ADMIN_USER, ADMIN_PASS)
    print("==> Authenticated.")

    # ── Resolve database ID ──────────────────────────────────────────────
    print(f"==> Looking up database '{DATABASE_NAME}'...")
    db_id = client.get_database_id(DATABASE_NAME)
    if db_id is None:
        print(f"ERROR: Database '{DATABASE_NAME}' not found in Superset.")
        print("    Run scripts/init-superset.sh first to register it.")
        sys.exit(1)
    print(f"==> Found database '{DATABASE_NAME}' (id={db_id}).")

    # ── Create datasets ──────────────────────────────────────────────────
    print("==> Creating datasets...")
    dataset_ids: dict[str, int] = {}
    for name, defn in DATASETS.items():
        dataset_ids[name] = client.create_dataset(
            database_id=db_id,
            table_name=name,
            sql=defn["sql"],
            description=defn["description"],
        )
    print(f"==> {len(dataset_ids)} datasets ready.")

    # ── Create charts ────────────────────────────────────────────────────
    print("==> Creating charts...")
    chart_ids: dict[str, int] = {}
    for name, defn in CHARTS.items():
        ds_key = defn["dataset"]
        ds_id = dataset_ids.get(ds_key, 0)
        if ds_id == 0:
            print(f"    WARNING: Dataset '{ds_key}' not found for chart '{name}', skipping.")
            continue
        chart_ids[name] = client.create_chart(
            name=name,
            viz_type=defn["viz_type"],
            dataset_id=ds_id,
            params=defn["params"],
        )
    print(f"==> {len(chart_ids)} charts ready.")

    # ── Create dashboards ────────────────────────────────────────────────
    print("==> Creating dashboards...")
    for dash_def in DASHBOARDS:
        ids = [chart_ids[c] for c in dash_def["charts"] if c in chart_ids]
        client.create_dashboard(
            title=dash_def["title"],
            slug=dash_def["slug"],
            chart_ids=ids,
        )
    print(f"==> {len(DASHBOARDS)} dashboards ready.")

    # ── Summary ──────────────────────────────────────────────────────────
    print("")
    print("==> Dashboard initialization complete!")
    print(f"    Superset URL: {SUPERSET_URL}")
    print(f"    Dashboards:")
    for dash_def in DASHBOARDS:
        print(f"      - {dash_def['title']}: {SUPERSET_URL}/superset/dashboard/{dash_def['slug']}/")


if __name__ == "__main__":
    main()

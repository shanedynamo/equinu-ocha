"""
Budget Check — Open WebUI Pipe Function Plugin

Users can select this as a "model" in the chat interface to check their
current token usage, monthly limit, and remaining budget.

The function calls GET /v1/budget/:userId on the Claude Engine middleware
and formats the response as a readable budget summary.

Install: Admin Panel > Settings > Functions > Add (+) > paste this file.
Set the function type to "Pipe".

Requires: requests (pre-installed in Open WebUI)
"""

from typing import Optional

import requests
from pydantic import BaseModel, Field


class Pipe:
    """Budget check function — shows token usage and remaining budget."""

    class Valves(BaseModel):
        CLAUDE_ENGINE_URL: str = Field(
            default="http://claude-engine:3001",
            description="Base URL of the Claude Engine middleware",
        )
        REQUEST_TIMEOUT: int = Field(
            default=10,
            description="HTTP request timeout in seconds",
        )

    def __init__(self):
        self.type = "pipe"
        self.valves = self.Valves()

    def pipes(self) -> list[dict]:
        """Register this function as a selectable model."""
        return [{"id": "budget-check", "name": "Budget Check"}]

    def pipe(
        self,
        body: dict,
        __user__: Optional[dict] = None,
    ) -> str:
        """
        Fetch and display the user's current budget status.

        Users can type anything (e.g. "/budget" or "check my budget")
        and this function will return their budget information.
        """
        if not __user__:
            return "**Error**: Unable to identify your account. Please sign in and try again."

        user_email = __user__.get("email", "")
        user_id = __user__.get("email", __user__.get("id", ""))
        user_role = __user__.get("role", "user")

        if not user_id:
            return "**Error**: Unable to determine your user ID."

        # Map Open WebUI roles to Claude Engine roles
        role_map = {
            "admin": "admin",
            "user": "business",
            "pending": "business",
        }
        engine_role = role_map.get(user_role, "business")

        headers = {
            "Content-Type": "application/json",
            "X-User-Email": user_email,
            "X-User-Role": engine_role,
            "X-User-Id": user_id,
        }

        url = f"{self.valves.CLAUDE_ENGINE_URL}/v1/budget/{user_id}"

        try:
            r = requests.get(
                url,
                headers=headers,
                timeout=self.valves.REQUEST_TIMEOUT,
            )

            if r.status_code == 403:
                return "**Access Denied**: You can only view your own budget."

            if r.status_code != 200:
                error = r.json().get("error", {})
                return f"**Error**: {error.get('message', 'Unable to fetch budget')}"

            budget = r.json()
            return self._format_budget(budget, user_email)

        except requests.ConnectionError:
            return (
                "**Connection Error**: Unable to reach the Claude Engine service. "
                "Please try again in a moment."
            )
        except requests.Timeout:
            return "**Timeout**: Budget check took too long. Please try again."
        except Exception as e:
            return f"**Error**: {e}"

    @staticmethod
    def _format_budget(budget: dict, user_email: str) -> str:
        """Format a BudgetStatus response as a readable markdown summary."""
        monthly_limit = budget.get("monthlyLimit")
        current_usage = budget.get("currentUsage", 0)
        percent_used = budget.get("percentUsed", 0)
        remaining = budget.get("remaining")
        reset_date = budget.get("resetDate", "unknown")
        role = budget.get("role", "unknown")
        exceeded = budget.get("exceeded", False)
        warning = budget.get("warningThreshold", False)

        # Format numbers with commas
        usage_str = f"{current_usage:,}"

        if monthly_limit is None:
            limit_str = "Unlimited"
            remaining_str = "Unlimited"
            bar = ""
            status_emoji = "OK"
        else:
            limit_str = f"{monthly_limit:,}"
            remaining_str = f"{remaining:,}" if remaining is not None else "N/A"
            # Progress bar
            filled = min(int(percent_used / 5), 20)
            empty = 20 - filled
            bar_char = "#" if exceeded else "="
            bar = f"`[{bar_char * filled}{'.' * empty}]` {percent_used}%"
            if exceeded:
                status_emoji = "EXCEEDED"
            elif warning:
                status_emoji = "WARNING"
            else:
                status_emoji = "OK"

        lines = [
            f"## Token Budget — {user_email}",
            "",
            f"**Status**: {status_emoji}",
            f"**Role**: {role}",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Used this month | {usage_str} tokens |",
            f"| Monthly limit | {limit_str} tokens |",
            f"| Remaining | {remaining_str} tokens |",
            f"| Budget resets | {reset_date} |",
        ]

        if bar:
            lines.extend(["", f"**Usage**: {bar}"])

        if exceeded:
            lines.extend([
                "",
                "---",
                "Your monthly token budget has been exceeded. "
                "Requests may be blocked depending on enforcement settings. "
                "Contact your administrator to request an increase.",
            ])
        elif warning:
            lines.extend([
                "",
                "---",
                "You are approaching your monthly token budget limit. "
                "Consider reducing usage or contact your administrator.",
            ])

        return "\n".join(lines)

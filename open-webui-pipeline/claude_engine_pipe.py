"""
Claude Engine Pipe — Open WebUI Pipeline Plugin

Routes all chat completion requests through the Dynamo AI Claude Engine
middleware instead of directly to the Anthropic API. This enables:
  - Role-based model access control
  - Token budget enforcement
  - Sensitive data scanning
  - Audit logging
  - Cost tracking

Install: Admin Panel > Settings > Functions > Add (+) > paste this file.
Set the function type to "Pipe".

Requires: requests (pre-installed in Open WebUI)
"""

import json
import time
from typing import Generator, Iterator, Optional, Union

import requests
from pydantic import BaseModel, Field


class Pipe:
    """Open WebUI Pipe that proxies requests through Claude Engine."""

    class Valves(BaseModel):
        CLAUDE_ENGINE_URL: str = Field(
            default="http://claude-engine:3001",
            description="Base URL of the Claude Engine middleware",
        )
        REQUEST_TIMEOUT: int = Field(
            default=120,
            description="HTTP request timeout in seconds",
        )
        SHOW_USAGE_FOOTER: bool = Field(
            default=True,
            description="Append token usage info to each response",
        )

    def __init__(self):
        self.type = "pipe"
        self.valves = self.Valves()

    def pipes(self) -> list[dict]:
        """Advertise available models to Open WebUI."""
        models = [
            {"id": "dynamo-claude-sonnet", "name": "Claude Sonnet 4"},
            {"id": "dynamo-claude-opus", "name": "Claude Opus 4"},
            {"id": "dynamo-claude-haiku", "name": "Claude Haiku 4"},
        ]
        # Try to fetch live model list from Claude Engine health endpoint
        try:
            r = requests.get(
                f"{self.valves.CLAUDE_ENGINE_URL}/health",
                timeout=5,
            )
            if r.status_code == 200:
                return models
        except requests.ConnectionError:
            return [{"id": "error", "name": "Claude Engine unavailable"}]
        return models

    def pipe(
        self,
        body: dict,
        __user__: Optional[dict] = None,
    ) -> Union[str, Generator[str, None, None]]:
        """
        Proxy a chat completion request to Claude Engine.

        Handles both streaming and non-streaming responses.
        Passes user context as headers for auth, budget, and audit.
        """
        user_email = __user__.get("email", "anonymous") if __user__ else "anonymous"
        user_role = __user__.get("role", "user") if __user__ else "user"
        user_name = __user__.get("name", "") if __user__ else ""

        # Map Open WebUI role names to Claude Engine role names
        role_map = {
            "admin": "admin",
            "user": "business",
            "pending": "business",
        }
        engine_role = role_map.get(user_role, "business")

        # Build the request payload
        payload = {
            "model": body.get("model", "claude-sonnet-4-20250514"),
            "messages": body.get("messages", []),
            "stream": body.get("stream", False),
        }

        # Forward optional parameters
        for key in ("max_tokens", "temperature", "top_p"):
            if key in body:
                payload[key] = body[key]

        headers = {
            "Content-Type": "application/json",
            "X-User-Email": user_email,
            "X-User-Role": engine_role,
            "X-User-Id": user_email,
        }

        url = f"{self.valves.CLAUDE_ENGINE_URL}/v1/chat/completions"

        try:
            if payload.get("stream"):
                return self._stream_response(url, headers, payload, user_email)
            else:
                return self._sync_response(url, headers, payload, user_email)
        except requests.ConnectionError:
            return (
                "**Connection Error**: Unable to reach the Claude Engine service. "
                "Please try again in a moment or contact your administrator."
            )
        except requests.Timeout:
            return (
                "**Timeout**: The request took too long to complete. "
                "Try a shorter prompt or contact your administrator."
            )
        except Exception as e:
            return f"**Error**: An unexpected error occurred: {e}"

    def _sync_response(
        self,
        url: str,
        headers: dict,
        payload: dict,
        user_email: str,
    ) -> str:
        """Handle a non-streaming chat completion."""
        r = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=self.valves.REQUEST_TIMEOUT,
        )

        # Handle error responses from Claude Engine
        if r.status_code != 200:
            return self._format_error(r)

        data = r.json()
        content = self._extract_content(data)

        # Append usage footer
        if self.valves.SHOW_USAGE_FOOTER:
            footer = self._build_usage_footer(
                data,
                model_downgraded=r.headers.get("X-Model-Downgraded") == "true",
                budget_warning=r.headers.get("X-Budget-Warning") == "true",
            )
            content += footer

        return content

    def _stream_response(
        self,
        url: str,
        headers: dict,
        payload: dict,
        user_email: str,
    ) -> Generator[str, None, None]:
        """Handle a streaming chat completion via SSE passthrough."""
        r = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=self.valves.REQUEST_TIMEOUT,
            stream=True,
        )

        # Handle error responses (non-streaming error from Claude Engine)
        if r.status_code != 200:
            yield self._format_error(r)
            return

        model_used = payload.get("model", "unknown")
        total_prompt_tokens = 0
        total_completion_tokens = 0
        model_downgraded = r.headers.get("X-Model-Downgraded") == "true"
        budget_warning = r.headers.get("X-Budget-Warning") == "true"

        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            if not line.startswith("data: "):
                continue

            data_str = line[6:]  # Strip "data: " prefix

            if data_str == "[DONE]":
                # Append usage footer after the stream completes
                if self.valves.SHOW_USAGE_FOOTER:
                    footer = self._build_usage_footer_from_counts(
                        model=model_used,
                        prompt_tokens=total_prompt_tokens,
                        completion_tokens=total_completion_tokens,
                        model_downgraded=model_downgraded,
                        budget_warning=budget_warning,
                    )
                    yield footer
                return

            try:
                chunk = json.loads(data_str)
                model_used = chunk.get("model", model_used)

                # Extract usage from the final chunk if present
                usage = chunk.get("usage", {})
                if usage:
                    total_prompt_tokens = usage.get(
                        "prompt_tokens", total_prompt_tokens
                    )
                    total_completion_tokens = usage.get(
                        "completion_tokens", total_completion_tokens
                    )

                # Extract and yield content deltas
                choices = chunk.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
            except json.JSONDecodeError:
                continue

    def _extract_content(self, data: dict) -> str:
        """Extract assistant message content from a completion response."""
        choices = data.get("choices", [])
        if not choices:
            return ""
        message = choices[0].get("message", {})
        return message.get("content", "")

    def _format_error(self, response: requests.Response) -> str:
        """Format a Claude Engine error response as a user-friendly message."""
        try:
            error_data = response.json()
            error = error_data.get("error", {})
            code = error.get("code", "unknown")
            message = error.get("message", "An error occurred")

            if code == "budget_exceeded":
                return (
                    "**Budget Exceeded**\n\n"
                    f"{message}\n\n"
                    "Contact your administrator to request a budget increase, "
                    "or wait until your budget resets at the start of next month."
                )
            elif code == "sensitive_data_blocked":
                return (
                    "**Request Blocked**\n\n"
                    f"{message}\n\n"
                    "Please remove any sensitive information "
                    "(API keys, credentials, SSNs, etc.) from your prompt "
                    "and try again."
                )
            elif code == "invalid_api_key" or code == "auth_required":
                return (
                    "**Authentication Error**\n\n"
                    f"{message}\n\n"
                    "Please sign in again or contact your administrator."
                )
            else:
                return f"**Error** ({code}): {message}"
        except (ValueError, KeyError):
            return (
                f"**Error**: Claude Engine returned status {response.status_code}. "
                "Please try again or contact your administrator."
            )

    def _build_usage_footer(
        self,
        data: dict,
        model_downgraded: bool = False,
        budget_warning: bool = False,
    ) -> str:
        """Build a usage footer from a non-streaming response."""
        usage = data.get("usage", {})
        model = data.get("model", "unknown")
        return self._build_usage_footer_from_counts(
            model=model,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            model_downgraded=model_downgraded,
            budget_warning=budget_warning,
        )

    @staticmethod
    def _build_usage_footer_from_counts(
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        model_downgraded: bool = False,
        budget_warning: bool = False,
    ) -> str:
        """Build a markdown usage footer from token counts."""
        total = prompt_tokens + completion_tokens
        parts = [
            f"\n\n---\n*Model: {model}",
            f"Tokens: {total:,} ({prompt_tokens:,} in / {completion_tokens:,} out)",
        ]

        if model_downgraded:
            parts.append(
                "Note: Model was adjusted based on your access level"
            )

        if budget_warning:
            parts.append(
                "Warning: You are approaching your monthly token budget"
            )

        return " | ".join(parts) + "*"

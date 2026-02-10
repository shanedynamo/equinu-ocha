import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { AppError } from "../middleware/error-handler.js";
import { createMessage, createMessageStream } from "../services/anthropic.js";
import { recordUsage } from "../services/budgetService.js";
import { buildAuditEntry, commitAuditLog } from "../services/auditLogger.js";
import type { EngineRequest } from "../types/common.js";
import type { AnthropicMessagesRequest } from "../types/anthropic.js";
import type Anthropic from "@anthropic-ai/sdk";

export const messagesRouter = Router();

// ── POST /v1/messages ───────────────────────────────────────────────────────

messagesRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const engineReq = req as EngineRequest;
      const body = req.body as AnthropicMessagesRequest;

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw new AppError("messages is required and must be a non-empty array", 400, "invalid_request");
      }
      if (!body.max_tokens) {
        throw new AppError("max_tokens is required", 400, "invalid_request");
      }

      const model = body.model || config.anthropic.defaultModel;

      // Normalize message content to Anthropic SDK format
      const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      logger.info({
        action: "messages_start",
        requestId: engineReq.context.requestId,
        userId: engineReq.context.userId,
        model,
        stream: !!body.stream,
        messageCount: body.messages.length,
      });

      if (body.stream) {
        await handleStream(engineReq, res, { model, body, messages });
      } else {
        await handleNonStream(engineReq, res, { model, body, messages });
      }
    } catch (err) {
      next(err);
    }
  },
);

// ── Non-streaming ───────────────────────────────────────────────────────────

interface HandlerParams {
  model: string;
  body: AnthropicMessagesRequest;
  messages: Anthropic.MessageParam[];
}

async function handleNonStream(
  req: EngineRequest,
  res: Response,
  params: HandlerParams,
): Promise<void> {
  const result = await createMessage({
    model: params.model,
    messages: params.messages,
    max_tokens: params.body.max_tokens,
    system: params.body.system,
    temperature: params.body.temperature,
    top_p: params.body.top_p,
    top_k: params.body.top_k,
    stop_sequences: params.body.stop_sequences,
    metadata: params.body.metadata,
  });

  const responseText = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  logger.info({
    action: "messages_done",
    requestId: req.context.requestId,
    userId: req.context.userId,
    model: result.model,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  });

  // Record usage for budget tracking (fire-and-forget)
  if (req.context.userId) {
    recordUsage({
      userId: req.context.userId,
      model: result.model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      requestCategory: req.context.audit?.requestCategory ?? "general_qa",
    }).catch(() => {});
  }

  // Commit audit log (fire-and-forget)
  if (req.context.audit) {
    const entry = buildAuditEntry(req.context.audit, {
      requestId: req.context.requestId,
      userId: req.context.userId,
      userEmail: req.context.userEmail,
      model: result.model,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      requestCategory: req.context.audit.requestCategory,
      responsePreview: responseText,
      status: "success",
    });
    commitAuditLog(entry).catch(() => {});
  }

  res.json(result);
}

// ── Streaming ───────────────────────────────────────────────────────────────

async function handleStream(
  req: EngineRequest,
  res: Response,
  params: HandlerParams,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", req.context.requestId);
  res.flushHeaders();

  const stream = await createMessageStream({
    model: params.model,
    messages: params.messages,
    max_tokens: params.body.max_tokens,
    system: params.body.system,
    temperature: params.body.temperature,
    top_p: params.body.top_p,
    top_k: params.body.top_k,
    stop_sequences: params.body.stop_sequences,
    metadata: params.body.metadata,
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let streamModel = params.model;
  const responseChunks: string[] = [];

  for await (const event of stream) {
    if (res.destroyed) {
      stream.controller.abort();
      break;
    }

    // Pass through Anthropic SSE events directly
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

    if (event.type === "message_start") {
      if (event.message.model) streamModel = event.message.model;
      if (event.message.usage) inputTokens = event.message.usage.input_tokens;
    }
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      responseChunks.push(event.delta.text);
    }
    if (event.type === "message_delta" && event.usage) {
      outputTokens = event.usage.output_tokens;
    }
  }

  res.end();

  logger.info({
    action: "messages_stream_done",
    requestId: req.context.requestId,
    userId: req.context.userId,
    model: streamModel,
    inputTokens,
    outputTokens,
  });

  // Record usage for budget tracking (fire-and-forget)
  if (req.context.userId) {
    recordUsage({
      userId: req.context.userId,
      model: streamModel,
      inputTokens,
      outputTokens,
      requestCategory: req.context.audit?.requestCategory ?? "general_qa",
    }).catch(() => {});
  }

  // Commit audit log with final token counts from stream (fire-and-forget)
  if (req.context.audit) {
    const entry = buildAuditEntry(req.context.audit, {
      requestId: req.context.requestId,
      userId: req.context.userId,
      userEmail: req.context.userEmail,
      model: streamModel,
      inputTokens,
      outputTokens,
      requestCategory: req.context.audit.requestCategory,
      responsePreview: responseChunks.join(""),
      status: "success",
    });
    commitAuditLog(entry).catch(() => {});
  }
}

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { AppError } from "../middleware/error-handler.js";
import { createMessage, createMessageStream } from "../services/anthropic.js";
import { recordUsage } from "../services/budgetService.js";
import { buildAuditEntry, commitAuditLog } from "../services/auditLogger.js";
import type { EngineRequest } from "../types/common.js";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIMessage,
} from "../types/openai.js";
import type Anthropic from "@anthropic-ai/sdk";

export const chatCompletionsRouter = Router();

// ── Helpers: convert OpenAI format → Anthropic format ───────────────────────

function extractSystemAndMessages(
  messages: OpenAIMessage[],
): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
    } else {
      anthropicMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }
  }

  return { system, messages: anthropicMessages };
}

function mapStopReason(
  reason: string | null,
): "stop" | "length" | "content_filter" | null {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    default:
      return null;
  }
}

// ── POST /v1/chat/completions ───────────────────────────────────────────────

chatCompletionsRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as OpenAIChatCompletionRequest;

      const engineReq = req as EngineRequest;
      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw new AppError("messages is required and must be a non-empty array", 400, "invalid_request");
      }

      const model = body.model || config.anthropic.defaultModel;
      const maxTokens = body.max_tokens ?? config.anthropic.maxTokens;
      const { system, messages } = extractSystemAndMessages(body.messages);

      logger.info({
        action: "chat_completion_start",
        requestId: engineReq.context.requestId,
        userId: engineReq.context.userId,
        model,
        stream: !!body.stream,
        messageCount: body.messages.length,
      });

      if (body.stream) {
        await handleStream(engineReq, res, { model, maxTokens, system, messages, body });
      } else {
        await handleNonStream(engineReq, res, { model, maxTokens, system, messages, body });
      }
    } catch (err) {
      next(err);
    }
  },
);

// ── Non-streaming ───────────────────────────────────────────────────────────

interface HandlerParams {
  model: string;
  maxTokens: number;
  system: string | undefined;
  messages: Anthropic.MessageParam[];
  body: OpenAIChatCompletionRequest;
}

async function handleNonStream(
  req: EngineRequest,
  res: Response,
  params: HandlerParams,
): Promise<void> {
  const result = await createMessage({
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens,
    system: params.system,
    temperature: params.body.temperature,
    top_p: params.body.top_p,
  });

  const textContent = result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const response: OpenAIChatCompletionResponse = {
    id: `chatcmpl-${result.id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: textContent },
        finish_reason: mapStopReason(result.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
      total_tokens: result.usage.input_tokens + result.usage.output_tokens,
    },
  };

  logger.info({
    action: "chat_completion_done",
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
      requestCategory: req.context.audit?.requestCategory ?? "chat_completion",
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
      responsePreview: textContent,
      status: "success",
    });
    commitAuditLog(entry).catch(() => {});
  }

  res.json(response);
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
    max_tokens: params.maxTokens,
    system: params.system,
    temperature: params.body.temperature,
    top_p: params.body.top_p,
  });

  const completionId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  let streamModel = params.model;

  // Send initial chunk with role
  const initialChunk: OpenAIChatCompletionChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model: streamModel,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

  let inputTokens = 0;
  let outputTokens = 0;
  const responseChunks: string[] = [];

  for await (const event of stream) {
    if (res.destroyed) {
      stream.controller.abort();
      break;
    }

    switch (event.type) {
      case "message_start":
        if (event.message.model) streamModel = event.message.model;
        if (event.message.usage) inputTokens = event.message.usage.input_tokens;
        break;

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          responseChunks.push(event.delta.text);
          const chunk: OpenAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: streamModel,
            choices: [
              {
                index: 0,
                delta: { content: event.delta.text },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        break;

      case "message_delta":
        if (event.usage) outputTokens = event.usage.output_tokens;

        const finalChunk: OpenAIChatCompletionChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: streamModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: mapStopReason(event.delta.stop_reason),
            },
          ],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        break;
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();

  logger.info({
    action: "chat_completion_stream_done",
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
      requestCategory: req.context.audit?.requestCategory ?? "chat_completion",
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

import Anthropic from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/streaming";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources";
import type { Message, MessageCreateParamsNonStreaming, MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages";
import { config } from "../config/index.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface CreateMessageParams {
  model: string;
  messages: Anthropic.MessageParam[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  metadata?: { user_id?: string };
}

export async function createMessage(
  params: CreateMessageParams,
): Promise<Message> {
  const body: MessageCreateParamsNonStreaming = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.max_tokens,
    stream: false,
    ...(params.system && { system: params.system }),
    ...(params.temperature != null && { temperature: params.temperature }),
    ...(params.top_p != null && { top_p: params.top_p }),
    ...(params.top_k != null && { top_k: params.top_k }),
    ...(params.stop_sequences && { stop_sequences: params.stop_sequences }),
    ...(params.metadata && { metadata: params.metadata }),
  };

  return client.messages.create(body);
}

export async function createMessageStream(
  params: CreateMessageParams,
): Promise<Stream<RawMessageStreamEvent>> {
  const body: MessageCreateParamsStreaming = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.max_tokens,
    stream: true,
    ...(params.system && { system: params.system }),
    ...(params.temperature != null && { temperature: params.temperature }),
    ...(params.top_p != null && { top_p: params.top_p }),
    ...(params.top_k != null && { top_k: params.top_k }),
    ...(params.stop_sequences && { stop_sequences: params.stop_sequences }),
    ...(params.metadata && { metadata: params.metadata }),
  };

  return client.messages.create(body);
}

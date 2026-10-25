import OpenAI from 'openai';
import type { ModelId } from '../../../shared/models';
import type { AppConfig } from '../config';
import type { ProviderId } from '../../../shared/models';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface LlmRequest {
  modelId: ModelId;
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
}

export interface LlmGateway {
  complete(request: LlmRequest): Promise<LlmResult>;
  stream(request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult>;
}

export class ProviderError extends Error {
  code: string;

  constructor(message: string, code = 'provider_error') {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function fallbackUsage(prompt: string, completion: string): LlmUsage {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

function normalizeUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
  prompt: string,
  completion: string,
): LlmUsage {
  if (!usage || (usage.prompt_tokens === undefined && usage.completion_tokens === undefined)) {
    return fallbackUsage(prompt, completion);
  }
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
    estimated: false,
  };
}

function promptText(messages: ChatMessage[]): string {
  return messages.map(message => `${message.role}: ${message.content}`).join('\n');
}

export class OpenAiCompatibleGateway implements LlmGateway {
  private readonly clients = new Map<ProviderId, OpenAI>();

  constructor(private readonly config: AppConfig) {}

  private route(modelId: ModelId) {
    const route = this.config.routes[modelId];
    if (!route) throw new ProviderError('Unknown model profile', 'unknown_model');
    if (!route.available || !route.model) {
      throw new ProviderError(`No provider route is configured for ${modelId}`, 'model_unavailable');
    }
    return { ...route, model: route.model, provider: route.provider };
  }

  private client(provider: ProviderId): OpenAI {
    const existing = this.clients.get(provider);
    if (existing) return existing;
    const providerConfig = this.config.providers[provider];
    if (!providerConfig.baseUrl || !providerConfig.apiKey) {
      throw new ProviderError(`Provider ${provider} is not configured`, 'provider_unavailable');
    }
    const client = new OpenAI({
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.baseUrl,
      timeout: this.config.requestTimeoutMs,
      maxRetries: 1,
    });
    this.clients.set(provider, client);
    return client;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const route = this.route(request.modelId);
    const providerConfig = this.config.providers[route.provider];
    const client = this.client(route.provider);
    const base = {
      model: route.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1200,
    };
    const jsonMode = Boolean(request.json && providerConfig.jsonMode);
    try {
      let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
      try {
        response = await client.chat.completions.create(
          { ...base, ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}) },
          { signal: request.signal },
        );
      } catch (error) {
        if (!jsonMode || !isBadRequest(error)) throw error;
        response = await client.chat.completions.create(base, { signal: request.signal });
      }
      const completion = response as { choices: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null };
      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) throw new ProviderError('The model returned an empty response', 'empty_response');
      return {
        text,
        usage: normalizeUsage(completion.usage, promptText(request.messages), text),
      };
    } catch (error) {
      throw translateProviderError(error);
    }
  }

  async stream(request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
    const route = this.route(request.modelId);
    const providerConfig = this.config.providers[route.provider];
    const client = this.client(route.provider);
    const base = {
      model: route.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1200,
      stream: true as const,
    };
    const withUsage = {
      ...base,
      ...(providerConfig.streamUsage ? { stream_options: { include_usage: true } } : {}),
    };

    try {
      let stream;
      try {
        stream = await client.chat.completions.create(withUsage, { signal: request.signal });
      } catch (error) {
        if (!providerConfig.streamUsage || !isBadRequest(error)) throw error;
        stream = await client.chat.completions.create(base, { signal: request.signal });
      }
      let text = '';
      let usage: LlmUsage | null = null;
      for await (const chunk of stream) {
        if (request.signal?.aborted) throw new ProviderError('Run cancelled', 'cancelled');
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          text += delta;
          onDelta(delta);
        }
        if (chunk.usage) {
          usage = normalizeUsage(chunk.usage, promptText(request.messages), text);
        }
      }
      if (!text.trim()) throw new ProviderError('The model returned an empty response', 'empty_response');
      return { text, usage: usage ?? fallbackUsage(promptText(request.messages), text) };
    } catch (error) {
      throw translateProviderError(error);
    }
  }
}

function isBadRequest(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 400;
}

function translateProviderError(error: unknown): Error {
  if (error instanceof ProviderError) return error;
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    const message =
      status === 401
        ? 'The provider rejected the API key.'
        : status === 404
          ? 'The configured model or endpoint was not found.'
          : status === 429
            ? 'The provider rate limit was reached. Try again shortly.'
            : `Provider request failed (${status || 'network error'}).`;
    return new ProviderError(message, status === 401 ? 'provider_auth' : 'provider_error');
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderError('Run cancelled', 'cancelled');
  }
  return new ProviderError(error instanceof Error ? error.message : 'Provider request failed', 'provider_error');
}

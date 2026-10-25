import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildConfig } from '../config';
import { OpenAiCompatibleGateway } from './llm';

describe('OpenAI-compatible gateway', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = null;
  });

  it('falls back when optional JSON and stream usage parameters are unsupported', async () => {
    server = http.createServer((request, response) => {
      let raw = '';
      request.on('data', chunk => {
        raw += String(chunk);
      });
      request.on('end', () => {
        const body = JSON.parse(raw || '{}') as { stream?: boolean; response_format?: unknown; stream_options?: unknown };
        if (body.response_format || body.stream_options) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'Unsupported parameter' } }));
          return;
        }
        if (body.stream) {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
          response.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
          response.write('data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n');
          response.write('data: [DONE]\n\n');
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
        );
      });
    });
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const config = buildConfig({
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      OPENAI_API_KEY: 'test',
      TAVILY_API_KEY: 'test',
      MODEL_OBSIDIAN_PROVIDER: 'openai',
      MODEL_OBSIDIAN_NAME: 'test-model',
      MODEL_OPAL_PROVIDER: 'openai',
      MODEL_OPAL_NAME: 'test-model',
      MODEL_JADE_PROVIDER: 'openai',
      MODEL_JADE_NAME: 'test-model',
      MODEL_GARNET_PROVIDER: 'openai',
      MODEL_GARNET_NAME: 'test-model',
      MODEL_TOPAZ_PROVIDER: 'openai',
      MODEL_TOPAZ_NAME: 'test-model',
      MODEL_AVENTURINE_PROVIDER: 'openai',
      MODEL_AVENTURINE_NAME: 'test-model',
    });

    const gateway = new OpenAiCompatibleGateway(config);
    const completion = await gateway.complete({
      modelId: 'obsidian',
      messages: [{ role: 'user', content: 'Return JSON' }],
      json: true,
    });
    expect(completion.text).toBe('{"ok":true}');
    expect(completion.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7, estimated: false });

    let streamed = '';
    const stream = await gateway.stream(
      { modelId: 'obsidian', messages: [{ role: 'user', content: 'Say hello' }] },
      delta => {
        streamed += delta;
      },
    );
    expect(streamed).toBe('Hello world');
    expect(stream.text).toBe('Hello world');
    expect(stream.usage.totalTokens).toBe(6);
  });
});

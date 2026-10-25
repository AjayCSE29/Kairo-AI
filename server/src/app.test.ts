import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildConfig } from './config';
import { createDatabase, getSessionRow, type DB } from './db';
import { createApp } from './app';
import type { LlmGateway, LlmRequest, LlmResult } from './providers/llm';
import type { SearchProvider, SearchResult } from './providers/tavily';
import { extractAttachmentText, UnsupportedAttachmentError } from './ingest/extract';

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimated: false };

function testConfig() {
  return buildConfig({
    HOST: '127.0.0.1',
    PORT: '8787',
    PUBLIC_BASE_URL: 'http://localhost:8787',
    OPENAI_BASE_URL: 'http://openai.test/v1',
    OPENAI_API_KEY: 'test-openai',
    JARVISLABS_BASE_URL: 'http://jarvis.test/v1',
    JARVISLABS_API_KEY: 'test-jarvis',
    TAVILY_API_KEY: 'test-tavily',
    MODEL_OBSIDIAN_NAME: 'obsidian-test',
    MODEL_OPAL_NAME: 'opal-test',
    MODEL_JADE_NAME: 'jade-test',
    MODEL_GARNET_NAME: 'garnet-test',
    MODEL_TOPAZ_NAME: 'topaz-test',
    MODEL_AVENTURINE_NAME: 'aventurine-test',
  });
}

class FakeLlm implements LlmGateway {
  async complete(request: LlmRequest): Promise<LlmResult> {
    const prompt = request.messages.map(message => message.content).join('\n');
    if (prompt.includes('search queries')) {
      return { text: JSON.stringify({ queries: ['language model scaling evidence'] }), usage };
    }
    if (prompt.includes('Extract the most important checkable claims')) {
      return {
        text: JSON.stringify({
          claims: [
            {
              text: 'Scaling improves measured performance on many tasks.',
              sourceIds: ['S1'],
              relation: 'supports',
              detail: 'The source reports broad gains.',
            },
          ],
        }),
        usage,
      };
    }
    if (prompt.includes('Review each claim against only its cited evidence passages')) {
      return {
        text: JSON.stringify({
          claims: [{ id: 'C1', status: 'Supported', detail: 'The cited passage supports the claim.' }],
        }),
        usage,
      };
    }
    throw new Error('Unexpected completion request');
  }

  async stream(_request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
    const text = 'Scaling can improve measured performance [S1], but evidence remains contested.';
    for (const chunk of text.match(/.{1,12}/g) ?? [text]) onDelta(chunk);
    return { text, usage: { ...usage, completionTokens: 12, totalTokens: 22 } };
  }
}

class FakeSearch implements SearchProvider {
  async search(): Promise<SearchResult[]> {
    return [
      {
        url: 'https://example.com/scaling',
        title: 'Scaling evidence',
        content:
          'A long passage of evidence about language model scaling, evaluation methods, and the limits of benchmark performance. '.repeat(4),
        score: 0.9,
        publishedDate: '2024-02-03',
      },
    ];
  }

  async extract(): Promise<Map<string, string>> {
    return new Map();
  }
}

async function waitFor(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Kairo server', () => {
  let db: DB | null = null;
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
    app = null;
    db = null;
  });

  it('reports missing configuration instead of starting with mock data', () => {
    const config = buildConfig({});
    expect(config.configured).toBe(false);
    expect(config.missing).toContain('TAVILY_API_KEY');
    expect(config.missing).toContain('MODEL_OBSIDIAN_NAME');
    expect(Object.values(config.routes).some(route => route.available)).toBe(false);
  });

  it('runs the real pipeline with provider and search adapters and persists the result', async () => {
    db = createDatabase(':memory:');
    const config = testConfig();
    app = await createApp({ config, db, llm: new FakeLlm(), search: new FakeSearch() });

    const created = await app.inject({
      method: 'POST',
      url: '/api/research',
      payload: {
        query: 'Does scaling improve language model performance?',
        modelId: 'jade',
        mode: 'Research',
        effort: 'Medium',
        verify: true,
      },
    });
    expect(created.statusCode).toBe(202);
    const accepted = created.json() as { sessionId: string };
    await waitFor(() => {
      const row = getSessionRow(db!, accepted.sessionId);
      return row?.status === 'completed';
    });

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/api/research/${accepted.sessionId}/events`,
    });
    expect(eventsResponse.headers['content-type']).toContain('text/event-stream');
    expect(eventsResponse.body).toContain('event: stage');
    expect(eventsResponse.body).toContain('event: done');

    const detailResponse = await app.inject({ method: 'GET', url: `/api/sessions/${accepted.sessionId}` });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json().session as {
      answer: { markdown: string } | null;
      sources: Array<{ id: string }>;
      claims: Array<{ status: string }>;
      usage: { totalTokens: number };
    };
    expect(detail.answer?.markdown).toContain('[S1]');
    expect(detail.sources).toHaveLength(1);
    expect(detail.claims[0]?.status).toBe('Supported');
    expect(detail.usage.totalTokens).toBeGreaterThan(0);

    const graphResponse = await app.inject({ method: 'GET', url: `/api/sessions/${accepted.sessionId}/graph` });
    const graph = graphResponse.json().graph as { nodes: unknown[]; edges: unknown[] };
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);

    const shareResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${accepted.sessionId}/share`,
    });
    expect(shareResponse.statusCode).toBe(201);
    const token = (shareResponse.json() as { share: { token: string } }).share.token;
    const publicResponse = await app.inject({ method: 'GET', url: `/api/share/${token}` });
    expect(publicResponse.statusCode).toBe(200);
    expect((publicResponse.json() as { snapshot: { answer: { markdown: string } } }).snapshot.answer.markdown).toContain('[S1]');

    const exportResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${accepted.sessionId}/export?format=md`,
    });
    expect(exportResponse.headers['content-type']).toContain('text/markdown');
    expect(exportResponse.body).toContain('## Sources');
  });

  it('supports session CRUD, preferences, and usage endpoints', async () => {
    db = createDatabase(':memory:');
    app = await createApp({ config: testConfig(), db, llm: new FakeLlm(), search: new FakeSearch() });

    const preferences = await app.inject({ method: 'PUT', url: '/api/preferences', payload: { effort: 'High', verify: false } });
    expect(preferences.statusCode).toBe(200);
    expect(preferences.json().preferences.effort).toBe('High');

    const created = await app.inject({
      method: 'POST',
      url: '/api/research',
      payload: { query: 'A question that produces a session', modelId: 'opal', mode: 'Quick answer', verify: false },
    });
    const sessionId = (created.json() as { sessionId: string }).sessionId;
    await waitFor(() => getSessionRow(db!, sessionId)?.status === 'completed');

    const patched = await app.inject({ method: 'PATCH', url: `/api/sessions/${sessionId}`, payload: { saved: true, title: 'Renamed' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().session.saved).toBe(true);
    expect(patched.json().session.title).toBe('Renamed');

    const usage = await app.inject({ method: 'GET', url: '/api/usage' });
    expect(usage.statusCode).toBe(200);
    expect((usage.json() as { usage: { totals: { runs: number } } }).usage.totals.runs).toBe(1);

    const removed = await app.inject({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    expect(removed.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect((list.json() as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('extracts text attachments and rejects unsupported files', async () => {
    await expect(extractAttachmentText('notes.md', 'text/markdown', Buffer.from('# Notes\n\nEvidence'))).resolves.toContain('Evidence');
    await expect(extractAttachmentText('binary.exe', 'application/octet-stream', Buffer.from([0, 1, 2]))).rejects.toBeInstanceOf(
      UnsupportedAttachmentError,
    );
  });

  it('rejects cross-site state-changing requests', async () => {
    db = createDatabase(':memory:');
    app = await createApp({ config: testConfig(), db });
    const response = await app.inject({
      method: 'POST',
      url: '/api/reset',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects runs when no model route is available', async () => {
    db = createDatabase(':memory:');
    app = await createApp({ config: buildConfig({}), db });
    const response = await app.inject({
      method: 'POST',
      url: '/api/research',
      payload: { query: 'Will this fail clearly?', modelId: 'obsidian', mode: 'Research' },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('model_unavailable');
  });
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { MODELS } from '../../shared/models';
import type {
  AppConfigDTO,
  CreateResearchInput,
  GraphDTO,
  GraphPoint,
  ModelCatalogItemDTO,
  PreferencesDTO,
  ResearchAcceptedDTO,
  ShareSnapshotDTO,
} from '../../shared/types';
import type { AppConfig } from './config';
import {
  countRunningRuns,
  createAttachment,
  createRun,
  createSession,
  createShare,
  attachmentReferencedByOtherSession,
  deleteAttachment,
  deleteSession,
  deleteSharesForSession,
  getAttachmentRow,
  getGraph,
  getPreferences,
  getSessionDetail,
  getSessionRow,
  getShare,
  getUsage as getUsageData,
  latestRunForSession,
  linkAttachment,
  listAttachmentsForSession,
  listEvents,
  listSessions,
  mapAttachment,
  markInterruptedRuns,
  resetAllData,
  resetGraph,
  saveGraph,
  setPreferences,
  updateSession,
  type DB,
} from './db';
import { DEFAULT_PREFERENCES } from './defaults';
import { extractAttachmentText, UnsupportedAttachmentError } from './ingest/extract';
import { OpenAiCompatibleGateway, type LlmGateway } from './providers/llm';
import { TavilySearchProvider, type SearchProvider } from './providers/tavily';
import { ResearchService, isTerminalStatus } from './research/pipeline';
import { subscribe } from './research/events';

const modelIdSchema = z.enum(['obsidian', 'opal', 'jade', 'garnet', 'topaz', 'aventurine']);
const modeSchema = z.enum(['Quick answer', 'Research', 'Deep research']);
const effortSchema = z.enum(['Low', 'Medium', 'High', 'Max']);

const researchSchema = z.object({
  query: z.string().trim().min(3, 'Ask a question with at least three characters.').max(4000),
  modelId: modelIdSchema,
  mode: modeSchema,
  effort: effortSchema.optional(),
  verify: z.boolean().optional(),
  attachmentIds: z.array(z.string()).max(10).optional(),
  parentId: z.string().optional(),
});

const rerunSchema = z.object({
  modelId: modelIdSchema.optional(),
  mode: modeSchema.optional(),
  effort: effortSchema.optional(),
  verify: z.boolean().optional(),
});

const followupSchema = z.object({
  query: z.string().trim().min(3, 'Ask a follow-up with at least three characters.').max(4000),
  modelId: modelIdSchema.optional(),
  mode: modeSchema.optional(),
  effort: effortSchema.optional(),
  verify: z.boolean().optional(),
});

const sessionUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    saved: z.boolean().optional(),
  })
  .refine(value => value.title !== undefined || value.saved !== undefined, {
    message: 'Nothing to update.',
  });

const preferencesSchema = z.object({
  modelId: modelIdSchema.optional(),
  mode: modeSchema.optional(),
  verify: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  effort: effortSchema.optional(),
});

const graphPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const graphSchema = z.object({
  positions: z.record(z.string(), graphPointSchema),
  memos: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        text: z.string().max(4000),
        position: graphPointSchema,
      }),
    )
    .max(50),
});

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = 'bad_request',
    readonly missing?: string[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface CreateAppOptions {
  config: AppConfig;
  db: DB;
  llm?: LlmGateway;
  search?: SearchProvider;
  service?: ResearchService;
  serveStatic?: boolean;
  logger?: boolean;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid request.', 'validation');
  }
  return parsed.data;
}

function titleFor(query: string): string {
  return query.length > 72 ? `${query.slice(0, 69)}…` : query;
}

function configDto(config: AppConfig): AppConfigDTO {
  return {
    configured: config.configured,
    missing: config.missing,
    providers: {
      openai: { configured: Boolean(config.providers.openai.baseUrl && config.providers.openai.apiKey) },
      jarvislabs: { configured: Boolean(config.providers.jarvislabs.baseUrl && config.providers.jarvislabs.apiKey) },
      tavily: { configured: Boolean(config.tavilyApiKey) },
    },
  };
}

function graphForSession(db: DB, sessionId: string): GraphDTO {
  return getGraph(db, sessionId);
}

function shareSnapshot(db: DB, sessionId: string): ShareSnapshotDTO | null {
  const session = getSessionDetail(db, sessionId);
  if (!session) return null;
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    title: session.title,
    query: session.query,
    modelId: session.modelId,
    mode: session.mode,
    date: session.date,
    usage: session.usage,
    answer: session.answer,
    sources: session.sources,
    claims: session.claims,
    graph: graphForSession(db, sessionId),
  };
}

function exportMarkdown(db: DB, sessionId: string): string | null {
  const session = getSessionDetail(db, sessionId);
  if (!session) return null;
  const model = MODELS.find(item => item.id === session.modelId);
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `> ${session.query}`,
    '',
    `- Model: ${model?.name ?? session.modelId}`,
    `- Mode: ${session.mode}`,
    `- Date: ${session.date}`,
    `- Verification: ${session.verified ? 'JEV evidence review requested' : 'Not requested'}`,
    '',
    '## Answer',
    '',
    session.answer?.markdown ?? '_No answer was produced._',
    '',
    '## Sources',
    '',
  ];
  if (session.sources.length) {
    for (const source of session.sources) {
      lines.push(`- **[${source.id}]** ${source.title} — ${source.domain}${source.url ? ` — ${source.url}` : ''}`);
      lines.push(`  - ${source.excerpt}`);
    }
  } else {
    lines.push('_No sources._');
  }
  lines.push('', '## Claims', '');
  if (session.claims.length) {
    for (const claim of session.claims) {
      lines.push(`- **${claim.id} · ${claim.status}** — ${claim.text}`);
      if (claim.detail) lines.push(`  - ${claim.detail}`);
      lines.push(`  - Evidence: ${claim.sourceIds.join(', ') || 'none'}`);
    }
  } else {
    lines.push('_No claims were extracted._');
  }
  lines.push(
    '',
    '---',
    '',
    'Evidence statuses reflect the cited material available to this run. They are not a certification of absolute truth.',
    '',
  );
  return lines.join('\n');
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  const service =
    options.service ??
    new ResearchService({
      db,
      config,
      llm: options.llm ?? new OpenAiCompatibleGateway(config),
      search: options.search ?? new TavilySearchProvider(config),
    });

  markInterruptedRuns(db);

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
  });

  app.setErrorHandler((error, request, reply) => {
    const failure = error as { code?: string; statusCode?: number; message?: string };
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({
        error: { message: error.message, code: error.code, ...(error.missing ? { missing: error.missing } : {}) },
      });
      return;
    }
    if (failure.code === 'FST_REQ_FILE_TOO_LARGE') {
      reply.code(413).send({ error: { message: 'The file exceeds the upload size limit.', code: 'file_too_large' } });
      return;
    }
    const status = typeof failure.statusCode === 'number' && failure.statusCode >= 400 ? failure.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    reply.code(status).send({
      error: {
        message: status >= 500 ? 'The server could not complete this request.' : failure.message ?? 'The request could not be completed.',
        code: status >= 500 ? 'internal_error' : 'request_error',
      },
    });
  });

  app.addHook('onRequest', async (request, reply) => {
    const unsafe = request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE';
    if (unsafe && request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: { message: 'Cross-site requests are not allowed.', code: 'forbidden' } });
    }
  });

  app.get('/api/health', async () => ({ ok: true, configured: config.configured }));

  app.get('/api/config', async () => ({ config: configDto(config) }));

  app.get('/api/models', async () => {
    const models: ModelCatalogItemDTO[] = MODELS.map(profile => {
      const route = config.routes[profile.id];
      return {
        ...profile,
        route: {
          provider: route.provider,
          model: route.model,
          available: route.available,
        },
      };
    });
    return { models };
  });

  app.get('/api/preferences', async () => ({ preferences: getPreferences(db) }));

  app.put('/api/preferences', async (request, reply) => {
    const patch = parseBody(preferencesSchema.partial(), request.body);
    const current = getPreferences(db);
    const next: PreferencesDTO = { ...current, ...patch };
    const route = config.routes[next.modelId];
    if (!route?.available) {
      throw new HttpError(400, 'That model profile is not configured on this server.', 'model_unavailable');
    }
    setPreferences(db, next);
    reply.send({ preferences: next });
  });

  app.get('/api/sessions', async request => {
    const query = request.query as { search?: string; saved?: string; model?: string };
    const sessions = listSessions(db, {
      search: query.search?.trim(),
      saved: query.saved === 'true' || query.saved === '1',
      model: query.model,
    });
    return { sessions };
  });

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSessionDetail(db, sessionId);
    if (!session) throw new HttpError(404, 'Investigation not found.', 'not_found');
    reply.send({ session });
  });

  app.patch('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!getSessionRow(db, sessionId)) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const patch = parseBody(sessionUpdateSchema, request.body);
    updateSession(db, sessionId, patch);
    reply.send({ session: getSessionDetail(db, sessionId) });
  });

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!getSessionRow(db, sessionId)) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const activeRun = latestRunForSession(db, sessionId);
    if (activeRun && !isTerminalStatus(activeRun.status)) service.cancel(activeRun.id);
    const attachments = listAttachmentsForSession(db, sessionId);
    deleteSharesForSession(db, sessionId);
    deleteSession(db, sessionId);
    for (const attachment of attachments) {
      if (attachmentReferencedByOtherSession(db, attachment.id, sessionId)) continue;
      const row = getAttachmentRow(db, attachment.id);
      if (row) {
        try {
          fs.rmSync(row.path, { force: true });
        } catch {
          // The database record is the source of truth; a missing file is harmless.
        }
        deleteAttachment(db, attachment.id);
      }
    }
    reply.code(204).send();
  });

  app.get('/api/sessions/:sessionId/export', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = request.query as { format?: string };
    const session = getSessionDetail(db, sessionId);
    if (!session) throw new HttpError(404, 'Investigation not found.', 'not_found');
    if (query.format === 'json') {
      const snapshot = shareSnapshot(db, sessionId);
      reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="kairo-${sessionId}.json"`)
        .send(JSON.stringify(snapshot, null, 2));
      return;
    }
    const markdown = exportMarkdown(db, sessionId) ?? '';
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="kairo-${sessionId}.md"`)
      .send(markdown);
  });

  app.get('/api/sessions/:sessionId/graph', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!getSessionRow(db, sessionId)) throw new HttpError(404, 'Investigation not found.', 'not_found');
    reply.send({ graph: graphForSession(db, sessionId) });
  });

  app.put('/api/sessions/:sessionId/graph', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!getSessionRow(db, sessionId)) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const input = parseBody(graphSchema, request.body);
    saveGraph(db, sessionId, input.positions as Record<string, GraphPoint>, input.memos);
    reply.send({ graph: graphForSession(db, sessionId) });
  });

  app.post('/api/sessions/:sessionId/graph/reset', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (!getSessionRow(db, sessionId)) throw new HttpError(404, 'Investigation not found.', 'not_found');
    resetGraph(db, sessionId);
    reply.send({ graph: graphForSession(db, sessionId) });
  });

  app.post('/api/sessions/:sessionId/share', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const snapshot = shareSnapshot(db, sessionId);
    if (!snapshot) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const token = crypto.randomBytes(24).toString('base64url');
    deleteSharesForSession(db, sessionId);
    const share = createShare(db, token, sessionId, snapshot);
    reply.code(201).send({
      share: {
        token,
        createdAt: share.created_at,
        url: `${config.publicBaseUrl}/share/${token}`,
      },
    });
  });

  app.delete('/api/sessions/:sessionId/share/:token', async (request, reply) => {
    const { sessionId, token } = request.params as { sessionId: string; token: string };
    const share = getShare(db, token);
    if (!share || share.sessionId !== sessionId) throw new HttpError(404, 'Share link not found.', 'not_found');
    deleteSharesForSession(db, sessionId);
    reply.code(204).send();
  });

  app.get('/api/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const share = getShare(db, token);
    if (!share) throw new HttpError(404, 'This share link is invalid or has been revoked.', 'not_found');
    reply.send({ snapshot: share.snapshot });
  });

  app.get('/api/usage', async () => ({ usage: getUsageData(db) }));

  const startResearch = (input: CreateResearchInput): ResearchAcceptedDTO => {
    const route = config.routes[input.modelId];
    if (!route?.available || !route.model) {
      throw new HttpError(400, 'That model profile is not configured on this server.', 'model_unavailable');
    }
    if (countRunningRuns(db) >= config.maxConcurrentRuns) {
      throw new HttpError(429, 'Another research run is already in progress. Try again shortly.', 'busy');
    }
    if (input.parentId && !getSessionRow(db, input.parentId)) {
      throw new HttpError(400, 'The parent investigation no longer exists.', 'invalid_parent');
    }
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (attachmentIds.length > config.maxAttachments) {
      throw new HttpError(400, `Attach at most ${config.maxAttachments} files.`, 'too_many_attachments');
    }
    const attachmentRows = attachmentIds.map(id => {
      const row = getAttachmentRow(db, id);
      if (!row) throw new HttpError(400, 'One of the attachments no longer exists.', 'invalid_attachment');
      return row;
    });

    const sessionId = `r-${crypto.randomUUID()}`;
    const runId = `run-${crypto.randomUUID()}`;
    createSession(db, {
      id: sessionId,
      title: titleFor(input.query),
      query: input.query,
      modelId: input.modelId,
      mode: input.mode,
      effort: input.effort ?? 'Medium',
      verify: input.verify ?? true,
      parentId: input.parentId ?? null,
    });
    for (const row of attachmentRows) linkAttachment(db, sessionId, row.id);
    createRun(db, {
      id: runId,
      sessionId,
      provider: route.provider,
      model: route.model,
    });
    service.start({ sessionId, runId });
    return { sessionId, runId };
  };

  app.post('/api/research', async (request, reply) => {
    const input = parseBody(researchSchema, request.body);
    const accepted = startResearch(input);
    reply.code(202).send(accepted);
  });

  app.post('/api/research/:sessionId/rerun', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSessionRow(db, sessionId);
    if (!session) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const patch = parseBody(rerunSchema, request.body ?? {});
    const accepted = startResearch({
      query: session.query,
      modelId: (patch.modelId ?? session.model_id) as CreateResearchInput['modelId'],
      mode: (patch.mode ?? session.mode) as CreateResearchInput['mode'],
      effort: (patch.effort ?? session.effort) as CreateResearchInput['effort'],
      verify: patch.verify ?? Boolean(session.verify),
      attachmentIds: listAttachmentsForSession(db, sessionId).map(item => item.id),
      parentId: sessionId,
    });
    reply.code(202).send(accepted);
  });

  app.post('/api/research/:sessionId/followup', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSessionRow(db, sessionId);
    if (!session) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const input = parseBody(followupSchema, request.body);
    const accepted = startResearch({
      query: input.query,
      modelId: (input.modelId ?? session.model_id) as CreateResearchInput['modelId'],
      mode: (input.mode ?? session.mode) as CreateResearchInput['mode'],
      effort: (input.effort ?? session.effort) as CreateResearchInput['effort'],
      verify: input.verify ?? Boolean(session.verify),
      attachmentIds: listAttachmentsForSession(db, sessionId).map(item => item.id),
      parentId: sessionId,
    });
    reply.code(202).send(accepted);
  });

  app.post('/api/research/:sessionId/cancel', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const run = latestRunForSession(db, sessionId);
    if (!run) throw new HttpError(404, 'Investigation not found.', 'not_found');
    if (isTerminalStatus(run.status)) throw new HttpError(409, 'This run has already finished.', 'already_finished');
    if (!service.cancel(run.id)) {
      throw new HttpError(409, 'This run is not active on this server.', 'not_running');
    }
    reply.code(202).send({ ok: true });
  });

  app.get('/api/research/:sessionId/events', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = getSessionRow(db, sessionId);
    if (!session) throw new HttpError(404, 'Investigation not found.', 'not_found');
    const run = latestRunForSession(db, sessionId);
    if (!run) throw new HttpError(404, 'This investigation has no run.', 'not_found');

    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const header = request.headers['last-event-id'];
    const headerValue = Array.isArray(header) ? header[0] : header;
    const requestedAfter = Number(headerValue ?? 0);
    let lastSent = Number.isFinite(requestedAfter) && requestedAfter > 0 ? requestedAfter : 0;
    let ready = false;
    let closed = false;
    const buffered: Array<{ seq: number; type: string; payload: unknown }> = [];

    const end = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      try {
        raw.end();
      } catch {
        // Connection is already gone.
      }
    };

    const send = (seq: number, type: string, payload: unknown) => {
      if (closed || raw.writableEnded) return;
      try {
        raw.write(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        end();
      }
    };

    const deliver = (event: { seq: number; type: string; payload: unknown }) => {
      if (closed || event.seq <= lastSent) return;
      lastSent = event.seq;
      send(event.seq, event.type, event.payload);
      if (event.type === 'done' || event.type === 'error') end();
    };

    const unsubscribe = subscribe(run.id, event => {
      if (!ready) {
        buffered.push(event);
        return;
      }
      deliver(event);
    });

    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        raw.write(': ping\n\n');
      } catch {
        end();
      }
    }, 15000);

    request.raw.on('close', end);

    for (;;) {
      const rows = listEvents(db, run.id, lastSent);
      if (!rows.length) break;
      for (const row of rows) {
        if (closed) break;
        try {
          deliver({ seq: row.seq, type: row.type, payload: JSON.parse(row.payload) as unknown });
        } catch {
          // Skip an unreadable event rather than terminating the stream.
        }
      }
      if (closed || rows.length < 500) break;
    }
    ready = true;
    for (const event of buffered) {
      if (closed) break;
      deliver(event);
    }

    if (!closed && isTerminalStatus(run.status)) {
      const latest = latestRunForSession(db, sessionId);
      if (!latest || latest.status !== 'running' && latest.status !== 'queued') end();
    }
    return reply;
  });

  app.post('/api/attachments', async (request, reply) => {
    const file = await request.file();
    if (!file) throw new HttpError(400, 'No file was uploaded.', 'missing_file');
    const filename = path.basename(file.filename || 'attachment').slice(0, 180);
    const buffer = await file.toBuffer();
    if (buffer.length > config.maxUploadBytes) {
      throw new HttpError(413, 'The file exceeds the upload size limit.', 'file_too_large');
    }
    let text: string;
    try {
      text = await extractAttachmentText(filename, file.mimetype, buffer);
    } catch (error) {
      if (error instanceof UnsupportedAttachmentError) {
        throw new HttpError(400, error.message, 'unsupported_attachment');
      }
      throw new HttpError(400, 'Could not read this attachment.', 'attachment_failed');
    }
    const id = `att-${crypto.randomUUID()}`;
    const extension = path.extname(filename).toLowerCase().slice(0, 12);
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const destination = path.join(config.uploadDir, `${id}${extension}`);
    fs.writeFileSync(destination, buffer);
    const createdAt = new Date().toISOString();
    createAttachment(db, {
      id,
      filename,
      mime: file.mimetype,
      size: buffer.length,
      path: destination,
      text,
      created_at: createdAt,
    });
    const row = getAttachmentRow(db, id)!;
    reply.code(201).send({ attachment: mapAttachment(row) });
  });

  app.delete('/api/attachments/:attachmentId', async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const row = getAttachmentRow(db, attachmentId);
    if (!row) throw new HttpError(404, 'Attachment not found.', 'not_found');
    try {
      fs.rmSync(row.path, { force: true });
    } catch {
      // Ignore a missing file.
    }
    deleteAttachment(db, attachmentId);
    reply.code(204).send();
  });

  app.post('/api/reset', async (_request, reply) => {
    service.cancelAll();
    resetAllData(db);
    try {
      for (const entry of fs.readdirSync(config.uploadDir)) {
        fs.rmSync(path.join(config.uploadDir, entry), { force: true, recursive: true });
      }
    } catch {
      // Uploads directory may not exist yet.
    }
    reply.send({ preferences: getPreferences(db) ?? DEFAULT_PREFERENCES });
  });

  if (options.serveStatic) {
    const dist = path.join(config.rootDir, 'dist');
    if (fs.existsSync(dist)) {
      await app.register(fastifyStatic, { root: dist, prefix: '/' });
      app.setNotFoundHandler((request, reply) => {
        if (request.method === 'GET' && !request.url.startsWith('/api')) {
          reply.sendFile('index.html');
          return;
        }
        reply.code(404).send({ error: { message: 'Not found.', code: 'not_found' } });
      });
    }
  }

  return app;
}

export { HttpError };

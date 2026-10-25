import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AnswerDTO,
  AttachmentDTO,
  ClaimDTO,
  ClaimStatus,
  GraphDTO,
  GraphMemoDTO,
  GraphPoint,
  PreferencesDTO,
  SessionDetailDTO,
  SessionStatus,
  SessionSummaryDTO,
  SourceDTO,
  StageUsageDTO,
  UsageDTO,
  UsageSummaryDTO,
} from '../../shared/types';
import type { Effort, ModelId, ResearchMode } from '../../shared/models';
import { DEFAULT_PREFERENCES } from './defaults';
import { MODELS } from '../../shared/models';

export type DB = Database.Database;

export interface SessionRow {
  id: string;
  title: string;
  query: string;
  model_id: string;
  mode: string;
  effort: string;
  verify: number;
  status: string;
  parent_id: string | null;
  error: string | null;
  answer_markdown: string | null;
  citations_json: string | null;
  saved: number;
  created_at: string;
  completed_at: string | null;
}

export interface RunRow {
  id: string;
  session_id: string;
  status: string;
  stage: string | null;
  provider: string;
  model: string;
  error: string | null;
  search_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: number;
  created_at: string;
  finished_at: string | null;
}

interface SourceRow {
  session_id: string;
  id: string;
  idx: number;
  url: string | null;
  title: string;
  domain: string;
  kind: string;
  published_date: string;
  excerpt: string;
  content: string;
  relevance: number;
  relationship: string;
}

interface ClaimRow {
  session_id: string;
  id: string;
  idx: number;
  text: string;
  status: string;
  detail: string;
  source_ids_json: string;
  relations_json: string;
}

interface EventRow {
  run_id: string;
  seq: number;
  type: string;
  payload: string;
}

export interface AttachmentRow {
  id: string;
  filename: string;
  mime: string;
  size: number;
  path: string;
  text: string;
  created_at: string;
}

interface ShareRow {
  token: string;
  session_id: string;
  snapshot_json: string;
  created_at: string;
}

export interface CreateSessionInput {
  id: string;
  title: string;
  query: string;
  modelId: ModelId;
  mode: ResearchMode;
  effort: Effort;
  verify: boolean;
  parentId?: string | null;
}

export interface CreateRunInput {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function displayDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function createDatabase(file: string): DB {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      query TEXT NOT NULL,
      model_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      effort TEXT NOT NULL DEFAULT 'Medium',
      verify INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued',
      parent_id TEXT,
      error TEXT,
      answer_markdown TEXT,
      citations_json TEXT,
      saved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      error TEXT,
      search_count INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stage_usage (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (run_id, stage)
    );

    CREATE TABLE IF NOT EXISTS sources (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      url TEXT,
      title TEXT NOT NULL,
      domain TEXT NOT NULL,
      kind TEXT NOT NULL,
      published_date TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL,
      content TEXT NOT NULL,
      relevance INTEGER NOT NULL DEFAULT 0,
      relationship TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE IF NOT EXISTS claims (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Not checked',
      detail TEXT NOT NULL DEFAULT '',
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      relations_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE IF NOT EXISTS events (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS graph_layout (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      PRIMARY KEY (session_id, node_id)
    );

    CREATE TABLE IF NOT EXISTS graph_memos (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      text TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_attachments (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, attachment_id)
    );

    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      verify INTEGER NOT NULL,
      reduced_motion INTEGER NOT NULL,
      effort TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_shares_session ON shares(session_id, created_at DESC);
  `);

  const existing = db.prepare('SELECT id FROM preferences WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO preferences (id, model_id, mode, verify, reduced_motion, effort)
       VALUES (1, ?, ?, ?, ?, ?)`,
    ).run(
      DEFAULT_PREFERENCES.modelId,
      DEFAULT_PREFERENCES.mode,
      DEFAULT_PREFERENCES.verify ? 1 : 0,
      DEFAULT_PREFERENCES.reducedMotion ? 1 : 0,
      DEFAULT_PREFERENCES.effort,
    );
  }
}

export function createSession(db: DB, input: CreateSessionInput): SessionRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, title, query, model_id, mode, effort, verify, status, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.query,
    input.modelId,
    input.mode,
    input.effort,
    input.verify ? 1 : 0,
    input.parentId ?? null,
    now,
  );
  return getSessionRow(db, input.id)!;
}

export function getSessionRow(db: DB, id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function createRun(db: DB, input: CreateRunInput): RunRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO runs (id, session_id, status, provider, model, created_at)
     VALUES (?, ?, 'queued', ?, ?, ?)`,
  ).run(input.id, input.sessionId, input.provider, input.model, now);
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(input.id) as RunRow;
}

export function getRun(db: DB, id: string): RunRow | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
}

export function latestRunForSession(db: DB, sessionId: string): RunRow | undefined {
  return db
    .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId) as RunRow | undefined;
}

export function setRunStage(db: DB, runId: string, stage: string) {
  db.prepare('UPDATE runs SET stage = ?, status = ? WHERE id = ?').run(stage, 'running', runId);
}

export function setSessionStatus(db: DB, sessionId: string, status: SessionStatus, error: string | null = null) {
  const completedAt = status === 'completed' || status === 'failed' || status === 'cancelled' ? new Date().toISOString() : null;
  db.prepare('UPDATE sessions SET status = ?, error = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?').run(
    status,
    error,
    completedAt,
    sessionId,
  );
}

export function finishRun(
  db: DB,
  runId: string,
  input: { status: SessionStatus; error?: string | null; searchCount?: number },
) {
  db.prepare(
    `UPDATE runs SET status = ?, error = ?, search_count = COALESCE(?, search_count), finished_at = ? WHERE id = ?`,
  ).run(input.status, input.error ?? null, input.searchCount ?? null, new Date().toISOString(), runId);
}

export function recordStageUsage(
  db: DB,
  runId: string,
  usage: { stage: string; promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean; durationMs: number },
) {
  db.prepare(
    `INSERT INTO stage_usage (run_id, stage, prompt_tokens, completion_tokens, total_tokens, estimated, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, stage) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       total_tokens = total_tokens + excluded.total_tokens,
       estimated = MAX(estimated, excluded.estimated),
       duration_ms = duration_ms + excluded.duration_ms`,
  ).run(runId, usage.stage, usage.promptTokens, usage.completionTokens, usage.totalTokens, usage.estimated ? 1 : 0, usage.durationMs);
}

export function updateRunTotals(db: DB, runId: string) {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(prompt_tokens),0) AS prompt, COALESCE(SUM(completion_tokens),0) AS completion,
              COALESCE(SUM(total_tokens),0) AS total, COALESCE(MAX(estimated),0) AS estimated
       FROM stage_usage WHERE run_id = ?`,
    )
    .get(runId) as { prompt: number; completion: number; total: number; estimated: number };
  db.prepare('UPDATE runs SET prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, estimated = ? WHERE id = ?').run(
    totals.prompt,
    totals.completion,
    totals.total,
    totals.estimated,
    runId,
  );
}

export function countRunningRuns(db: DB): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued','running')`).get() as { count: number };
  return row.count;
}

export function insertSource(db: DB, sessionId: string, source: SourceDTO, content: string, index: number) {
  db.prepare(
    `INSERT INTO sources (session_id, id, idx, url, title, domain, kind, published_date, excerpt, content, relevance, relationship)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    source.id,
    index,
    source.url ?? null,
    source.title,
    source.domain,
    source.kind,
    source.date,
    source.excerpt,
    content,
    source.relevance,
    source.relationship,
  );
}

export function updateSourceRelationship(db: DB, sessionId: string, sourceId: string, relationship: string) {
  db.prepare('UPDATE sources SET relationship = ? WHERE session_id = ? AND id = ?').run(relationship, sessionId, sourceId);
}

export function insertClaim(
  db: DB,
  sessionId: string,
  claim: ClaimDTO,
  index: number,
  relations: Record<string, string>,
) {
  db.prepare(
    `INSERT INTO claims (session_id, id, idx, text, status, detail, source_ids_json, relations_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, id) DO UPDATE SET
       text = excluded.text, status = excluded.status, detail = excluded.detail,
       source_ids_json = excluded.source_ids_json, relations_json = excluded.relations_json`,
  ).run(
    sessionId,
    claim.id,
    index,
    claim.text,
    claim.status,
    claim.detail,
    JSON.stringify(claim.sourceIds),
    JSON.stringify(relations),
  );
}

export function updateClaimStatus(db: DB, sessionId: string, claim: ClaimDTO) {
  db.prepare('UPDATE claims SET status = ?, detail = ? WHERE session_id = ? AND id = ?').run(
    claim.status,
    claim.detail,
    sessionId,
    claim.id,
  );
}

export function setAnswer(db: DB, sessionId: string, answer: AnswerDTO) {
  db.prepare('UPDATE sessions SET answer_markdown = ?, citations_json = ? WHERE id = ?').run(
    answer.markdown,
    JSON.stringify(answer.citations),
    sessionId,
  );
}

export function updateSession(db: DB, id: string, input: { title?: string; saved?: boolean }) {
  if (input.title !== undefined) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(input.title, id);
  }
  if (input.saved !== undefined) {
    db.prepare('UPDATE sessions SET saved = ? WHERE id = ?').run(input.saved ? 1 : 0, id);
  }
  return getSessionRow(db, id);
}

export function deleteSession(db: DB, id: string) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function linkAttachment(db: DB, sessionId: string, attachmentId: string) {
  db.prepare('INSERT OR IGNORE INTO session_attachments (session_id, attachment_id) VALUES (?, ?)').run(
    sessionId,
    attachmentId,
  );
}

export function attachmentsWithTextForSession(db: DB, sessionId: string): AttachmentRow[] {
  return db
    .prepare(
      `SELECT a.* FROM attachments a
       JOIN session_attachments sa ON sa.attachment_id = a.id
       WHERE sa.session_id = ?
       ORDER BY a.created_at ASC`,
    )
    .all(sessionId) as AttachmentRow[];
}

export function listAttachmentsForSession(db: DB, sessionId: string): AttachmentDTO[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM attachments a
       JOIN session_attachments sa ON sa.attachment_id = a.id
       WHERE sa.session_id = ?
       ORDER BY a.created_at ASC`,
    )
    .all(sessionId) as AttachmentRow[];
  return rows.map(mapAttachment);
}

export function mapAttachment(row: AttachmentRow): AttachmentDTO {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    extractedChars: row.text.length,
    createdAt: row.created_at,
  };
}

export function createAttachment(db: DB, row: AttachmentRow) {
  db.prepare(
    `INSERT INTO attachments (id, filename, mime, size, path, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.filename, row.mime, row.size, row.path, row.text, row.created_at);
}

export function getAttachmentRow(db: DB, id: string): AttachmentRow | undefined {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
}

export function attachmentReferencedByOtherSession(db: DB, attachmentId: string, sessionId: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM session_attachments WHERE attachment_id = ? AND session_id <> ? LIMIT 1')
      .get(attachmentId, sessionId),
  );
}

export function deleteAttachment(db: DB, id: string) {
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
}

export function getPreferences(db: DB): PreferencesDTO {
  const row = db.prepare('SELECT * FROM preferences WHERE id = 1').get() as
    | { model_id: string; mode: string; verify: number; reduced_motion: number; effort: string }
    | undefined;
  if (!row) return DEFAULT_PREFERENCES;
  return {
    modelId: row.model_id as ModelId,
    mode: row.mode as ResearchMode,
    verify: Boolean(row.verify),
    reducedMotion: Boolean(row.reduced_motion),
    effort: row.effort as Effort,
  };
}

export function setPreferences(db: DB, preferences: PreferencesDTO) {
  db.prepare('UPDATE preferences SET model_id = ?, mode = ?, verify = ?, reduced_motion = ?, effort = ? WHERE id = 1').run(
    preferences.modelId,
    preferences.mode,
    preferences.verify ? 1 : 0,
    preferences.reducedMotion ? 1 : 0,
    preferences.effort,
  );
}

export function appendEvent(db: DB, runId: string, type: string, payload: unknown): number {
  const next = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE run_id = ?').get(runId) as {
    seq: number;
  };
  db.prepare('INSERT INTO events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
    runId,
    next.seq,
    type,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
  return next.seq;
}

export function listEvents(db: DB, runId: string, afterSeq: number, limit = 500): EventRow[] {
  return db
    .prepare('SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?')
    .all(runId, afterSeq, limit) as EventRow[];
}

export function usageForRun(db: DB, runId: string): UsageSummaryDTO {
  const run = getRun(db, runId);
  const stages = db.prepare('SELECT * FROM stage_usage WHERE run_id = ? ORDER BY rowid ASC').all(runId) as Array<{
    stage: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated: number;
    duration_ms: number;
  }>;
  return {
    promptTokens: run?.prompt_tokens ?? 0,
    completionTokens: run?.completion_tokens ?? 0,
    totalTokens: run?.total_tokens ?? 0,
    estimated: Boolean(run?.estimated),
    searchCount: run?.search_count ?? 0,
    stages: stages.map<StageUsageDTO>(stage => ({
      stage: stage.stage as StageUsageDTO['stage'],
      promptTokens: stage.prompt_tokens,
      completionTokens: stage.completion_tokens,
      totalTokens: stage.total_tokens,
      estimated: Boolean(stage.estimated),
      durationMs: stage.duration_ms,
    })),
  };
}

export function usageForSession(db: DB, sessionId: string): UsageSummaryDTO | null {
  const run = latestRunForSession(db, sessionId);
  if (!run) return null;
  return usageForRun(db, run.id);
}

function sourceRows(db: DB, sessionId: string): SourceRow[] {
  return db.prepare('SELECT * FROM sources WHERE session_id = ? ORDER BY idx ASC').all(sessionId) as SourceRow[];
}

function claimRows(db: DB, sessionId: string): ClaimRow[] {
  return db.prepare('SELECT * FROM claims WHERE session_id = ? ORDER BY idx ASC').all(sessionId) as ClaimRow[];
}

export function sourcesForSession(db: DB, sessionId: string): SourceDTO[] {
  return sourceRows(db, sessionId).map(mapSourceRow);
}

export function claimsForSession(db: DB, sessionId: string): ClaimDTO[] {
  return claimRows(db, sessionId).map(mapClaimRow);
}

function mapSourceRow(row: SourceRow): SourceDTO {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    kind: row.kind,
    date: row.published_date,
    excerpt: row.excerpt,
    relevance: row.relevance,
    relationship: row.relationship,
    ...(row.url ? { url: row.url } : {}),
  };
}

function mapClaimRow(row: ClaimRow): ClaimDTO {
  return {
    id: row.id,
    text: row.text,
    status: row.status as ClaimStatus,
    sourceIds: parseJson<string[]>(row.source_ids_json, []),
    detail: row.detail,
  };
}

export function mapSessionSummary(db: DB, row: SessionRow): SessionSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    query: row.query,
    modelId: row.model_id as ModelId,
    mode: row.mode as ResearchMode,
    effort: row.effort as Effort,
    verified: Boolean(row.verify),
    saved: Boolean(row.saved),
    status: row.status as SessionStatus,
    parentId: row.parent_id,
    date: displayDate(row.created_at),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    error: row.error,
    usage: usageForSession(db, row.id),
  };
}

export function mapSessionDetail(db: DB, row: SessionRow): SessionDetailDTO {
  const run = latestRunForSession(db, row.id);
  const share = db
    .prepare('SELECT token FROM shares WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(row.id) as { token: string } | undefined;
  const answer =
    row.answer_markdown !== null
      ? {
          markdown: row.answer_markdown,
          citations: parseJson<AnswerDTO['citations']>(row.citations_json, []),
        }
      : null;
  return {
    ...mapSessionSummary(db, row),
    sources: sourcesForSession(db, row.id),
    claims: claimsForSession(db, row.id),
    answer,
    attachments: listAttachmentsForSession(db, row.id),
    runId: run?.id ?? null,
    shareToken: share?.token ?? null,
  };
}

export function getSessionDetail(db: DB, id: string): SessionDetailDTO | null {
  const row = getSessionRow(db, id);
  return row ? mapSessionDetail(db, row) : null;
}

export function listSessions(
  db: DB,
  filters: { search?: string; saved?: boolean; model?: string } = {},
): SessionSummaryDTO[] {
  let sql = 'SELECT * FROM sessions';
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.search) {
    where.push('(LOWER(title) LIKE ? OR LOWER(query) LIKE ?)');
    const like = `%${filters.search.toLowerCase()}%`;
    params.push(like, like);
  }
  if (filters.saved) where.push('saved = 1');
  if (filters.model && filters.model !== 'All models') {
    const model = MODELS.find(item => item.name === filters.model);
    if (model) {
      where.push('model_id = ?');
      params.push(model.id);
    }
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params) as SessionRow[];
  return rows.map(row => mapSessionSummary(db, row));
}

export function getGraph(db: DB, sessionId: string): GraphDTO {
  const sources = sourceRows(db, sessionId);
  const claims = claimRows(db, sessionId);
  const session = getSessionRow(db, sessionId);
  const layoutRows = db.prepare('SELECT * FROM graph_layout WHERE session_id = ?').all(sessionId) as Array<{
    node_id: string;
    x: number;
    y: number;
  }>;
  const layout: Record<string, GraphPoint> = {};
  for (const row of layoutRows) layout[row.node_id] = { x: row.x, y: row.y };

  const nodes: GraphDTO['nodes'] = [];
  const edges: GraphDTO['edges'] = [];

  if (session) {
    nodes.push({
      id: 'q',
      kind: 'question',
      label: session.query,
      position: layout.q ?? { x: 330, y: 20 },
      className: 'graph-question',
    });
  }

  claims.forEach((claim, index) => {
    nodes.push({
      id: claim.id,
      kind: 'claim',
      label: claim.text,
      position: layout[claim.id] ?? { x: 300 + index * 40, y: 180 + index * 150 },
      className: 'graph-claim',
      status: claim.status as ClaimStatus,
    });
    edges.push({ id: `q-${claim.id}`, source: 'q', target: claim.id });
    const relations = parseJson<Record<string, string>>(claim.relations_json, {});
    const sourceIds = parseJson<string[]>(claim.source_ids_json, []);
    for (const sourceId of sourceIds) {
      const relation = relations[sourceId] ?? 'evidence';
      edges.push({
        id: `${sourceId}-${claim.id}`,
        source: sourceId,
        target: claim.id,
        label: relation === 'challenges' ? 'challenges' : 'evidence',
        dashed: relation === 'challenges',
      });
    }
  });

  sources.forEach((source, index) => {
    nodes.push({
      id: source.id,
      kind: 'source',
      label: source.title,
      position: layout[source.id] ?? { x: index % 2 === 0 ? 40 : 610, y: 200 + Math.floor(index / 2) * 175 },
      className: 'graph-source',
    });
  });

  const memos = db.prepare('SELECT * FROM graph_memos WHERE session_id = ? ORDER BY rowid ASC').all(sessionId) as Array<{
    id: string;
    text: string;
    x: number;
    y: number;
  }>;

  return {
    nodes,
    edges,
    layout,
    memos: memos.map(memo => ({ id: memo.id, text: memo.text, position: { x: memo.x, y: memo.y } })),
  };
}

export function saveGraph(db: DB, sessionId: string, positions: Record<string, GraphPoint>, memos: GraphMemoDTO[]) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM graph_layout WHERE session_id = ?').run(sessionId);
    const insertLayout = db.prepare('INSERT INTO graph_layout (session_id, node_id, x, y) VALUES (?, ?, ?, ?)');
    for (const [nodeId, point] of Object.entries(positions)) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      insertLayout.run(sessionId, nodeId, point.x, point.y);
    }
    db.prepare('DELETE FROM graph_memos WHERE session_id = ?').run(sessionId);
    const insertMemo = db.prepare('INSERT INTO graph_memos (session_id, id, text, x, y) VALUES (?, ?, ?, ?, ?)');
    for (const memo of memos) {
      insertMemo.run(sessionId, memo.id, memo.text.slice(0, 4000), memo.position.x, memo.position.y);
    }
  });
  transaction();
}

export function resetGraph(db: DB, sessionId: string) {
  db.prepare('DELETE FROM graph_layout WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM graph_memos WHERE session_id = ?').run(sessionId);
}

export function createShare(db: DB, token: string, sessionId: string, snapshot: unknown): ShareRow {
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO shares (token, session_id, snapshot_json, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    sessionId,
    JSON.stringify(snapshot),
    createdAt,
  );
  return { token, session_id: sessionId, snapshot_json: JSON.stringify(snapshot), created_at: createdAt };
}

export function getShare(db: DB, token: string): { sessionId: string; snapshot: unknown; createdAt: string } | null {
  const row = db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    snapshot: parseJson<unknown>(row.snapshot_json, null),
    createdAt: row.created_at,
  };
}

export function deleteShare(db: DB, token: string) {
  db.prepare('DELETE FROM shares WHERE token = ?').run(token);
}

export function deleteSharesForSession(db: DB, sessionId: string) {
  db.prepare('DELETE FROM shares WHERE session_id = ?').run(sessionId);
}

export function getUsage(db: DB): UsageDTO {
  const sessions = db
    .prepare(`SELECT * FROM sessions WHERE status = 'completed' ORDER BY created_at DESC LIMIT 100`)
    .all() as SessionRow[];
  const rows: UsageDTO['sessions'] = sessions.map(session => {
    const run = latestRunForSession(db, session.id);
    return {
      id: session.id,
      title: session.title,
      modelId: session.model_id as ModelId,
      mode: session.mode as ResearchMode,
      date: displayDate(session.created_at),
      completedAt: session.completed_at,
      promptTokens: run?.prompt_tokens ?? 0,
      completionTokens: run?.completion_tokens ?? 0,
      totalTokens: run?.total_tokens ?? 0,
      estimated: Boolean(run?.estimated),
      searchCount: run?.search_count ?? 0,
    };
  });
  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS runs,
              COALESCE(SUM(r.prompt_tokens),0) AS prompt,
              COALESCE(SUM(r.completion_tokens),0) AS completion,
              COALESCE(SUM(r.total_tokens),0) AS total,
              COALESCE(MAX(r.estimated),0) AS estimated,
              COALESCE(SUM(r.search_count),0) AS searches
       FROM sessions s JOIN runs r ON r.session_id = s.id
       WHERE s.status = 'completed'`,
    )
    .get() as { runs: number; prompt: number; completion: number; total: number; estimated: number; searches: number };
  const byModelRows = db
    .prepare(
      `SELECT s.model_id AS modelId, COUNT(DISTINCT s.id) AS runs,
              COALESCE(SUM(r.total_tokens),0) AS total, COALESCE(SUM(r.search_count),0) AS searches
       FROM sessions s JOIN runs r ON r.session_id = s.id
       WHERE s.status = 'completed'
       GROUP BY s.model_id ORDER BY total DESC`,
    )
    .all() as Array<{ modelId: string; runs: number; total: number; searches: number }>;
  return {
    totals: {
      runs: totals.runs,
      promptTokens: totals.prompt,
      completionTokens: totals.completion,
      totalTokens: totals.total,
      estimated: Boolean(totals.estimated),
      searchCount: totals.searches,
    },
    byModel: byModelRows.map(row => ({
      modelId: row.modelId as ModelId,
      runs: row.runs,
      totalTokens: row.total,
      searchCount: row.searches,
    })),
    sessions: rows,
  };
}

export function resetAllData(db: DB) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM shares').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM attachments').run();
    db.prepare('DELETE FROM preferences').run();
  });
  transaction();
  db.prepare(
    `INSERT INTO preferences (id, model_id, mode, verify, reduced_motion, effort) VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_PREFERENCES.modelId,
    DEFAULT_PREFERENCES.mode,
    DEFAULT_PREFERENCES.verify ? 1 : 0,
    DEFAULT_PREFERENCES.reducedMotion ? 1 : 0,
    DEFAULT_PREFERENCES.effort,
  );
}

export function markInterruptedRuns(db: DB) {
  const now = new Date().toISOString();
  db.prepare(`UPDATE runs SET status = 'failed', error = 'Server restarted before this run finished', finished_at = ? WHERE status IN ('queued','running')`).run(now);
  db.prepare(`UPDATE sessions SET status = 'failed', error = 'Server restarted before this run finished', completed_at = ? WHERE status IN ('queued','running')`).run(now);
}

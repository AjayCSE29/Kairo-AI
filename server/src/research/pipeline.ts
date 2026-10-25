import { z } from 'zod';
import type { ClaimDTO, ResearchEvent, RunStage, SourceDTO } from '../../../shared/types';
import type { AppConfig } from '../config';
import type { DB } from '../db';
import {
  appendEvent,
  attachmentsWithTextForSession,
  finishRun,
  getSessionDetail,
  getRun,
  getSessionRow,
  insertClaim,
  insertSource,
  recordStageUsage,
  setAnswer,
  setRunStage,
  setSessionStatus,
  updateClaimStatus,
  updateRunTotals,
  updateSourceRelationship,
  usageForRun,
} from '../db';
import { EFFORT_PRESETS, MODE_PRESETS, type ModelId } from '../../../shared/models';
import type { LlmGateway, LlmRequest, LlmUsage } from '../providers/llm';
import { ProviderError } from '../providers/llm';
import type { SearchProvider, SearchResult } from '../providers/tavily';
import { publish } from './events';
import { buildCitations, normalizeCitationMarkers } from './citations';
import { claimsPrompt, EVIDENCE_SYSTEM_PROMPT, plannerPrompt, synthesisPrompt, verificationPrompt } from './prompts';
import { domainForUrl, parseSafeHttpUrl } from '../security/url';

export interface ResearchDependencies {
  db: DB;
  config: AppConfig;
  llm: LlmGateway;
  search: SearchProvider;
}

export interface ResearchJob {
  sessionId: string;
  runId: string;
}

const plannerSchema = z.object({
  queries: z.array(z.string().trim().min(3)).min(1).max(8),
});

const sourceIdList = z.preprocess(
  value => {
    if (typeof value === 'string') return value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
    return value;
  },
  z.array(z.string()).default([]),
) as z.ZodType<string[]>;

const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().trim().min(3),
        sourceIds: sourceIdList,
        relation: z.enum(['supports', 'challenges', 'context']).default('supports'),
        detail: z.string().default(''),
      }),
    )
    .default([]),
});

const verificationSchema = z.object({
  claims: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(['Supported', 'Insufficient evidence', 'Contradicted']),
        detail: z.string().default(''),
      }),
    )
    .default([]),
});

type StageProgress = { started: number; completed: number };

const STAGE_PROGRESS: Record<RunStage, StageProgress> = {
  planning: { started: 3, completed: 10 },
  searching: { started: 12, completed: 28 },
  extracting: { started: 30, completed: 45 },
  claims: { started: 47, completed: 62 },
  verification: { started: 64, completed: 76 },
  synthesis: { started: 78, completed: 94 },
  finalizing: { started: 96, completed: 100 },
};

const STAGE_LABELS: Record<RunStage, string> = {
  planning: 'Planning the investigation',
  searching: 'Searching for relevant sources',
  extracting: 'Extracting evidence',
  claims: 'Identifying checkable claims',
  verification: 'Reviewing claims against evidence',
  synthesis: 'Synthesizing a cited answer',
  finalizing: 'Preparing the result',
};

function parseJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in model response.');
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

function isCancellation(error: unknown): boolean {
  return (
    (error instanceof ProviderError && error.code === 'cancelled') ||
    (error instanceof Error && (error.name === 'AbortError' || error.message === 'Run cancelled'))
  );
}

function isFatalProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    ['provider_auth', 'provider_unavailable', 'model_unavailable', 'unknown_model'].includes(error.code)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSourceId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function normalizeClaimId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function excerpt(value: string, max = 600) {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}…` : cleaned;
}

function promptSource(source: SourceDTO, content: string | undefined, maxChars: number) {
  const text = content?.trim() || source.excerpt;
  return {
    id: source.id,
    title: source.title,
    domain: source.domain,
    excerpt: text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text,
    relationship: source.relationship,
    ...(source.url ? { url: source.url } : {}),
  };
}

function relationshipForSource(sourceId: string, claims: ClaimDTO[], relations: Map<string, string>): string {
  const related = claims.filter(claim => claim.sourceIds.includes(sourceId));
  if (!related.length) return 'Background evidence';
  const supporting = related.filter(claim => relations.get(`${sourceId}:${claim.id}`) !== 'challenges');
  const challenging = related.filter(claim => relations.get(`${sourceId}:${claim.id}`) === 'challenges');
  const parts: string[] = [];
  if (supporting.length) parts.push(`Relates to ${supporting.map(claim => claim.id).join(', ')}`);
  if (challenging.length) parts.push(`Challenges ${challenging.map(claim => claim.id).join(', ')}`);
  return parts.join(' · ');
}

export class ResearchService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: ResearchDependencies) {}

  start(job: ResearchJob) {
    const controller = new AbortController();
    this.controllers.set(job.runId, controller);
    void this.execute(job, controller.signal).finally(() => this.controllers.delete(job.runId));
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  private emit(runId: string, event: ResearchEvent) {
    const seq = appendEvent(this.deps.db, runId, event.type, event);
    publish(runId, { seq, type: event.type, payload: event });
  }

  private async execute(job: ResearchJob, signal: AbortSignal) {
    try {
      await runPipeline(job, this.deps, signal, event => this.emit(job.runId, event));
    } catch (error) {
      const cancelled = isCancellation(error) || signal.aborted;
      const message = cancelled
        ? 'Run cancelled. No further provider calls were made.'
        : error instanceof Error
          ? error.message
          : 'Research failed unexpectedly.';
      try {
        setSessionStatus(this.deps.db, job.sessionId, cancelled ? 'cancelled' : 'failed', message);
        finishRun(this.deps.db, job.runId, { status: cancelled ? 'cancelled' : 'failed', error: message });
        updateRunTotals(this.deps.db, job.runId);
        if (getRun(this.deps.db, job.runId)) {
          this.emit(job.runId, {
            type: 'error',
            message,
            code: cancelled ? 'cancelled' : error instanceof ProviderError ? error.code : 'research_failed',
          });
        }
      } catch {
        // The session may have been deleted or reset while the run was unwinding.
      }
    }
  }
}

export async function runPipeline(
  job: ResearchJob,
  deps: ResearchDependencies,
  signal: AbortSignal,
  emit: (event: ResearchEvent) => void,
): Promise<void> {
  const { db, llm, search } = deps;
  const session = getSessionRow(db, job.sessionId);
  if (!session) throw new Error('Session not found.');
  setSessionStatus(db, session.id, 'running');
  const modelId = session.model_id as ModelId;
  const mode = session.mode as keyof typeof MODE_PRESETS;
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.Research;
  const effort = EFFORT_PRESETS[(session.effort as keyof typeof EFFORT_PRESETS) ?? 'Medium'] ?? EFFORT_PRESETS.Medium;
  const attachments = attachmentsWithTextForSession(db, session.id);
  const parent = session.parent_id ? getSessionRow(db, session.parent_id) : undefined;
  const query = session.query;
  const parentContext = parent?.answer_markdown ? parent.answer_markdown.slice(0, 5000) : null;
  const researchQuestion = parent ? `${query}\n\nPrevious investigation question: ${parent.query}` : query;

  const stage = async <T>(name: RunStage, work: () => Promise<T>): Promise<T> => {
    const progress = STAGE_PROGRESS[name];
    setRunStage(db, job.runId, name);
    emit({ type: 'stage', stage: name, label: STAGE_LABELS[name], status: 'started', progress: progress.started });
    try {
      const result = await work();
      emit({ type: 'stage', stage: name, label: STAGE_LABELS[name], status: 'completed', progress: progress.completed });
      return result;
    } catch (error) {
      emit({ type: 'stage', stage: name, label: STAGE_LABELS[name], status: 'failed', progress: progress.started });
      throw error;
    }
  };

  const recordUsage = (name: RunStage, usage: LlmUsage, startedAt: number) => {
    recordStageUsage(db, job.runId, {
      stage: name,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimated: usage.estimated,
      durationMs: Date.now() - startedAt,
    });
    updateRunTotals(db, job.runId);
  };

  const complete = async (name: RunStage, request: LlmRequest) => {
    const startedAt = Date.now();
    const result = await llm.complete({ ...request, signal });
    recordUsage(name, result.usage, startedAt);
    return result;
  };

  const completeJson = async <S extends z.ZodTypeAny>(name: RunStage, request: LlmRequest, schema: S): Promise<z.output<S>> => {
    const first = await complete(name, { ...request, json: true });
    try {
      const parsed = schema.safeParse(parseJsonObject(first.text));
      if (parsed.success) return parsed.data;
      throw new Error(parsed.error.issues.map(issue => issue.message).join('; '));
    } catch (firstError) {
      const repair = await complete(name, {
        ...request,
        json: true,
        messages: [
          ...request.messages,
          { role: 'assistant', content: first.text },
          {
            role: 'user',
            content: `That response was not valid for the required JSON schema (${firstError instanceof Error ? firstError.message : 'invalid JSON'}). Return only valid JSON matching the requested shape.`,
          },
        ],
      });
      const parsed = schema.safeParse(parseJsonObject(repair.text));
      if (!parsed.success) throw new Error('The model did not return usable structured output.');
      return parsed.data;
    }
  };

  const attachmentSources: SourceDTO[] = attachments.map((attachment, index) => ({
    id: `S${index + 1}`,
    title: attachment.filename,
    domain: 'Attachment',
    kind: 'Uploaded file',
    date: '',
    excerpt: excerpt(attachment.text, 600),
    relevance: 100,
    relationship: 'Uploaded evidence',
  }));

  let sources: SourceDTO[] = [];
  const contentById = new Map<string, string>();
  let searchCount = 0;
  let plannedQueries: string[] = [query];

  await stage('planning', async () => {
    let queries: string[] = [query];
    try {
      const planned = await completeJson(
        'planning',
        {
          modelId,
          messages: [
            { role: 'system', content: EVIDENCE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: plannerPrompt(researchQuestion, preset.queries + effort.extraQueries, attachments.map(item => item.filename)),
            },
          ],
          maxTokens: 500,
          temperature: 0.2,
        },
        plannerSchema,
      );
      queries = planned.queries.slice(0, preset.queries + effort.extraQueries);
    } catch (error) {
      if (isFatalProviderError(error) || isCancellation(error)) throw error;
      queries = [query];
    }
    plannedQueries = queries;
  });

  const searchResults: SearchResult[] = await stage('searching', async () => {
    const collected: SearchResult[] = [];
    const perQuery = Math.max(3, Math.ceil(preset.maxSources / plannedQueries.length) + 2);
    let failures = 0;
    for (const plannedQuery of plannedQueries) {
      if (signal.aborted) throw new ProviderError('Run cancelled', 'cancelled');
      try {
        const results = await search.search(plannedQuery, {
          maxResults: Math.min(perQuery, 10),
          depth: mode === 'Quick answer' ? 'basic' : 'advanced',
          signal,
        });
        searchCount += 1;
        collected.push(...results);
      } catch (error) {
        if (isCancellation(error)) throw error;
        failures += 1;
      }
    }
    if (failures === plannedQueries.length && !attachments.length) {
      throw new Error('Web search failed for every query. Check the Tavily key and try again.');
    }
    const seen = new Set<string>();
    return collected.filter(result => {
      const safe = parseSafeHttpUrl(result.url);
      if (!safe || seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });
  });

  await stage('extracting', async () => {
    const selected = searchResults.slice(0, preset.maxSources);
    const missing = selected.filter(result => result.content.trim().length < 240).map(result => result.url).slice(0, 6);
    if (missing.length) {
      try {
        const extracted = await search.extract(missing, signal);
        for (const result of selected) {
          const raw = extracted.get(result.url);
          if (raw && raw.trim().length > result.content.trim().length) result.content = raw.trim();
        }
      } catch (error) {
        if (isCancellation(error)) throw error;
      }
    }

    const webSources: SourceDTO[] = selected.map((result, index) => {
      const safe = parseSafeHttpUrl(result.url)!;
      const content = result.content.trim();
      return {
        id: `S${attachmentSources.length + index + 1}`,
        title: result.title.trim() || safe.hostname,
        domain: domainForUrl(result.url),
        kind: 'Web source',
        date: (result.publishedDate ?? '').slice(0, 10),
        excerpt: excerpt(content || result.title, 600),
        relevance: clamp(Math.round(result.score * 100) || 92 - index * 5, 1, 100),
        relationship: 'Retrieved evidence',
        url: result.url,
      };
    });

    sources = [...attachmentSources, ...webSources];
    if (!sources.length) {
      throw new Error('No usable sources were found. Try a broader question or add an attachment.');
    }

    for (const [index, source] of sources.entries()) {
      const original =
        index < attachments.length
          ? attachments[index].text
          : searchResults.find(result => result.url === source.url)?.content ?? '';
      insertSource(db, session.id, source, original.slice(0, 16000), index);
      contentById.set(source.id, original.slice(0, 16000) || source.excerpt);
    }
    emit({ type: 'sources', sources });
  });

  let claims: ClaimDTO[] = [];
  const relations = new Map<string, string>();

  await stage('claims', async () => {
    if (!sources.length) return;
    const maxClaims = mode === 'Quick answer' ? 3 : mode === 'Research' ? 5 : 6;
    try {
      const result = await completeJson(
        'claims',
        {
          modelId,
          messages: [
            { role: 'system', content: EVIDENCE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: claimsPrompt(
                researchQuestion,
                sources.map(source => promptSource(source, contentById.get(source.id), preset.sourceChars)),
                maxClaims,
              ),
            },
          ],
          maxTokens: 1400,
          temperature: 0.1,
        },
        claimsSchema,
      );
      const validIds = new Set(sources.map(source => source.id));
      const seenText = new Set<string>();
      const extracted: ClaimDTO[] = [];
      result.claims.forEach((claim, index) => {
        const sourceIds = [...new Set(claim.sourceIds.map(normalizeSourceId))].filter(id => validIds.has(id));
        const text = claim.text.trim();
        if (!text || !sourceIds.length || seenText.has(text.toLowerCase())) return;
        seenText.add(text.toLowerCase());
        const id = `C${index + 1}`;
        for (const sourceId of sourceIds) relations.set(`${sourceId}:${id}`, claim.relation);
        extracted.push({
          id,
          text,
          status: 'Not checked',
          sourceIds,
          detail: claim.detail.trim() || 'Pending evidence review.',
        });
      });
      claims = extracted.slice(0, maxClaims);
      if (claims.length) {
        const rawRelations = new Map<string, Record<string, string>>();
        for (const [key, relation] of relations) {
          const [sourceId, claimId] = key.split(':');
          const map = rawRelations.get(claimId) ?? {};
          map[sourceId] = relation;
          rawRelations.set(claimId, map);
        }
        claims.forEach((claim, index) => insertClaim(db, session.id, claim, index, rawRelations.get(claim.id) ?? {}));
      }
      emit({ type: 'claims', claims });
      if (claims.length) {
        for (const source of sources) {
          const relationship = relationshipForSource(source.id, claims, relations);
          source.relationship = relationship;
          updateSourceRelationship(db, session.id, source.id, relationship);
        }
        emit({ type: 'sources', sources });
      }
    } catch (error) {
      if (isFatalProviderError(error) || isCancellation(error)) throw error;
      claims = [];
      emit({ type: 'claims', claims });
    }
  });

  if (session.verify && claims.length) {
    await stage('verification', async () => {
      try {
        const citedIds = new Set(claims.flatMap(claim => claim.sourceIds));
        const citedSources = sources.filter(source => citedIds.has(source.id));
        const result = await completeJson(
          'verification',
          {
            modelId,
            messages: [
              { role: 'system', content: EVIDENCE_SYSTEM_PROMPT },
              {
                role: 'user',
                content: verificationPrompt(
                  researchQuestion,
                  claims.map(claim => ({ id: claim.id, text: claim.text, sourceIds: claim.sourceIds })),
                  citedSources.map(source => promptSource(source, contentById.get(source.id), preset.sourceChars)),
                ),
              },
            ],
            maxTokens: 1600,
            temperature: 0.05,
          },
          verificationSchema,
        );
        const byId = new Map(result.claims.map(item => [normalizeClaimId(item.id), item]));
        claims = claims.map(claim => {
          const review = byId.get(normalizeClaimId(claim.id));
          if (!review) return claim;
          return {
            ...claim,
            status: review.status,
            detail: review.detail.trim() || claim.detail,
          };
        });
        for (const claim of claims) updateClaimStatus(db, session.id, claim);
        emit({ type: 'claims', claims });
      } catch (error) {
        if (isFatalProviderError(error) || isCancellation(error)) throw error;
      }
    });
  }

  await stage('synthesis', async () => {
    const cited = new Set(claims.flatMap(claim => claim.sourceIds));
    const ordered = [
      ...sources.filter(source => cited.has(source.id)),
      ...sources.filter(source => !cited.has(source.id)),
    ];
    const answerSources = ordered.slice(0, preset.answerSources);
    const validIds = new Set(answerSources.map(source => source.id));
    const startedAt = Date.now();
    let streamed = '';
    let pending = '';
    let lastFlush = Date.now();
    const flush = () => {
      if (!pending) return;
      emit({ type: 'delta', text: pending });
      pending = '';
      lastFlush = Date.now();
    };
    const result = await llm.stream(
      {
        modelId,
        messages: [
          { role: 'system', content: EVIDENCE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: synthesisPrompt(
              query,
              answerSources.map(source => promptSource(source, contentById.get(source.id), preset.sourceChars)),
              claims,
              parentContext,
            ),
          },
        ],
        maxTokens: effort.maxTokens,
        temperature: effort.temperature,
        signal,
      },
      delta => {
        streamed += delta;
        pending += delta;
        if (pending.length >= 80 || Date.now() - lastFlush >= 120) flush();
      },
    );
    flush();
    recordUsage('synthesis', result.usage, startedAt);
    const markdown = normalizeCitationMarkers(result.text || streamed, validIds).trim();
    if (!markdown) throw new Error('The model returned an empty answer.');
    setAnswer(db, session.id, {
      markdown,
      citations: buildCitations(answerSources),
    });
  });

  await stage('finalizing', async () => {
    updateRunTotals(db, job.runId);
    finishRun(db, job.runId, { status: 'completed', searchCount });
    setSessionStatus(db, session.id, 'completed');
    const total = usageForRun(db, job.runId);
    emit({ type: 'usage', usage: total });
    const detail = getSessionDetail(db, session.id);
    if (detail) emit({ type: 'done', session: detail });
  });
}

export function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}


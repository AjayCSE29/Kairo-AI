import type { Effort, ModelId, ProviderId, ResearchMode } from './models';

export type ClaimStatus = 'Supported' | 'Insufficient evidence' | 'Contradicted' | 'Not checked';
export type SessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStatus = SessionStatus;
export type RunStage =
  | 'planning'
  | 'searching'
  | 'extracting'
  | 'claims'
  | 'verification'
  | 'synthesis'
  | 'finalizing';

export interface SourceDTO {
  id: string;
  title: string;
  domain: string;
  kind: string;
  date: string;
  excerpt: string;
  relevance: number;
  relationship: string;
  url?: string;
}

export interface ClaimDTO {
  id: string;
  text: string;
  status: ClaimStatus;
  sourceIds: string[];
  detail: string;
}

export interface CitationDTO {
  sourceId: string;
  index: number;
  title: string;
  domain: string;
  url?: string;
}

export interface AnswerDTO {
  markdown: string;
  citations: CitationDTO[];
}

export interface StageUsageDTO {
  stage: RunStage;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  durationMs: number;
}

export interface UsageSummaryDTO {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  searchCount: number;
  stages: StageUsageDTO[];
}

export interface SessionSummaryDTO {
  id: string;
  title: string;
  query: string;
  modelId: ModelId;
  mode: ResearchMode;
  effort: Effort;
  verified: boolean;
  saved: boolean;
  status: SessionStatus;
  parentId: string | null;
  date: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  usage: UsageSummaryDTO | null;
}

export interface SessionDetailDTO extends SessionSummaryDTO {
  sources: SourceDTO[];
  claims: ClaimDTO[];
  answer: AnswerDTO | null;
  attachments: AttachmentDTO[];
  runId: string | null;
  shareToken: string | null;
}

export interface AttachmentDTO {
  id: string;
  filename: string;
  mime: string;
  size: number;
  extractedChars: number;
  createdAt: string;
}

export interface PreferencesDTO {
  modelId: ModelId;
  mode: ResearchMode;
  verify: boolean;
  reducedMotion: boolean;
  effort: Effort;
}

export interface ProviderStatusDTO {
  configured: boolean;
}

export interface AppConfigDTO {
  configured: boolean;
  missing: string[];
  providers: {
    openai: ProviderStatusDTO;
    jarvislabs: ProviderStatusDTO;
    tavily: ProviderStatusDTO;
  };
}

export interface ModelRouteDTO {
  provider: ProviderId;
  model: string | null;
  available: boolean;
}

export interface ModelCatalogItemDTO {
  id: ModelId;
  name: string;
  role: string;
  description: string;
  multiplier: number;
  tone: string;
  speed: string;
  depth: string;
  harness: string[];
  route: ModelRouteDTO;
}

export interface CreateResearchInput {
  query: string;
  modelId: ModelId;
  mode: ResearchMode;
  effort?: Effort;
  verify?: boolean;
  attachmentIds?: string[];
  parentId?: string;
}

export interface UpdateSessionInput {
  title?: string;
  saved?: boolean;
}

export interface UpdatePreferencesInput extends Partial<PreferencesDTO> {}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphMemoDTO {
  id: string;
  text: string;
  position: GraphPoint;
}

export type GraphNodeKind = 'question' | 'claim' | 'source' | 'memo';

export interface GraphNodeDTO {
  id: string;
  kind: GraphNodeKind;
  label: string;
  position: GraphPoint;
  className?: string;
  status?: ClaimStatus;
}

export interface GraphEdgeDTO {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
}

export interface GraphDTO {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  memos: GraphMemoDTO[];
  layout: Record<string, GraphPoint>;
}

export interface UpdateGraphInput {
  positions: Record<string, GraphPoint>;
  memos: GraphMemoDTO[];
}

export interface UsageRowDTO {
  id: string;
  title: string;
  modelId: ModelId;
  mode: ResearchMode;
  date: string;
  completedAt: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  searchCount: number;
}

export interface UsageDTO {
  totals: {
    runs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimated: boolean;
    searchCount: number;
  };
  byModel: Array<{
    modelId: ModelId;
    runs: number;
    totalTokens: number;
    searchCount: number;
  }>;
  sessions: UsageRowDTO[];
}

export interface ShareDTO {
  token: string;
  createdAt: string;
  url: string;
}

export interface ShareSnapshotDTO {
  version: number;
  createdAt: string;
  title: string;
  query: string;
  modelId: ModelId;
  mode: ResearchMode;
  date: string;
  usage: UsageSummaryDTO | null;
  answer: AnswerDTO | null;
  sources: SourceDTO[];
  claims: ClaimDTO[];
  graph: GraphDTO;
}

export type StageStatus = 'started' | 'completed' | 'failed';

export type ResearchEvent =
  | { type: 'stage'; stage: RunStage; label: string; status: StageStatus; progress: number }
  | { type: 'sources'; sources: SourceDTO[] }
  | { type: 'claims'; claims: ClaimDTO[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: UsageSummaryDTO }
  | { type: 'done'; session: SessionDetailDTO }
  | { type: 'error'; message: string; code?: string };

export interface ResearchAcceptedDTO {
  sessionId: string;
  runId: string;
}

export interface ApiErrorBody {
  error: {
    message: string;
    code?: string;
    missing?: string[];
  };
}

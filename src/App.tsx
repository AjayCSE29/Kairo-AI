import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Background,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Library,
  LoaderCircle,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { EFFORTS, MODELS, MODE_PRESETS, RESEARCH_MODES, type Effort, type ModelId, type ResearchMode } from '../shared/models';
import type {
  AppConfigDTO,
  AttachmentDTO,
  ClaimDTO,
  CreateResearchInput,
  GraphDTO,
  GraphMemoDTO,
  GraphNodeDTO,
  ModelCatalogItemDTO,
  PreferencesDTO,
  SessionDetailDTO,
  SessionSummaryDTO,
  SourceDTO,
  StageStatus,
} from '../shared/types';
import { ApiError, api, subscribeToResearch, type ResearchSubscription } from './api';
import { AnswerMarkdown } from './Markdown';
import SettingsModels from './SettingsModels';
import UsagePage from './UsagePage';

type Section = 'Answer' | 'Sources' | 'Claims' | 'Graph';
type Notify = (message: string) => void;
type UpdatePreferences = (patch: Partial<PreferencesDTO>) => void;

const promptOptions = [
  'Can small language models reason reliably?',
  'Compare vector search architectures',
  'What makes a scientific source trustworthy?',
];


function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Something went wrong.';
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'failed') return 'Failed';
  return status;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState<{
    config: AppConfigDTO;
    preferences: PreferencesDTO;
    models: ModelCatalogItemDTO[];
    sessions: SessionSummaryDTO[];
  } | null>(null);
  const [fatal, setFatal] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState('');

  const notify = useCallback<Notify>(message => setToast(message), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getConfig(), api.getPreferences(), api.getModels(), api.listSessions()])
      .then(async ([configResponse, preferencesResponse, modelsResponse, sessionsResponse]) => {
        if (cancelled) return;
        const models = modelsResponse.models;
        let preferences = preferencesResponse.preferences;
        const currentModel = models.find(model => model.id === preferences.modelId);
        if ((!currentModel || !currentModel.route.available) && configResponse.config.configured) {
          const fallback = models.find(model => model.route.available);
          if (fallback) {
            preferences = { ...preferences, modelId: fallback.id };
            api.updatePreferences({ modelId: fallback.id }).catch(() => undefined);
          }
        }
        setBootstrap({ config: configResponse.config, preferences, models, sessions: sessionsResponse.sessions });
      })
      .catch(error => {
        if (!cancelled) setFatal(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  const refreshSessions = useCallback(async () => {
    const response = await api.listSessions();
    setBootstrap(current => (current ? { ...current, sessions: response.sessions } : current));
    return response.sessions;
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') refreshSessions().catch(() => undefined);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshSessions]);

  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    refreshSessions().catch(() => undefined);
  }, [location.pathname, refreshSessions]);

  const updatePreferences = useCallback<UpdatePreferences>(
    patch => {
      setBootstrap(current =>
        current ? { ...current, preferences: { ...current.preferences, ...patch } } : current,
      );
      api
        .updatePreferences(patch)
        .then(response => {
          setBootstrap(current => (current ? { ...current, preferences: response.preferences } : current));
        })
        .catch(error => {
          notify(errorMessage(error));
          api
            .getPreferences()
            .then(response =>
              setBootstrap(current => (current ? { ...current, preferences: response.preferences } : current)),
            )
            .catch(() => undefined);
        });
    },
    [notify],
  );

  const createResearch = useCallback(
    async (input: CreateResearchInput) => {
      const accepted = await api.createResearch(input);
      await refreshSessions().catch(() => undefined);
      navigate(`/research/${accepted.sessionId}`);
    },
    [navigate, refreshSessions],
  );

  useEffect(() => {
    if (!bootstrap) return;
    const active = bootstrap.sessions.some(session => session.status === 'running' || session.status === 'queued');
    if (!active) return;
    const timer = window.setInterval(() => {
      refreshSessions().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [bootstrap, refreshSessions]);

  const resetAll = useCallback(async () => {
    const response = await api.reset();
    let preferences = response.preferences;
    const currentModels = bootstrap?.models ?? [];
    const selected = currentModels.find(model => model.id === preferences.modelId);
    if (!selected?.route.available) {
      const fallback = currentModels.find(model => model.route.available);
      if (fallback) {
        preferences = { ...preferences, modelId: fallback.id };
        api.updatePreferences({ modelId: fallback.id }).catch(() => undefined);
      }
    }
    setBootstrap(current => (current ? { ...current, preferences, sessions: [] } : current));
    notify('Local research data was removed');
  }, [bootstrap?.models, notify]);

  if (location.pathname.startsWith('/share/')) {
    const token = location.pathname.split('/')[2] ?? '';
    return <SharePage token={token} />;
  }

  if (fatal) {
    return (
      <div className="setup-shell">
        <div className="setup-card">
          <span className="setup-icon"><AlertTriangle size={20} /></span>
          <h1>Kairo cannot start</h1>
          <p>{fatal}</p>
          <button className="primary-btn" onClick={() => window.location.reload()}>
            Retry <RefreshCw size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="setup-shell">
        <div className="setup-card setup-loading">
          <LoaderCircle size={18} className="spin" />
          <p>Starting Kairo…</p>
        </div>
      </div>
    );
  }

  if (!bootstrap.config.configured) {
    return <SetupPage config={bootstrap.config} />;
  }

  const { preferences, models, sessions, config } = bootstrap;
  const activeId = location.pathname.startsWith('/research/') ? location.pathname.split('/')[2] : null;
  const current = activeId ? sessions.find(session => session.id === activeId) : undefined;
  const breadcrumb = location.pathname === '/library'
    ? 'Library'
    : location.pathname === '/settings/usage'
      ? 'Settings · Usage'
      : location.pathname === '/settings/models'
        ? 'Settings · Models'
        : location.pathname.startsWith('/settings')
          ? 'Settings'
          : location.pathname.startsWith('/graph/')
            ? 'Graph'
            : current
              ? 'Research'
              : 'Workspace';

  const openSession = (id: string) => navigate(`/research/${id}`);

  return (
    <div className={`app-shell ${preferences.reducedMotion ? 'reduced-motion' : ''}`}>
      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <Link to="/" className="brand" onClick={() => setMobileNav(false)}>
            <span className="brand-mark">K</span>
            <span>KAIRO</span>
          </Link>
          <button className="icon-btn mobile-only" onClick={() => setMobileNav(false)} aria-label="Close sidebar">
            <X size={16} />
          </button>
        </div>
        <button className="new-btn" onClick={() => navigate('/')}>
          <Plus size={15} /> New research <kbd>⌘ K</kbd>
        </button>
        <div className="nav-group">
          <div className="nav-label">WORKSPACE</div>
          <NavLink active={location.pathname === '/'} icon={<Search size={16} />} text="Research" click={() => navigate('/')} />
          <NavLink
            active={location.pathname === '/library'}
            icon={<Library size={16} />}
            text="Research library"
            click={() => navigate('/library')}
          />
        </div>
        <div className="recent-group">
          <div className="nav-label recent-label">
            RECENT
            <button className="tiny-btn" onClick={() => navigate('/library')} aria-label="View library">
              <MoreHorizontal size={15} />
            </button>
          </div>
          {sessions.slice(0, 5).map(session => (
            <button
              key={session.id}
              className={`recent-item ${activeId === session.id ? 'recent-active' : ''}`}
              onClick={() => openSession(session.id)}
              title={session.title}
            >
              <span className={`recent-dot recent-${session.status}`} />
              {session.title}
            </button>
          ))}
          {sessions.length === 0 && <div className="muted-note">Your recent research will appear here.</div>}
        </div>
        <div className="sidebar-bottom">
          <Link
            to="/settings"
            className={`nav-link ${location.pathname.startsWith('/settings') ? 'active' : ''}`}
          >
            <Settings size={16} /> Settings
          </Link>
          <button className="profile" onClick={() => setModal('about')}>
            <span className="avatar">A</span>
            <span className="profile-copy">
              <b>Local workspace</b>
              <small>{config.missing.length ? 'Some providers missing' : 'Single-user · SQLite'}</small>
            </span>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="top-left">
            <button className="icon-btn mobile-only" onClick={() => setMobileNav(true)} aria-label="Open menu">
              <Menu size={17} />
            </button>
            <span className="breadcrumb">{breadcrumb}</span>
            {current && (
              <>
                <span className="crumb-sep">/</span>
                <span className="crumb-current">{current.title}</span>
              </>
            )}
          </div>
        </header>
        <div className="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  preferences={preferences}
                  models={models}
                  onPreferences={updatePreferences}
                  onCreate={createResearch}
                  notify={notify}
                />
              }
            />
            <Route
              path="/research/:sessionId"
              element={
                <ResearchRoute
                  models={models}
                  refreshSessions={refreshSessions}
                  notify={notify}
                />
              }
            />
            <Route
              path="/library"
              element={<LibraryRoute sessions={sessions} refreshSessions={refreshSessions} notify={notify} />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  models={models}
                  preferences={preferences}
                  onPreferences={updatePreferences}
                  onReset={resetAll}
                  notify={notify}
                />
              }
            />
            <Route
              path="/settings/models"
              element={
                <SettingsPage
                  modelsTab
                  models={models}
                  preferences={preferences}
                  onPreferences={updatePreferences}
                  onReset={resetAll}
                  notify={notify}
                />
              }
            />
            <Route
              path="/settings/usage"
              element={
                <SettingsPage
                  usageTab
                  models={models}
                  preferences={preferences}
                  onPreferences={updatePreferences}
                  onReset={resetAll}
                  notify={notify}
                />
              }
            />
            <Route path="/usage" element={<Navigate to="/settings/usage" replace />} />
            <Route path="/models" element={<Navigate to="/settings/models" replace />} />
            <Route path="/credits" element={<Navigate to="/settings/usage" replace />} />
            <Route
              path="/graph/:sessionId"
              element={<GraphRoute models={models} setSelectedClaim={() => undefined} />}
            />
            <Route
              path="*"
              element={
                <EmptyState
                  title="Page not found"
                  body="This route does not exist in Kairo."
                  action="Go to research"
                  onAction={() => navigate('/')}
                />
              }
            />
          </Routes>
        </div>
      </main>

      {modal === 'about' && (
        <Modal title="About Kairo" onClose={() => setModal('')}>
          <div className="modal-body">
            <p>Kairo is an evidence-first research workspace.</p>
            <p className="muted">
              Runs use real web search and the model providers configured on this server. Source excerpts and model
              answers can be wrong; JEV is a model-assisted review of cited evidence, not a certification of truth.
            </p>
            <button className="outline-btn" onClick={() => setModal('')}>Close</button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}

function NavLink({
  active,
  icon,
  text,
  click,
}: {
  active: boolean;
  icon: React.ReactNode;
  text: string;
  click: () => void;
}) {
  return (
    <button className={`nav-link ${active ? 'active' : ''}`} onClick={click} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{text}</span>
    </button>
  );
}

function Home({
  preferences,
  models,
  onPreferences,
  onCreate,
  notify,
}: {
  preferences: PreferencesDTO;
  models: ModelCatalogItemDTO[];
  onPreferences: UpdatePreferences;
  onCreate: (input: CreateResearchInput) => Promise<void>;
  notify: Notify;
}) {
  return (
    <div className="home-view">
      <div className="home-center">
        <div className="eyebrow">
          <span className="eyebrow-line" />EVIDENCE, MADE LEGIBLE<span className="eyebrow-line" />
        </div>
        <h1>
          What do you want
          <br />
          <em>to understand?</em>
        </h1>
        <p className="home-sub">A research workspace for questions that deserve more than a quick answer.</p>
        <Composer
          preferences={preferences}
          models={models}
          onPreferences={onPreferences}
          onCreate={onCreate}
          notify={notify}
        />
        <div className="home-note">
          <ShieldCheck size={14} /> Live web search and model synthesis <span>·</span> JEV reviews cited evidence only
        </div>
      </div>
    </div>
  );
}

function Composer({
  preferences,
  models,
  onPreferences,
  onCreate,
  notify,
}: {
  preferences: PreferencesDTO;
  models: ModelCatalogItemDTO[];
  onPreferences: UpdatePreferences;
  onCreate: (input: CreateResearchInput) => Promise<void>;
  notify: Notify;
}) {
  const [query, setQuery] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const model = models.find(item => item.id === preferences.modelId) ?? models[0];
  const availableModels = models.filter(item => item.route.available);
  const effortIndex = Math.max(0, EFFORTS.indexOf(preferences.effort));
  const effortText = EFFORTS[effortIndex];

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [query]);

  const submit = async () => {
    if (!query.trim() || submitting || !model) return;
    setSubmitting(true);
    try {
      await onCreate({
        query: query.trim(),
        modelId: preferences.modelId,
        mode: preferences.mode,
        effort: preferences.effort,
        verify: preferences.verify,
        attachmentIds: attachments.map(attachment => attachment.id),
      });
      setQuery('');
      setAttachments([]);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const slots = 5 - attachments.length;
    const selected = [...files].slice(0, Math.max(0, slots));
    if (selected.length < files.length) notify('You can attach up to five files');
    setUploading(true);
    for (const file of selected) {
      try {
        const response = await api.uploadAttachment(file);
        setAttachments(current => [...current, response.attachment]);
      } catch (error) {
        notify(errorMessage(error));
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeAttachment = async (attachment: AttachmentDTO) => {
    setAttachments(current => current.filter(item => item.id !== attachment.id));
    try {
      await api.deleteAttachment(attachment.id);
    } catch {
      // The attachment may already belong to a run; removing the chip is enough here.
    }
  };

  const chooseModel = (id: ModelId) => {
    onPreferences({ modelId: id });
    setModelsOpen(false);
    setEffortOpen(false);
  };

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        aria-label="Research question"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Investigate a question, compare explanations, or trace a claim to its sources…"
      />
      {attachments.length > 0 && (
        <div className="attachment-row">
          {attachments.map(attachment => (
            <span className="attachment-chip" key={attachment.id}>
              <FileText size={12} />
              <span>{attachment.filename}</span>
              <button onClick={() => void removeAttachment(attachment)} aria-label={`Remove ${attachment.filename}`}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-controls">
        <div className="composer-options">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.csv,.json,application/pdf,text/*"
            multiple
            hidden
            onChange={event => void uploadFiles(event.target.files)}
          />
          <button
            className="attach-icon"
            onClick={() => fileRef.current?.click()}
            title="Attach PDF or text files"
            aria-label="Attach a file"
            disabled={uploading || attachments.length >= 5}
          >
            {uploading ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}
          </button>
          <div className="featured-model-control">
            <div className="select-wrap model-name-wrap">
              <button
                className="model-name-trigger"
                aria-expanded={modelsOpen}
                onClick={() => {
                  setModelsOpen(value => !value);
                  setEffortOpen(false);
                  setModeOpen(false);
                }}
              >
                <span className={`gem gem-${model?.tone ?? 'silver'}`}>◆</span>
                {model?.name ?? 'Select model'}
                <ChevronDown size={13} />
              </button>
              {modelsOpen && (
                <div className="popover model-pop model-list-pop">
                  <div className="model-list-title">Select model</div>
                  {models.map(item => (
                    <button
                      key={item.id}
                      className={preferences.modelId === item.id ? 'selected-option' : ''}
                      onClick={() => chooseModel(item.id)}
                      disabled={!item.route.available}
                      title={item.route.available ? item.route.model ?? undefined : 'Not configured on this server'}
                    >
                      <span className={`gem gem-${item.tone}`}>◆</span>
                      <span className="model-list-copy">
                        <b>{item.name}</b>
                        <small>
                          {item.role}
                          {!item.route.available ? ' · unavailable' : item.route.model ? ` · ${item.route.model}` : ''}
                        </small>
                      </span>
                      {preferences.modelId === item.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="select-wrap effort-wrap">
              <button
                className="effort-trigger"
                aria-expanded={effortOpen}
                onClick={() => {
                  setEffortOpen(value => !value);
                  setModelsOpen(false);
                  setModeOpen(false);
                }}
              >
                {effortText}
                <ChevronDown size={12} />
              </button>
              {effortOpen && (
                <div className="popover effort-pop">
                  <div className="effort-pop-heading">
                    <b>{effortText}</b>
                    <button
                      aria-label="Reset effort to Medium"
                      title="Reset effort"
                      onClick={() => onPreferences({ effort: 'Medium' })}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                  <button
                    className="effort-model-link"
                    onClick={() => {
                      setEffortOpen(false);
                      setModelsOpen(true);
                    }}
                  >
                    {model?.name ?? 'Model'} <span>›</span>
                  </button>
                  <div className="effort-slider-wrap">
                    <input
                      className="effort-slider"
                      type="range"
                      min="0"
                      max="3"
                      step="1"
                      value={effortIndex}
                      aria-label="Reasoning effort"
                      aria-valuetext={effortText}
                      style={{ '--effort-position': `${(effortIndex / 3) * 100}%` } as React.CSSProperties}
                      onChange={event => onPreferences({ effort: EFFORTS[Number(event.target.value)] as Effort })}
                    />
                    <div className="effort-slider-marks" aria-hidden="true"><i /><i /><i /><i /></div>
                  </div>
                  <div className="effort-labels">
                    <span>Low</span><span>Medium</span><span>High</span><span>Max</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="select-wrap">
            <button
              className="control-pill mode-control"
              onClick={() => {
                setModeOpen(value => !value);
                setModelsOpen(false);
                setEffortOpen(false);
              }}
            >
              <Activity size={13} />
              {preferences.mode}
              <ChevronDown size={13} />
            </button>
            {modeOpen && (
              <div className="popover mode-pop">
                {RESEARCH_MODES.map(mode => (
                  <button
                    className={preferences.mode === mode ? 'selected-option' : ''}
                    key={mode}
                    onClick={() => {
                      onPreferences({ mode });
                      setModeOpen(false);
                    }}
                  >
                    <span>{mode}</span>
                    <code>{MODE_PRESETS[mode].label}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="composer-submit">
          <button
            className="submit-btn"
            disabled={submitting || !query.trim() || !availableModels.length}
            onClick={() => void submit()}
            aria-label="Start research"
          >
            {submitting ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}
          </button>
        </div>
      </div>
      <div className="composer-foot">
        <span>⌘ / Ctrl + Enter to research · real search and model calls</span>
      </div>
      <div className="example-row">
        <span>TRY</span>
        {promptOptions.map(option => (
          <button key={option} onClick={() => setQuery(option)}>
            {option}
            <ArrowRight size={12} />
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <CircleHelp size={22} />
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="outline-btn" onClick={onAction}>
        {action}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function ResearchRoute({
  models,
  refreshSessions,
  notify,
}: {
  models: ModelCatalogItemDTO[];
  refreshSessions: () => Promise<SessionSummaryDTO[]>;
  notify: Notify;
}) {
  const { sessionId = '' } = useParams();
  return <ResearchPage sessionId={sessionId} models={models} refreshSessions={refreshSessions} notify={notify} />;
}

function ResearchPage({
  sessionId,
  models,
  refreshSessions,
  notify,
}: {
  sessionId: string;
  models: ModelCatalogItemDTO[];
  refreshSessions: () => Promise<SessionSummaryDTO[]>;
  notify: Notify;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [section, setSection] = useState<Section>('Answer');
  const [stages, setStages] = useState<Array<{ stage: string; label: string; status: StageStatus; progress: number }>>([]);
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceDTO | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<ClaimDTO | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [followup, setFollowup] = useState('');
  const [followupBusy, setFollowupBusy] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(true);

  const reload = useCallback(async () => {
    const response = await api.getSession(sessionId);
    setSession(response.session);
    setBusy(response.session.status === 'queued' || response.session.status === 'running');
    return response.session;
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    let subscription: ResearchSubscription | null = null;
    setLoading(true);
    setLoadError('');
    setStreamText('');
    setStages([]);
    setSelectedSource(null);
    setSelectedClaim(null);
    setBusy(false);
    api
      .getSession(sessionId)
      .then(response => {
        if (cancelled) return;
        const detail = response.session;
        setSession(detail);
        setBusy(detail.status === 'queued' || detail.status === 'running');
        setLoading(false);
        if (detail.status === 'queued' || detail.status === 'running') {
          subscription = subscribeToResearch(sessionId, {
            stage: event => {
              setStages(current => {
                const next = current.filter(item => item.stage !== event.stage);
                return [...next, { stage: event.stage, label: event.label, status: event.status, progress: event.progress }];
              });
            },
            sources: event => setSession(current => (current ? { ...current, sources: event.sources } : current)),
            claims: event => setSession(current => (current ? { ...current, claims: event.claims } : current)),
            delta: event => setStreamText(current => current + event.text),
            usage: event =>
              setSession(current => (current ? { ...current, usage: event.usage } : current)),
            done: event => {
              setSession(event.session);
              setBusy(false);
              setStreamText('');
              setStages(current => current.map(item => ({ ...item, status: 'completed' as const })));
              void refreshSessions();
            },
            error: event => {
              notify(event.message);
              setBusy(false);
              void reload().catch(() => undefined);
              void refreshSessions();
            },
          });
        }
      })
      .catch(error => {
        if (cancelled) return;
        setLoadError(errorMessage(error));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      subscription?.close();
    };
  }, [sessionId, notify, refreshSessions, reload]);

  if (loading) {
    return (
      <div className="page-view">
        <div className="loading-card"><LoaderCircle size={18} className="spin" /> Loading investigation…</div>
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <EmptyState
        title="Investigation not found"
        body={loadError || 'This session may have been removed from local history.'}
        action="Back to research"
        onAction={() => navigate('/')}
      />
    );
  }

  const model = models.find(item => item.id === session.modelId) ?? MODELS.find(item => item.id === session.modelId);
  const activeModel = models.find(item => item.id === session.modelId);
  const currentStage = stages.find(item => item.status === 'started') ?? stages[stages.length - 1];

  const cancel = async () => {
    try {
      await api.cancel(session.id);
      notify('Cancelling the run…');
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const copyAnswer = () => {
    if (!session.answer?.markdown) return;
    navigator.clipboard
      ?.writeText(session.answer.markdown)
      .then(() => notify('Answer copied'))
      .catch(() => notify('Clipboard unavailable'));
  };

  const toggleSaved = async () => {
    try {
      const response = await api.updateSession(session.id, { saved: !session.saved });
      setSession(response.session);
      await refreshSessions();
      notify(response.session.saved ? 'Investigation saved' : 'Investigation unsaved');
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const rerun = async (modelId: ModelId) => {
    setRerunOpen(false);
    try {
      const accepted = await api.rerun(session.id, { modelId });
      await refreshSessions();
      navigate(`/research/${accepted.sessionId}`);
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const startFollowup = async () => {
    if (!followup.trim() || followupBusy) return;
    setFollowupBusy(true);
    try {
      const accepted = await api.followup(session.id, { query: followup.trim() });
      setFollowup('');
      await refreshSessions();
      navigate(`/research/${accepted.sessionId}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setFollowupBusy(false);
    }
  };

  const openShare = async () => {
    try {
      const response = await api.createShare(session.id);
      const url = `${window.location.origin}/share/${response.share.token}`;
      setShareUrl(url);
      setShareOpen(true);
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const revokeShare = async () => {
    const token = shareUrl.split('/').pop();
    if (!token) return;
    try {
      await api.revokeShare(session.id, token);
      setShareOpen(false);
      setShareUrl('');
      notify('Share link revoked');
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  return (
    <div className="research-view">
      <div className="result-top">
        <div>
          <div className="result-kicker">
            <span className={`status-pulse status-${session.status}`} /> {statusLabel(session.status).toUpperCase()}
            <span>·</span>
            {session.date}
            {session.verified && (
              <>
                <span>·</span> JEV REVIEW
              </>
            )}
          </div>
          <h1 className="result-title">{session.title}</h1>
          <div className="result-meta">
            <span className={`gem gem-${model?.tone ?? 'silver'}`}>◆</span>
            {model?.name ?? session.modelId}
            <span>·</span>
            {session.mode}
            <span>·</span>
            {session.effort} effort
            {activeModel?.route.model && (
              <>
                <span>·</span>
                <code>{activeModel.route.model}</code>
              </>
            )}
          </div>
        </div>
        <div className="result-actions">
          <button className={`icon-text ${session.saved ? 'saved' : ''}`} onClick={() => void toggleSaved()}>
            <Bookmark size={15} fill={session.saved ? 'currentColor' : 'none'} />
            {session.saved ? 'Saved' : 'Save'}
          </button>
          <button className="icon-text" onClick={copyAnswer} disabled={!session.answer}>
            <Copy size={15} /> Copy
          </button>
          <button className="icon-text" onClick={() => setRerunOpen(value => !value)}>
            <RotateCcw size={14} /> Rerun
          </button>
          <div className="action-menu-wrap">
            <button className="icon-text" onClick={() => setExportOpen(value => !value)}>
              <Download size={15} /> Export
            </button>
            {exportOpen && (
              <div className="rerun-popover export-popover">
                <span>EXPORT RESULT</span>
                <a href={api.exportUrl(session.id, 'md')} download onClick={() => setExportOpen(false)}>
                  <FileText size={13} /> Markdown
                </a>
                <a href={api.exportUrl(session.id, 'json')} download onClick={() => setExportOpen(false)}>
                  <FileText size={13} /> JSON
                </a>
              </div>
            )}
          </div>
          <button className="icon-text" onClick={() => void openShare()}>
            <Share2 size={15} /> Share
          </button>
          {rerunOpen && (
            <div className="rerun-popover">
              <span>RERUN WITH MODEL</span>
              {models.map(item => (
                <button key={item.id} onClick={() => void rerun(item.id)} disabled={!item.route.available}>
                  <i className={`gem gem-${item.tone}`}>◆</i>
                  <span>
                    {item.name}
                    <small>{item.route.available ? item.route.model : 'Unavailable'}</small>
                  </span>
                  <code>× {item.multiplier}</code>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {busy && (
        <div className="activity-box">
          <div className="activity-head">
            <span className="spinner"><LoaderCircle size={15} className="spin" /></span>
            <div>
              <b>{currentStage?.label ?? 'Starting the investigation'}</b>
              <small>Real search and model synthesis · {session.mode}</small>
            </div>
            <button className="cancel-btn" onClick={() => void cancel()}>
              <Square size={11} fill="currentColor" /> Cancel
            </button>
          </div>
          <div className="activity-progress">
            <span style={{ width: `${Math.max(currentStage?.progress ?? 2, 2)}%` }} />
          </div>
          <div className="activity-steps">
            {stages.map(stage => (
              <div
                key={stage.stage}
                className={`activity-step ${stage.status === 'completed' ? 'complete' : ''} ${
                  stage.status === 'started' ? 'active' : ''
                }`}
              >
                <span>
                  {stage.status === 'completed' ? (
                    <Check size={11} />
                  ) : stage.status === 'started' ? (
                    <LoaderCircle size={11} className="spin" />
                  ) : (
                    <span className="step-dot" />
                  )}
                </span>
                {stage.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {session.error && !busy && (
        <div className="error-banner">
          <AlertTriangle size={15} />
          <span>{session.error}</span>
          <button className="outline-btn compact" onClick={() => void rerun(session.modelId)}>
            Run again <RotateCcw size={12} />
          </button>
        </div>
      )}

      <div className={`query-quote ${questionOpen ? '' : 'query-quote-closed'}`}>
        <span className="quote-mark">“</span>
        {questionOpen && <span>{session.query}</span>}
        <button onClick={() => setQuestionOpen(value => !value)}>
          {questionOpen ? 'Hide question' : 'Show question'}
        </button>
      </div>

      <div className="result-tabs">
        {(['Answer', 'Sources', 'Claims', 'Graph'] as Section[]).map((item, index) => (
          <button className={section === item ? 'tab-active' : ''} key={item} onClick={() => setSection(item)}>
            {[<FileText size={14} />, <Search size={14} />, <ShieldCheck size={14} />, <GitBranch size={14} />][index]}
            {item}
            {item === 'Sources' && <small>{String(session.sources.length).padStart(2, '0')}</small>}
            {item === 'Claims' && <small>{String(session.claims.length).padStart(2, '0')}</small>}
          </button>
        ))}
      </div>

      {section === 'Answer' && (
        <>
          {busy && (
            <div className="stream-panel">
              <div className="answer-label">
                <span className="answer-mark">K</span> LIVE SYNTHESIS
              </div>
              {streamText ? <pre className="stream-preview">{streamText}</pre> : <p className="stream-waiting">Waiting for evidence and synthesis…</p>}
            </div>
          )}
          {!busy && session.answer && (
            <AnswerView
              session={session}
              setSection={setSection}
              setSelectedSource={setSelectedSource}
              notify={notify}
            />
          )}
          {!busy && !session.answer && (
            <div className="draft-state">
              <div className="draft-icon"><Square size={15} /></div>
              <div>
                <b>{session.status === 'failed' ? 'This investigation could not complete' : 'This investigation is a draft'}</b>
                <p>{session.error ?? 'The run stopped before an answer was produced.'}</p>
              </div>
              <button className="outline-btn compact" onClick={() => void rerun(session.modelId)}>
                Run again <RotateCcw size={12} />
              </button>
            </div>
          )}
        </>
      )}
      {section === 'Sources' && <SourcesView sources={session.sources} setSelectedSource={setSelectedSource} />}
      {section === 'Claims' && (
        <ClaimsView claims={session.claims} verified={session.verified} setSelectedClaim={setSelectedClaim} />
      )}
      {section === 'Graph' && (
        <GraphCanvas
          key={`${session.id}-${session.status}`}
          sessionId={session.id}
          claims={session.claims}
          setSelectedClaim={setSelectedClaim}
          notify={notify}
        />
      )}

      {!busy && (
        <div className="followup">
          <div className="followup-icon"><Sparkles size={15} /></div>
          <div className="followup-copy">
            <b>Continue the investigation</b>
            <span>Ask a follow-up. This answer is included as context for the next run.</span>
          </div>
          <div className="followup-input">
            <input
              value={followup}
              onChange={event => setFollowup(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && void startFollowup()}
              placeholder="Ask a follow-up question…"
            />
            <button disabled={!followup.trim() || followupBusy} onClick={() => void startFollowup()} aria-label="Submit follow-up">
              {followupBusy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      )}
      {section === 'Answer' && !busy && (
        <div className="result-footnote">
          <ShieldCheck size={13} /> Sources are real web results or uploads. Verification reflects the cited evidence
          available to this run, not absolute truth.
        </div>
      )}

      {selectedSource && (
        <SourceDrawer
          source={selectedSource}
          claims={session.claims}
          onClose={() => setSelectedSource(null)}
          onClaim={id => {
            const claim = session.claims.find(item => item.id === id) ?? null;
            setSelectedClaim(claim);
            setSelectedSource(null);
            setSection('Claims');
          }}
        />
      )}
      {selectedClaim && (
        <ClaimDrawer
          claim={selectedClaim}
          sources={session.sources}
          onClose={() => setSelectedClaim(null)}
          setSelectedSource={source => {
            setSelectedClaim(null);
            setSelectedSource(source);
          }}
        />
      )}
      {shareOpen && (
        <Modal title="Share this result" onClose={() => setShareOpen(false)}>
          <div className="modal-body">
            <p className="muted">
              This creates a frozen, read-only snapshot. Anyone with the link can view it; later changes are not
              reflected.
            </p>
            <div className="share-link-row">
              <input readOnly value={shareUrl} aria-label="Share link" />
              <button
                className="outline-btn compact"
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl).then(() => notify('Share link copied')).catch(() => undefined);
                }}
              >
                <Copy size={13} /> Copy
              </button>
            </div>
            <div className="modal-actions">
              <button className="danger-btn" onClick={() => void revokeShare()}>
                <Trash2 size={13} /> Revoke link
              </button>
              <button className="outline-btn" onClick={() => setShareOpen(false)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AnswerView({
  session,
  setSection,
  setSelectedSource,
  notify,
}: {
  session: SessionDetailDTO;
  setSection: (section: Section) => void;
  setSelectedSource: (source: SourceDTO) => void;
  notify: Notify;
}) {
  const counts = session.claims.reduce<Record<string, number>>((acc, claim) => {
    acc[claim.status] = (acc[claim.status] ?? 0) + 1;
    return acc;
  }, {});
  const openCitation = (sourceId: string) => {
    const source = session.sources.find(item => item.id === sourceId);
    if (source) setSelectedSource(source);
  };
  return (
    <div className="answer-layout">
      <article>
        <div className="answer-label">
          <span className="answer-mark">K</span> KAIRO SYNTHESIS <span>·</span> {session.sources.length} SOURCES
        </div>
        {session.answer ? (
          <AnswerMarkdown answer={session.answer} onCite={openCitation} />
        ) : (
          <p className="muted">No answer available.</p>
        )}
        <div className="answer-actions">
          <button
            onClick={() => {
              if (!session.answer) return;
              navigator.clipboard
                ?.writeText(session.answer.markdown)
                .then(() => notify('Answer copied'))
                .catch(() => notify('Clipboard unavailable'));
            }}
          >
            <Copy size={14} /> Copy answer
          </button>
          <button onClick={() => setSection('Claims')}>
            <ShieldCheck size={14} /> Inspect claims
          </button>
          <button onClick={() => setSection('Sources')}>
            <Search size={14} /> Explore sources
          </button>
          <button onClick={() => setSection('Graph')}>
            <GitBranch size={14} /> View evidence graph
          </button>
        </div>
      </article>
      <aside className="answer-side">
        <div className="verification-card">
          <div className="side-card-head">
            <span>{session.verified ? 'JEV REVIEW' : 'JEV NOT RUN'}</span>
            <ShieldCheck size={15} />
          </div>
          {session.verified ? (
            <>
              <div className="jev-summary">
                {session.claims.length} <small>claims examined</small>
              </div>
              <div className="jev-row">
                <span className="status-dot supported" />Supported by available evidence
                <b>{counts.Supported ?? 0}</b>
              </div>
              <div className="jev-row">
                <span className="status-dot contradicted" />Contradicted by available evidence
                <b>{counts.Contradicted ?? 0}</b>
              </div>
              <div className="jev-row">
                <span className="status-dot insufficient" />Insufficient evidence
                <b>{counts['Insufficient evidence'] ?? 0}</b>
              </div>
              <div className="jev-row">
                <span className="status-dot" />Not checked<b>{counts['Not checked'] ?? 0}</b>
              </div>
              <button className="subtle-link" onClick={() => setSection('Claims')}>
                Open claim review <ArrowRight size={13} />
              </button>
              <div className="jev-note">
                Evidence quality and context matter. This review does not establish absolute truth.
              </div>
            </>
          ) : (
            <>
              <p className="jev-note">
                Verification was disabled for this run. Claims are available to inspect, but no JEV statuses were
                assigned.
              </p>
              <button className="subtle-link" onClick={() => setSection('Claims')}>
                View unverified claims <ArrowRight size={13} />
              </button>
            </>
          )}
        </div>
        <div className="related-card">
          <div className="side-card-head">
            <span>KEY SOURCES</span>
            <button onClick={() => setSection('Sources')}>
              All {session.sources.length} <ArrowRight size={12} />
            </button>
          </div>
          {session.sources.slice(0, 3).map(source => (
            <button className="key-source" key={source.id} onClick={() => setSelectedSource(source)}>
              <code>{source.id}</code>
              <span>
                {source.title}
                <small>{source.domain}{source.date ? ` · ${source.date}` : ''}</small>
              </span>
              <ArrowRight size={13} />
            </button>
          ))}
          {!session.sources.length && <p className="muted-note">No sources were collected.</p>}
        </div>
        {session.attachments.length > 0 && (
          <div className="related-card">
            <div className="side-card-head"><span>ATTACHMENTS</span></div>
            {session.attachments.map(attachment => (
              <span className="attachment-chip static" key={attachment.id}>
                <FileText size={12} />
                {attachment.filename}
              </span>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function SourcesView({
  sources,
  setSelectedSource,
}: {
  sources: SourceDTO[];
  setSelectedSource: (source: SourceDTO) => void;
}) {
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState('All types');
  const [sort, setSort] = useState<'Relevance' | 'Title'>('Relevance');
  const kinds = useMemo(() => ['All types', ...new Set(sources.map(source => source.kind))], [sources]);
  const items = useMemo(
    () =>
      sources
        .filter(source => `${source.title} ${source.domain} ${source.excerpt}`.toLowerCase().includes(term.toLowerCase()))
        .filter(source => kind === 'All types' || source.kind === kind)
        .sort((a, b) => (sort === 'Relevance' ? b.relevance - a.relevance : a.title.localeCompare(b.title))),
    [sources, term, kind, sort],
  );
  return (
    <div className="explorer-view">
      <div className="explorer-head">
        <div>
          <h2>Sources</h2>
          <p>{items.length} sources collected · relevance is not a measure of reliability</p>
        </div>
        <div className="explorer-tools">
          <label className="search-field">
            <Search size={14} />
            <input value={term} onChange={event => setTerm(event.target.value)} placeholder="Search sources" />
          </label>
          <select value={kind} onChange={event => setKind(event.target.value)}>
            {kinds.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button className="select-sort" onClick={() => setSort(sort === 'Relevance' ? 'Title' : 'Relevance')}>
            <ArrowDownUp size={13} />
            {sort}
          </button>
        </div>
      </div>
      {items.map(source => (
        <button key={source.id} className="source-row" onClick={() => setSelectedSource(source)}>
          <span className="source-number">{source.id}</span>
          <span className="source-main">
            <b>{source.title}</b>
            <small>
              {source.domain}
              {source.kind ? <> <i>·</i> {source.kind}</> : null}
              {source.date ? <> <i>·</i> {source.date}</> : null}
            </small>
            <span className="source-excerpt">“{source.excerpt}”</span>
            <span className="source-related">
              <span className="related-tag">{source.relationship}</span>
              <span className="relevance">{source.relevance}% relevance</span>
            </span>
          </span>
          <ArrowRight size={15} />
        </button>
      ))}
      {!items.length && <div className="library-empty"><Search size={20} /><b>No sources found</b><span>Try another search.</span></div>}
    </div>
  );
}

function ClaimsView({
  claims,
  verified,
  setSelectedClaim,
}: {
  claims: ClaimDTO[];
  verified: boolean;
  setSelectedClaim: (claim: ClaimDTO) => void;
}) {
  return (
    <div className="explorer-view">
      <div className="explorer-head">
        <div>
          <h2>Claim explorer</h2>
          <p>
            {verified
              ? `Evidence review across ${claims.length} checkable statements`
              : `${claims.length} checkable statements · JEV was not run for this investigation`}
          </p>
        </div>
        <span className="demo-chip">
          <ShieldCheck size={12} />
          {verified ? 'JEV · REVIEWED' : 'NOT CHECKED'}
        </span>
      </div>
      <div className="claim-legend">
        <span><i className="status-dot supported" />Supported by available evidence</span>
        <span><i className="status-dot contradicted" />Contradicted by available evidence</span>
        <span><i className="status-dot insufficient" />Insufficient evidence</span>
      </div>
      {claims.map(claim => (
        <button className="claim-row" key={claim.id} onClick={() => setSelectedClaim(claim)}>
          <div className="claim-top">
            <code>{claim.id}</code>
            <Status status={claim.status} />
          </div>
          <b>{claim.text}</b>
          <span className="claim-bottom">
            {claim.sourceIds.length} evidence passages <span>·</span> {claim.sourceIds.join(', ')} <ArrowRight size={13} />
          </span>
        </button>
      ))}
      {!claims.length && (
        <div className="library-empty">
          <CircleHelp size={20} />
          <b>No claims were extracted</b>
          <span>This run did not produce checkable claims from the available evidence.</span>
        </div>
      )}
      <p className="small-disclaimer">
        <CircleHelp size={13} />{' '}
        {verified
          ? 'Status reflects the cited evidence in this run and is not a universal truth judgment.'
          : 'JEV is disabled; evidence is shown without a verification status.'}
      </p>
    </div>
  );
}

function Status({ status }: { status: ClaimDTO['status'] }) {
  const label =
    status === 'Supported'
      ? 'Supported by available evidence'
      : status === 'Contradicted'
        ? 'Contradicted by available evidence'
        : status === 'Not checked'
          ? 'Not checked'
          : 'Insufficient evidence';
  const className =
    status === 'Supported'
      ? 'status-supported'
      : status === 'Contradicted'
        ? 'status-contradicted'
        : status === 'Not checked'
          ? 'status-not-checked'
          : 'status-insufficient';
  return (
    <span className={`claim-status ${className}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

type MemoNodeType = Node<{ label: string; readOnly: boolean; onTextChange: (text: string) => void; onDelete: () => void }, 'memo'>;
const graphNodeTypes: NodeTypes = { memo: GraphMemoNode };

function GraphMemoNode({ data, selected }: NodeProps<MemoNodeType>) {
  return (
    <div className={`graph-memo-node ${selected ? 'graph-memo-selected' : ''}`}>
      <div className="graph-memo-title">
        <StickyNote size={13} />
        Memo
        {!data.readOnly && (
          <button className="graph-memo-delete nodrag" onClick={data.onDelete} aria-label="Delete memo" title="Delete memo">
            <X size={12} />
          </button>
        )}
      </div>
      <textarea
        className="nodrag nowheel"
        value={data.label}
        readOnly={data.readOnly}
        onChange={event => data.onTextChange(event.target.value)}
        onPointerDown={event => event.stopPropagation()}
        placeholder="Write a note…"
        aria-label="Graph memo"
      />
    </div>
  );
}

function graphNodes(graph: GraphDTO, callbacks: {
  onMemoChange: (id: string, text: string) => void;
  onMemoDelete: (id: string) => void;
  readOnly: boolean;
}): Node[] {
  const mapped: Node[] = graph.nodes.map(node => ({
    id: node.id,
    position: node.position,
    data: { label: node.label, kind: node.kind },
    type: node.kind === 'question' ? 'input' : undefined,
    className: classNameForNode(node),
    draggable: !callbacks.readOnly,
  }));
  for (const memo of graph.memos) {
    mapped.push({
      id: memo.id,
      type: 'memo',
      position: memo.position,
      data: {
        label: memo.text,
        readOnly: callbacks.readOnly,
        onTextChange: (text: string) => callbacks.onMemoChange(memo.id, text),
        onDelete: () => callbacks.onMemoDelete(memo.id),
      },
      draggable: !callbacks.readOnly,
    });
  }
  return mapped;
}

function classNameForNode(node: GraphNodeDTO): string {
  if (node.kind === 'question') return 'graph-question';
  if (node.kind === 'claim') {
    const status = node.status === 'Supported' ? 'g-supported' : node.status === 'Contradicted' ? 'g-contradicted' : 'g-insufficient';
    return `graph-claim ${status}`;
  }
  if (node.kind === 'source') return 'graph-source';
  return '';
}

function graphEdges(graph: GraphDTO): Edge[] {
  return graph.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    className: edge.dashed ? 'edge-challenge' : undefined,
    style: edge.dashed ? { strokeDasharray: '5 4' } : undefined,
  }));
}

function GraphCanvas({
  sessionId,
  graph: suppliedGraph,
  claims = [],
  setSelectedClaim,
  notify,
  readOnly = false,
  heading = true,
}: {
  sessionId?: string;
  graph?: GraphDTO;
  claims?: ClaimDTO[];
  setSelectedClaim?: (claim: ClaimDTO) => void;
  notify?: Notify;
  readOnly?: boolean;
  heading?: boolean;
}) {
  const [graph, setGraph] = useState<GraphDTO | null>(suppliedGraph ?? null);
  const [loading, setLoading] = useState(!suppliedGraph && Boolean(sessionId));
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All nodes');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('q');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const graphRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const nodesRef = useRef<Node[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const scheduleSave = useCallback(() => {
    if (readOnly || !sessionId) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      const memos: GraphMemoDTO[] = [];
      for (const node of nodesRef.current) {
        if (node.type === 'memo') {
          memos.push({
            id: node.id,
            text: String(node.data.label ?? ''),
            position: { x: node.position.x, y: node.position.y },
          });
        } else {
          positions[node.id] = { x: node.position.x, y: node.position.y };
        }
      }
      api
        .saveGraph(sessionId, { positions, memos })
        .catch(caught => notify?.(errorMessage(caught)));
    }, 700);
  }, [notify, readOnly, sessionId]);

  const updateMemo = useCallback(
    (id: string, text: string) => {
      setNodes(current =>
        current.map(node => (node.id === id ? { ...node, data: { ...node.data, label: text } } : node)),
      );
      scheduleSave();
    },
    [scheduleSave, setNodes],
  );

  const deleteMemo = useCallback(
    (id: string) => {
      setNodes(current => current.filter(node => node.id !== id));
      scheduleSave();
    },
    [scheduleSave, setNodes],
  );

  const applyGraph = useCallback(
    (next: GraphDTO) => {
      setGraph(next);
      setFitKey(current => current + 1);
      setNodes(
        graphNodes(next, {
          onMemoChange: updateMemo,
          onMemoDelete: deleteMemo,
          readOnly,
        }),
      );
    },
    [deleteMemo, readOnly, setNodes, updateMemo],
  );

  useEffect(() => {
    if (suppliedGraph) {
      applyGraph(suppliedGraph);
      setLoading(false);
      return;
    }
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    api
      .getGraph(sessionId)
      .then(response => {
        if (!cancelled) {
          applyGraph(response.graph);
          setLoading(false);
        }
      })
      .catch(caught => {
        if (!cancelled) {
          setError(errorMessage(caught));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyGraph, sessionId, suppliedGraph]);

  useEffect(() => {
    if (readOnly) return;
    const sync = () => setIsFullscreen(document.fullscreenElement === graphRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [readOnly]);

  const toggleFullscreen = () => {
    const element = graphRef.current;
    if (!element) return;
    if (document.fullscreenElement === element) void document.exitFullscreen();
    else void element.requestFullscreen();
  };

  const addMemo = () => {
    if (readOnly) return;
    const id = `memo-${Date.now()}`;
    setNodes(current => {
      const offset = current.filter(node => node.type === 'memo').length % 4;
      return [
        ...current,
        {
          id,
          type: 'memo',
          position: { x: 110 + offset * 36, y: 360 + offset * 36 },
          data: {
            label: '',
            readOnly: false,
            onTextChange: (text: string) => updateMemo(id, text),
            onDelete: () => deleteMemo(id),
          },
        },
      ];
    });
    setFilter('All nodes');
    setSearch('');
    setSelected(id);
    scheduleSave();
  };

  const resetLayout = async () => {
    if (!sessionId || readOnly) return;
    try {
      const response = await api.resetGraph(sessionId);
      applyGraph(response.graph);
      setSelected('q');
      notify?.('Graph layout reset');
    } catch (caught) {
      notify?.(errorMessage(caught));
    }
  };

  const shown = nodes.filter(node => {
    const kind =
      node.type === 'memo'
        ? 'Notes'
        : node.id === 'q'
          ? 'Question'
          : node.id.startsWith('C')
            ? 'Claims'
            : 'Sources';
    return (filter === 'All nodes' || filter === kind) && String(node.data.label ?? '').toLowerCase().includes(search.toLowerCase());
  });
  const ids = new Set(shown.map(node => node.id));
  const shownEdges = (graph ? graphEdges(graph) : []).filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const selectedClaim = claims.find(claim => claim.id === selected);

  if (loading) {
    return <div className="loading-card"><LoaderCircle size={16} className="spin" /> Loading graph…</div>;
  }
  if (error || !graph) {
    return <div className="error-banner"><AlertTriangle size={15} /> {error || 'Graph unavailable.'}</div>;
  }

  return (
    <div className="graph-view" ref={graphRef}>
      <div className="graph-toolbar">
        {heading && (
          <div>
            <h2>Knowledge graph</h2>
            <p>Explore the links between this question, claims, and source evidence.</p>
          </div>
        )}
        <label className="graph-search">
          <Search size={13} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a node" />
        </label>
        <select value={filter} onChange={event => setFilter(event.target.value)}>
          <option>All nodes</option>
          <option>Claims</option>
          <option>Sources</option>
          <option>Question</option>
          <option>Notes</option>
        </select>
        {!readOnly && (
          <button className="outline-btn compact" onClick={addMemo}>
            <StickyNote size={13} /> Memo
          </button>
        )}
        {!readOnly && (
          <button
            className="outline-btn compact"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen graph'}
            title={isFullscreen ? 'Exit full screen' : 'Full screen graph'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </button>
        )}
        {!readOnly && (
          <button className="outline-btn compact" onClick={() => void resetLayout()}>
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>
      <div className="graph-canvas">
        <div className="graph-canvas-hint">
          <Move size={12} /> {readOnly ? 'Read-only snapshot' : 'Drag nodes to arrange · drag empty space to pan'}
        </div>
        <ReactFlow
          key={`${sessionId ?? 'share'}-${fitKey}`}
          nodes={shown}
          edges={shownEdges}
          nodeTypes={graphNodeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={false}
          deleteKeyCode={null}
          onNodesChange={onNodesChange}
          onNodeDragStop={scheduleSave}
          panOnDrag
          fitView
          minZoom={0.3}
          maxZoom={1.5}
          onNodeClick={(_, node) => {
            setSelected(node.id);
            if (node.id.startsWith('C')) {
              const claim = claims.find(item => item.id === node.id);
              if (claim) setSelectedClaim?.(claim);
            }
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#303030" gap={20} size={1} />
        </ReactFlow>
      </div>
      <div className="graph-legend">
        <span><i className="legend-square question" />Question</span>
        <span><i className="legend-square claim" />Claim</span>
        <span><i className="legend-square source" />Source</span>
        <span><i className="legend-edge" />Supports / relates</span>
        <span><i className="legend-edge dashed" />Challenges</span>
        <span className="graph-count">{shown.length} nodes · {shownEdges.length} relationships</span>
      </div>
      {selectedClaim && (
        <div className="graph-selected">
          <code>{selectedClaim.id}</code>
          <span>{selectedClaim.text}</span>
          <Status status={selectedClaim.status} />
          <button className="icon-btn" onClick={() => setSelected('q')} aria-label="Clear selection"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

function GraphRoute({ models, setSelectedClaim }: { models: ModelCatalogItemDTO[]; setSelectedClaim: (claim: ClaimDTO) => void }) {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetailDTO | null>(null);
  const [error, setError] = useState('');
  const [selectedClaim, setLocalClaim] = useState<ClaimDTO | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceDTO | null>(null);
  useEffect(() => {
    api
      .getSession(sessionId)
      .then(response => setSession(response.session))
      .catch(caught => setError(errorMessage(caught)));
  }, [sessionId]);
  if (error) return <EmptyState title="Graph unavailable" body={error} action="Back to research" onAction={() => navigate('/')} />;
  if (!session) return <div className="page-view"><div className="loading-card"><LoaderCircle size={16} className="spin" /> Loading graph…</div></div>;
  const model = models.find(item => item.id === session.modelId);
  return (
    <div className="research-view">
      <div className="result-kicker"><GitBranch size={13} /> KNOWLEDGE GRAPH <span>·</span> {session.date}</div>
      <h1 className="result-title">{session.title}</h1>
      <div className="result-meta">
        <span className={`gem gem-${model?.tone ?? 'silver'}`}>◆</span>
        {model?.name ?? session.modelId} <span>·</span> {session.mode}
      </div>
      <GraphCanvas
        sessionId={session.id}
        claims={session.claims}
        setSelectedClaim={claim => {
          setLocalClaim(claim);
          setSelectedClaim(claim);
        }}
        notify={undefined}
      />
      {selectedClaim && (
        <ClaimDrawer
          claim={selectedClaim}
          sources={session.sources}
          onClose={() => setLocalClaim(null)}
          setSelectedSource={source => {
            setLocalClaim(null);
            setSelectedSource(source);
          }}
        />
      )}
      {selectedSource && (
        <SourceDrawer
          source={selectedSource}
          claims={session.claims}
          onClose={() => setSelectedSource(null)}
          onClaim={id => {
            const claim = session.claims.find(item => item.id === id);
            if (claim) {
              setLocalClaim(claim);
              setSelectedClaim(claim);
            }
            setSelectedSource(null);
          }}
        />
      )}
    </div>
  );
}

function SourceDrawer({
  source,
  claims,
  onClose,
  onClaim,
}: {
  source: SourceDTO;
  claims: ClaimDTO[];
  onClose: () => void;
  onClaim: (id: string) => void;
}) {
  const connected = claims.filter(claim => claim.sourceIds.includes(source.id));
  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close source details" />
      <aside className="detail-drawer">
        <div className="drawer-head">
          <div>
            <span className="drawer-kicker">SOURCE DETAIL · {source.id}</span>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
          <h2>{source.title}</h2>
          {source.url ? (
            <a className="domain-link" href={source.url} target="_blank" rel="noreferrer">
              {source.domain} <ExternalLink size={12} />
            </a>
          ) : (
            <span className="domain-link">{source.domain}</span>
          )}
        </div>
        <div className="drawer-content">
          <div className="drawer-metadata">
            <span>Source type<b>{source.kind}</b></span>
            <span>Publication date<b>{source.date || 'Unknown'}</b></span>
            <span>Relevance<b>{source.relevance}%</b></span>
          </div>
          <h3>Relevant passage</h3>
          <blockquote>{source.excerpt}</blockquote>
          <div className="quality-note">
            <CircleHelp size={14} />
            <span>
              <b>Relevance and reliability are different.</b> Relevance describes how closely this passage matches the
              investigation. It does not establish the source's reliability.
            </span>
          </div>
          <h3>Connected claims</h3>
          {connected.map(claim => (
            <button className="drawer-claim" key={claim.id} onClick={() => onClaim(claim.id)}>
              <code>{claim.id}</code>
              <span>{claim.text}<small><Status status={claim.status} /></small></span>
              <ArrowRight size={13} />
            </button>
          ))}
          {!connected.length && <p className="muted-note">No claims reference this source.</p>}
        </div>
        <div className="drawer-bottom">
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer" className="outline-btn">
              Open source <ExternalLink size={13} />
            </a>
          ) : (
            <span className="demo-chip">UPLOADED FILE</span>
          )}
        </div>
      </aside>
    </>
  );
}

function ClaimDrawer({
  claim,
  sources,
  onClose,
  setSelectedSource,
}: {
  claim: ClaimDTO;
  sources: SourceDTO[];
  onClose: () => void;
  setSelectedSource: (source: SourceDTO) => void;
}) {
  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close claim details" />
      <aside className="detail-drawer">
        <div className="drawer-head">
          <div>
            <span className="drawer-kicker">CLAIM REVIEW · {claim.id}</span>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
          <h2>{claim.text}</h2>
          <Status status={claim.status} />
        </div>
        <div className="drawer-content">
          <div className="quality-note"><ShieldCheck size={14} /><span>{claim.detail}</span></div>
          <h3>Evidence passages</h3>
          {claim.sourceIds.map(id => {
            const source = sources.find(item => item.id === id);
            if (!source) return null;
            return (
              <button className="evidence-passage" key={id} onClick={() => setSelectedSource(source)}>
                <div><code>{id}</code><span>{source.title}</span></div>
                <p>“{source.excerpt}”</p>
                <small>{source.relationship} <ArrowRight size={12} /></small>
              </button>
            );
          })}
        </div>
        <div className="drawer-bottom">
          <span className="small-disclaimer">Evidence available to this run only</span>
          <button className="outline-btn" onClick={onClose}>Done</button>
        </div>
      </aside>
    </>
  );
}

function LibraryRoute({
  sessions,
  refreshSessions,
  notify,
}: {
  sessions: SessionSummaryDTO[];
  refreshSessions: () => Promise<SessionSummaryDTO[]>;
  notify: Notify;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [model, setModel] = useState('All models');
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent');

  const visible = useMemo(
    () =>
      sessions
        .filter(
          session =>
            (!savedOnly || session.saved) &&
            `${session.title} ${session.query}`.toLowerCase().includes(search.toLowerCase()) &&
            (model === 'All models' || MODELS.find(item => item.id === session.modelId)?.name === model),
        )
        .sort((a, b) =>
          sort === 'recent' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
        ),
    [sessions, savedOnly, search, model, sort],
  );

  const toggleSaved = async (session: SessionSummaryDTO) => {
    try {
      await api.updateSession(session.id, { saved: !session.saved });
      await refreshSessions();
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const remove = async (session: SessionSummaryDTO) => {
    if (!window.confirm('Remove this investigation from local history?')) return;
    try {
      await api.deleteSession(session.id);
      await refreshSessions();
      notify('Investigation removed');
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const rename = async (session: SessionSummaryDTO) => {
    const next = window.prompt('Rename investigation', session.title);
    if (!next?.trim()) return;
    try {
      await api.updateSession(session.id, { title: next.trim() });
      await refreshSessions();
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  return (
    <div className="page-view">
      <div className="page-heading">
        <div>
          <div className="page-kicker">YOUR WORKSPACE</div>
          <h1>Research library</h1>
          <p>Revisit and continue your investigations.</p>
        </div>
        <button className="primary-btn" onClick={() => navigate('/')}><Plus size={14} />New research</button>
      </div>
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={14} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search titles and questions" />
        </label>
        <select value={model} onChange={event => setModel(event.target.value)}>
          <option>All models</option>
          {MODELS.map(item => <option key={item.id}>{item.name}</option>)}
        </select>
        <button className={`outline-btn compact ${savedOnly ? 'filter-on' : ''}`} onClick={() => setSavedOnly(value => !value)}>
          <Bookmark size={13} />Saved
        </button>
        <button className="select-sort" onClick={() => setSort(sort === 'recent' ? 'oldest' : 'recent')}>
          <ArrowDownUp size={13} />{sort === 'recent' ? 'Most recent' : 'Oldest first'}
        </button>
      </div>
      <div className="library-count">{visible.length} INVESTIGATIONS</div>
      {visible.length === 0 ? (
        <div className="library-empty"><Library size={20} /><b>No investigations found</b><span>Try another search or start a new research question.</span></div>
      ) : (
        <div className="library-list">
          {visible.map(session => {
            const profile = MODELS.find(item => item.id === session.modelId);
            return (
              <div className="library-row" key={session.id}>
                <button className="library-main" onClick={() => navigate(`/research/${session.id}`)}>
                  <span className={`gem gem-${profile?.tone ?? 'silver'}`}>◆</span>
                  <span>
                    <b>{session.title}</b>
                    <small>{session.query}</small>
                    <span className="library-meta">
                      {profile?.name ?? session.modelId}<i>·</i>{session.mode}<i>·</i>{session.date}
                      <i>·</i>× {profile?.multiplier ?? 1} factor
                      {session.verified && <><i>·</i><span className="library-verified"><ShieldCheck size={12} /> JEV</span></>}
                      <i>·</i>
                      <span className={`library-status library-status-${session.status}`}>{statusLabel(session.status)}</span>
                      {session.usage && <><i>·</i>{session.usage.totalTokens.toLocaleString()} tokens</>}
                    </span>
                  </span>
                  <ArrowRight size={15} />
                </button>
                <div className="library-actions">
                  <button className={session.saved ? 'saved' : ''} title={session.saved ? 'Unsave' : 'Save'} onClick={() => void toggleSaved(session)}>
                    <Bookmark size={14} fill={session.saved ? 'currentColor' : 'none'} />
                  </button>
                  <button title="Rename" onClick={() => void rename(session)}><MoreHorizontal size={15} /></button>
                  <button title="Remove" onClick={() => void remove(session)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  models,
  preferences,
  onPreferences,
  onReset,
  notify,
  modelsTab,
  usageTab,
}: {
  models: ModelCatalogItemDTO[];
  preferences: PreferencesDTO;
  onPreferences: UpdatePreferences;
  onReset: () => Promise<void>;
  notify: Notify;
  modelsTab?: boolean;
  usageTab?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="page-view settings-view">
      <div className="page-heading">
        <div>
          <div className="page-kicker">PREFERENCES</div>
          <h1>Settings</h1>
          <p>Configure your local research workspace.</p>
        </div>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button role="tab" aria-selected={!modelsTab && !usageTab} className={!modelsTab && !usageTab ? 'settings-tab-active' : ''} onClick={() => navigate('/settings')}>Preferences</button>
        <button role="tab" aria-selected={!!modelsTab} className={modelsTab ? 'settings-tab-active' : ''} onClick={() => navigate('/settings/models')}>Models</button>
        <button role="tab" aria-selected={!!usageTab} className={usageTab ? 'settings-tab-active' : ''} onClick={() => navigate('/settings/usage')}>Usage</button>
      </div>
      {modelsTab ? (
        <SettingsModels models={models} preferences={preferences} onPreferences={onPreferences} notify={notify} />
      ) : usageTab ? (
        <UsagePage />
      ) : (
        <>
          <section className="settings-section">
            <div className="settings-heading"><h2>Research defaults</h2><p>Applied to new investigations.</p></div>
            <div className="setting-row">
              <div><b>Default research mode</b><small>Sets the depth and scope of a research run.</small></div>
              <select value={preferences.mode} onChange={event => onPreferences({ mode: event.target.value as ResearchMode })}>
                {RESEARCH_MODES.map(mode => <option key={mode}>{mode}</option>)}
              </select>
            </div>
            <div className="setting-row">
              <div><b>Reasoning effort</b><small>Controls answer length and search depth.</small></div>
              <select value={preferences.effort} onChange={event => onPreferences({ effort: event.target.value as Effort })}>
                {EFFORTS.map(effort => <option key={effort}>{effort}</option>)}
              </select>
            </div>
            <div className="setting-row">
              <div><b>JEV verification by default</b><small>Review claims against the cited evidence.</small></div>
              <Toggle on={preferences.verify} set={value => onPreferences({ verify: value })} />
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-heading"><h2>Appearance</h2><p>Obsidian is the default interface theme.</p></div>
            <div className="setting-row">
              <div><b>Theme</b><small>High contrast graphite surfaces.</small></div>
              <span className="theme-choice"><i />Obsidian <Check size={13} /></span>
            </div>
            <div className="setting-row">
              <div><b>Reduced motion</b><small>Limit nonessential transitions.</small></div>
              <Toggle on={preferences.reducedMotion} set={value => onPreferences({ reducedMotion: value })} />
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-heading"><h2>Usage & data</h2><p>Usage history is stored locally by the Kairo server.</p></div>
            <div className="setting-row">
              <div><b>Usage history</b><small>View real token counts and completed runs.</small></div>
              <button className="outline-btn compact" onClick={() => navigate('/settings/usage')}>View usage <ArrowRight size={13} /></button>
            </div>
            <div className="setting-row">
              <div><b>Reset all data</b><small>Delete sessions, shares, attachments, and preferences from this server.</small></div>
              <button
                className="danger-btn"
                onClick={() => {
                  if (window.confirm('Delete all local research data? This cannot be undone.')) {
                    void onReset().catch(error => notify(errorMessage(error)));
                  }
                }}
              >
                Reset data
              </button>
            </div>
          </section>
          <section className="settings-section about-section">
            <div className="settings-heading"><h2>About</h2><p>Kairo · version 0.1.0 · live research workspace</p></div>
            <p>
              Runs use real web search and the configured OpenAI-compatible providers. JEV describes evidence coverage
              and limitations; it does not establish absolute truth.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Toggle({ on, set }: { on: boolean; set: (value: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} className={`switch ${on ? 'switch-on' : ''}`} onClick={() => set(!on)}>
      <span />
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SetupPage({ config }: { config: AppConfigDTO }) {
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="brand setup-brand"><span className="brand-mark">K</span><span>KAIRO</span></div>
        <span className="setup-icon"><ShieldCheck size={20} /></span>
        <h1>Connect Kairo to your providers</h1>
        <p>
          Kairo no longer runs on mock data. Add the model endpoints and search key to the server, then restart it.
        </p>
        <div className="setup-missing">
          <b>Missing configuration</b>
          <ul>{config.missing.map(item => <li key={item}><code>{item}</code></li>)}</ul>
        </div>
        <pre>{`cp .env.example .env
# edit .env, then:
npm run dev`}</pre>
        <p className="muted">
          OpenAI and JarvisLabs must expose an OpenAI-compatible <code>/v1/chat/completions</code> endpoint. Keys stay
          on the server.
        </p>
        <button className="primary-btn" onClick={() => window.location.reload()}>Retry <RefreshCw size={14} /></button>
      </div>
    </div>
  );
}

function SharePage({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<import('../shared/types').ShareSnapshotDTO | null>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState<Section>('Answer');
  const [selectedSource, setSelectedSource] = useState<SourceDTO | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<ClaimDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getShare(token)
      .then(response => {
        if (!cancelled) {
          setSnapshot(response.snapshot);
          setLoading(false);
        }
      })
      .catch(caught => {
        if (!cancelled) {
          setError(errorMessage(caught));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <div className="setup-shell"><div className="setup-card setup-loading"><LoaderCircle size={18} className="spin" /><p>Loading shared result…</p></div></div>;
  }
  if (error || !snapshot) {
    return (
      <div className="setup-shell">
        <div className="setup-card">
          <span className="setup-icon"><AlertTriangle size={20} /></span>
          <h1>Share link unavailable</h1>
          <p>{error || 'This link is invalid or has been revoked.'}</p>
          <Link to="/" className="primary-btn">Open Kairo <ArrowRight size={14} /></Link>
        </div>
      </div>
    );
  }
  const model = MODELS.find(item => item.id === snapshot.modelId);
  return (
    <div className="share-shell">
      <header className="share-header">
        <Link to="/" className="brand"><span className="brand-mark">K</span><span>KAIRO</span></Link>
        <span className="share-label">SHARED RESULT · READ ONLY</span>
      </header>
      <main className="research-view">
        <div className="result-kicker"><Share2 size={13} /> SHARED INVESTIGATION <span>·</span> {snapshot.date}</div>
        <h1 className="result-title">{snapshot.title}</h1>
        <div className="result-meta"><span className={`gem gem-${model?.tone ?? 'silver'}`}>◆</span>{model?.name ?? snapshot.modelId}<span>·</span>{snapshot.mode}</div>
        <div className="query-quote"><span className="quote-mark">“</span><span>{snapshot.query}</span></div>
        <div className="result-tabs">
          {(['Answer', 'Sources', 'Claims', 'Graph'] as Section[]).map((item, index) => (
            <button className={section === item ? 'tab-active' : ''} key={item} onClick={() => setSection(item)}>
              {[<FileText size={14} />, <Search size={14} />, <ShieldCheck size={14} />, <GitBranch size={14} />][index]}
              {item}
            </button>
          ))}
        </div>
        {section === 'Answer' && (
          snapshot.answer ? (
            <div className="answer-layout">
              <article>
                <div className="answer-label"><span className="answer-mark">K</span> KAIRO SYNTHESIS <span>·</span> {snapshot.sources.length} SOURCES</div>
                <AnswerMarkdown
                  answer={snapshot.answer}
                  onCite={sourceId => setSelectedSource(snapshot.sources.find(source => source.id === sourceId) ?? null)}
                />
              </article>
              <aside className="answer-side">
                <div className="verification-card">
                  <div className="side-card-head"><span>JEV REVIEW</span><ShieldCheck size={15} /></div>
                  <div className="jev-summary">{snapshot.claims.length} <small>claims examined</small></div>
                  {snapshot.claims.map(claim => (
                    <div className="jev-row" key={claim.id}><span className="status-dot" />{claim.id}<b>{claim.status}</b></div>
                  ))}
                  <div className="jev-note">Evidence statuses describe the cited material only, not absolute truth.</div>
                </div>
              </aside>
            </div>
          ) : <p className="muted">No answer was produced.</p>
        )}
        {section === 'Sources' && <SourcesView sources={snapshot.sources} setSelectedSource={setSelectedSource} />}
        {section === 'Claims' && <ClaimsView claims={snapshot.claims} verified={snapshot.claims.some(claim => claim.status !== 'Not checked')} setSelectedClaim={setSelectedClaim} />}
        {section === 'Graph' && (
          <GraphCanvas
            graph={snapshot.graph}
            claims={snapshot.claims}
            readOnly
            setSelectedClaim={setSelectedClaim}
            heading={false}
          />
        )}
        <div className="result-footnote">
          <ShieldCheck size={13} /> Shared snapshot · sources and evidence can change or become unavailable.
        </div>
        {selectedSource && (
          <SourceDrawer
            source={selectedSource}
            claims={snapshot.claims}
            onClose={() => setSelectedSource(null)}
            onClaim={id => {
              setSelectedClaim(snapshot.claims.find(claim => claim.id === id) ?? null);
              setSelectedSource(null);
              setSection('Claims');
            }}
          />
        )}
        {selectedClaim && (
          <ClaimDrawer
            claim={selectedClaim}
            sources={snapshot.sources}
            onClose={() => setSelectedClaim(null)}
            setSelectedSource={setSelectedSource}
          />
        )}
      </main>
    </div>
  );
}

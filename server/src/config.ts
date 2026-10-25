import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MODEL_IDS, type ModelId, type ProviderId } from '../../shared/models';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: process.env.ENV_FILE ?? path.join(rootDir, '.env') });

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  jsonMode: boolean;
  streamUsage: boolean;
}

export interface ModelRouteConfig {
  provider: ProviderId;
  model: string | null;
  available: boolean;
}

export interface AppConfig {
  rootDir: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  databasePath: string;
  uploadDir: string;
  maxUploadBytes: number;
  maxAttachments: number;
  maxConcurrentRuns: number;
  requestTimeoutMs: number;
  searchTimeoutMs: number;
  providers: Record<ProviderId, ProviderConfig>;
  tavilyApiKey: string;
  routes: Record<ModelId, ModelRouteConfig>;
  configured: boolean;
  missing: string[];
}

const DEFAULT_PROVIDERS: Record<ModelId, ProviderId> = {
  obsidian: 'jarvislabs',
  opal: 'openai',
  jade: 'jarvislabs',
  garnet: 'openai',
  topaz: 'jarvislabs',
  aventurine: 'openai',
};

function upperModel(id: ModelId) {
  return id.toUpperCase();
}

function asBool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 8787);
  const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`).replace(/\/$/, '');
  const dataDir = path.resolve(rootDir, env.DATA_DIR || 'data');

  const providers: Record<ProviderId, ProviderConfig> = {
    openai: {
      baseUrl: (env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.OPENAI_API_KEY || '',
      jsonMode: asBool(env.OPENAI_JSON_MODE, true),
      streamUsage: asBool(env.OPENAI_STREAM_USAGE, true),
    },
    jarvislabs: {
      baseUrl: (env.JARVISLABS_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.JARVISLABS_API_KEY || '',
      jsonMode: asBool(env.JARVISLABS_JSON_MODE, true),
      streamUsage: asBool(env.JARVISLABS_STREAM_USAGE, true),
    },
  };

  const routes = {} as Record<ModelId, ModelRouteConfig>;
  const missing = new Set<string>();
  const usedProviders = new Set<ProviderId>();

  for (const id of MODEL_IDS) {
    const providerName = (env[`MODEL_${upperModel(id)}_PROVIDER`] || DEFAULT_PROVIDERS[id]).toLowerCase();
    const provider: ProviderId = providerName === 'jarvislabs' ? 'jarvislabs' : 'openai';
    const model = env[`MODEL_${upperModel(id)}_NAME`] || null;
    usedProviders.add(provider);
    const providerConfig = providers[provider];
    const providerReady = Boolean(providerConfig.baseUrl && providerConfig.apiKey);
    if (!model) missing.add(`MODEL_${upperModel(id)}_NAME`);
    routes[id] = {
      provider,
      model,
      available: providerReady && Boolean(model),
    };
  }

  for (const provider of usedProviders) {
    const providerConfig = providers[provider];
    const prefix = provider === 'openai' ? 'OPENAI' : 'JARVISLABS';
    if (!providerConfig.baseUrl) missing.add(`${prefix}_BASE_URL`);
    if (!providerConfig.apiKey) missing.add(`${prefix}_API_KEY`);
  }

  if (!env.TAVILY_API_KEY) missing.add('TAVILY_API_KEY');

  const anyRoute = Object.values(routes).some(route => route.available);
  const configured = anyRoute && Boolean(env.TAVILY_API_KEY);

  return {
    rootDir,
    host,
    port: Number.isFinite(port) && port > 0 ? port : 8787,
    publicBaseUrl,
    databasePath: path.resolve(dataDir, 'kairo.db'),
    uploadDir: path.resolve(dataDir, 'uploads'),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024),
    maxAttachments: Number(env.MAX_ATTACHMENTS || 5),
    maxConcurrentRuns: Math.max(1, Number(env.MAX_CONCURRENT_RUNS || 2)),
    requestTimeoutMs: Math.max(1000, Number(env.REQUEST_TIMEOUT_MS || 180000)),
    searchTimeoutMs: Math.max(1000, Number(env.SEARCH_TIMEOUT_MS || 30000)),
    providers,
    tavilyApiKey: env.TAVILY_API_KEY || '',
    routes,
    configured,
    missing: [...missing].sort(),
  };
}

export const config = buildConfig(process.env);

export function modelRoute(id: ModelId): ModelRouteConfig {
  return config.routes[id];
}

export function providerConfig(provider: ProviderId): ProviderConfig {
  return config.providers[provider];
}

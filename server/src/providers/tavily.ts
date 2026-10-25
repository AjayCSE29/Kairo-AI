import type { AppConfig } from '../config';

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface SearchOptions {
  maxResults: number;
  depth: 'basic' | 'advanced';
  signal?: AbortSignal;
}

export interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  extract(urls: string[], signal?: AbortSignal): Promise<Map<string, string>>;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  score?: number;
  published_date?: string;
}

interface TavilySearchResponse {
  results?: TavilyResult[];
}

interface TavilyExtractResponse {
  results?: Array<{ url?: string; raw_content?: string | null }>;
}

export class TavilyError extends Error {
  constructor(message: string, readonly code = 'search_error') {
    super(message);
    this.name = 'TavilyError';
  }
}

export class TavilySearchProvider implements SearchProvider {
  constructor(private readonly config: AppConfig) {}

  private async request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.config.tavilyApiKey) throw new TavilyError('Tavily is not configured', 'search_unavailable');
    const timeout = AbortSignal.timeout(this.config.searchTimeoutMs);
    const signalToUse = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`https://api.tavily.com${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.config.tavilyApiKey, ...(body as Record<string, unknown>) }),
        signal: signalToUse,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new TavilyError('Search request timed out', 'search_timeout');
      }
      throw new TavilyError('Could not reach Tavily', 'search_unavailable');
    }
    if (!response.ok) {
      if (response.status === 401) throw new TavilyError('Tavily rejected the API key', 'search_auth');
      if (response.status === 429) throw new TavilyError('Tavily rate limit reached', 'search_rate_limit');
      throw new TavilyError(`Search request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const data = await this.request<TavilySearchResponse>(
      '/search',
      {
        query,
        search_depth: options.depth,
        include_raw_content: 'markdown',
        include_answer: false,
        max_results: options.maxResults,
      },
      options.signal,
    );
    return (data.results ?? [])
      .filter(result => typeof result.url === 'string' && result.url.startsWith('http'))
      .map(result => ({
        url: result.url as string,
        title: result.title?.trim() || new URL(result.url as string).hostname,
        content: (result.raw_content || result.content || '').trim(),
        score: typeof result.score === 'number' ? result.score : 0,
        publishedDate: result.published_date,
      }));
  }

  async extract(urls: string[], signal?: AbortSignal): Promise<Map<string, string>> {
    const output = new Map<string, string>();
    if (!urls.length) return output;
    const data = await this.request<TavilyExtractResponse>('/extract', { urls }, signal);
    for (const result of data.results ?? []) {
      if (result.url && result.raw_content) output.set(result.url, result.raw_content);
    }
    return output;
  }
}

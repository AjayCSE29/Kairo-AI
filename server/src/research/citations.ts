import type { CitationDTO, SourceDTO } from '../../../shared/types';

const CITATION_PATTERN = /\[(S\d+)\]/g;

export function buildCitations(sources: SourceDTO[]): CitationDTO[] {
  return sources.map(source => ({
    sourceId: source.id,
    index: Number.parseInt(source.id.replace(/^S/, ''), 10) || 0,
    title: source.title,
    domain: source.domain,
    ...(source.url ? { url: source.url } : {}),
  }));
}

export function citedSourceIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(CITATION_PATTERN)) ids.add(match[1]);
  return [...ids];
}

export function normalizeCitationMarkers(markdown: string, validSourceIds: Set<string>): string {
  return markdown.replace(CITATION_PATTERN, (match, id: string) => (validSourceIds.has(id) ? match : ''));
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

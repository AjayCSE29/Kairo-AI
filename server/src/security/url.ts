import net from 'node:net';

export function parseSafeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
    if (host.endsWith('.local') || host.endsWith('.internal')) return null;
    if (net.isIP(host)) {
      if (isPrivateIp(host)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isPrivateIp(host: string): boolean {
  if (net.isIPv4(host)) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(host)) {
    const normalized = host.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized === '::'
    );
  }
  return false;
}

export function domainForUrl(value: string): string {
  const url = parseSafeHttpUrl(value);
  return url ? url.hostname.replace(/^www\./, '') : 'unknown';
}

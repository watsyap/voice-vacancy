// Лимит spec §6: скользящее окно 60 мин по IP, в памяти инстанса (best effort, AGENTS.md §6 — предложено).

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

/** null — можно; число — через сколько секунд повторить (Retry-After). */
export function checkLimit(key: string, limit: number, now = Date.now()): number | null {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return Math.ceil((recent[0]! + WINDOW_MS - now) / 1000);
  }
  recent.push(now);
  hits.set(key, recent);
  return null;
}

export const clientIp = (req: Request): string =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

import { validateAnalyzeRes } from '../../shared/schema';
import type { AnalyzeRes, Q } from '../../shared/types';
import { CONFIG } from '../config';

export type AnalyzeResult = { ok: true; res: AnalyzeRes; demo: boolean } | { ok: false; demo: boolean };

type Attempt = { kind: 'ok'; res: AnalyzeRes } | { kind: 'retry' } | { kind: 'fail' };

/**
 * POST /api/analyze в окне 4 с (AC-9.3, запрос отменяется AbortController).
 * Невалидный ответ или 502 (невалидный JSON от LLM) → ровно 1 повтор, если окно не вышло (AC-9.2).
 * Любой другой не-200 → сразу ошибка (spec §6).
 */
export async function analyze(q: Q, transcript: string, signal?: AbortSignal): Promise<AnalyzeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.analyzeTimeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let demo = false;

  const attempt = async (): Promise<Attempt> => {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, transcript }),
      signal: ctrl.signal,
    });
    if (r.headers.get('X-Demo') === '1') demo = true;
    if (r.status === 502) return { kind: 'retry' };
    if (!r.ok) return { kind: 'fail' };
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      return { kind: 'retry' };
    }
    const res = validateAnalyzeRes(q, body);
    return res ? { kind: 'ok', res } : { kind: 'retry' };
  };

  try {
    let a = await attempt();
    if (a.kind === 'retry' && !ctrl.signal.aborted) a = await attempt();
    return a.kind === 'ok' ? { ok: true, res: a.res, demo } : { ok: false, demo };
  } catch {
    return { ok: false, demo };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { isQ } from '../shared/schema.js';
import { analyzeDemo } from './_lib/demo.js';
import { error, isDemo, json } from './_lib/http.js';
import { analyzeLLM, UpstreamError } from './_lib/llm.js';
import { checkLimit, clientIp } from './_lib/rateLimit.js';

/** Предел транскрипта — 4000 символов (AGENTS.md §6, предложено). */
const MAX_TRANSCRIPT = 4000;
/** spec §6: 60 запросов анализа в час с IP. */
const LIMIT_PER_HOUR = 60;

// POST /api/analyze — spec §6, AGENTS.md §6.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('bad_request');
  }
  const { q, transcript } = (body ?? {}) as { q?: unknown; transcript?: unknown };
  if (!isQ(q) || typeof transcript !== 'string' || !transcript.trim() || transcript.length > MAX_TRANSCRIPT) {
    return error('bad_request');
  }

  // В демо лимита нет (предложено).
  if (isDemo()) return json(analyzeDemo(q, transcript));

  const retryAfter = checkLimit(`analyze:${clientIp(req)}`, LIMIT_PER_HOUR);
  if (retryAfter !== null) return error('rate_limited', { 'Retry-After': String(retryAfter) });

  try {
    return json(await analyzeLLM(q, transcript.trim()));
  } catch (e) {
    // Причина — в логи Vercel (без ключа и транскрипта).
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.error('analyze failed:', e instanceof Error ? e.constructor.name : typeof e, status ?? '', e instanceof Error ? e.message : '');
    if (e instanceof Anthropic.APIConnectionTimeoutError) return error('timeout');
    if (e instanceof UpstreamError || e instanceof Anthropic.APIError) return error('upstream');
    return error('internal');
  }
}

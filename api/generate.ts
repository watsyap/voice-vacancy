import Anthropic from '@anthropic-ai/sdk';
import { generateDemo } from './_lib/demo.js';
import { validateGenerateReq } from './_lib/generateReq.js';
import { demoHeaders, error, isDemo } from './_lib/http.js';
import { generateLLM, UpstreamError } from './_lib/llm.js';
import { checkLimit, clientIp } from './_lib/rateLimit.js';

/** spec §6: 10 генераций в час с IP. */
const LIMIT_PER_HOUR = 10;
/** Демо: по 20 символов раз в 30 мс (spec §6). */
const DEMO_CHUNK = 20;
const DEMO_TICK_MS = 30;

const STREAM_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

function demoStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(ctrl) {
      if (i >= text.length) return ctrl.close();
      if (i > 0) await new Promise((r) => setTimeout(r, DEMO_TICK_MS));
      ctrl.enqueue(enc.encode(text.slice(i, i + DEMO_CHUNK)));
      i += DEMO_CHUNK;
    },
  });
}

function mapError(e: unknown): Response {
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  console.error('generate failed:', e instanceof Error ? e.constructor.name : typeof e, status ?? '', e instanceof Error ? e.message : '');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return error('timeout');
  if (e instanceof UpstreamError || e instanceof Anthropic.APIError) return error('upstream');
  return error('internal');
}

// POST /api/generate — spec §6, AGENTS.md §6. Поток Markdown, text/plain chunked.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('bad_request');
  }
  const valid = validateGenerateReq(body);
  if (!valid) return error('bad_request');

  if (isDemo()) return new Response(demoStream(generateDemo(valid)), { headers: { ...STREAM_HEADERS, ...demoHeaders() } });

  const retryAfter = checkLimit(`generate:${clientIp(req)}`, LIMIT_PER_HOUR);
  if (retryAfter !== null) return error('rate_limited', { 'Retry-After': String(retryAfter) });

  // Ждём первый фрагмент: до него ошибка уходит кодом (S18), после — обрывом потока (S18′).
  const it = generateLLM(valid);
  let first: IteratorResult<string>;
  try {
    first = await it.next();
  } catch (e) {
    return mapError(e);
  }
  if (first.done) return error('upstream');

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(first.value));
    },
    async pull(ctrl) {
      try {
        const next = await it.next();
        if (next.done) ctrl.close();
        else ctrl.enqueue(enc.encode(next.value));
      } catch (e) {
        console.error('generate cut:', e instanceof Error ? e.message : e);
        ctrl.error(e);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

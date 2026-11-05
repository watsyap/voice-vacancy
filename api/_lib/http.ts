import type { ApiError } from '../../shared/types.js';

/** Без ключа LLM — демо (spec §6). */
export const isDemo = (): boolean => !process.env.ANTHROPIC_API_KEY;

const demoHeaders = (): Record<string, string> => (isDemo() ? { 'X-Demo': '1' } : {});

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...demoHeaders(), ...headers },
  });
}

const STATUS: Record<ApiError['error'], number> = {
  bad_request: 400,
  rate_limited: 429,
  upstream: 502,
  timeout: 504,
  internal: 500,
};

export function error(code: ApiError['error'], headers: Record<string, string> = {}): Response {
  return json({ error: code } satisfies ApiError, STATUS[code], headers);
}

export { demoHeaders };

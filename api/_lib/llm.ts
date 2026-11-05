import Anthropic from '@anthropic-ai/sdk';
import { validateAnalyzeRes } from '../../shared/schema.js';
import type { AnalyzeRes, GenerateReq, Q } from '../../shared/types.js';
import { B1_SYSTEM, B2_SYSTEM, b1User, b2User } from './prompts.js';

// Модели — spec §6: анализ — класс Haiku, генерация — класс Sonnet. Переопределяются env.
export const MODEL_ANALYZE = process.env.LLM_MODEL_ANALYZE || 'claude-haiku-4-5';
export const MODEL_GENERATE = process.env.LLM_MODEL_GENERATE || 'claude-sonnet-5';

/** Таймаут LLM 25 с (AGENTS.md §6, предложено). Сервер не повторяет (maxRetries: 0). */
const TIMEOUT_MS = 25_000;

let client: Anthropic | null = null;
export const llm = (): Anthropic => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));

export class UpstreamError extends Error {}

/** Б1: извлечение слотов. Невалидный JSON → UpstreamError (502), клиент повторит в своём окне 4 с. */
export async function analyzeLLM(q: Q, transcript: string): Promise<AnalyzeRes> {
  // b1-analyze.md задаёт temperature 0, но API его больше не принимает (400 «Extra inputs are not permitted»).
  // Стабильность решения об уточнении держит код: полнота считается по слотам (spec §5, decisions.md).
  const res = await llm().messages.create({
    model: MODEL_ANALYZE,
    max_tokens: 400,
    system: B1_SYSTEM,
    messages: [{ role: 'user', content: b1User(q, transcript) }],
  });
  if (res.stop_reason === 'refusal') throw new UpstreamError('refusal');
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed: unknown;
  try {
    // На случай, если модель всё же обернула JSON в ```.
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new UpstreamError('invalid json');
  }
  const valid = validateAnalyzeRes(q, parsed);
  if (!valid) throw new UpstreamError('schema');
  return valid;
}

/**
 * Б2: генерация вакансии потоком. b2-generate.md задаёт temperature 0.3, но claude-sonnet-5 параметр не принимает,
 * а размышление по умолчанию задерживает первый токен (AC-17.1) — выключено. Решение автора, decisions.md.
 */
export async function* generateLLM(req: GenerateReq): AsyncGenerator<string> {
  const stream = llm().messages.stream({
    model: MODEL_GENERATE,
    max_tokens: 900,
    thinking: { type: 'disabled' },
    system: B2_SYSTEM,
    messages: [{ role: 'user', content: b2User(JSON.stringify(req.answers, null, 2)) }],
  });
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new UpstreamError('refusal');
}

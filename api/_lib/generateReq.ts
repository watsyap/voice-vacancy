import { isQ, validateAnalyzeRes } from '../../shared/schema.js';
import type { GenerateAnswer, GenerateReq } from '../../shared/types.js';

/** Предел транскрипта — как у /api/analyze (AGENTS.md §6, предложено). */
const MAX_TRANSCRIPT = 4000;

/** Проверка тела /api/generate (spec §6). null → 400 bad_request. Все skipped — тоже 400 (S20 не отправляет). */
export function validateGenerateReq(body: unknown): GenerateReq | null {
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 4) return null;
  const out: GenerateAnswer[] = [];
  const seen = new Set<number>();
  for (const a of answers as Record<string, unknown>[]) {
    if (typeof a !== 'object' || a === null || !isQ(a.q) || seen.has(a.q)) return null;
    seen.add(a.q);
    if (a.status === 'skipped') {
      out.push({ q: a.q, status: 'skipped' });
    } else if (a.status === 'raw') {
      if (typeof a.transcript !== 'string' || !a.transcript.trim() || a.transcript.length > MAX_TRANSCRIPT) return null;
      out.push({ q: a.q, status: 'raw', transcript: a.transcript.trim() });
    } else if (a.status === 'analyzed') {
      // Слоты проверяем тем же валидатором, что и ответ анализа.
      const v = validateAnalyzeRes(a.q, { slots: a.slots, missing: [], followup: null, off_topic: false });
      if (!v) return null;
      out.push({ q: a.q, status: 'analyzed', slots: v.slots });
    } else {
      return null;
    }
  }
  if (out.every((a) => a.status === 'skipped')) return null;
  return { answers: out.sort((x, y) => x.q - y.q) };
}

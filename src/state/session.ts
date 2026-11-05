import type { AnySlots, Q } from '../../shared/types';
import { QS } from '../../shared/types';
import { CONFIG } from '../config';
import type { AnswerStatus, State } from './machine';

// localStorage — flow.md §5, AGENTS.md §3. Ключ и формат — предложено.
export const SESSION_KEY = 'vv:session:v1';

export type SessionAnswer = {
  transcript: string;
  slots: AnySlots | null;
  status: AnswerStatus;
  completeness: number;
  followupUsed: boolean;
};

export type Session = {
  q: Q;
  cursor: Q;
  answers: Record<Q, SessionAnswer>;
  inputMode: 'voice' | 'text';
  queue: Q[];
  vacancy: string;
  savedAt: number;
};

/** Что сохраняем: без фазы записи, промежуточного текста и demo (flow.md §5). */
export function toSession(s: State, now = Date.now()): Session {
  const answers = Object.fromEntries(
    QS.map((q) => {
      const a = s.answers[q];
      return [q, { transcript: a.transcript, slots: a.slots, status: a.status, completeness: a.completeness, followupUsed: a.followupUsed }];
    }),
  ) as Record<Q, SessionAnswer>;
  return { q: s.q, cursor: s.cursor, answers, inputMode: s.inputMode, queue: s.queue, vacancy: s.vacancy.text, savedAt: now };
}

/** Есть что сохранять: хоть один ответ или текст вакансии. */
export const hasProgress = (s: State): boolean =>
  s.vacancy.text.length > 0 || QS.some((q) => s.answers[q].status !== 'empty');

const STATUSES: AnswerStatus[] = ['empty', 'analyzed', 'partial', 'raw', 'skipped'];
const isQ = (v: unknown): v is Q => v === 1 || v === 2 || v === 3 || v === 4;

/** Разбор сохранённой сессии; битая или старше 7 дней → null (spec §7 S23). */
export function parseSession(raw: string | null, now = Date.now()): Session | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Session>;
    if (typeof v.savedAt !== 'number' || now - v.savedAt > CONFIG.sessionMaxAgeMs) return null;
    if (!isQ(v.q) || !isQ(v.cursor) || (v.inputMode !== 'voice' && v.inputMode !== 'text')) return null;
    if (!Array.isArray(v.queue) || !v.queue.every(isQ) || typeof v.vacancy !== 'string' || !v.answers) return null;
    for (const q of QS) {
      const a = v.answers[q];
      if (!a || typeof a.transcript !== 'string' || !STATUSES.includes(a.status) || typeof a.completeness !== 'number') return null;
      if (typeof a.followupUsed !== 'boolean') return null;
    }
    return v as Session;
  } catch {
    return null;
  }
}

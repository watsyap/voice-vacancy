import type { AnalyzeRes, AnySlots, Q } from './types.js';

// Валидатор ответа /api/analyze — AGENTS.md §6. Без библиотек.
// Лишние поля отбрасываются, неверный тип — ответ невалиден (null).

const LIMITS = { task: 120, item4: 80, followup: 160 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** string | null; пустая строка → null. undefined → invalid. */
function nullableString(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : null;
}

/** Массив непустых строк ≤ max; пустые после trim выбрасываются, длинные — ответ невалиден. */
function stringList(v: unknown, max: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return undefined;
    const t = x.trim();
    if (!t) continue;
    if (t.length > max) return undefined;
    out.push(t);
  }
  return out;
}

function slots(q: Q, v: unknown): AnySlots | undefined {
  if (!isObj(v)) return undefined;
  switch (q) {
    case 1: {
      const tasks = stringList(v.tasks, LIMITS.task);
      return tasks ? { tasks } : undefined;
    }
    case 2: {
      const p = v.project;
      if (!isObj(p)) return undefined;
      const description = nullableString(p.description);
      const goal = nullableString(p.goal);
      if (description === undefined || goal === undefined) return undefined;
      if (p.role === undefined) return { project: { description, goal } };
      const role = nullableString(p.role);
      if (role === undefined) return undefined;
      return { project: { description, goal, role } };
    }
    case 3: {
      const c = v.continuity;
      if (c !== null && c !== 'same' && c !== 'other' && c !== 'undecided') return undefined;
      const np = v.next_project;
      if (np === undefined || np === null) return { continuity: c, next_project: null };
      if (!isObj(np)) return undefined;
      const description = nullableString(np.description);
      const domain = nullableString(np.domain);
      if (description === undefined || domain === undefined) return undefined;
      return { continuity: c, next_project: { description, domain } };
    }
    case 4: {
      const tools = stringList(v.tools, LIMITS.item4);
      const knowledge = stringList(v.knowledge, LIMITS.item4);
      return tools && knowledge ? { tools, knowledge } : undefined;
    }
  }
}

export function validateAnalyzeRes(q: Q, v: unknown): AnalyzeRes | null {
  if (!isObj(v)) return null;
  const s = slots(q, v.slots);
  const missing = stringList(v.missing, Number.POSITIVE_INFINITY);
  if (!s || !missing || typeof v.off_topic !== 'boolean') return null;
  const followup = nullableString(v.followup);
  if (followup === undefined || (followup !== null && followup.length > LIMITS.followup)) return null;
  return { slots: s, missing, followup, off_topic: v.off_topic };
}

export const isQ = (v: unknown): v is Q => v === 1 || v === 2 || v === 3 || v === 4;

import type { AnalyzeRes, Q, Slots1, Slots2, Slots3, Slots4 } from '../../shared/types.js';

// Демо-режим без ключа LLM — эвристики spec §6. Ответ должен реагировать на ввод.

const FILLERS = new Set(['ну', 'э', 'типа']);
/** Вводные в начале пункта списка — предложено, чтобы «он будет делать ревью кода» → «делать ревью кода». */
const LEAD_INS = new Set(['он', 'она', 'будет', 'будут', 'нужно', 'надо', 'должен', 'должна', 'также', 'ещё', 'еще', 'а']);

const clean = (s: string): string =>
  s
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w.toLowerCase().replace(/[^\p{L}]/gu, '')))
    .join(' ')
    .replace(/^[\s,;:—-]+|[\s,;:.!?—-]+$/g, '');

const dropLeadIns = (s: string): string => {
  const ws = s.split(' ');
  while (ws.length > 1 && LEAD_INS.has(ws[0]!.toLowerCase())) ws.shift();
  return ws.join(' ');
};

const cap = (s: string, max: number): string => (s.length > max ? s.slice(0, max).trimEnd() : s);

/** Q1, Q4: деление по запятым, «и», точкам (spec §6). */
function splitList(text: string, max: number): string[] {
  return text
    .split(/[,.;!?\n]+|\s+и\s+/iu)
    .map((x) => cap(dropLeadIns(clean(x)), max))
    .filter((x) => x.length > 0);
}

// Словарь инструментов Q4 — spec §6 (+ частые ошибки распознавания по Б1, правило 3).
const TOOLS: [string, RegExp][] = [
  ['Figma', /figma|фигм/iu],
  ['Sketch', /sketch|скетч/iu],
  ['Jira', /jira|жир[аеуы]|джир/iu],
  ['Confluence', /confluence|конфлюенс/iu],
  ['SQL', /(^|[^\p{L}])sql([^\p{L}]|$)|эскуэль/iu],
  ['Python', /python|питон/iu],
  ['1С', /(^|[^\p{L}\p{N}])1[сc]([^\p{L}]|$)/iu],
  ['Excel', /excel|эксел/iu],
  ['Power BI', /power\s?bi|пауэр\s?би/iu],
  ['JavaScript', /javascript|джаваскрипт|(^|[^\p{L}])js([^\p{L}]|$)/iu],
  ['TypeScript', /typescript|тайпскрипт/iu],
  ['React', /react|реакт/iu],
  ['Java', /(^|[^\p{L}])java([^\p{L}s]|$)|джав(а|е|ы|у)([^\p{L}]|$)/iu],
  ['Go', /golang|(^|[^\p{L}])go([^\p{L}]|$)/iu],
  ['Git', /(^|[^\p{L}])git([^\p{L}]|$)|(^|[^\p{L}])гит([^\p{L}]|$)/iu],
  ['Photoshop', /photoshop|фотошоп/iu],
  ['Tableau', /tableau/iu],
];

export function matchTools(text: string): string[] {
  return TOOLS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// Роль по словарю Q4 — spec §6. Ничья: порядок групп как в спеке (предложено).
const ROLE_GROUPS: [string, string[]][] = [
  ['Дизайнер', ['Figma', 'Sketch']],
  ['Аналитик', ['SQL', 'Python', 'Excel', 'Power BI']],
  ['Разработчик', ['JavaScript', 'TypeScript', 'React', 'Java', 'Go', '1С']],
];

export function roleByTools(tools: string[]): string {
  let best = '';
  let bestCount = 0;
  for (const [role, names] of ROLE_GROUPS) {
    const n = tools.filter((t) => names.includes(t)).length;
    if (n > bestCount) {
      best = role;
      bestCount = n;
    }
  }
  if (best) return best;
  if (tools.some((t) => t === 'Jira' || t === 'Confluence')) return 'Менеджер проекта';
  return 'Специалист';
}

// Пункты missing и шаблоны уточнений по первому из них (spec §6) — тексты предложены.
const MISSING = {
  tasks: 'ещё одна-две ежедневные задачи',
  description: 'что за проект',
  goal: 'цель проекта',
  continuity: 'продолжит или перейдёт на другой проект',
  nextDescription: 'какой следующий проект',
  nextDomain: 'с чем связан следующий проект',
  items4: 'ещё инструменты или знания',
} as const;

const FOLLOWUP: Record<string, string> = {
  [MISSING.tasks]: 'Какие ещё задачи он будет делать каждый день?',
  [MISSING.description]: 'Расскажите, что это за проект?',
  [MISSING.goal]: 'Зачем этот проект — какой результат нужен?',
  [MISSING.continuity]: 'Он продолжит этот проект или перейдёт на другой?',
  [MISSING.nextDescription]: 'На какой проект он перейдёт?',
  [MISSING.nextDomain]: 'С чем будет связан новый проект?',
  [MISSING.items4]: 'Какие ещё программы или знания ему понадобятся?',
};

function q1(text: string): [Slots1, string[]] {
  const tasks = splitList(text, 120);
  return [{ tasks }, tasks.length < 2 ? [MISSING.tasks] : []];
}

function q2(text: string): [Slots2, string[]] {
  const t = clean(text);
  const first = t.split(/[.!?]+/)[0] ?? '';
  // «чтобы» и «цель» точнее «для» («приложение для курьеров»): ищем по приоритету.
  // Цель — до конца предложения; «чтобы» и «цель —» убираем, «для» оставляем (без него смысл теряется).
  let at = -1;
  let goal: string | null = null;
  for (const [re, keepMarker] of [
    [/(^|\s)чтобы\s+/iu, false],
    [/(^|\s)цел[ьи]\S*\s*(?:[—:-]\s*)?/iu, false],
    [/(^|\s)для\s+/iu, true],
  ] as const) {
    const m = re.exec(t);
    if (!m) continue;
    at = m.index + m[1]!.length;
    const from = keepMarker ? at : m.index + m[0].length;
    goal = clean(t.slice(from).split(/[.!?]/)[0] ?? '') || null;
    break;
  }
  const descRaw = at > 0 && at < first.length ? first.slice(0, at) : first;
  const description = dropLeadIns(clean(descRaw)) || null;
  const missing = [...(description ? [] : [MISSING.description]), ...(goal ? [] : [MISSING.goal])];
  return [{ project: { description, goal, role: null } }, missing];
}

function q3(text: string): [Slots3, string[]] {
  const t = text.toLowerCase();
  if (/не знаю|не решили|зависит|посмотрим/u.test(t)) return [{ continuity: 'undecided', next_project: null }, []];
  if (/друг(ой|ую|ом|ого)|перейд/u.test(t)) {
    const d = /(?:перейд\S*|друг\S*)\s+(?:на\s+|проект\s+)?([^.,;!?]+?)(?=\s+(?:связан|для)\s|[.,;!?]|$)/iu.exec(text);
    const description = d ? clean(d[1]!) || null : null;
    const m = /(?:связан\S*\s+с|для)\s+([^.,;!?]+)/iu.exec(text);
    const domain = m ? clean(m[1]!) || null : null;
    const missing = [...(description ? [] : [MISSING.nextDescription]), ...(domain ? [] : [MISSING.nextDomain])];
    return [{ continuity: 'other', next_project: { description, domain } }, missing];
  }
  if (/продолж|тот же/u.test(t)) return [{ continuity: 'same', next_project: null }, []];
  return [{ continuity: null, next_project: null }, [MISSING.continuity]];
}

function q4(text: string): [Slots4, string[]] {
  const tools: string[] = [];
  const knowledge: string[] = [];
  for (const item of splitList(text, 80)) {
    const found = matchTools(item);
    if (found.length) {
      for (const f of found) if (!tools.includes(f)) tools.push(f);
    } else {
      knowledge.push(item);
    }
  }
  return [{ tools, knowledge }, tools.length + knowledge.length < 2 ? [MISSING.items4] : []];
}

export function analyzeDemo(q: Q, transcript: string): AnalyzeRes {
  const [slots, missing] = q === 1 ? q1(transcript) : q === 2 ? q2(transcript) : q === 3 ? q3(transcript) : q4(transcript);
  const first = missing[0];
  return { slots, missing, followup: first ? (FOLLOWUP[first] ?? null) : null, off_topic: false };
}

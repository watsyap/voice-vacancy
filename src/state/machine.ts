import type { AnySlots, Q } from '../../shared/types';
import { QS } from '../../shared/types';
import { meetsMin } from '../lib/normalize';
import { completeness, outcome } from './completeness';
import type { Event, EventType } from './events';

// ID состояний — flow.md §3 (S10′ → S10p, S18′ → S18p). S3a–S3c, S21, S24 — оверлеи, не фазы.
export type Phase =
  | 'S1' | 'S2' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S10p' | 'S11' | 'S12'
  | 'S13' | 'S14' | 'S15' | 'S16' | 'S17' | 'S18' | 'S18p' | 'S19' | 'S20' | 'S23';

export type AnswerStatus = 'empty' | 'analyzed' | 'partial' | 'raw' | 'skipped';

export type Answer = {
  transcript: string;
  slots: AnySlots | null;
  status: AnswerStatus;
  completeness: number;
  followupUsed: boolean;
  /** Уточняющий вопрос из последнего анализа (показывается в S11). */
  followup: string | null;
};

export type State = {
  phase: Phase;
  q: Q;
  /** Самый дальний открытый вопрос: сюда ведёт «Следующий вопрос» из S15. */
  cursor: Q;
  answers: Record<Q, Answer>;
  /** Финальный распознанный (или введённый) текст текущей попытки. */
  draft: string;
  /** Промежуточный текст распознавания; не сохраняется (flow.md §5). */
  interim: string;
  /** Запись идёт как ответ на уточнение: «Готово» дописывает draft к транскрипту (spec §5). */
  inFollowup: boolean;
  inputMode: 'voice' | 'text';
  voiceBlock: null | 'S3a' | 'S3b' | 'S3c';
  offline: boolean;
  volumeMode: 'rms' | 'pulse';
  queue: Q[];
  vacancy: { text: string; complete: boolean };
  demo: boolean;
  noSpeechCount: number;
};

export const emptyAnswer = (): Answer => ({
  transcript: '',
  slots: null,
  status: 'empty',
  completeness: 0,
  followupUsed: false,
  followup: null,
});

export const initialState = (): State => ({
  phase: 'S1',
  q: 1,
  cursor: 1,
  answers: { 1: emptyAnswer(), 2: emptyAnswer(), 3: emptyAnswer(), 4: emptyAnswer() },
  draft: '',
  interim: '',
  inFollowup: false,
  inputMode: 'voice',
  voiceBlock: null,
  offline: false,
  volumeMode: 'rms',
  queue: [],
  vacancy: { text: '', complete: false },
  demo: false,
  noSpeechCount: 0,
});

const RECORDING: Phase[] = ['S4', 'S5', 'S6', 'S7', 'S8'];
const RESOLVED: Phase[] = ['S10', 'S10p', 'S12', 'S14'];

/** Разрешённые пары phase × event. Всё остальное — тот же state (AGENTS.md §3). */
export const ALLOWED: Record<Phase, readonly EventType[]> = {
  S1: ['START', 'START_TEXT'],
  S2: ['MIC_OK'],
  S4: ['SPEECH_INTERIM', 'SPEECH_FINAL', 'DONE', 'SUBMIT_TEXT', 'SKIP'],
  S5: ['SPEECH_INTERIM', 'SPEECH_FINAL', 'DONE', 'SKIP'],
  S6: ['SPEECH_INTERIM', 'SPEECH_FINAL', 'DONE', 'SKIP'],
  S7: ['SPEECH_INTERIM', 'SPEECH_FINAL', 'DONE', 'SUBMIT_TEXT', 'SKIP'],
  S8: ['DONE', 'RERECORD'],
  S9: ['ANALYZE_OK', 'ANALYZE_FAIL'],
  S10: ['NEXT', 'RERECORD', 'OPEN_SEGMENT'],
  S10p: ['NEXT', 'RERECORD', 'OPEN_SEGMENT'],
  S11: ['SPEECH_INTERIM', 'SPEECH_FINAL', 'DONE', 'SUBMIT_TEXT', 'SKIP_FOLLOWUP'],
  S12: ['NEXT', 'RERECORD', 'OPEN_SEGMENT'],
  S13: [],
  S14: ['NEXT', 'OPEN_SEGMENT'],
  S15: ['NEXT', 'RERECORD'],
  S16: [],
  S17: [],
  S18: [],
  S18p: [],
  S19: [],
  S20: ['OPEN_SEGMENT'],
  S23: [],
};

const join = (a: string, b: string): string => [a.trim(), b.trim()].filter(Boolean).join(' ');

const setAnswer = (s: State, q: Q, patch: Partial<Answer>): State => ({
  ...s,
  answers: { ...s.answers, [q]: { ...s.answers[q], ...patch } },
});

/** Фаза, в которой показывается уже данный ответ. */
export function resolvedPhase(a: Answer): Phase {
  switch (a.status) {
    case 'analyzed':
      return 'S10';
    case 'partial':
      return 'S10p';
    case 'raw':
      return 'S12';
    case 'skipped':
      return 'S14';
    case 'empty':
      return 'S4';
  }
}

const firstEmpty = (s: State): Q | null => QS.find((q) => s.answers[q].status === 'empty') ?? null;

/** Открыть вопрос для записи: новая попытка с чистым черновиком. */
const openQuestion = (s: State, q: Q): State => ({
  ...s,
  phase: 'S4',
  q,
  cursor: q > s.cursor ? q : s.cursor,
  draft: '',
  interim: '',
  inFollowup: false,
  noSpeechCount: 0,
});

/** «Готово»: проверка min, затем анализ (flow.md §2, шаг 4; spec §5). */
function finish(s: State, text: string): State {
  if (s.inFollowup) {
    // Ответ на уточнение дописывается к исходному (spec §5, AC-11.2). Пустой — предложено: игнорировать.
    if (!text.trim()) return s;
    const merged = join(s.answers[s.q].transcript, text);
    return { ...setAnswer(s, s.q, { transcript: merged }), phase: 'S9', draft: '', interim: '', inFollowup: false };
  }
  if (!meetsMin(s.q, text)) return { ...s, phase: 'S7', draft: text, interim: '' };
  return { ...setAnswer(s, s.q, { transcript: text.trim() }), phase: 'S9', draft: '', interim: '' };
}

export function reducer(s: State, e: Event): State {
  if (!ALLOWED[s.phase].includes(e.type)) return s;

  switch (e.type) {
    case 'START':
      return { ...s, phase: 'S2', inputMode: 'voice' };

    case 'START_TEXT':
      return { ...openQuestion(s, 1), inputMode: 'text' };

    case 'MIC_OK':
      return openQuestion(s, s.q);

    case 'SPEECH_INTERIM':
      return { ...s, interim: e.text, phase: s.phase === 'S11' ? 'S11' : 'S4' };

    case 'SPEECH_FINAL':
      return {
        ...s,
        draft: join(s.draft, e.text),
        interim: '',
        noSpeechCount: 0,
        phase: s.phase === 'S11' ? 'S11' : 'S4',
      };

    case 'DONE':
      return finish(s, join(s.draft, s.interim));

    case 'SUBMIT_TEXT':
      return finish(s, e.text);

    case 'ANALYZE_OK': {
      const a = s.answers[s.q];
      const value = completeness(s.q, e.res);
      const next = outcome(value, a.followupUsed, e.res.followup);
      const patched = setAnswer(s, s.q, {
        slots: e.res.slots,
        completeness: value,
        status: value >= 1 ? 'analyzed' : 'partial',
        followup: e.res.followup,
        followupUsed: a.followupUsed || next === 'S11',
      });
      return { ...patched, phase: next, inFollowup: next === 'S11', draft: '', interim: '' };
    }

    case 'ANALYZE_FAIL':
      return {
        ...setAnswer(s, s.q, { slots: null, completeness: 0, status: 'raw', followup: null }),
        phase: 'S12',
        inFollowup: false,
      };

    case 'SKIP_FOLLOWUP':
      return { ...s, phase: 'S10p', inFollowup: false, draft: '', interim: '' };

    case 'SKIP': {
      const skipped = setAnswer(s, s.q, { ...emptyAnswer(), status: 'skipped' });
      if (QS.every((q) => skipped.answers[q].status === 'skipped')) {
        return { ...skipped, phase: 'S20', draft: '', interim: '' };
      }
      const target = firstEmpty(skipped);
      if (target !== null) return openQuestion(skipped, target);
      return { ...skipped, phase: 'S14', draft: '', interim: '' };
    }

    case 'RERECORD':
      // S13: сброс транскрипта, слотов и флага уточнения, сразу запись (spec §5).
      return openQuestion(setAnswer(s, s.q, emptyAnswer()), s.q);

    case 'NEXT': {
      const target = firstEmpty(s);
      if (target !== null) return openQuestion(s, target);
      if (s.phase === 'S15' && s.q !== s.cursor) {
        return { ...s, q: s.cursor, phase: resolvedPhase(s.answers[s.cursor]) };
      }
      // Все отвечены и мы на последнем: дальше только «Собрать вакансию» (A5.5).
      return s;
    }

    case 'OPEN_SEGMENT': {
      // Только к другому уже данному ответу (spec §4.1, §7 S15).
      if (e.q === s.q || s.answers[e.q].status === 'empty') return s;
      return { ...s, q: e.q, phase: 'S15', draft: '', interim: '' };
    }
  }
}

export const isRecording = (p: Phase): boolean => RECORDING.includes(p) || p === 'S11';
export const isResolved = (p: Phase): boolean => RESOLVED.includes(p);

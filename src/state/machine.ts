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
  /** Уточнение прочитано (600 мс прошли): запись в S11 разрешена. */
  followupReady: boolean;
  /** S8 по скрытию вкладки (S22): другая подпись. */
  tabPaused: boolean;
  inputMode: 'voice' | 'text';
  voiceBlock: null | 'S3a' | 'S3b' | 'S3c';
  offline: boolean;
  volumeMode: 'rms' | 'pulse';
  queue: Q[];
  vacancy: { text: string; complete: boolean };
  /** Номер запуска генерации: новый запуск — новый запрос (useEffects). */
  genRun: number;
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
  followupReady: false,
  tabPaused: false,
  inputMode: 'voice',
  voiceBlock: null,
  offline: false,
  volumeMode: 'rms',
  queue: [],
  vacancy: { text: '', complete: false },
  genRun: 0,
  demo: false,
  noSpeechCount: 0,
});

const RECORDING: Phase[] = ['S4', 'S5', 'S6', 'S7', 'S8'];
const RESOLVED: Phase[] = ['S10', 'S10p', 'S12', 'S14'];

/** Разрешённые пары phase × event. Всё остальное — тот же state (AGENTS.md §3).
 *  VOLUME_UNAVAILABLE — оверлей S24, допустим в любой фазе. */
const LISTEN_EVENTS: readonly EventType[] = [
  'SPEECH_INTERIM', 'SPEECH_FINAL', 'SILENCE_START', 'SILENCE_END', 'NO_SPEECH', 'PAUSE', 'TAB_HIDDEN',
  'DONE', 'SUBMIT_TEXT', 'DRAFT_EDIT', 'SET_INPUT_MODE', 'MIC_DENIED', 'MIC_MISSING',
];
const PAUSED_EVENTS: readonly EventType[] = [
  'SPEECH_INTERIM', 'SPEECH_FINAL', 'RESUME', 'DONE', 'SET_INPUT_MODE', 'MIC_DENIED', 'MIC_MISSING',
];

export const ALLOWED: Record<Phase, readonly EventType[]> = {
  S1: ['START', 'START_TEXT'],
  S2: ['MIC_OK', 'MIC_DENIED', 'MIC_MISSING', 'SPEECH_UNSUPPORTED'],
  S4: [...LISTEN_EVENTS, 'SKIP'],
  S5: [...PAUSED_EVENTS, 'SKIP', 'SKIP_FOLLOWUP'],
  S6: [...PAUSED_EVENTS, 'SKIP', 'SKIP_FOLLOWUP'],
  S7: [...LISTEN_EVENTS, 'SKIP'],
  S8: [...PAUSED_EVENTS, 'RERECORD', 'SKIP_FOLLOWUP'],
  S9: ['ANALYZE_OK', 'ANALYZE_FAIL'],
  S10: ['NEXT', 'RERECORD', 'OPEN_SEGMENT', 'GENERATE'],
  S10p: ['NEXT', 'RERECORD', 'OPEN_SEGMENT', 'GENERATE'],
  S11: [...LISTEN_EVENTS, 'SKIP_FOLLOWUP', 'FOLLOWUP_READY'],
  S12: ['NEXT', 'RERECORD', 'OPEN_SEGMENT', 'GENERATE'],
  S13: [],
  S14: ['NEXT', 'OPEN_SEGMENT', 'GENERATE'],
  S15: ['NEXT', 'RERECORD'],
  S16: ['GEN_CHUNK', 'GEN_SLOW', 'GEN_FAIL', 'GEN_CUT', 'GEN_DONE'],
  S17: ['GEN_CHUNK', 'GEN_FAIL', 'GEN_CUT', 'GEN_DONE'],
  S18: ['GENERATE'],
  S18p: ['GENERATE', 'EDIT_VACANCY'],
  S19: ['EDIT_VACANCY', 'RESET'],
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

/** Фаза записи: обычный ответ — S4, ответ на уточнение — S11 (то же S4-поведение, spec §7). */
const listenPhase = (s: State): Phase => (s.inFollowup ? 'S11' : 'S4');

/** Голос можно включить: API есть и не заблокирован (S3a–S3c). */
const voiceAllowed = (s: State): boolean => s.voiceBlock === null;

/** Остановить запись в текстовый режим, сохранив сказанное (flow.md §3). */
const toText = (s: State, block: State['voiceBlock'] = s.voiceBlock): State => ({
  ...s,
  inputMode: 'text',
  voiceBlock: block,
  draft: join(s.draft, s.interim),
  interim: '',
  tabPaused: false,
  phase: listenPhase(s),
});

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
  tabPaused: false,
  noSpeechCount: 0,
});

/** «Готово»: проверка min, затем анализ (flow.md §2, шаг 4; spec §5). */
function finish(s: State, text: string): State {
  if (s.inFollowup) {
    // Ответ на уточнение дописывается к исходному (spec §5, AC-11.2). Пустой — предложено: игнорировать.
    if (!text.trim()) return s;
    const merged = join(s.answers[s.q].transcript, text);
    return { ...setAnswer(s, s.q, { transcript: merged }), phase: 'S9', draft: '', interim: '', inFollowup: false, tabPaused: false };
  }
  if (!meetsMin(s.q, text)) return { ...s, phase: 'S7', draft: text, interim: '', tabPaused: false };
  return { ...setAnswer(s, s.q, { transcript: text.trim() }), phase: 'S9', draft: '', interim: '', tabPaused: false };
}

export function reducer(s: State, e: Event): State {
  if (e.type === 'VOLUME_UNAVAILABLE') return s.volumeMode === 'pulse' ? s : { ...s, volumeMode: 'pulse' };
  if (e.type === 'DEMO_SEEN') return s.demo ? s : { ...s, demo: true };
  if (!ALLOWED[s.phase].includes(e.type)) return s;

  switch (e.type) {
    case 'START':
      return { ...s, phase: 'S2', inputMode: 'voice' };

    case 'START_TEXT':
      return { ...openQuestion(s, 1), inputMode: 'text' };

    case 'MIC_OK':
      return { ...openQuestion(s, s.q), inputMode: 'voice' };

    case 'MIC_DENIED':
      return s.phase === 'S2' ? toText(openQuestion(s, s.q), 'S3a') : toText(s, 'S3a');

    case 'MIC_MISSING':
      return s.phase === 'S2' ? toText(openQuestion(s, s.q), 'S3b') : toText(s, 'S3b');

    case 'SPEECH_UNSUPPORTED':
      return toText(openQuestion(s, s.q), 'S3c');

    case 'SPEECH_INTERIM': {
      if (s.inputMode !== 'voice') return s;
      // В паузе дописываем хвост распознавания, но фазу не меняем.
      const paused = s.phase === 'S8' || s.phase === 'S5' || s.phase === 'S6';
      return { ...s, interim: e.text, phase: paused ? s.phase : listenPhase(s) };
    }

    case 'SPEECH_FINAL': {
      if (s.inputMode !== 'voice') return s;
      const paused = s.phase === 'S8' || s.phase === 'S5' || s.phase === 'S6';
      return {
        ...s,
        draft: join(s.draft, e.text),
        interim: '',
        noSpeechCount: 0,
        phase: paused ? s.phase : listenPhase(s),
      };
    }

    case 'SILENCE_START':
      // 5 с без слов → пауза (flow.md §3 S5). Если текст уже есть — тоже пауза, а не отправка (предложено).
      return s.inputMode === 'voice' ? { ...s, phase: 'S5' } : s;

    case 'SILENCE_END':
      // 4 с тишины после речи → конец ответа (AC-4.3).
      return s.inputMode === 'voice' && join(s.draft, s.interim) ? finish(s, join(s.draft, s.interim)) : s;

    case 'NO_SPEECH':
      return s.inputMode === 'voice' ? { ...s, phase: 'S6', noSpeechCount: s.noSpeechCount + 1 } : s;

    case 'PAUSE':
      return s.inputMode === 'voice' ? { ...s, phase: 'S8', tabPaused: false } : s;

    case 'TAB_HIDDEN':
      return s.inputMode === 'voice' ? { ...s, phase: 'S8', tabPaused: true } : s;

    case 'RESUME':
      // Хвост промежуточного текста фиксируем: новая сессия распознавания его не вернёт.
      return { ...s, phase: listenPhase(s), draft: join(s.draft, s.interim), interim: '', tabPaused: false };

    case 'SET_INPUT_MODE':
      if (e.mode === 'text') return s.inputMode === 'text' ? s : toText(s);
      if (s.inputMode === 'voice' || !voiceAllowed(s)) return s;
      return { ...s, inputMode: 'voice', phase: listenPhase(s), noSpeechCount: 0 };

    case 'DRAFT_EDIT':
      return s.inputMode === 'text' ? { ...s, draft: e.text } : s;

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
      return {
        ...patched,
        phase: next,
        inFollowup: next === 'S11',
        followupReady: false,
        draft: '',
        interim: '',
        demo: s.demo || !!e.demo,
      };
    }

    case 'FOLLOWUP_READY':
      return s.followupReady ? s : { ...s, followupReady: true };

    case 'ANALYZE_FAIL':
      return {
        ...setAnswer(s, s.q, { slots: null, completeness: 0, status: 'raw', followup: null }),
        phase: 'S12',
        inFollowup: false,
        demo: s.demo || !!e.demo,
      };

    case 'SKIP_FOLLOWUP':
      if (!s.inFollowup) return s;
      return { ...s, phase: 'S10p', inFollowup: false, draft: '', interim: '', tabPaused: false };

    case 'SKIP': {
      // В уточнении «Пропустить» вопрос нет (spec §4.1).
      if (s.inFollowup) return s;
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

    case 'GENERATE': {
      // Только с последнего вопроса, когда неотвеченных нет и не всё пропущено (AC-16.1, S20).
      const fromQuestion = s.phase !== 'S18' && s.phase !== 'S18p';
      if (fromQuestion && (s.q !== 4 || firstEmpty(s) !== null)) return s;
      if (QS.every((q) => s.answers[q].status === 'skipped')) return s;
      return { ...s, phase: 'S16', vacancy: { text: '', complete: false }, genRun: s.genRun + 1 };
    }

    case 'GEN_CHUNK':
      return { ...s, phase: 'S16', vacancy: { text: s.vacancy.text + e.text, complete: false } };

    case 'GEN_SLOW':
      return s.vacancy.text ? s : { ...s, phase: 'S17' };

    case 'GEN_FAIL':
      return { ...s, phase: 'S18', vacancy: { text: '', complete: false } };

    case 'GEN_CUT':
      return { ...s, phase: 'S18p' };

    case 'GEN_DONE':
      return s.vacancy.text ? { ...s, phase: 'S19', vacancy: { ...s.vacancy, complete: true } } : { ...s, phase: 'S18' };

    case 'EDIT_VACANCY':
      return { ...s, vacancy: { ...s.vacancy, text: e.text } };

    case 'RESET':
      return initialState();

    case 'OPEN_SEGMENT': {
      // Только к другому уже данному ответу (spec §4.1, §7 S15).
      if (e.q === s.q || s.answers[e.q].status === 'empty') return s;
      return { ...s, q: e.q, phase: 'S15', draft: '', interim: '' };
    }
  }
}

export const isRecording = (p: Phase): boolean => RECORDING.includes(p) || p === 'S11';
/** Идёт захват голоса (распознавание и громкость активны). */
export const isListening = (s: State): boolean =>
  s.inputMode === 'voice' && (s.phase === 'S4' || s.phase === 'S7' || (s.phase === 'S11' && s.followupReady));
export const isResolved = (p: Phase): boolean => RESOLVED.includes(p);

import type { AnalyzeRes, Q } from '../../shared/types';

// События машины — AGENTS.md §3. Остальные (генерация, сеть, сессия) добавляются по этапам A5.
export type Event =
  | { type: 'START' }
  | { type: 'START_TEXT' }
  | { type: 'MIC_OK' }
  | { type: 'MIC_DENIED' }
  | { type: 'MIC_MISSING' }
  | { type: 'SPEECH_UNSUPPORTED' }
  | { type: 'SPEECH_INTERIM'; text: string }
  | { type: 'SPEECH_FINAL'; text: string }
  | { type: 'SILENCE_START' }
  | { type: 'SILENCE_END' }
  | { type: 'NO_SPEECH' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'TAB_HIDDEN' }
  | { type: 'VOLUME_UNAVAILABLE' }
  /** «Ответить текстом» / «Ответить голосом» (flow.md §3, «Текстовый режим»). */
  | { type: 'SET_INPUT_MODE'; mode: 'voice' | 'text' }
  /** Правка поля ввода в текстовом режиме: текст живёт в state, чтобы переживать смену режима. */
  | { type: 'DRAFT_EDIT'; text: string }
  | { type: 'DONE' }
  | { type: 'SUBMIT_TEXT'; text: string }
  /** demo — сервер вернул X-Demo: 1 (AGENTS.md §6); флаг не сбрасывается. */
  | { type: 'ANALYZE_OK'; res: AnalyzeRes; demo?: boolean }
  | { type: 'ANALYZE_FAIL'; demo?: boolean }
  | { type: 'SKIP_FOLLOWUP' }
  | { type: 'SKIP' }
  | { type: 'RERECORD' }
  | { type: 'NEXT' }
  | { type: 'OPEN_SEGMENT'; q: Q };

export type EventType = Event['type'];

import type { AnalyzeRes, Q } from '../../shared/types';
import type { Session } from './session';

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
  /** Прошло 600 мс после показа уточнения — можно начинать запись (spec §7 S11). */
  | { type: 'FOLLOWUP_READY' }
  | { type: 'SKIP_FOLLOWUP' }
  | { type: 'SKIP' }
  | { type: 'RERECORD' }
  | { type: 'NEXT' }
  | { type: 'OPEN_SEGMENT'; q: Q }
  /** «Собрать вакансию» / «Повторить» / «Дописать заново» (S16, AC-16.1, S18, S18′). */
  | { type: 'GENERATE' }
  | { type: 'GEN_CHUNK'; text: string }
  /** 10 с без первого фрагмента (AC-17.1). */
  | { type: 'GEN_SLOW' }
  | { type: 'GEN_FAIL' }
  | { type: 'GEN_CUT' }
  | { type: 'GEN_DONE' }
  /** X-Demo от /api/generate. */
  | { type: 'DEMO_SEEN' }
  | { type: 'EDIT_VACANCY'; text: string }
  | { type: 'RESET' }
  /** Сессия из localStorage при старте (flow.md §5, spec §7 S23). */
  | { type: 'RESTORE'; session: Session }
  /** «Продолжить» в S23 — это жест для микрофона (flow.md §3). */
  | { type: 'CONTINUE' }
  | { type: 'OFFLINE' }
  | { type: 'ONLINE' }
  /** Ответ из очереди S21 проанализирован: без уточнения, неполный → S10′ (spec §7 S21). */
  | { type: 'QUEUE_ANALYZED'; q: Q; res: AnalyzeRes }
  /** Анализ ответа из очереди не удался: ответ остаётся raw (генерация разберёт). */
  | { type: 'QUEUE_FAILED'; q: Q };

export type EventType = Event['type'];

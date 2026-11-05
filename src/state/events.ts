import type { AnalyzeRes, Q } from '../../shared/types';

// События машины — AGENTS.md §3. Остальные (голос, генерация, сеть, сессия) добавляются по этапам A5.
export type Event =
  | { type: 'START' }
  | { type: 'START_TEXT' }
  | { type: 'MIC_OK' }
  | { type: 'SPEECH_INTERIM'; text: string }
  | { type: 'SPEECH_FINAL'; text: string }
  | { type: 'DONE' }
  | { type: 'SUBMIT_TEXT'; text: string }
  | { type: 'ANALYZE_OK'; res: AnalyzeRes }
  | { type: 'ANALYZE_FAIL' }
  | { type: 'SKIP_FOLLOWUP' }
  | { type: 'SKIP' }
  | { type: 'RERECORD' }
  | { type: 'NEXT' }
  | { type: 'OPEN_SEGMENT'; q: Q };

export type EventType = Event['type'];

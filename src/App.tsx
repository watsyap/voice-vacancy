import { useReducer } from 'react';
import type { Q } from '../shared/types';
import { QS } from '../shared/types';
import { Actions } from './components/Actions';
import { ProgressRing, type RingMode, type SegmentState } from './components/ProgressRing';
import { QuestionView } from './components/QuestionView';
import { StatusLine } from './components/StatusLine';
import { initialState, isRecording, reducer, type State } from './state/machine';
import styles from './App.module.css';

// Тексты — flow.md §3. Остальные подписи добавляются по этапам A5.
const INTRO = '4 вопроса о будущем сотруднике, ~3 минуты. Отвечайте голосом — микрофон нужен только для записи';

function segmentsOf(s: State): Record<Q, SegmentState> {
  return Object.fromEntries(
    QS.map((q) => [q, { status: s.answers[q].status, fill: s.answers[q].completeness }]),
  ) as Record<Q, SegmentState>;
}

function ringMode(s: State): RingMode {
  if (s.phase === 'S9') return 'analyze';
  if (s.phase === 'S4' && s.inputMode === 'voice') return 'listen';
  return 'idle';
}

function statusOf(s: State): string {
  switch (s.phase) {
    case 'S2':
      return 'Разрешите доступ к микрофону';
    case 'S4':
      return s.inputMode === 'voice' ? 'Слушаю' : '';
    case 'S9':
      return 'Разбираю ответ';
    default:
      return '';
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const isIntro = state.phase === 'S1';
  const current = isIntro ? null : state.q;

  return (
    <main className={styles.screen}>
      <section className={styles.top}>
        {isIntro ? (
          <p className={styles.intro}>{INTRO}</p>
        ) : (
          <QuestionView q={state.q} showExample={!state.interim && !state.draft} />
        )}
      </section>

      <section className={styles.ringZone}>
        <ProgressRing segments={segmentsOf(state)} current={current} mode={ringMode(state)} />
      </section>

      <section className={styles.statusZone}>
        <StatusLine text={statusOf(state)} />
      </section>

      <section className={styles.actionsZone}>
        {isIntro && (
          <Actions
            primary={{ label: 'Начать', onClick: () => dispatch({ type: 'START' }) }}
            links={[{ label: 'Ответить текстом', onClick: () => dispatch({ type: 'START_TEXT' }) }]}
          />
        )}
        {isRecording(state.phase) && state.inputMode === 'voice' && (
          <Actions primary={{ label: 'Готово', onClick: () => dispatch({ type: 'DONE' }) }} />
        )}
      </section>
    </main>
  );
}

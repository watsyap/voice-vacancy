import { useCallback, useEffect, useReducer, type Dispatch } from 'react';
import type { Q } from '../shared/types';
import { QS } from '../shared/types';
import { Actions, type Action } from './components/Actions';
import { ProgressRing, type RingMode, type SegmentState } from './components/ProgressRing';
import { QuestionView } from './components/QuestionView';
import { StatusLine } from './components/StatusLine';
import { TextAnswer } from './components/TextAnswer';
import { TranscriptLive } from './components/TranscriptLive';
import { CONFIG } from './config';
import { useEffects } from './hooks/useEffects';
import { speechSupported, useSpeech } from './hooks/useSpeech';
import { useVolume } from './hooks/useVolume';
import type { Event } from './state/events';
import { initialState, isListening, isRecording, reducer, type State } from './state/machine';
import styles from './App.module.css';

// Тексты — flow.md §3 и spec §4. Не придумывать новые.
const INTRO = '4 вопроса о будущем сотруднике, ~3 минуты. Отвечайте голосом — микрофон нужен только для записи';
const VOICE_BLOCK: Record<NonNullable<State['voiceBlock']>, string> = {
  S3a: 'Микрофон заблокирован. Включить: значок слева от адреса → Микрофон → Разрешить, затем обновите страницу',
  S3b: 'Микрофон не найден — отвечайте текстом',
  S3c: 'Голосовой ввод работает в Chrome и Edge',
};

function segmentsOf(s: State): Record<Q, SegmentState> {
  return Object.fromEntries(
    QS.map((q) => [q, { status: s.answers[q].status, fill: s.answers[q].completeness }]),
  ) as Record<Q, SegmentState>;
}

function ringMode(s: State): RingMode {
  if (s.phase === 'S9') return 'analyze';
  if (isListening(s)) return 'listen';
  return 'idle';
}

function statusOf(s: State): string {
  const followup = s.answers[s.q].followup ?? '';
  if (s.phase === 'S2') return 'Разрешите доступ к микрофону';
  if (s.phase === 'S9') return 'Разбираю ответ';
  if (!isRecording(s.phase)) return '';
  if (s.phase === 'S7') return 'Расскажите чуть подробнее';
  if (s.phase === 'S11') return followup;
  if (s.inputMode === 'text') return s.voiceBlock ? VOICE_BLOCK[s.voiceBlock] : '';
  switch (s.phase) {
    case 'S4':
      return 'Слушаю';
    case 'S5':
      return 'Нажмите на кольцо, когда будете готовы';
    case 'S6':
      return 'Не разобрал речь. Говорите ближе к микрофону или ответьте текстом';
    case 'S8':
      return s.tabPaused ? 'Запись приостановлена' : 'Пауза';
    default:
      return '';
  }
}

type ActionSet = { primary?: Action; secondary?: Action; links?: [] | [Action] | [Action, Action] };

function actionsOf(s: State, dispatch: Dispatch<Event>, voiceOk: boolean): ActionSet {
  const ev = (e: Event) => () => dispatch(e);
  const links = (...xs: (Action | false)[]) => xs.filter((x): x is Action => Boolean(x)).slice(0, 2) as ActionSet['links'];
  const done: Action = { label: 'Готово', onClick: ev({ type: 'DONE' }) };
  const toText: Action = { label: 'Ответить текстом', onClick: ev({ type: 'SET_INPUT_MODE', mode: 'text' }) };
  const toVoice: Action | false = voiceOk && { label: 'Ответить голосом', onClick: ev({ type: 'SET_INPUT_MODE', mode: 'voice' }) };
  const skip: Action | false = !s.inFollowup && { label: 'Пропустить', onClick: ev({ type: 'SKIP' }) };
  const skipFollowup: Action | undefined = s.inFollowup
    ? { label: 'Пропустить уточнение', onClick: ev({ type: 'SKIP_FOLLOWUP' }) }
    : undefined;

  if (s.phase === 'S1') {
    return { primary: { label: 'Начать', onClick: ev({ type: 'START' }) }, links: [{ label: 'Ответить текстом', onClick: ev({ type: 'START_TEXT' }) }] };
  }
  if (!isRecording(s.phase)) return {};

  if (s.inputMode === 'text') {
    return {
      primary: { label: 'Отправить', onClick: ev({ type: 'SUBMIT_TEXT', text: s.draft }) },
      secondary: skipFollowup,
      links: links(toVoice, skip),
    };
  }

  switch (s.phase) {
    case 'S4':
    case 'S7':
    case 'S11':
      return { primary: done, secondary: skipFollowup, links: links(toText, skip) };
    case 'S5':
      return { secondary: skipFollowup, links: links(toText, skip) };
    case 'S6': {
      const retry: Action = { label: 'Повторить', onClick: ev({ type: 'RESUME' }) };
      // После 2 раз подряд «Ответить текстом» — основная (flow.md §3 S6).
      if (s.noSpeechCount >= CONFIG.noSpeechToTextAfter) return { primary: toText, secondary: retry, links: links(skip) };
      return { primary: retry, secondary: skipFollowup, links: links(toText, skip) };
    }
    case 'S8':
      return { primary: done, secondary: { label: 'Перезаписать', onClick: ev({ type: 'RERECORD' }) } };
    default:
      return {};
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffects(state, dispatch);

  const listening = isListening(state);
  const onVolumeUnavailable = useCallback(() => dispatch({ type: 'VOLUME_UNAVAILABLE' }), []);
  const volume = useVolume({ active: listening && state.volumeMode === 'rms', onUnavailable: onVolumeUnavailable });
  useSpeech({
    active: listening,
    onEvent: dispatch,
    heardVoice: volume.heardVoice,
    volumeStartedAt: () => volume.startedAt.current,
  });

  // Горячие клавиши — spec §4.1: Enter = «Готово» (голос), Esc = пауза. Ctrl+Enter — в поле ввода.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')) return;
      if (state.inputMode !== 'voice') return;
      if (e.key === 'Enter' && ['S4', 'S7', 'S8', 'S11'].includes(state.phase)) dispatch({ type: 'DONE' });
      if (e.key === 'Escape' && listening) dispatch({ type: 'PAUSE' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.inputMode, state.phase, listening]);

  const isIntro = state.phase === 'S1';
  const recording = isRecording(state.phase);
  const voiceOk = state.voiceBlock === null && speechSupported();
  const paused = state.inputMode === 'voice' && ['S5', 'S6', 'S8'].includes(state.phase);
  const center = listening
    ? { label: 'Пауза', onClick: () => dispatch({ type: 'PAUSE' }) }
    : paused
      ? { label: 'Продолжить', onClick: () => dispatch({ type: 'RESUME' }) }
      : null;

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
        <ProgressRing
          segments={segmentsOf(state)}
          current={isIntro ? null : state.q}
          mode={ringMode(state)}
          levelRef={volume.level}
          pulse={state.volumeMode === 'pulse'}
          pulseKey={state.draft.length + state.interim.length}
          centerLabel={center?.label}
          onCenter={center?.onClick}
        />
      </section>

      <section className={styles.statusZone}>
        <StatusLine text={statusOf(state)} />
        {recording && state.inputMode === 'voice' && (
          <TranscriptLive finalText={state.draft} interimText={state.interim} />
        )}
        {recording && state.inputMode === 'text' && (
          <TextAnswer
            label="Ответ"
            value={state.draft}
            autoFocus
            onChange={(text) => dispatch({ type: 'DRAFT_EDIT', text })}
            onSubmit={() => dispatch({ type: 'SUBMIT_TEXT', text: state.draft })}
          />
        )}
      </section>

      <section className={styles.actionsZone}>
        <Actions {...actionsOf(state, dispatch, voiceOk)} />
      </section>
    </main>
  );
}

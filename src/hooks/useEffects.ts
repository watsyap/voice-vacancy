import { useEffect, useRef, type Dispatch } from 'react';
import type { Event } from '../state/events';
import { isListening, type State } from '../state/machine';
import { CONFIG } from '../config';
import { analyze, generate } from '../lib/api';
import { buildGenerateReq } from '../lib/generateReq';
import { speechSupported } from './useSpeech';

/** Побочные эффекты по фазе (AGENTS.md §3); результат возвращается событием. */
export function useEffects(state: State, dispatch: Dispatch<Event>): void {
  // S2: запрос микрофона после «Начать» (жест пользователя, spec §10).
  useEffect(() => {
    if (state.phase !== 'S2') return;
    if (!speechSupported()) {
      dispatch({ type: 'SPEECH_UNSUPPORTED' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      // Распознавание само спросит микрофон; громкости не будет (S24).
      dispatch({ type: 'VOLUME_UNAVAILABLE' });
      dispatch({ type: 'MIC_OK' });
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) dispatch({ type: 'MIC_OK' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        // Запрет → S3a; нет, занят или не открылся → S3b (предложено: у flow.md только эти две причины).
        dispatch({ type: name === 'NotAllowedError' || name === 'SecurityError' ? 'MIC_DENIED' : 'MIC_MISSING' });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, dispatch]);

  // S9: анализ ответа; ≤ 4 с, затем S12 (spec §6). Уход из S9 отменяет запрос.
  const transcript = state.answers[state.q].transcript;
  useEffect(() => {
    if (state.phase !== 'S9') return;
    const ctrl = new AbortController();
    void analyze(state.q, transcript, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      dispatch(r.ok ? { type: 'ANALYZE_OK', res: r.res, demo: r.demo } : { type: 'ANALYZE_FAIL', demo: r.demo });
    });
    return () => ctrl.abort();
  }, [state.phase, state.q, transcript, dispatch]);

  // S11: запись стартует через 600 мс после показа уточнения, чтобы успели прочитать (spec §7, AC-11.1).
  const awaitingFollowup = state.phase === 'S11' && !state.followupReady;
  useEffect(() => {
    if (!awaitingFollowup) return;
    const t = setTimeout(() => dispatch({ type: 'FOLLOWUP_READY' }), CONFIG.followupDelayMs);
    return () => clearTimeout(t);
  }, [awaitingFollowup, dispatch]);

  // S16–S17: генерация потоком; 10 с без фрагмента → S17, 30 с → S18 (AC-17.1, AC-17.2).
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  // Оффлайн или очередь не разобрана — ждём (spec §7 S16, C7): старт по online, когда очередь пуста.
  const generating = (state.phase === 'S16' || state.phase === 'S17') && !state.offline && state.queue.length === 0;
  const genRun = state.genRun;
  useEffect(() => {
    if (!generating) return;
    const ctrl = new AbortController();
    let got = false;
    const slow = setTimeout(() => !got && dispatch({ type: 'GEN_SLOW' }), CONFIG.genSlowMs);
    const fail = setTimeout(() => {
      if (got) return;
      ctrl.abort();
      dispatch({ type: 'GEN_FAIL' });
    }, CONFIG.genFailMs);
    void generate(
      buildGenerateReq(latest.current),
      (text) => {
        got = true;
        dispatch({ type: 'GEN_CHUNK', text });
      },
      ctrl.signal,
      () => dispatch({ type: 'DEMO_SEEN' }),
    ).then((outcome) => {
      if (ctrl.signal.aborted) return;
      dispatch({ type: outcome === 'done' ? 'GEN_DONE' : outcome === 'cut' ? 'GEN_CUT' : 'GEN_FAIL' });
    });
    return () => {
      clearTimeout(slow);
      clearTimeout(fail);
      ctrl.abort();
    };
    // Новый запрос — только на новый запуск (genRun), а не на S16 ↔ S17.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genRun, generating ? 1 : 0]);

  // S21: сеть. AC-21.1 — offline приходит сразу; начальное состояние берём из navigator.onLine.
  useEffect(() => {
    if (!navigator.onLine) dispatch({ type: 'OFFLINE' });
    const off = () => dispatch({ type: 'OFFLINE' });
    const on = () => dispatch({ type: 'ONLINE' });
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, [dispatch]);

  // S21: очередь по online — по одному, по порядку вопросов, без уточнений (spec §7 S21).
  const nextQueued = state.offline ? null : (state.queue[0] ?? null);
  const queuedTranscript = nextQueued ? state.answers[nextQueued].transcript : '';
  useEffect(() => {
    if (nextQueued === null) return;
    const ctrl = new AbortController();
    void analyze(nextQueued, queuedTranscript, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.demo) dispatch({ type: 'DEMO_SEEN' });
      dispatch(r.ok ? { type: 'QUEUE_ANALYZED', q: nextQueued, res: r.res } : { type: 'QUEUE_FAILED', q: nextQueued });
    });
    return () => ctrl.abort();
  }, [nextQueued, queuedTranscript, dispatch]);

  // S22: вкладка скрыта во время записи → пауза.
  const listening = isListening(state);
  useEffect(() => {
    if (!listening) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dispatch({ type: 'TAB_HIDDEN' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [listening, dispatch]);
}

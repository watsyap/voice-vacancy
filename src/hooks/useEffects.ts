import { useEffect, type Dispatch } from 'react';
import type { Event } from '../state/events';
import { isListening, type State } from '../state/machine';
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

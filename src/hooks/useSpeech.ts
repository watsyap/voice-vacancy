import { useEffect, useRef } from 'react';
import type { Event } from '../state/events';
import { SpeechSession, type Rec } from './speechSession';

type RecCtor = new () => Rec;

const ctor = (): RecCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Есть ли Web Speech API (иначе S3c). */
export const speechSupported = (): boolean => ctor() !== null;

type Options = {
  active: boolean;
  onEvent: (e: Event) => void;
  heardVoice: () => boolean;
  volumeStartedAt: () => number | null;
};

/** Распознавание ru-RU, пока active (AGENTS.md §5). Логика — в SpeechSession. */
export function useSpeech({ active, onEvent, heardVoice, volumeStartedAt }: Options): void {
  const latest = useRef({ onEvent, heardVoice, volumeStartedAt });
  useEffect(() => {
    latest.current = { onEvent, heardVoice, volumeStartedAt };
  });

  useEffect(() => {
    const Ctor = ctor();
    if (!active || !Ctor) return;
    const session = new SpeechSession({
      create: () => new Ctor(),
      emit: (e) => latest.current.onEvent(e),
      heardVoice: () => latest.current.heardVoice(),
      volumeStartedAt: () => latest.current.volumeStartedAt(),
    });
    session.start();
    return () => session.stop();
  }, [active]);
}

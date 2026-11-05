import { useEffect, useRef, type MutableRefObject } from 'react';

/** RMS речи ≈ 0.02–0.15; делитель переводит его в 0–1 — предложено. */
const RMS_FULL = 0.12;
/** Порог «голос был» для S6 — предложено. */
const VOICE_PEAK = 0.3;

type Options = { active: boolean; onUnavailable: () => void };

export type Volume = {
  /** Текущая громкость 0–1, без сглаживания (сглаживает кольцо). */
  level: MutableRefObject<number>;
  /** Когда начался захват; null — захвата нет. */
  startedAt: MutableRefObject<number | null>;
  /** Был ли голос с начала захвата (S6). */
  heardVoice: () => boolean;
};

/** Громкость микрофона через AnalyserNode (AGENTS.md §5). Ошибка → S24. */
export function useVolume({ active, onUnavailable }: Options): Volume {
  const level = useRef(0);
  const peak = useRef(0);
  const startedAt = useRef<number | null>(null);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    peak.current = 0;
    startedAt.current = Date.now();

    const fail = () => {
      if (!cancelled) onUnavailableRef.current();
    };

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      fail();
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        if (cancelled) return;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const value = Math.min(1, Math.sqrt(sum / buf.length) / RMS_FULL);
          level.current = value;
          if (value > peak.current) peak.current = value;
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(fail);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      level.current = 0;
      startedAt.current = null;
    };
  }, [active]);

  return { level, startedAt, heardVoice: () => peak.current > VOICE_PEAK };
}

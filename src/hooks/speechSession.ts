import { CONFIG } from '../config';
import type { Event } from '../state/events';

// Минимальные типы Web Speech API: в lib.dom их нет.
export type RecResult = { isFinal: boolean; 0: { transcript: string }; length: number };
export type RecResultEvent = { resultIndex: number; results: ArrayLike<RecResult> };
export type RecErrorEvent = { error: string };
export interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecResultEvent) => void) | null;
  onerror: ((e: RecErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechEvent = Extract<
  Event,
  {
    type:
      | 'SPEECH_INTERIM'
      | 'SPEECH_FINAL'
      | 'SILENCE_START'
      | 'SILENCE_END'
      | 'NO_SPEECH'
      | 'MIC_DENIED'
      | 'MIC_MISSING'
      | 'VOLUME_UNAVAILABLE'
      | 'OFFLINE';
  }
>;

export type SessionOptions = {
  create: () => Rec;
  emit: (e: SpeechEvent) => void;
  /** Громкость была, а слов нет — S6 вместо S5 (flow.md §3). */
  heardVoice: () => boolean;
  /** Когда useVolume начал захват; для конфликта на Android (AGENTS.md §5). */
  volumeStartedAt: () => number | null;
  now?: () => number;
};

/** Окно конфликта захвата на Android — предложено (AGENTS.md §5). */
const CAPTURE_CONFLICT_MS = 2000;
/** Защита от бесконечного цикла рестартов без результатов — предложено. */
const MAX_EMPTY_RESTARTS = 5;

/**
 * Одна запись ответа: распознавание с авторестартом (spec §7 S4), таймеры тишины от последнего результата,
 * ошибки → события машины. Накопление текста делает редьюсер.
 */
export class SpeechSession {
  private rec: Rec | null = null;
  private stopped = true;
  private halted = false;
  private heard = false;
  private emptyRestarts = 0;
  private gotResultThisRec = false;
  private volumeReleased = false;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.halted = false;
    this.heard = false;
    this.emptyRestarts = 0;
    this.volumeReleased = false;
    this.spawn();
    this.arm(CONFIG.silenceStartMs, () => this.halt(this.o.heardVoice() ? { type: 'NO_SPEECH' } : { type: 'SILENCE_START' }));
  }

  /** Остановка по команде (пауза, «Готово», смена фазы): без рестарта. */
  stop(): void {
    this.stopped = true;
    this.clear();
    try {
      this.rec?.stop();
    } catch {
      /* уже остановлено */
    }
  }

  private spawn(): void {
    const rec = this.o.create();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = (e) => this.onError(e.error);
    rec.onend = () => this.onEnd();
    this.rec = rec;
    this.gotResultThisRec = false;
    this.startedAt = this.now();
    try {
      rec.start();
    } catch {
      /* InvalidStateError: старт уже идёт */
    }
  }

  private onResult(e: RecResultEvent): void {
    // Поздние фрагменты после stop() тоже отдаём: редьюсер допишет их в паузе (S8) или отбросит.
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r) continue;
      const text = r[0].transcript;
      if (r.isFinal) {
        if (text.trim()) this.o.emit({ type: 'SPEECH_FINAL', text: text.trim() });
      } else {
        interim += text;
      }
    }
    this.o.emit({ type: 'SPEECH_INTERIM', text: interim.trim() });
    this.heard = true;
    this.gotResultThisRec = true;
    this.emptyRestarts = 0;
    if (!this.stopped && !this.halted) this.arm(CONFIG.silenceEndMs, () => this.halt({ type: 'SILENCE_END' }));
  }

  private onError(error: string): void {
    if (this.stopped) return;
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        this.halt({ type: 'MIC_DENIED' });
        return;
      case 'audio-capture':
        if (this.captureConflict()) {
          // Android: микрофон занят захватом громкости. Освобождаем его, распознавание перезапустится в onend.
          this.releaseVolume();
          return;
        }
        this.halt({ type: 'MIC_MISSING' });
        return;
      case 'no-speech':
        if (!this.heard) this.halt({ type: 'NO_SPEECH' });
        return;
      case 'network':
        // Chrome распознаёт на сервере: без сети голоса нет (flow.md §3 S21).
        this.halt({ type: 'OFFLINE' });
        return;
      default:
        // aborted и прочее: решает onend.
        return;
    }
  }

  private onEnd(): void {
    if (this.stopped || this.halted) return;
    if (!this.gotResultThisRec) {
      if (this.captureConflict()) this.releaseVolume();
      if (++this.emptyRestarts > MAX_EMPTY_RESTARTS) {
        this.halt(this.heard ? { type: 'SILENCE_END' } : { type: 'NO_SPEECH' });
        return;
      }
    }
    // Android Chrome сам завершает continuous-распознавание: перезапуск, текст копится в редьюсере (AC-4.5).
    this.spawn();
  }

  private releaseVolume(): void {
    if (this.volumeReleased) return;
    this.volumeReleased = true;
    this.o.emit({ type: 'VOLUME_UNAVAILABLE' });
  }

  private captureConflict(): boolean {
    const v = this.o.volumeStartedAt();
    return v !== null && this.now() - v < CAPTURE_CONFLICT_MS && this.now() - this.startedAt < CAPTURE_CONFLICT_MS;
  }

  private halt(e: SpeechEvent): void {
    if (this.halted || this.stopped) return;
    this.halted = true;
    this.clear();
    try {
      this.rec?.stop();
    } catch {
      /* уже остановлено */
    }
    this.o.emit(e);
  }

  private arm(ms: number, fn: () => void): void {
    this.clear();
    this.timer = setTimeout(fn, ms);
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '../state/events';
import { SpeechSession, type Rec, type RecResult } from './speechSession';

class FakeRec implements Rec {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: Rec['onresult'] = null;
  onerror: Rec['onerror'] = null;
  onend: Rec['onend'] = null;
  started = 0;
  stopped = 0;
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  abort() {}
  say(parts: [string, boolean][], resultIndex = 0) {
    const results = parts.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t }, length: 1 }) as RecResult);
    this.onresult?.({ resultIndex, results });
  }
}

let now = 0;
let recs: FakeRec[];
let events: Event[];
let heard: boolean;
let volumeAt: number | null;

const session = () =>
  new SpeechSession({
    create: () => {
      const r = new FakeRec();
      recs.push(r);
      return r;
    },
    emit: (e) => events.push(e),
    heardVoice: () => heard,
    volumeStartedAt: () => volumeAt,
    now: () => now,
  });

const last = () => recs[recs.length - 1]!;
const types = () => events.map((e) => e.type);

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  recs = [];
  events = [];
  heard = false;
  volumeAt = null;
});
afterEach(() => vi.useRealTimers());

describe('SpeechSession', () => {
  it('настраивает ru-RU, continuous, interimResults', () => {
    session().start();
    expect(last()).toMatchObject({ lang: 'ru-RU', continuous: true, interimResults: true, started: 1 });
  });

  it('промежуточный и финальный текст → события', () => {
    session().start();
    last().say([
      ['ревью кода', true],
      ['и пла', false],
    ]);
    expect(events).toEqual([
      { type: 'SPEECH_FINAL', text: 'ревью кода' },
      { type: 'SPEECH_INTERIM', text: 'и пла' },
    ]);
  });

  it('AC-4.5: onend без команды → новый запуск распознавания', () => {
    session().start();
    last().say([['ревью кода', true]]);
    last().onend?.();
    expect(recs).toHaveLength(2);
    expect(last().started).toBe(1);
    last().say([['и созвоны', true]]);
    expect(events.filter((e) => e.type === 'SPEECH_FINAL')).toHaveLength(2);
  });

  it('stop() → без рестарта, поздний финальный фрагмент всё равно отдаётся', () => {
    const s = session();
    s.start();
    s.stop();
    last().say([['хвост', true]]);
    last().onend?.();
    expect(recs).toHaveLength(1);
    expect(types()).toContain('SPEECH_FINAL');
  });

  it('AC-4.3: 4 с тишины после речи → SILENCE_END, без рестарта', () => {
    session().start();
    vi.advanceTimersByTime(1000);
    last().say([['ревью кода', true]]);
    vi.advanceTimersByTime(3999);
    expect(types()).not.toContain('SILENCE_END');
    vi.advanceTimersByTime(1);
    expect(types()).toContain('SILENCE_END');
    last().onend?.();
    expect(recs).toHaveLength(1);
  });

  it('каждый новый результат сдвигает таймер тишины (AC-4.4: слово «готово» не останавливает)', () => {
    session().start();
    last().say([['проект', true]]);
    vi.advanceTimersByTime(3000);
    last().say([['готов к запуску', false]]);
    vi.advanceTimersByTime(3000);
    expect(types()).not.toContain('SILENCE_END');
  });

  it('S5: 5 с без слов → SILENCE_START', () => {
    session().start();
    vi.advanceTimersByTime(5000);
    expect(types()).toEqual(['SILENCE_START']);
  });

  it('S6: громкость была, слов нет 5 с → NO_SPEECH', () => {
    heard = true;
    session().start();
    vi.advanceTimersByTime(5000);
    expect(types()).toEqual(['NO_SPEECH']);
  });

  it('ошибки: not-allowed → MIC_DENIED, audio-capture → MIC_MISSING, no-speech → NO_SPEECH, network → OFFLINE', () => {
    for (const [error, type] of [
      ['not-allowed', 'MIC_DENIED'],
      ['audio-capture', 'MIC_MISSING'],
      ['no-speech', 'NO_SPEECH'],
      ['network', 'OFFLINE'],
    ] as const) {
      events = [];
      session().start();
      last().onerror?.({ error });
      last().onend?.();
      expect(types()).toEqual([type]);
    }
  });

  it('S24: audio-capture в первые 2 с захвата громкости → VOLUME_UNAVAILABLE и рестарт', () => {
    volumeAt = 0;
    session().start();
    now = 500;
    last().onerror?.({ error: 'audio-capture' });
    last().onend?.();
    expect(types()).toEqual(['VOLUME_UNAVAILABLE']);
    expect(recs).toHaveLength(2);
  });

  it('пустые рестарты подряд ограничены', () => {
    session().start();
    for (let i = 0; i < 10; i++) last().onend?.();
    expect(types()).toEqual(['NO_SPEECH']);
    expect(recs.length).toBeLessThanOrEqual(6);
  });
});

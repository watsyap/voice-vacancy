import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { initialState, reducer, type State } from './machine';
import { hasProgress, parseSession, toSession } from './session';

const withAnswer = (): State =>
  [
    { type: 'START_TEXT' } as const,
    { type: 'SUBMIT_TEXT', text: 'ревью кода и планирование спринта' } as const,
    { type: 'ANALYZE_FAIL' } as const,
  ].reduce(reducer, initialState());

describe('сессия — flow.md §5', () => {
  it('сохраняется без фазы, промежуточного текста и demo', () => {
    const s = { ...withAnswer(), interim: 'хвост', demo: true };
    const ss = toSession(s, 1000);
    expect(ss).not.toHaveProperty('phase');
    expect(ss).not.toHaveProperty('interim');
    expect(ss).not.toHaveProperty('demo');
    expect(ss.answers[1]).toMatchObject({ transcript: 'ревью кода и планирование спринта', status: 'raw' });
    expect(ss.savedAt).toBe(1000);
  });

  it('туда-обратно через JSON', () => {
    const ss = toSession(withAnswer(), 1000);
    expect(parseSession(JSON.stringify(ss), 2000)).toEqual(ss);
  });

  it('старше 7 дней → null; битая → null', () => {
    const ss = toSession(withAnswer(), 0);
    expect(parseSession(JSON.stringify(ss), CONFIG.sessionMaxAgeMs + 1)).toBeNull();
    expect(parseSession('{oops', 0)).toBeNull();
    expect(parseSession(JSON.stringify({ ...ss, q: 9 }), 0)).toBeNull();
    expect(parseSession(null)).toBeNull();
  });

  it('hasProgress: пусто — нет, есть ответ — да', () => {
    expect(hasProgress(initialState())).toBe(false);
    expect(hasProgress(withAnswer())).toBe(true);
  });
});

describe('RESTORE / S23 — spec §7', () => {
  it('без вакансии → S23 с ответами (AC-18.2)', () => {
    const s = reducer(initialState(), { type: 'RESTORE', session: toSession(withAnswer()) });
    expect(s.phase).toBe('S23');
    expect(s.answers[1].transcript).toBe('ревью кода и планирование спринта');
  });

  it('с текстом вакансии → сразу S19 с правками (AC-19.3)', () => {
    const ss = { ...toSession(withAnswer()), vacancy: '## Роль (предположение): правка' };
    const s = reducer(initialState(), { type: 'RESTORE', session: ss });
    expect(s).toMatchObject({ phase: 'S19', vacancy: { text: '## Роль (предположение): правка', complete: true } });
  });

  it('C6: «Продолжить» на тот же вопрос; голос — через запрос микрофона', () => {
    const atQ2 = reducer(withAnswer(), { type: 'NEXT' });
    const restored = reducer(initialState(), { type: 'RESTORE', session: { ...toSession(atQ2), inputMode: 'voice' } });
    const s = reducer(restored, { type: 'CONTINUE' });
    expect(s).toMatchObject({ phase: 'S2', q: 2 });
    expect(reducer(s, { type: 'MIC_OK' })).toMatchObject({ phase: 'S4', q: 2 });
  });

  it('«Продолжить» в текстовом режиме → S4 текстом', () => {
    const restored = reducer(initialState(), { type: 'RESTORE', session: toSession(reducer(withAnswer(), { type: 'NEXT' })) });
    expect(reducer(restored, { type: 'CONTINUE' })).toMatchObject({ phase: 'S4', q: 2, inputMode: 'text' });
  });

  it('«Продолжить» на уже данном ответе → его итоговое состояние', () => {
    const restored = reducer(initialState(), { type: 'RESTORE', session: toSession(withAnswer()) });
    expect(reducer(restored, { type: 'CONTINUE' }).phase).toBe('S12');
  });

  it('«Начать заново» → S1', () => {
    const restored = reducer(initialState(), { type: 'RESTORE', session: toSession(withAnswer()) });
    expect(reducer(restored, { type: 'RESET' }).phase).toBe('S1');
  });
});

describe('S21 — оффлайн и очередь', () => {
  const voiceS4 = (): State => [{ type: 'START' } as const, { type: 'MIC_OK' } as const].reduce(reducer, initialState());

  it('AC-21.1: сеть пропала в записи → текстовый режим, распознанное в поле', () => {
    const s = [
      { type: 'SPEECH_FINAL', text: 'ревью кода' } as const,
      { type: 'SPEECH_INTERIM', text: 'и созвоны' } as const,
      { type: 'OFFLINE' } as const,
    ].reduce(reducer, voiceS4());
    expect(s).toMatchObject({ offline: true, inputMode: 'text', draft: 'ревью кода и созвоны', phase: 'S4' });
  });

  it('AC-21.2: ответ оффлайн → без анализа, в очередь, можно идти дальше', () => {
    const s = [
      { type: 'OFFLINE' } as const,
      { type: 'SUBMIT_TEXT', text: 'ревью кода и планирование спринта' } as const,
    ].reduce(reducer, reducer(initialState(), { type: 'START_TEXT' }));
    expect(s).toMatchObject({ phase: 'S12', queue: [1] });
    expect(s.answers[1].status).toBe('raw');
    expect(reducer(s, { type: 'NEXT' })).toMatchObject({ phase: 'S4', q: 2 });
  });

  it('оффлайн: короткий ответ всё равно S7', () => {
    const s = [{ type: 'OFFLINE' } as const, { type: 'SUBMIT_TEXT', text: 'ревью' } as const].reduce(
      reducer,
      reducer(initialState(), { type: 'START_TEXT' }),
    );
    expect(s.phase).toBe('S7');
  });

  it('сеть пропала во время анализа → ответ в очередь', () => {
    const s = [{ type: 'OFFLINE' } as const, { type: 'ANALYZE_FAIL' } as const].reduce(reducer, {
      ...withAnswer(),
      phase: 'S9',
    } as State);
    expect(s.queue).toEqual([1]);
  });

  it('AC-21.3: очередь разбирается без уточнения; неполный → S10′; экран обновляется сам', () => {
    let s = [
      { type: 'OFFLINE' } as const,
      { type: 'SUBMIT_TEXT', text: 'ревью кода и планирование спринта' } as const,
      { type: 'NEXT' } as const,
      { type: 'SUBMIT_TEXT', text: 'запуск приложения для курьеров быстро' } as const,
      { type: 'ONLINE' } as const,
    ].reduce(reducer, reducer(initialState(), { type: 'START_TEXT' }));
    expect(s.queue).toEqual([1, 2]);
    s = reducer(s, { type: 'QUEUE_ANALYZED', q: 1, res: { slots: { tasks: ['a'] }, missing: ['x'], followup: 'Ещё?', off_topic: false } });
    expect(s.answers[1]).toMatchObject({ status: 'partial', followup: null });
    s = reducer(s, {
      type: 'QUEUE_ANALYZED',
      q: 2,
      res: { slots: { project: { description: 'приложение', goal: 'быстрее' } }, missing: [], followup: null, off_topic: false },
    });
    expect(s.queue).toEqual([]);
    expect(s.phase).toBe('S10');
  });

  it('ошибка анализа из очереди — ответ остаётся raw', () => {
    const s = [
      { type: 'OFFLINE' } as const,
      { type: 'SUBMIT_TEXT', text: 'ревью кода и планирование спринта' } as const,
      { type: 'ONLINE' } as const,
      { type: 'QUEUE_FAILED', q: 1 } as const,
    ].reduce(reducer, reducer(initialState(), { type: 'START_TEXT' }));
    expect(s).toMatchObject({ queue: [], phase: 'S12' });
    expect(s.answers[1].status).toBe('raw');
  });
});

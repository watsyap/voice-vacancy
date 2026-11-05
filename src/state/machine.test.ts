import { describe, expect, it } from 'vitest';
import type { AnalyzeRes, Q } from '../../shared/types';
import type { Event } from './events';
import { ALLOWED, initialState, reducer, type Phase, type State } from './machine';

const run = (s: State, ...events: Event[]): State => events.reduce(reducer, s);

const ok = (slots: AnalyzeRes['slots'], followup: string | null = null, off_topic = false): Event => ({
  type: 'ANALYZE_OK',
  res: { slots, missing: followup ? ['ещё задача'] : [], followup, off_topic },
});

/** Q1 в S9 с отправленным ответом. */
const inS9 = (text = 'ревью кода и планирование спринта каждый день'): State =>
  run(initialState(), { type: 'START_TEXT' }, { type: 'SUBMIT_TEXT', text });

const ONE_TASK = ok({ tasks: ['ревью кода'] }, 'А какие ещё задачи будут каждый день?');
const TWO_TASKS = ok({ tasks: ['ревью кода', 'планирование спринта'] });

describe('S9 — анализ', () => {
  it('ответ не короче порога → S9 с транскриптом', () => {
    const s = inS9();
    expect(s.phase).toBe('S9');
    expect(s.answers[1].transcript).toBe('ревью кода и планирование спринта каждый день');
  });

  it('AC-7.2: короче порога → S7, текст сохранён', () => {
    const s = run(initialState(), { type: 'START_TEXT' }, { type: 'SUBMIT_TEXT', text: 'ревью кода планирование спринта' });
    expect(s.phase).toBe('S7');
    expect(s.draft).toBe('ревью кода планирование спринта');
  });

  it('голос: «Готово» берёт финальный и промежуточный текст', () => {
    const s = run(
      initialState(),
      { type: 'START' },
      { type: 'MIC_OK' },
      { type: 'SPEECH_FINAL', text: 'ревью кода и' },
      { type: 'SPEECH_INTERIM', text: 'планирование спринта каждый день' },
      { type: 'DONE' },
    );
    expect(s.phase).toBe('S9');
    expect(s.answers[1].transcript).toBe('ревью кода и планирование спринта каждый день');
  });
});

describe('S9 → S10 / S11 / S10′ / S12', () => {
  it('полно → S10, статус analyzed', () => {
    const s = run(inS9(), TWO_TASKS);
    expect(s.phase).toBe('S10');
    expect(s.answers[1].status).toBe('analyzed');
    expect(s.answers[1].completeness).toBe(1);
  });

  it('AC-11.1: 1 задача, уточнения не было → S11, сегмент 50%', () => {
    const s = run(inS9(), ONE_TASK);
    expect(s.phase).toBe('S11');
    expect(s.answers[1].completeness).toBe(0.5);
    expect(s.answers[1].followup).toBe('А какие ещё задачи будут каждый день?');
    expect(s.answers[1].followupUsed).toBe(true);
  });

  it('неполно, но followup = null → S10′', () => {
    const s = run(inS9(), ok({ tasks: ['ревью кода'] }, null));
    expect(s.phase).toBe('S10p');
    expect(s.answers[1].status).toBe('partial');
  });

  it('off_topic → полнота 0, уточнение', () => {
    const s = run(inS9(), ok({ tasks: ['a', 'b'] }, 'Расскажите про задачи сотрудника', true));
    expect(s.phase).toBe('S11');
    expect(s.answers[1].completeness).toBe(0);
  });

  it('AC-12.1: ошибка анализа → S12, статус raw, транскрипт сохранён', () => {
    const s = run(inS9(), { type: 'ANALYZE_FAIL' });
    expect(s.phase).toBe('S12');
    expect(s.answers[1].status).toBe('raw');
    expect(s.answers[1].transcript).toBe('ревью кода и планирование спринта каждый день');
  });
});

describe('S11 — уточнение', () => {
  it('AC-11.2: ответ на уточнение дописывается к исходному → S9', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SUBMIT_TEXT', text: 'ещё созвоны с заказчиком' });
    expect(s.phase).toBe('S9');
    expect(s.answers[1].transcript).toBe('ревью кода и планирование спринта каждый день ещё созвоны с заказчиком');
  });

  it('уточнение голосом: S11 остаётся S11, «Готово» дописывает', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SPEECH_FINAL', text: 'созвоны' }, { type: 'DONE' });
    expect(s.phase).toBe('S9');
    expect(s.answers[1].transcript.endsWith(' созвоны')).toBe(true);
  });

  it('пустой ответ на уточнение не отправляется (предложено)', () => {
    const s = run(inS9(), ONE_TASK, { type: 'DONE' });
    expect(s.phase).toBe('S11');
  });

  it('AC-11.3: после уточнения всё ещё неполно → S10′, второго уточнения нет', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SUBMIT_TEXT', text: 'ну и всё' }, ONE_TASK);
    expect(s.phase).toBe('S10p');
  });

  it('после уточнения полно → S10', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SUBMIT_TEXT', text: 'созвоны с заказчиком' }, TWO_TASKS);
    expect(s.phase).toBe('S10');
  });

  it('AC-11.4: «Пропустить уточнение» → S10′ с текущей полнотой', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SKIP_FOLLOWUP' });
    expect(s.phase).toBe('S10p');
    expect(s.answers[1].completeness).toBe(0.5);
  });

  it('в S11 нет «Пропустить» вопрос (spec §4.1)', () => {
    const s = run(inS9(), ONE_TASK);
    expect(reducer(s, { type: 'SKIP' })).toBe(s);
  });
});

describe('RERECORD, NEXT, SKIP', () => {
  it('RERECORD сбрасывает транскрипт, слоты и флаг уточнения', () => {
    const s = run(inS9(), ONE_TASK, { type: 'SKIP_FOLLOWUP' }, { type: 'RERECORD' });
    expect(s.phase).toBe('S4');
    expect(s.answers[1]).toMatchObject({ transcript: '', slots: null, status: 'empty', followupUsed: false });
    // Новая попытка снова получает уточнение.
    const again = run(s, { type: 'SUBMIT_TEXT', text: 'ревью кода и ещё много всего' }, ONE_TASK);
    expect(again.phase).toBe('S11');
  });

  it('RERECORD из S12', () => {
    const s = run(inS9(), { type: 'ANALYZE_FAIL' }, { type: 'RERECORD' });
    expect(s.phase).toBe('S4');
    expect(s.answers[1].status).toBe('empty');
  });

  it('NEXT из S10 / S10′ / S12 → следующий вопрос в S4', () => {
    for (const ev of [TWO_TASKS, ok({ tasks: ['a'] }), { type: 'ANALYZE_FAIL' } as Event]) {
      const s = run(inS9(), ev, { type: 'NEXT' });
      expect(s.phase).toBe('S4');
      expect(s.q).toBe(2);
      expect(s.draft).toBe('');
    }
  });

  it('нет автоперехода: S10 стоит, пока нет NEXT (AC-10.3)', () => {
    const s = run(inS9(), TWO_TASKS);
    expect(s.phase).toBe('S10');
    expect(s.q).toBe(1);
  });

  it('SKIP → следующий вопрос; 4 пропуска → S20', () => {
    let s = run(initialState(), { type: 'START_TEXT' }, { type: 'SKIP' });
    expect(s.q).toBe(2);
    expect(s.answers[1].status).toBe('skipped');
    s = run(s, { type: 'SKIP' }, { type: 'SKIP' }, { type: 'SKIP' });
    expect(s.phase).toBe('S20');
  });

  it('SKIP на Q4 при данных ответах → S14 (ждём «Собрать вакансию»)', () => {
    const s = run(inS9(), TWO_TASKS, { type: 'NEXT' }, { type: 'SKIP' }, { type: 'SKIP' }, { type: 'SKIP' });
    expect(s.phase).toBe('S14');
    expect(s.q).toBe(4);
  });

  it('перезапись единственного ответа и пропуск → S20', () => {
    let s = run(initialState(), { type: 'START_TEXT' }, { type: 'SKIP' }, { type: 'SKIP' }, { type: 'SKIP' });
    s = run(s, { type: 'SUBMIT_TEXT', text: 'Figma, SQL' }, { type: 'ANALYZE_FAIL' }, { type: 'RERECORD' }, { type: 'SKIP' });
    expect(s.phase).toBe('S20');
  });
});

describe('S15 — возврат к ответу', () => {
  const twoAnswered = (): State =>
    run(inS9(), TWO_TASKS, { type: 'NEXT' }, { type: 'SUBMIT_TEXT', text: 'запуск приложения для курьеров чтобы быстрее' }, {
      type: 'ANALYZE_FAIL',
    });

  it('тап по сегменту данного ответа из S12 → S15', () => {
    const s = run(twoAnswered(), { type: 'OPEN_SEGMENT', q: 1 });
    expect(s.phase).toBe('S15');
    expect(s.q).toBe(1);
  });

  it('тап по пустому сегменту или по текущему — ничего', () => {
    const s = twoAnswered();
    expect(reducer(s, { type: 'OPEN_SEGMENT', q: 3 })).toBe(s);
    expect(reducer(s, { type: 'OPEN_SEGMENT', q: 2 })).toBe(s);
  });

  it('из S15 «Следующий вопрос» → первый неотвеченный', () => {
    const s = run(twoAnswered(), { type: 'OPEN_SEGMENT', q: 1 }, { type: 'NEXT' });
    expect(s.phase).toBe('S4');
    expect(s.q).toBe(3);
  });

  it('тап по сегменту во время записи не работает', () => {
    const s = run(twoAnswered(), { type: 'NEXT' });
    expect(s.phase).toBe('S4');
    expect(reducer(s, { type: 'OPEN_SEGMENT', q: 1 })).toBe(s);
  });
});

describe('недопустимые события', () => {
  const all: Event[] = [
    { type: 'START' },
    { type: 'START_TEXT' },
    { type: 'MIC_OK' },
    { type: 'SPEECH_INTERIM', text: 'x' },
    { type: 'SPEECH_FINAL', text: 'x' },
    { type: 'DONE' },
    { type: 'SUBMIT_TEXT', text: 'x x x x x' },
    ok({ tasks: ['a', 'b'] }),
    { type: 'ANALYZE_FAIL' },
    { type: 'SKIP_FOLLOWUP' },
    { type: 'SKIP' },
    { type: 'RERECORD' },
    { type: 'NEXT' },
    { type: 'OPEN_SEGMENT', q: 2 as Q },
  ];

  it('по таблице ALLOWED: событие вне фазы возвращает тот же state', () => {
    for (const phase of Object.keys(ALLOWED) as Phase[]) {
      const s: State = { ...initialState(), phase };
      for (const e of all) {
        if (!ALLOWED[phase].includes(e.type)) expect(reducer(s, e)).toBe(s);
      }
    }
  });

  it('в S9 нет действий пользователя (AC-9.1)', () => {
    const s = inS9();
    for (const type of ['DONE', 'NEXT', 'SKIP', 'RERECORD'] as const) {
      expect(reducer(s, { type } as Event)).toBe(s);
    }
  });
});

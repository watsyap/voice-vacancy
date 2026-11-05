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

/** Q1 в S4, голосовой режим. */
const voiceS4 = (): State => run(initialState(), { type: 'START' }, { type: 'MIC_OK' });

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
    const s9 = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода каждый день с утра' }, { type: 'DONE' });
    const s11 = run(s9, ONE_TASK, { type: 'SPEECH_FINAL', text: 'созвоны' });
    expect(s11.phase).toBe('S11');
    const s = run(s11, { type: 'DONE' });
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
    { type: 'MIC_DENIED' },
    { type: 'MIC_MISSING' },
    { type: 'SPEECH_UNSUPPORTED' },
    { type: 'SILENCE_START' },
    { type: 'SILENCE_END' },
    { type: 'NO_SPEECH' },
    { type: 'PAUSE' },
    { type: 'RESUME' },
    { type: 'TAB_HIDDEN' },
    { type: 'SET_INPUT_MODE', mode: 'text' },
    { type: 'DRAFT_EDIT', text: 'x' },
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

describe('A5.2 — голос и текстовый режим', () => {
  it('S2: разрешил → S4 голосом', () => {
    const s = voiceS4();
    expect(s.phase).toBe('S4');
    expect(s.inputMode).toBe('voice');
  });

  it('S2 → S3a / S3b / S3c: текстовый режим с причиной', () => {
    const cases = [
      ['MIC_DENIED', 'S3a'],
      ['MIC_MISSING', 'S3b'],
      ['SPEECH_UNSUPPORTED', 'S3c'],
    ] as const;
    for (const [type, block] of cases) {
      const s = run(initialState(), { type: 'START' }, { type });
      expect(s.phase).toBe('S4');
      expect(s.inputMode).toBe('text');
      expect(s.voiceBlock).toBe(block);
    }
  });

  it('S3a: голос обратно не включается', () => {
    const s = run(initialState(), { type: 'START' }, { type: 'MIC_DENIED' });
    expect(reducer(s, { type: 'SET_INPUT_MODE', mode: 'voice' })).toBe(s);
  });

  it('микрофон отозван во время записи → текст, сказанное в поле', () => {
    const s = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью' }, { type: 'SPEECH_INTERIM', text: 'кода' }, {
      type: 'MIC_DENIED',
    });
    expect(s.inputMode).toBe('text');
    expect(s.draft).toBe('ревью кода');
  });

  it('AC-4.5: финальный текст копится между сессиями распознавания', () => {
    const s = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода' }, { type: 'SPEECH_FINAL', text: 'и созвоны' });
    expect(s.draft).toBe('ревью кода и созвоны');
  });

  it('S5: 5 с без слов → пауза; RESUME → S4', () => {
    const s = run(voiceS4(), { type: 'SILENCE_START' });
    expect(s.phase).toBe('S5');
    expect(run(s, { type: 'RESUME' }).phase).toBe('S4');
  });

  it('S6: «не разобрал» считается подряд, речь сбрасывает счётчик', () => {
    let s = run(voiceS4(), { type: 'NO_SPEECH' });
    expect(s.phase).toBe('S6');
    s = run(s, { type: 'RESUME' }, { type: 'NO_SPEECH' });
    expect(s.noSpeechCount).toBe(2);
    s = run(s, { type: 'RESUME' }, { type: 'SPEECH_FINAL', text: 'ревью' });
    expect(s.noSpeechCount).toBe(0);
  });

  it('AC-4.3: 4 с тишины после речи → проверка min', () => {
    const short = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода' }, { type: 'SILENCE_END' });
    expect(short.phase).toBe('S7');
    const long = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода и планирование спринта' }, {
      type: 'SILENCE_END',
    });
    expect(long.phase).toBe('S9');
  });

  it('SILENCE_END без текста ничего не делает', () => {
    const s = voiceS4();
    expect(reducer(s, { type: 'SILENCE_END' })).toBe(s);
  });

  it('S7: запись продолжается и дописывает', () => {
    const s = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода' }, { type: 'DONE' }, {
      type: 'SPEECH_FINAL',
      text: 'и планирование спринта',
    });
    expect(s.phase).toBe('S4');
    expect(s.draft).toBe('ревью кода и планирование спринта');
  });

  it('S8: пауза сохраняет текст, «Перезаписать» сбрасывает, «Готово» → S9', () => {
    const paused = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода и планирование спринта' }, { type: 'PAUSE' });
    expect(paused.phase).toBe('S8');
    expect(paused.draft).toBe('ревью кода и планирование спринта');
    expect(run(paused, { type: 'RERECORD' })).toMatchObject({ phase: 'S4', draft: '' });
    expect(run(paused, { type: 'DONE' }).phase).toBe('S9');
  });

  it('S8: поздний финальный фрагмент после паузы не теряется', () => {
    const s = run(voiceS4(), { type: 'SPEECH_INTERIM', text: 'ревью' }, { type: 'PAUSE' }, {
      type: 'SPEECH_FINAL',
      text: 'ревью кода',
    });
    expect(s.phase).toBe('S8');
    expect(s.draft).toBe('ревью кода');
  });

  it('RESUME фиксирует хвост промежуточного текста', () => {
    const s = run(voiceS4(), { type: 'SPEECH_INTERIM', text: 'ревью' }, { type: 'PAUSE' }, { type: 'RESUME' });
    expect(s).toMatchObject({ phase: 'S4', draft: 'ревью', interim: '' });
  });

  it('S22: скрытие вкладки → S8 с отметкой', () => {
    const s = run(voiceS4(), { type: 'TAB_HIDDEN' });
    expect(s).toMatchObject({ phase: 'S8', tabPaused: true });
    expect(run(s, { type: 'RESUME' }).tabPaused).toBe(false);
  });

  it('голос → текст → голос сохраняет сказанное', () => {
    let s = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода' }, { type: 'SET_INPUT_MODE', mode: 'text' });
    expect(s).toMatchObject({ inputMode: 'text', draft: 'ревью кода', phase: 'S4' });
    s = run(s, { type: 'DRAFT_EDIT', text: 'ревью кода и созвоны' }, { type: 'SET_INPUT_MODE', mode: 'voice' });
    expect(s).toMatchObject({ inputMode: 'voice', draft: 'ревью кода и созвоны', phase: 'S4' });
  });

  it('пауза в уточнении возвращает в S11; «Пропустить уточнение» доступно, «Пропустить» — нет', () => {
    const s11 = run(voiceS4(), { type: 'SPEECH_FINAL', text: 'ревью кода каждый день с утра' }, { type: 'DONE' }, ONE_TASK);
    const paused = run(s11, { type: 'PAUSE' });
    expect(paused.phase).toBe('S8');
    expect(run(paused, { type: 'RESUME' }).phase).toBe('S11');
    expect(reducer(run(s11, { type: 'SILENCE_START' }), { type: 'SKIP' }).phase).toBe('S5');
    expect(run(paused, { type: 'SKIP_FOLLOWUP' }).phase).toBe('S10p');
  });

  it('«Пропустить уточнение» вне уточнения ничего не делает', () => {
    const s = run(voiceS4(), { type: 'PAUSE' });
    expect(reducer(s, { type: 'SKIP_FOLLOWUP' })).toBe(s);
  });

  it('S24: VOLUME_UNAVAILABLE в любой фазе → pulse', () => {
    expect(reducer(initialState(), { type: 'VOLUME_UNAVAILABLE' }).volumeMode).toBe('pulse');
    expect(reducer(voiceS4(), { type: 'VOLUME_UNAVAILABLE' }).phase).toBe('S4');
  });

  it('события распознавания в текстовом режиме игнорируются', () => {
    const s = run(initialState(), { type: 'START_TEXT' });
    expect(reducer(s, { type: 'SPEECH_FINAL', text: 'x' })).toBe(s);
    expect(reducer(s, { type: 'PAUSE' })).toBe(s);
  });
});

describe('A5.3 — демо-флаг', () => {
  it('X-Demo в ответе анализа ставит demo и не сбрасывается', () => {
    let s = run(inS9(), { ...TWO_TASKS, demo: true } as Event);
    expect(s.demo).toBe(true);
    s = run(s, { type: 'NEXT' }, { type: 'SUBMIT_TEXT', text: 'запуск приложения для курьеров быстро' }, { type: 'ANALYZE_FAIL' });
    expect(s.demo).toBe(true);
  });

  it('ошибка с X-Demo тоже ставит demo', () => {
    expect(run(inS9(), { type: 'ANALYZE_FAIL', demo: true }).demo).toBe(true);
  });
});

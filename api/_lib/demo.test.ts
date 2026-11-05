import { describe, expect, it } from 'vitest';
import { validateAnalyzeRes } from '../../shared/schema.js';
import type { Q } from '../../shared/types.js';
import { completeness } from '../../src/state/completeness.js';
import { analyzeDemo, generateDemo, roleByTools } from './demo.js';

describe('демо-эвристики — spec §6', () => {
  it('Q1: деление по запятым, «и», точкам; паразиты и вводные убраны', () => {
    const r = analyzeDemo(1, 'ну он будет делать ревью кода, планирование спринта и созвоны с заказчиком. Отчёты');
    expect(r.slots).toEqual({ tasks: ['делать ревью кода', 'планирование спринта', 'созвоны с заказчиком', 'Отчёты'] });
    expect(r.missing).toEqual([]);
    expect(r.followup).toBeNull();
  });

  it('Q1: одна задача → missing и уточнение по шаблону', () => {
    const r = analyzeDemo(1, 'в основном ревью кода каждый день');
    expect((r.slots as { tasks: string[] }).tasks).toHaveLength(1);
    expect(r.missing).toEqual(['ещё одна-две ежедневные задачи']);
    expect(r.followup).toBe('Какие ещё задачи он будет делать каждый день?');
  });

  it('Q2: description = первое предложение, goal по «чтобы»', () => {
    const r = analyzeDemo(2, 'Запуск приложения для курьеров, чтобы сократить время доставки. Команда пять человек');
    expect(r.slots).toEqual({
      project: { description: 'Запуск приложения для курьеров', goal: 'сократить время доставки', role: null },
    });
    expect(r.missing).toEqual([]);
  });

  it('Q2: goal по «цель» и «для»; без них — missing', () => {
    expect((analyzeDemo(2, 'Внутренняя CRM, цель — меньше ручной работы').slots as { project: { goal: string } }).project.goal).toBe(
      'меньше ручной работы',
    );
    expect((analyzeDemo(2, 'Новый лендинг для партнёров').slots as { project: { goal: string } }).project.goal).toBe(
      'для партнёров',
    );
    const r = analyzeDemo(2, 'Будет делать новую внутреннюю CRM систему');
    expect(r.missing).toEqual(['цель проекта']);
    expect(r.followup).toBe('Зачем этот проект — какой результат нужен?');
  });

  it('Q3: ключевые слова → same / undecided / other', () => {
    expect(analyzeDemo(3, 'Продолжит этот проект дальше').slots).toEqual({ continuity: 'same', next_project: null });
    expect(analyzeDemo(3, 'Останется на том же самом, тот же проект').slots).toMatchObject({ continuity: 'same' });
    expect(analyzeDemo(3, 'Пока не решили').slots).toMatchObject({ continuity: 'undecided' });
    expect(analyzeDemo(3, 'Зависит от результатов').slots).toMatchObject({ continuity: 'undecided' });
    const other = analyzeDemo(3, 'Перейдёт на внутреннюю CRM, связанную с продажами');
    expect(other.slots).toEqual({
      continuity: 'other',
      next_project: { description: 'внутреннюю CRM', domain: 'продажами' },
    });
    expect(other.missing).toEqual([]);
  });

  it('Q3: other без деталей → missing; ни одного ключевого слова → continuity null', () => {
    const r = analyzeDemo(3, 'Скорее всего возьмётся за другой');
    expect(r.slots).toMatchObject({ continuity: 'other' });
    expect(r.missing[0]).toBe('какой следующий проект');
    expect(analyzeDemo(3, 'Сложно сказать что-то конкретное').slots).toEqual({ continuity: null, next_project: null });
  });

  it('AC-10.4: «пока не решили» → полнота 100%', () => {
    expect(completeness(3, analyzeDemo(3, 'пока не решили'))).toBe(1);
  });

  it('Q4: словарь инструментов, остальное — знания', () => {
    expect(analyzeDemo(4, 'Figma, SQL, опыт в B2B-аналитике').slots).toEqual({
      tools: ['Figma', 'SQL'],
      knowledge: ['опыт в B2B-аналитике'],
    });
    expect(analyzeDemo(4, 'знание фигмы и эксель').slots).toEqual({ tools: ['Figma', 'Excel'], knowledge: [] });
    expect(analyzeDemo(4, 'жира').missing).toEqual(['ещё инструменты или знания']);
  });

  it('AC-7.1 вместе с демо: «Figma, SQL» на Q4 — полный ответ', () => {
    expect(completeness(4, analyzeDemo(4, 'Figma, SQL'))).toBe(1);
  });

  it('JavaScript не считается Java', () => {
    expect((analyzeDemo(4, 'JavaScript и React').slots as { tools: string[] }).tools).toEqual(['JavaScript', 'React']);
  });

  it('роль по словарю Q4', () => {
    expect(roleByTools(['Figma'])).toBe('Дизайнер');
    expect(roleByTools(['SQL', 'Excel', 'Jira'])).toBe('Аналитик');
    expect(roleByTools(['React', 'Figma', 'JavaScript'])).toBe('Разработчик');
    expect(roleByTools(['Jira', 'Confluence'])).toBe('Менеджер проекта');
    expect(roleByTools([])).toBe('Специалист');
  });

  it('разный ввод → разные слоты; один и тот же — одинаковые', () => {
    expect(analyzeDemo(1, 'ревью кода, созвоны')).not.toEqual(analyzeDemo(1, 'отчёты, планирование'));
    expect(analyzeDemo(2, 'CRM, чтобы быстрее')).toEqual(analyzeDemo(2, 'CRM, чтобы быстрее'));
  });

  it('ответ демо всегда проходит валидатор схемы', () => {
    const inputs: [Q, string][] = [
      [1, 'x'.repeat(300)],
      [2, ''],
      [3, 'перейдёт'],
      [4, 'y'.repeat(200) + ', Figma'],
    ];
    for (const [q, t] of inputs) expect(validateAnalyzeRes(q, analyzeDemo(q, t))).not.toBeNull();
  });
});

describe('демо-генерация — spec §6, b2-generate.md', () => {
  const full = {
    answers: [
      { q: 1 as const, status: 'analyzed' as const, slots: { tasks: ['ревью кода', 'планирование спринта'] } },
      { q: 2 as const, status: 'analyzed' as const, slots: { project: { description: 'приложение для курьеров', goal: 'сократить время доставки' } } },
      { q: 3 as const, status: 'analyzed' as const, slots: { continuity: 'undecided' as const, next_project: null } },
      { q: 4 as const, status: 'analyzed' as const, slots: { tools: ['React', 'Figma', 'JavaScript'], knowledge: ['B2B-аналитика'] } },
    ],
  };

  it('структура b2 и роль с пометкой «(предположение)»', () => {
    const t = generateDemo(full);
    expect(t.startsWith('## Роль (предположение): Разработчик')).toBe(true);
    for (const h of ['### Чем предстоит заниматься', '### Проект на первые полгода', '### Что дальше', '### Что нужно знать и уметь']) {
      expect(t).toContain(h);
    }
    expect(t).toContain('Решим по итогам первого полугодия');
    expect(t).toContain('- Ревью кода');
  });

  it('AC-16.2: пропущенный Q2 → нет раздела «Проект»', () => {
    const t = generateDemo({ answers: [full.answers[0]!, { q: 2, status: 'skipped' }, full.answers[2]!, full.answers[3]!] });
    expect(t).not.toContain('Проект на первые полгода');
  });

  it('raw-ответ разбирается эвристиками и попадает в раздел (AC-12.2)', () => {
    const t = generateDemo({ answers: [{ q: 1, status: 'raw', transcript: 'ревью кода, созвоны с заказчиком' }] });
    expect(t).toContain('- Созвоны с заказчиком');
    expect(t).toContain('Роль (предположение): Специалист');
  });

  it('AC-19.1: ≤ 1500 знаков, нет запрещённых слов', () => {
    const long = { answers: [{ q: 1 as const, status: 'analyzed' as const, slots: { tasks: Array.from({ length: 40 }, (_, i) => `задача номер ${i} с длинным описанием`) } }] };
    expect(generateDemo(long).length).toBeLessThanOrEqual(1500);
    expect(generateDemo(full)).not.toMatch(/зарплат|бонус|дружный коллектив/i);
  });

  it('Q3 same / other', () => {
    expect(generateDemo({ answers: [{ q: 3, status: 'analyzed', slots: { continuity: 'same', next_project: null } }] })).toContain(
      'Продолжит развивать проект',
    );
    expect(
      generateDemo({ answers: [{ q: 3, status: 'analyzed', slots: { continuity: 'other', next_project: { description: 'CRM', domain: 'продажи' } } }] }),
    ).toContain('Перейдёт на другой проект: CRM. Связан с: продажи');
  });
});

import { describe, expect, it } from 'vitest';
import { rawSavedText, understoodText } from './understood';

describe('«Понял: …» — spec §4.1, AC-10.2', () => {
  it('Q1 — как в примере flow.md §2', () => {
    expect(understoodText(1, { tasks: ['ревью кода', 'планирование спринта'] })).toBe(
      'Понял: задачи — ревью кода, планирование спринта',
    );
  });

  it('Q2, Q3, Q4', () => {
    expect(understoodText(2, { project: { description: 'CRM', goal: 'меньше ручной работы' } })).toBe(
      'Понял: проект — CRM; цель — меньше ручной работы',
    );
    expect(understoodText(3, { continuity: 'undecided' })).toBe('Понял: пока не решили');
    expect(understoodText(3, { continuity: 'other', next_project: { description: 'CRM', domain: 'продажи' } })).toBe(
      'Понял: перейдёт на другой проект — CRM, связан с: продажи',
    );
    expect(understoodText(4, { tools: ['Figma', 'SQL'], knowledge: ['B2B-аналитика'] })).toBe(
      'Понял: инструменты — Figma, SQL; знания — B2B-аналитика',
    );
  });

  it('≤ 120 символов с «…»', () => {
    const t = understoodText(1, { tasks: Array.from({ length: 20 }, (_, i) => `задача номер ${i}`) });
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.endsWith('…')).toBe(true);
  });

  it('без процентов и терминов', () => {
    const t = understoodText(1, { tasks: ['a', 'b'] });
    expect(t).not.toMatch(/%|слот|LLM|модел/i);
  });

  it('нечего показать → пусто', () => {
    expect(understoodText(1, { tasks: [] })).toBe('');
    expect(understoodText(3, { continuity: null })).toBe('');
    expect(understoodText(1, null)).toBe('');
  });

  it('S12: начало транскрипта ≤ 80 символов', () => {
    const t = rawSavedText('x'.repeat(200));
    expect(t.startsWith('Ответ сохранён: ')).toBe(true);
    expect(t.length).toBe('Ответ сохранён: '.length + 80);
    expect(rawSavedText('коротко')).toBe('Ответ сохранён: коротко');
  });
});

import { describe, expect, it } from 'vitest';
import { validateAnalyzeRes } from './schema.js';

const base = { missing: [], followup: null, off_topic: false };

describe('validateAnalyzeRes — AGENTS.md §6', () => {
  it('Q1: валидный, trim и пустые строки выбрасываются', () => {
    expect(validateAnalyzeRes(1, { ...base, slots: { tasks: [' ревью кода ', '', 'созвоны'] } })).toEqual({
      ...base,
      slots: { tasks: ['ревью кода', 'созвоны'] },
    });
  });

  it('Q1: невалидный — не массив, не строка, > 120 символов', () => {
    expect(validateAnalyzeRes(1, { ...base, slots: { tasks: 'ревью' } })).toBeNull();
    expect(validateAnalyzeRes(1, { ...base, slots: { tasks: [1] } })).toBeNull();
    expect(validateAnalyzeRes(1, { ...base, slots: { tasks: ['x'.repeat(121)] } })).toBeNull();
  });

  it('Q2: role опциональна, пустая строка → null', () => {
    expect(validateAnalyzeRes(2, { ...base, slots: { project: { description: 'CRM', goal: '' } } })?.slots).toEqual({
      project: { description: 'CRM', goal: null },
    });
    expect(
      validateAnalyzeRes(2, { ...base, slots: { project: { description: 'CRM', goal: null, role: 'лид' } } })?.slots,
    ).toEqual({ project: { description: 'CRM', goal: null, role: 'лид' } });
  });

  it('Q2: невалидный — нет project, goal не строка', () => {
    expect(validateAnalyzeRes(2, { ...base, slots: {} })).toBeNull();
    expect(validateAnalyzeRes(2, { ...base, slots: { project: { description: 'CRM', goal: 5 } } })).toBeNull();
  });

  it('Q3: enum и next_project (может быть null или отсутствовать)', () => {
    expect(validateAnalyzeRes(3, { ...base, slots: { continuity: 'undecided' } })?.slots).toEqual({
      continuity: 'undecided',
      next_project: null,
    });
    expect(
      validateAnalyzeRes(3, { ...base, slots: { continuity: 'other', next_project: { description: 'CRM', domain: null } } })
        ?.slots,
    ).toEqual({ continuity: 'other', next_project: { description: 'CRM', domain: null } });
  });

  it('Q3: невалидный — значение вне enum, «unknown» из старой версии', () => {
    expect(validateAnalyzeRes(3, { ...base, slots: { continuity: 'unknown' } })).toBeNull();
    expect(validateAnalyzeRes(3, { ...base, slots: { continuity: 'other', next_project: 'CRM' } })).toBeNull();
  });

  it('Q4: валидный и невалидный (> 80 символов, нет knowledge)', () => {
    expect(validateAnalyzeRes(4, { ...base, slots: { tools: ['Figma'], knowledge: [] } })?.slots).toEqual({
      tools: ['Figma'],
      knowledge: [],
    });
    expect(validateAnalyzeRes(4, { ...base, slots: { tools: ['x'.repeat(81)], knowledge: [] } })).toBeNull();
    expect(validateAnalyzeRes(4, { ...base, slots: { tools: [] } })).toBeNull();
  });

  it('общие поля: followup ≤ 160, off_topic boolean, missing — массив строк', () => {
    const slots = { tasks: [] };
    expect(validateAnalyzeRes(1, { ...base, slots, followup: 'x'.repeat(161) })).toBeNull();
    expect(validateAnalyzeRes(1, { ...base, slots, off_topic: 'no' })).toBeNull();
    expect(validateAnalyzeRes(1, { ...base, slots, missing: 'цель' })).toBeNull();
    expect(validateAnalyzeRes(1, null)).toBeNull();
  });

  it('лишние поля отбрасываются, score игнорируется', () => {
    const r = validateAnalyzeRes(1, { ...base, score: 80, slots: { tasks: ['a'], extra: 1 } });
    expect(r).toEqual({ ...base, slots: { tasks: ['a'] } });
  });
});

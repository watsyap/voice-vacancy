import { describe, expect, it } from 'vitest';
import type { AnalyzeRes } from '../../shared/types';
import { completeness, outcome, segmentFill } from './completeness';

const res = (slots: AnalyzeRes['slots'], extra: Partial<AnalyzeRes> = {}): AnalyzeRes => ({
  slots,
  missing: [],
  followup: null,
  off_topic: false,
  ...extra,
});

describe('completeness — spec §5', () => {
  it('Q1: min(tasks, 2) / 2', () => {
    expect(completeness(1, res({ tasks: [] }))).toBe(0);
    expect(completeness(1, res({ tasks: ['ревью кода'] }))).toBe(0.5);
    expect(completeness(1, res({ tasks: ['ревью кода', 'планирование спринта'] }))).toBe(1);
    expect(completeness(1, res({ tasks: ['a', 'b', 'c'] }))).toBe(1);
  });

  it('Q2: description и goal, роль не обязательна', () => {
    expect(completeness(2, res({ project: { description: null, goal: null } }))).toBe(0);
    expect(completeness(2, res({ project: { description: 'приложение для курьеров', goal: null } }))).toBe(0.5);
    expect(completeness(2, res({ project: { description: 'приложение', goal: '  ' } }))).toBe(0.5);
    expect(
      completeness(2, res({ project: { description: 'приложение', goal: 'сократить доставку', role: null } })),
    ).toBe(1);
  });

  it('Q3: same и undecided — 100%, other требует description и domain', () => {
    expect(completeness(3, res({ continuity: null }))).toBe(0);
    expect(completeness(3, res({ continuity: 'same' }))).toBe(1);
    expect(completeness(3, res({ continuity: 'undecided' }))).toBe(1);
    expect(completeness(3, res({ continuity: 'other' }))).toBeCloseTo(1 / 3);
    expect(completeness(3, res({ continuity: 'other', next_project: { description: 'CRM', domain: null } }))).toBeCloseTo(
      2 / 3,
    );
    expect(
      completeness(3, res({ continuity: 'other', next_project: { description: 'CRM', domain: 'продажи' } })),
    ).toBe(1);
  });

  it('Q4: min(tools + knowledge, 2) / 2', () => {
    expect(completeness(4, res({ tools: [], knowledge: [] }))).toBe(0);
    expect(completeness(4, res({ tools: ['Figma'], knowledge: [] }))).toBe(0.5);
    expect(completeness(4, res({ tools: ['Figma'], knowledge: ['B2B-аналитика'] }))).toBe(1);
  });

  it('off_topic → 0 при любых слотах', () => {
    expect(completeness(1, res({ tasks: ['a', 'b'] }, { off_topic: true }))).toBe(0);
    expect(completeness(3, res({ continuity: 'same' }, { off_topic: true }))).toBe(0);
  });

  it('AC-10.1: детерминизм ×5', () => {
    const r = res({ tasks: ['ревью кода'] }, { missing: ['ещё задача'], followup: 'А что ещё?' });
    const runs = Array.from({ length: 5 }, () => {
      const v = completeness(1, r);
      return [segmentFill(v), outcome(v, false, r.followup)];
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it('AC-10.4: «пока не решили» → undecided, 100%, без уточнения', () => {
    const r = res({ continuity: 'undecided' });
    const v = completeness(3, r);
    expect(v).toBe(1);
    expect(outcome(v, false, r.followup)).toBe('S10');
  });

  it('частичный сегмент — минимум 10%', () => {
    expect(segmentFill(0)).toBe(0);
    expect(segmentFill(0.05)).toBe(0.1);
    expect(segmentFill(0.5)).toBe(0.5);
  });

  it('outcome: S10 / S11 / S10′', () => {
    expect(outcome(1, false, null)).toBe('S10');
    expect(outcome(0.5, false, 'Что ещё?')).toBe('S11');
    expect(outcome(0.5, true, 'Что ещё?')).toBe('S10p');
    expect(outcome(0.5, false, null)).toBe('S10p');
  });
});

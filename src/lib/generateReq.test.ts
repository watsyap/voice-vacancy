import { describe, expect, it } from 'vitest';
import { emptyAnswer, initialState, type State } from '../state/machine';
import { buildGenerateReq } from './generateReq';

describe('buildGenerateReq', () => {
  it('analyzed / partial → slots, raw → transcript (AC-12.2), skipped / empty → skipped', () => {
    const s: State = {
      ...initialState(),
      answers: {
        1: { ...emptyAnswer(), status: 'analyzed', slots: { tasks: ['a', 'b'] }, transcript: 'a b' },
        2: { ...emptyAnswer(), status: 'partial', slots: { project: { description: 'CRM', goal: null } } },
        3: { ...emptyAnswer(), status: 'raw', transcript: 'перейдёт на CRM' },
        4: { ...emptyAnswer(), status: 'skipped' },
      },
    };
    expect(buildGenerateReq(s).answers).toEqual([
      { q: 1, status: 'analyzed', slots: { tasks: ['a', 'b'] } },
      { q: 2, status: 'analyzed', slots: { project: { description: 'CRM', goal: null } } },
      { q: 3, status: 'raw', transcript: 'перейдёт на CRM' },
      { q: 4, status: 'skipped' },
    ]);
  });
});

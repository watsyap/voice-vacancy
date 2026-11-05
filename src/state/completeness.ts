import type { AnalyzeRes, Q, Slots1, Slots2, Slots3, Slots4 } from '../../shared/types';
import { CONFIG } from '../config';

const filled = (s: string | null | undefined): boolean => typeof s === 'string' && s.trim().length > 0;

/** Полнота ответа 0–1 по слотам — spec §5. Модель полноту не считает. */
export function completeness(q: Q, res: AnalyzeRes): number {
  if (res.off_topic) return 0;
  switch (q) {
    case 1: {
      const { tasks } = res.slots as Slots1;
      return Math.min(tasks.length, 2) / 2;
    }
    case 2: {
      const { project } = res.slots as Slots2;
      return ((filled(project.description) ? 1 : 0) + (filled(project.goal) ? 1 : 0)) / 2;
    }
    case 3: {
      const { continuity, next_project } = res.slots as Slots3;
      if (continuity === null) return 0;
      if (continuity === 'same' || continuity === 'undecided') return 1;
      const got = 1 + (filled(next_project?.description) ? 1 : 0) + (filled(next_project?.domain) ? 1 : 0);
      return got / 3;
    }
    case 4: {
      const { tools, knowledge } = res.slots as Slots4;
      return Math.min(tools.length + knowledge.length, 2) / 2;
    }
  }
}

export type AnalyzeOutcome = 'S10' | 'S11' | 'S10p';

/** Куда идти после анализа — spec §5, «Правила». */
export function outcome(value: number, followupUsed: boolean, followup: string | null): AnalyzeOutcome {
  if (value >= 1) return 'S10';
  if (!followupUsed && followup !== null) return 'S11';
  return 'S10p';
}

/** Доля сегмента для рисования: частичный — минимум 10% (spec §5). */
export function segmentFill(value: number): number {
  if (value <= 0) return 0;
  return Math.max(value, CONFIG.minPartialFill);
}

import type { AnySlots, Q, Slots1, Slots2, Slots3, Slots4 } from '../../shared/types';
import { CONFIG } from '../config';

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Перечисление извлечённого по вопросу. Подписи «задачи — …» — из примера flow.md §2; остальные предложены. */
function body(q: Q, slots: AnySlots): string {
  switch (q) {
    case 1: {
      const { tasks } = slots as Slots1;
      return tasks.length ? `задачи — ${tasks.join(', ')}` : '';
    }
    case 2: {
      const { description, goal } = (slots as Slots2).project;
      return [description && `проект — ${description}`, goal && `цель — ${goal}`].filter(Boolean).join('; ');
    }
    case 3: {
      const { continuity, next_project } = slots as Slots3;
      if (continuity === 'same') return 'продолжит этот проект';
      if (continuity === 'undecided') return 'пока не решили';
      if (continuity !== 'other') return '';
      const what = [next_project?.description, next_project?.domain && `связан с: ${next_project.domain}`]
        .filter(Boolean)
        .join(', ');
      return what ? `перейдёт на другой проект — ${what}` : 'перейдёт на другой проект';
    }
    case 4: {
      const { tools, knowledge } = slots as Slots4;
      return [tools.length && `инструменты — ${tools.join(', ')}`, knowledge.length && `знания — ${knowledge.join(', ')}`]
        .filter(Boolean)
        .join('; ');
    }
  }
}

/** «Понял: …» ≤ 120 символов, без процентов и терминов (spec §4.1, AC-10.2). Нечего показать — пустая строка. */
export function understoodText(q: Q, slots: AnySlots | null): string {
  if (!slots) return '';
  const b = body(q, slots);
  return b ? cut(`Понял: ${b}`, CONFIG.understoodMaxChars) : '';
}

/** S12: «Ответ сохранён» + начало транскрипта ≤ 80 символов с «…» (spec §7 S12). */
export function rawSavedText(transcript: string): string {
  const t = transcript.trim();
  return t ? `Ответ сохранён: ${cut(t, CONFIG.rawPreviewChars)}` : 'Ответ сохранён';
}

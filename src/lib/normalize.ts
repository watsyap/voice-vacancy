import type { Q } from '../../shared/types';
import { CONFIG } from '../config';

// Слова-паразиты — spec §5.
const FILLERS = new Set(['ну', 'э', 'типа']);

/** Слова ответа без пунктуации и паразитов. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 0 && !FILLERS.has(w));
}

/** Ответ не короче порога min (spec §5, AC-7.1, AC-7.2). */
export function meetsMin(q: Q, text: string): boolean {
  return words(text).length >= CONFIG.minWords[q];
}

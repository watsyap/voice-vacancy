import type { Q } from '../shared/types';

// Все таймеры и пороги. Значения без «предложено» менять только вместе со спекой (AGENTS.md §8).
export const CONFIG = {
  /** Тишина после речи → конец ответа. flow.md §4 */
  silenceEndMs: 4000,
  /** Тишина с начала записи → пауза S5. flow.md §4 */
  silenceStartMs: 5000,
  /** Порог min, слов после нормализации. spec §5 */
  minWords: { 1: 5, 2: 5, 3: 5, 4: 2 } as Record<Q, number>,
  /** Окно анализа, включая 1 повтор. spec §6, AC-9.3 */
  analyzeTimeoutMs: 4000,
  /** Задержка автостарта записи в S11. spec §7 */
  followupDelayMs: 600,
  /** Первый фрагмент генерации: подсказка S17 / ошибка S18. AC-17.1, AC-17.2 */
  genSlowMs: 10000,
  genFailMs: 30000,
  /** Замыкание кольца перед текстом вакансии. spec §8, AC-16.1 */
  closeMs: 600,
  /** Хранение сессии. flow.md §4 */
  sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Debounce записи текста вакансии. flow.md §5 */
  vacancySaveDebounceMs: 500,
  /** Подпись «Скопировано». spec §4.2 */
  copiedMs: 2000,
  /** Окно двойного подтверждения «Новая вакансия». spec §4.2 */
  confirmResetMs: 3000,
  /** S6: после стольких «не разобрал» подряд «Ответить текстом» — основная. flow.md §3 */
  noSpeechToTextAfter: 2,
  /** Частичный сегмент — не меньше этой доли. spec §5 */
  minPartialFill: 0.1,
  /** Начало транскрипта в подписи S12. spec §7 */
  rawPreviewChars: 80,
  /** «Понял: …». spec §4.1 */
  understoodMaxChars: 120,
} as const;

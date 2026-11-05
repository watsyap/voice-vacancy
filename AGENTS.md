# AGENTS.md — голосовая вакансия

**Что** делать — `docs/spec.md`. **Как** делать — этот файл. Приоритет: `spec.md` > `flow.md` > `analysis.md` > `docs/prompts/work-prompts.md` (А0) > этот файл.
Здесь не повторяются состояния (flow.md §3, spec §7), AC (spec §9), полнота (spec §5), анимация (spec §8). Ставь ссылку, не копируй.
«предложено» — значение задано в AGENTS.md, в спеке его нет. Менять можно, но с записью в журнал (`docs/decisions.md`).

## 1. Стек и команды

| | |
|---|---|
| UI | React 18 + Vite + TypeScript (strict) |
| API | Vercel Functions, Node runtime, `/api/*.ts` |
| Тесты | Vitest (+ jsdom для хуков) |
| Lint | ESLint + `tsc --noEmit` |
| Зависимости | Без библиотек состояния, роутинга, UI-китов, анимации. Новая зависимость — только с обоснованием в PR |
| LLM | Anthropic API, env `ANTHROPIC_API_KEY`; `LLM_MODEL_ANALYZE` (класс Haiku), `LLM_MODEL_GENERATE` (класс Sonnet) — spec §6. Нет ключа → демо |

| Команда | Что делает |
|---|---|
| `npm run dev` | `vercel dev` — UI + `/api` локально (без ключа = демо) |
| `npm run build` | `tsc -b && vite build` |
| `npm test` | `vitest run` |
| `npm run lint` | `eslint . && tsc --noEmit` |

## 2. Структура

```
/api/analyze.ts          POST /api/analyze: валидация входа, лимит, LLM или демо
/api/generate.ts         POST /api/generate: поток Markdown, LLM или демо
/api/_lib/               серверное: llm.ts, prompts.ts (Б1, Б2), demo.ts, rateLimit.ts
/shared/                 общее для api и src: types.ts, schema.ts (валидаторы слотов), questions.ts
/src/state/              machine.ts (редьюсер), events.ts, completeness.ts (spec §5)
/src/hooks/              useSpeech, useVolume, useSession, useEffects (побочные эффекты по фазе)
/src/components/         компоненты из §5, по одному на файл + *.module.css
/src/lib/                api.ts (fetch + AbortController + повтор), normalize.ts (min-порог)
/src/styles/tokens.css   дизайн-токены (§4), единственное место с «сырыми» значениями
/src/config.ts           все таймеры и пороги с комментарием-ссылкой на раздел спеки
/docs/                   spec.md, flow.md, analysis.md, decisions.md
/docs/prompts/           b1-analyze.md, b2-generate.md — источник правды; /api/_lib/prompts.ts копирует их дословно
```
Тесты лежат рядом с кодом: `*.test.ts`.

## 3. Архитектура состояния

Одна машина: `useReducer(reducer, initial)` в `App`. Редьюсер чистый: без таймеров, fetch, localStorage. Побочные эффекты — в `useEffects(state, dispatch)`, по `state.phase`; результат возвращается событием.

| Поле | Тип | Назначение |
|---|---|---|
| `phase` | `'S1'\|'S2'\|'S4'…'S20'\|'S10p'\|'S18p'\|'S23'` | Текущее состояние; ID = flow.md §3 (`S10′` → `S10p`, `S18′` → `S18p`) |
| `q` | `1\|2\|3\|4` | Текущий вопрос |
| `answers[1..4]` | `{transcript, slots\|null, status, completeness, followupUsed}` | `status`: `empty\|analyzed\|partial\|raw\|skipped` |
| `inputMode` | `'voice'\|'text'` | Текстовый режим (flow.md §3, «Текстовый режим») |
| `voiceBlock` | `null\|'S3a'\|'S3b'\|'S3c'` | Почему голоса нет; S3a–S3c — оверлеи, не фазы |
| `offline` | `boolean` | Оверлей S21 |
| `volumeMode` | `'rms'\|'pulse'` | `pulse` = оверлей S24 |
| `queue` | `q[]` | Ответы `raw`, ждущие анализа (S21) |
| `vacancy` | `{text, complete}` | Текст S16–S19 |
| `demo` | `boolean` | Пришёл `X-Demo: 1` |
| `noSpeechCount` | `number` | Для S6 (2 раза подряд → «Ответить текстом» основная) |

| Событие | Откуда | Типичный переход |
|---|---|---|
| `START` / `START_TEXT` | кнопки S1 | S1 → S2 / текст |
| `MIC_OK` · `MIC_DENIED` · `MIC_MISSING` · `SPEECH_UNSUPPORTED` | useSpeech | S2 → S4 · S3a · S3b · S3c |
| `SPEECH_INTERIM` · `SPEECH_FINAL` | useSpeech | остаёмся в S4 |
| `SILENCE_START` (5 с) · `SILENCE_END` (4 с) · `NO_SPEECH` | useSpeech | S4 → S5 · S4 → min-проверка · S6 |
| `DONE` / `SUBMIT_TEXT` | кнопка, Enter, Ctrl+Enter | → S7 (ниже порога) или S9 |
| `PAUSE` · `RESUME` · `TAB_HIDDEN` | кольцо, Esc, visibilitychange | S4 ↔ S8; S22 → S8 |
| `ANALYZE_OK(res)` | api | S9 → S10 / S11 / S10p (по `completeness.ts`) |
| `ANALYZE_FAIL` | api (ошибка, таймаут, 2-й невалидный) | S9 → S12 |
| `SKIP_FOLLOWUP` · `SKIP` · `RERECORD` | кнопки | S11 → S10p · → S14 · → S13 → S4 |
| `NEXT` · `OPEN_SEGMENT(q)` | кнопка, тап по сегменту | → S4 следующего / S15 |
| `GENERATE` · `GEN_CHUNK` · `GEN_SLOW` · `GEN_FAIL` · `GEN_CUT` · `GEN_DONE` | кнопка, api, таймер | S16 → S17 → S18 / S18p / S19 |
| `EDIT_VACANCY` · `COPY` · `RESET` | VacancyEditor, ссылки | S19; `RESET` → S1 |
| `OFFLINE` · `ONLINE` · `QUEUE_ANALYZED(q,res)` | window, api | оверлей S21; без уточнения, неполный → `partial` |
| `VOLUME_UNAVAILABLE` | useVolume | `volumeMode = 'pulse'` |
| `RESTORE(session)` | useSession при старте | → S19 (есть вакансия) / S23 / S1 |

Недопустимое событие в фазе — редьюсер возвращает тот же `state` (не бросает). Таблица разрешённых пар `phase × event` — константа в `machine.ts`, по ней же тест.

**localStorage** (ключ `vv:session:v1`, предложено), по flow.md §5: `q`, `answers[]` (transcript, slots, status, followupUsed), `inputMode`, `queue`, `vacancy.text` (debounce 500 мс), `savedAt`. Не хранить: промежуточный текст, фазу записи, `demo`. При чтении старше 7 дней — удалить → S1. Ошибка чтения/записи (квота, приватный режим) — молча работать без сохранения.

## 4. Дизайн-токены (`src/styles/tokens.css`)

Длительности и easing — из spec §8; остальное — предложено.

```css
:root {
  /* цвет — предложено */
  --bg: #FFFFFF; --surface: #F5F5F7; --text: #111114; --text-2: #6E6E73;
  --accent: #0A84FF; --danger: #D70015; --focus: #0A84FF;
  --ring-idle: #D2D2D7; --ring-active: #111114; --ring-done: #34C759;
  /* типографика — предложено */
  --font: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --fs-question: 24px/1.3; --fs-body: 16px/1.5; --fs-caption: 14px/1.4; --fs-label: 12px/1.3;
  --fw-question: 600; --fw-body: 400;
  /* отступы (шаг 4) и радиусы — предложено */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px; --sp-12: 48px;
  --r-btn: 12px; --r-field: 12px; --r-stroke: 1px;
  /* кольцо — spec §8 */
  --ring-d: 240px; --ring-d-mobile: 200px; --ring-d-mini: 48px;
  --stroke-w: 2px; --stroke-h: 8px; --stroke-h-max: 20px;
  /* время — spec §8 */
  --t-attack: 50ms; --t-release: 150ms; --t-pulse: 300ms;
  --t-analyze-cycle: 1200ms; --t-gen-cycle: 1600ms; --t-fill: 400ms;
  --t-question: 250ms; --t-close: 600ms; --t-breath: 2000ms;
  --t-ring-out: 200ms; --t-fade-reduced: 150ms;
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1); --ease-out: ease-out; --ease-io: ease-in-out;
}
@media (prefers-color-scheme: dark) {
  :root { /* предложено */
    --bg: #000000; --surface: #1C1C1E; --text: #F5F5F7; --text-2: #98989D;
    --accent: #0A84FF; --danger: #FF453A;
    --ring-idle: #3A3A3C; --ring-active: #F5F5F7; --ring-done: #30D158;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root { --t-question: var(--t-fade-reduced); --t-fill: 0ms; --t-close: var(--t-fade-reduced); }
}
```
Брейкпоинт 600 px (spec §8). Контраст текста ≥ 4.5:1 в обеих темах; `--ring-idle` декоративный, смысл дублирует подпись.

## 5. Компоненты и хуки

| Компонент | Props | Внутреннее состояние | Обслуживает |
|---|---|---|---|
| `ProgressRing` | `segments: SegmentState[4]`, `current`, `mode: 'listen'\|'analyze'\|'idle'\|'close'\|'generate'`, `level: number` (0–1), `pulseKey`, `size: 'full'\|'mini'`, `onCenter()`, `onSegment(q)`, `segmentsClickable` | Сглаженный RMS (атака/спад), rAF-цикл, SVG из 64 `<line>` | S1, S4–S16, S24; вид — spec §8 |
| `QuestionView` | `q`, `showExample` | Анимация смены вопроса (`key=q`) | Все экраны вопроса; тексты — `/shared/questions.ts` (spec §2) |
| `StatusLine` | `text`, `tone: 'neutral'\|'error'` | — | Все S; `aria-live="polite"`. Тексты — только из спеки/flow |
| `TranscriptLive` | `finalText`, `interimText` | Последние 3 строки, затухание старых | S4, S8 |
| `TextAnswer` | `value`, `onChange`, `onSubmit`, `autoFocus` | Автовысота ≤ 6 строк | Текстовый режим, S3a–S3c, S21 |
| `Understood` | `slots`, `q` | — | «Понял: …» ≤ 120 симв. (spec §4.1); S10, S10p, S11, S15 |
| `Actions` | `primary?`, `secondary?`, `links?` (≤ 2) | — | Лимит кнопок spec §4.1 (проверка типом) |
| `VacancyEditor` | `text`, `streaming`, `onEdit`, `onCopy`, `onReset` | Двойное подтверждение «Новая вакансия» (3 с) | S16–S19, S18p |
| `DemoBadge` | `visible` | — | Метка демо (spec §4.1) |

| Хук | Возвращает / делает | Детали |
|---|---|---|
| `useSpeech({active, onEvent})` | `start()`, `stop()`, `supported` | `webkitSpeechRecognition`, `lang='ru-RU'`, `continuous`, `interimResults`. `onend` без `stop()` → рестарт, финальный текст накапливается (spec §7 S4). Таймеры тишины от последнего `onresult`. Ошибки: `not-allowed`→MIC_DENIED, `audio-capture`→MIC_MISSING, `no-speech`→NO_SPEECH, `network`→OFFLINE |
| `useVolume({active})` | `level` 0–1 | `getUserMedia` + `AnalyserNode`, RMS по `getFloatTimeDomainData`. Ошибка или распознавание падает в течение 2 с после старта захвата (Android) → освободить поток, `VOLUME_UNAVAILABLE` (предложено) |
| `useSession(state, dispatch)` | — | Загрузка при монтировании → `RESTORE`; запись после каждого перехода; `vacancy.text` с debounce 500 мс |
| `useEffects(state, dispatch)` | — | Запуск анализа в S9, генерации в S16, таймеров S11 (600 мс), S17 (10/30 с), очереди по `online` |

## 6. Контракт API (дополняет spec §6)

```ts
// shared/types.ts
type Q = 1 | 2 | 3 | 4;
type Slots1 = { tasks: string[] };
type Slots2 = { project: { description: string | null; goal: string | null; role?: string | null } };
type Slots3 = { continuity: 'same' | 'other' | 'undecided' | null;
                next_project?: { description: string | null; domain: string | null } };
type Slots4 = { tools: string[]; knowledge: string[] };
type SlotsByQ = { 1: Slots1; 2: Slots2; 3: Slots3; 4: Slots4 };
type AnalyzeReq = { q: Q; transcript: string };
type AnalyzeRes<K extends Q = Q> = { slots: SlotsByQ[K]; missing: string[]; followup: string | null; off_topic: boolean };
type GenerateReq = { answers: { q: Q; status: 'analyzed' | 'raw' | 'skipped'; slots?: SlotsByQ[Q]; transcript?: string }[] };
type ApiError = { error: 'bad_request' | 'rate_limited' | 'upstream' | 'timeout' | 'internal' };
```

JSON-схемы слотов (для `shared/schema.ts`; валидатор пишется руками, без библиотек — предложено). Лишние поля — отбрасываются, неверный тип — ответ невалиден.

| Q | Схема |
|---|---|
| 1 | `{tasks: string[] (каждая trim, непустая, ≤ 120)}` |
| 2 | `{project: {description: string\|null, goal: string\|null, role?: string\|null}}` |
| 3 | `{continuity: enum[same,other,undecided]\|null, next_project?: {description: string\|null, domain: string\|null}}` |
| 4 | `{tools: string[], knowledge: string[]}` (каждый ≤ 80) |
| все | `missing: string[]`, `followup: string\|null (≤ 160)`, `off_topic: boolean` |

| Код | Когда | Клиент |
|---|---|---|
| 200 | Успех; `/generate` — `text/plain; charset=utf-8`, chunked | — |
| 400 `bad_request` | Неверный `q`, пустой `transcript` или > 4000 симв. (предложено), все `skipped` | S12 / S18 (баг клиента) |
| 429 `rate_limited` | Лимит spec §6 («Лимит запросов»); заголовок `Retry-After` | S12 / S18 |
| 502 `upstream` | Ошибка LLM или невалидный JSON от LLM | S12 (с повтором по spec §6) / S18 |
| 504 `timeout` | LLM дольше 25 с (предложено) | S12 / S18 |
| 500 `internal` | Прочее | S12 / S18 |

- `X-Demo: 1` — на любом ответе в демо-режиме, включая ошибки. Клиент ставит `demo = true` и не сбрасывает.
- Лимит: скользящее окно 60 мин по `x-forwarded-for`, в памяти инстанса (best effort, предложено). В демо-режиме лимита нет (предложено).
- Обрыв потока `/generate` после ≥ 1 фрагмента → `GEN_CUT` (S18p); до первого → `GEN_FAIL`.
- Клиентский таймаут анализа и повтор — spec §6, AC-9.2/9.3. Сервер не повторяет.

## 7. Тесты (обязательны для DoD)

| Файл | Что проверяет |
|---|---|
| `src/state/completeness.test.ts` | Формулы spec §5 для Q1–Q4; `off_topic` → 0; минимум 10% для частичного; детерминизм ×5 (AC-10.1); «пока не решили» → `undecided`, 100%, без уточнения (AC-10.4) |
| `src/lib/normalize.test.ts` | Порог min: Q1–Q2 = 5, Q3–Q4 = 2; удаление «ну», «э», «типа» (AC-7.1, AC-7.2) |
| `api/_lib/demo.test.ts` | Эвристики spec §6: деление Q1/Q4, словарь Q4, `goal` в Q2, ключевые слова Q3, `followup` из `missing`, роль по словарю; разный ввод → разные слоты |
| `shared/schema.test.ts` | Валидный/невалидный ответ по каждому Q |
| `src/state/machine.test.ts` | S9 → S10 / S11 / S10p / S12; S11 → S9 с объединённым транскриптом (AC-11.2); второго уточнения нет (AC-11.3); `SKIP_FOLLOWUP` (AC-11.4); `RERECORD` сбрасывает флаг; недопустимые события не меняют state |

## 8. Правила для агента

| Нельзя менять без правки `docs/spec.md` | Где |
|---|---|
| Тексты вопросов, примеры, порядок | spec §2 |
| Пороги (5/2 слова, 4 с, 5 с, 600 мс, 10/30 с, 7 дней, лимиты 60/10) | flow.md §4, spec §5–7, §13 |
| Тексты подписей и кнопок | flow.md §3, spec §4 |
| Формулы полноты, лимит уточнений | spec §5 |
| Контракт API | spec §6 + §6 этого файла |
| «Чего делать нельзя» | spec §10 — ни один пункт |

- Противоречие между документами или с этим файлом → **остановиться**, описать (где, что, варианты) в `docs/decisions.md` и в ответе. Не выбирать молча.
- Нет текста для состояния в спеке → не придумывать, спросить.
- Не добавлять элементы UI, которых нет в spec §4.
- Строки для пользователя — без «слот», «LLM», «модель», процентов (spec §10).
- Коммит после каждого этапа A5 (`docs/prompts/work-prompts.md`), сообщение: `A5.<n>: <что>`.

## 9. Definition of done

- [ ] `npm run lint`, `npm test`, `npm run build` — без ошибок.
- [ ] Все AC из spec §9 проходят (ручная проверка по чек-листу в PR).
- [ ] Каждое состояние flow.md §3 достижимо; способ вызвать — в `docs/qa.md` (devtools: offline, блок микрофона и т. п.).
- [ ] Сценарии C1–C7 (spec §3) проходятся в демо-режиме без `ANTHROPIC_API_KEY`.
- [ ] `prefers-reduced-motion: reduce` — поведение spec §8 (проверить эмуляцией в DevTools).
- [ ] Тёмная тема, ширина 360 px и ≥ 600 px — без поломок вёрстки.
- [ ] Деплой на Vercel открывается по HTTPS, метка демо видна без ключа.

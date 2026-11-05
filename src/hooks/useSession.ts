import { useEffect, useRef, type Dispatch } from 'react';
import { CONFIG } from '../config';
import type { Event } from '../state/events';
import type { State } from '../state/machine';
import { SESSION_KEY, hasProgress, parseSession, toSession } from '../state/session';

// Ошибки localStorage (квота, приватный режим) — молча работаем без сохранения (AGENTS.md §3).
const read = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};
const write = (s: State): void => {
  try {
    if (hasProgress(s)) localStorage.setItem(SESSION_KEY, JSON.stringify(toSession(s)));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* без сохранения */
  }
};
const remove = (): void => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* без сохранения */
  }
};

/** Загрузка при старте → RESTORE; запись после каждого перехода; текст вакансии — с debounce 500 мс (AGENTS.md §5). */
export function useSession(state: State, dispatch: Dispatch<Event>): void {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const raw = read();
    const session = parseSession(raw);
    // Старше 7 дней или битая — удаляем молча → S1 (spec §7 S23).
    if (!session) {
      if (raw) remove();
      return;
    }
    dispatch({ type: 'RESTORE', session });
  }, [dispatch]);

  // Всё, кроме текста вакансии, — сразу после перехода.
  const { phase, q, cursor, answers, inputMode, queue } = state;
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  useEffect(() => {
    if (!loaded.current) return;
    write(latest.current);
  }, [phase, q, cursor, answers, inputMode, queue]);

  // Текст вакансии (правки) — с debounce (AC-19.3).
  const text = state.vacancy.text;
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => write(latest.current), CONFIG.vacancySaveDebounceMs);
    return () => clearTimeout(t);
  }, [text]);
}

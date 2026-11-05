import { useLayoutEffect, useRef } from 'react';
import type { Q } from '../../shared/types';
import { QUESTIONS } from '../../shared/questions';
import styles from './QuestionView.module.css';

type Props = { q: Q; showExample: boolean };

/** Подбор размера: вопрос в одну строку, шрифт от 24 до 18 px; не влез на 18 — перенос (decisions.md). */
function fitOneLine(el: HTMLElement): void {
  el.style.fontSize = '';
  el.style.whiteSpace = 'nowrap';
  const max = parseFloat(getComputedStyle(el).fontSize);
  const min = parseFloat(getComputedStyle(el).getPropertyValue('--fs-question-min')) || max;
  const ratio = el.clientWidth / el.scrollWidth;
  if (ratio >= 1) return;
  const size = Math.floor(max * ratio * 10) / 10;
  if (size >= min) {
    el.style.fontSize = `${size}px`;
  } else {
    el.style.fontSize = `${min}px`;
    el.style.whiteSpace = '';
  }
}

/** Текст вопроса и пример (spec §2, §4.1). Смена вопроса — fade + 8 px за 250 мс (spec §8). */
export function QuestionView({ q, showExample }: Props) {
  const { text, example } = QUESTIONS[q];
  const ref = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitOneLine(el);
    const ro = new ResizeObserver(() => fitOneLine(el));
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [q]);

  return (
    <div key={q} className={styles.view}>
      <h1 ref={ref} className={styles.question}>
        {text}
      </h1>
      <p className={styles.example} aria-hidden={!showExample} data-hidden={!showExample}>
        {example}
      </p>
    </div>
  );
}

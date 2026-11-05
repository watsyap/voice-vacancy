import type { Q } from '../../shared/types';
import { QUESTIONS } from '../../shared/questions';
import styles from './QuestionView.module.css';

type Props = { q: Q; showExample: boolean };

/** Текст вопроса и пример (spec §2, §4.1). Смена вопроса — fade + 8 px за 250 мс (spec §8). */
export function QuestionView({ q, showExample }: Props) {
  const { text, example } = QUESTIONS[q];
  return (
    <div key={q} className={styles.view}>
      <h1 className={styles.question}>{text}</h1>
      <p className={styles.example} aria-hidden={!showExample} data-hidden={!showExample}>
        {example}
      </p>
    </div>
  );
}

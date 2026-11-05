import styles from './StatusLine.module.css';

type Props = { text: string; tone?: 'neutral' | 'error' };

/** Одна строка статуса (spec §4.1). Тексты — только из спеки и flow.md. */
export function StatusLine({ text, tone = 'neutral' }: Props) {
  return (
    <p className={styles.status} data-tone={tone} aria-live="polite">
      {text}
    </p>
  );
}

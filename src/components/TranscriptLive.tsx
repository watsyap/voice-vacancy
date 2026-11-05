import styles from './TranscriptLive.module.css';

type Props = { finalText: string; interimText: string };

/** Промежуточный текст под подписью: до 3 строк, старое уходит вверх с затуханием (spec §4.1). */
export function TranscriptLive({ finalText, interimText }: Props) {
  if (!finalText && !interimText) return null;
  return (
    <div className={styles.box}>
      <p className={styles.text}>
        {finalText}
        {finalText && interimText ? ' ' : ''}
        {interimText && <span className={styles.interim}>{interimText}</span>}
      </p>
    </div>
  );
}

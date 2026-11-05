import { useLayoutEffect, useRef } from 'react';
import styles from './TextAnswer.module.css';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  label: string;
};

/** Поле ответа в текстовом режиме: автовысота до 6 строк, Ctrl+Enter = «Отправить» (spec §4.1). */
export function TextAnswer({ value, onChange, onSubmit, autoFocus, label }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={styles.field}
      rows={1}
      value={value}
      aria-label={label}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}

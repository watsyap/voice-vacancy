import { useEffect, useState } from 'react';
import { CONFIG } from '../config';
import { Actions } from './Actions';
import styles from './VacancyEditor.module.css';

type Props = {
  text: string;
  /** Идёт поток (S16–S17): правка недоступна (spec §4.2). */
  streaming: boolean;
  /** Генерация завершена (S19): «Скопировать» и «Новая вакансия». */
  complete: boolean;
  onEdit: (text: string) => void;
  onReset: () => void;
};

/** Текст вакансии: редактируемый Markdown, «Скопировать», «Новая вакансия» с двойным подтверждением (spec §4.2). */
export function VacancyEditor({ text, streaming, complete, onEdit, onReset }: Props) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), CONFIG.copiedMs);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIG.confirmResetMs);
    return () => clearTimeout(t);
  }, [confirming]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* буфер недоступен — текст можно выделить вручную */
    }
  };

  return (
    <div className={styles.editor}>
      <textarea
        className={styles.text}
        aria-label="Текст вакансии"
        value={text}
        readOnly={streaming}
        onChange={(e) => onEdit(e.target.value)}
      />
      {complete && (
        <Actions
          primary={{ label: copied ? 'Скопировано' : 'Скопировать', onClick: () => void copy() }}
          links={[
            {
              label: confirming ? 'Удалить текущую? Нажмите ещё раз' : 'Новая вакансия',
              onClick: () => (confirming ? onReset() : setConfirming(true)),
            },
          ]}
        />
      )}
    </div>
  );
}

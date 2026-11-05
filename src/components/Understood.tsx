import type { AnySlots, Q } from '../../shared/types';
import { understoodText } from '../lib/understood';
import styles from './StatusLine.module.css';

/** «Понял: …» над уточнением в S11 (spec §4.1). В S10/S10′/S15 тот же текст идёт в подпись статуса. */
export function Understood({ q, slots }: { q: Q; slots: AnySlots | null }) {
  const text = understoodText(q, slots);
  return text ? <p className={styles.status}>{text}</p> : null;
}

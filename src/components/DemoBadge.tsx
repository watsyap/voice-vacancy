import styles from './DemoBadge.module.css';

/** Метка «Демо-режим» в углу — только после X-Demo: 1 от API (spec §4.1). */
export function DemoBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <div className={styles.badge}>Демо-режим</div>;
}

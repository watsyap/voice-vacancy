import styles from './Actions.module.css';

export type Action = { label: string; onClick: () => void };

type Props = {
  primary?: Action;
  secondary?: Action;
  /** Не больше 2 ссылок (spec §4.1) — проверяется типом. */
  links?: [] | [Action] | [Action, Action];
};

/** Лимит spec §4.1: 1 основная, 1 вторичная, ≤ 2 ссылки. */
export function Actions({ primary, secondary, links = [] }: Props) {
  return (
    <div className={styles.actions}>
      {(primary || secondary) && (
        <div className={styles.buttons}>
          {primary && (
            <button type="button" className={styles.primary} onClick={primary.onClick}>
              {primary.label}
            </button>
          )}
          {secondary && (
            <button type="button" className={styles.secondary} onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
      {links.length > 0 && (
        <div className={styles.links}>
          {links.map((l) => (
            <button key={l.label} type="button" className={styles.link} onClick={l.onClick}>
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

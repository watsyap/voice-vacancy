import type { CSSProperties } from 'react';
import type { Q } from '../../shared/types';
import { QS } from '../../shared/types';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { segmentFill } from '../state/completeness';
import type { AnswerStatus } from '../state/machine';
import styles from './ProgressRing.module.css';

// Геометрия — spec §8: 64 штриха (16 на сегмент), зазор 4°, штрих 2 × 8 px, до 20 px от громкости.
const VIEW = 240;
const C = VIEW / 2;
const PER_SEGMENT = 16;
const GAP_DEG = 4;
const STROKE_H = 8;
const STROKE_H_EXTRA = 12;
const R_INNER = C - STROKE_H - STROKE_H_EXTRA - 4;
const SPAN_DEG = 90 - GAP_DEG;

export type SegmentState = { status: AnswerStatus; fill: number };
export type RingMode = 'listen' | 'analyze' | 'idle' | 'close' | 'generate';

type Props = {
  segments: Record<Q, SegmentState>;
  /** Сегмент текущего вопроса; null — текущего нет (S1). */
  current: Q | null;
  mode: RingMode;
  /** Громкость 0–1 (S4). */
  level?: number;
  size?: 'full' | 'mini';
  centerLabel?: string;
  onCenter?: () => void;
  onSegment?: (q: Q) => void;
  segmentsClickable?: boolean;
};

const rad = (deg: number): number => (deg * Math.PI) / 180;
const angleOf = (seg: number, i: number): number => -90 + seg * 90 + GAP_DEG / 2 + ((i + 0.5) * SPAN_DEG) / PER_SEGMENT;

type StrokeKind = 'idle' | 'active' | 'done' | 'raw' | 'hidden';

/** Вид штриха i сегмента — таблица «Состояние сегмента», spec §8. */
function strokeKind(seg: SegmentState, i: number, isCurrent: boolean): StrokeKind {
  switch (seg.status) {
    case 'skipped':
      return i % 2 === 1 ? 'hidden' : 'idle';
    case 'raw':
      return 'raw';
    case 'analyzed':
    case 'partial': {
      const done = Math.round(segmentFill(seg.fill) * PER_SEGMENT);
      if (i < done) return 'done';
      return isCurrent ? 'active' : 'idle';
    }
    case 'empty':
      return isCurrent ? 'active' : 'idle';
  }
}

function arcPath(seg: number): string {
  const r = R_INNER + STROKE_H;
  const a0 = rad(-90 + seg * 90 + GAP_DEG / 2);
  const a1 = rad(-90 + seg * 90 + GAP_DEG / 2 + SPAN_DEG);
  return `M ${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)}`;
}

export function ProgressRing({
  segments,
  current,
  mode,
  level = 0,
  size = 'full',
  centerLabel,
  onCenter,
  onSegment,
  segmentsClickable = false,
}: Props) {
  const reduced = useReducedMotion();
  const lvl = Math.min(1, Math.max(0, level));

  return (
    <div className={`${styles.ring} ${size === 'mini' ? styles.mini : ''}`} data-mode={mode}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className={styles.svg} aria-hidden={!segmentsClickable}>
        {QS.map((q, seg) => {
          const isCurrent = q === current;
          return (
            <g key={q} className={styles.segment}>
              {Array.from({ length: PER_SEGMENT }, (_, i) => {
                const kind = strokeKind(segments[q], i, isCurrent);
                const live = isCurrent && kind === 'active' && mode === 'listen';
                const h = live && !reduced ? STROKE_H + STROKE_H_EXTRA * lvl : STROKE_H;
                const a = rad(angleOf(seg, i));
                const style = {
                  '--i': i,
                  ...(live && reduced ? { opacity: 0.5 + 0.5 * lvl } : null),
                } as CSSProperties;
                return (
                  <line
                    key={i}
                    className={`${styles.stroke} ${styles[kind]} ${isCurrent ? styles.current : ''}`}
                    x1={C + R_INNER * Math.cos(a)}
                    y1={C + R_INNER * Math.sin(a)}
                    x2={C + (R_INNER + h) * Math.cos(a)}
                    y2={C + (R_INNER + h) * Math.sin(a)}
                    style={style}
                  />
                );
              })}
              {segmentsClickable && onSegment && (
                <path
                  d={arcPath(seg)}
                  className={styles.hit}
                  role="button"
                  tabIndex={0}
                  aria-label={`Вопрос ${q}`}
                  onClick={() => onSegment(q)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onSegment(q);
                    }
                  }}
                />
              )}
            </g>
          );
        })}
      </svg>
      {onCenter && centerLabel && (
        <button type="button" className={styles.center} aria-label={centerLabel} onClick={onCenter} />
      )}
    </div>
  );
}

import type { GenerateAnswer, GenerateReq } from '../../shared/types';
import { QS } from '../../shared/types';
import type { State } from '../state/machine';

/** Ответы → тело /api/generate (spec §6): полный и частичный — analyzed, S12/очередь — raw, пропуск — skipped. */
export function buildGenerateReq(s: State): GenerateReq {
  const answers: GenerateAnswer[] = QS.map((q) => {
    const a = s.answers[q];
    if ((a.status === 'analyzed' || a.status === 'partial') && a.slots) return { q, status: 'analyzed', slots: a.slots };
    if (a.status === 'raw' && a.transcript.trim()) return { q, status: 'raw', transcript: a.transcript };
    return { q, status: 'skipped' };
  });
  return { answers };
}

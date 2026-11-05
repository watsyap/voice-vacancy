// Контракт API — AGENTS.md §6, spec §6.
export type Q = 1 | 2 | 3 | 4;

export type Slots1 = { tasks: string[] };
export type Slots2 = { project: { description: string | null; goal: string | null; role?: string | null } };
export type Slots3 = {
  continuity: 'same' | 'other' | 'undecided' | null;
  next_project?: { description: string | null; domain: string | null } | null;
};
export type Slots4 = { tools: string[]; knowledge: string[] };
export type SlotsByQ = { 1: Slots1; 2: Slots2; 3: Slots3; 4: Slots4 };
export type AnySlots = SlotsByQ[Q];

export type AnalyzeReq = { q: Q; transcript: string };
export type AnalyzeRes<K extends Q = Q> = {
  slots: SlotsByQ[K];
  missing: string[];
  followup: string | null;
  off_topic: boolean;
};

export type GenerateAnswer = {
  q: Q;
  status: 'analyzed' | 'raw' | 'skipped';
  slots?: AnySlots;
  transcript?: string;
};
export type GenerateReq = { answers: GenerateAnswer[] };

export type ApiError = { error: 'bad_request' | 'rate_limited' | 'upstream' | 'timeout' | 'internal' };

export const QS: readonly Q[] = [1, 2, 3, 4];

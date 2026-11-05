import { describe, expect, it } from 'vitest';
import { validateGenerateReq } from './generateReq.js';

describe('validateGenerateReq — spec §6', () => {
  it('валидный запрос; ответы сортируются по q', () => {
    const r = validateGenerateReq({
      answers: [
        { q: 2, status: 'raw', transcript: ' CRM для продаж ' },
        { q: 1, status: 'analyzed', slots: { tasks: ['ревью кода'] } },
        { q: 3, status: 'skipped' },
      ],
    });
    expect(r?.answers.map((a) => a.q)).toEqual([1, 2, 3]);
    expect(r?.answers[1]).toEqual({ q: 2, status: 'raw', transcript: 'CRM для продаж' });
  });

  it('все skipped → 400 (S20 не отправляет)', () => {
    expect(validateGenerateReq({ answers: [1, 2, 3, 4].map((q) => ({ q, status: 'skipped' })) })).toBeNull();
  });

  it('невалидное: нет answers, неверный q, дубль, raw без текста, кривые слоты, неизвестный статус', () => {
    expect(validateGenerateReq({})).toBeNull();
    expect(validateGenerateReq({ answers: [{ q: 5, status: 'skipped' }] })).toBeNull();
    expect(validateGenerateReq({ answers: [{ q: 1, status: 'raw', transcript: 'a' }, { q: 1, status: 'skipped' }] })).toBeNull();
    expect(validateGenerateReq({ answers: [{ q: 1, status: 'raw', transcript: '  ' }] })).toBeNull();
    expect(validateGenerateReq({ answers: [{ q: 1, status: 'analyzed', slots: { tasks: 'x' } }] })).toBeNull();
    expect(validateGenerateReq({ answers: [{ q: 1, status: 'partial' }] })).toBeNull();
  });
});

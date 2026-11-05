import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, generate } from './api';

const VALID = { slots: { tasks: ['ревью кода', 'созвоны'] }, missing: [], followup: null, off_topic: false };

const resp = (status: number, body: unknown, demo = false) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: demo ? { 'X-Demo': '1' } : {},
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('analyze — spec §6', () => {
  it('200 и валидный ответ → ok, X-Demo → demo', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, VALID, true));
    expect(await analyze(1, 'текст')).toEqual({ ok: true, res: VALID, demo: true });
  });

  it('AC-9.2: невалидный JSON → ровно 1 повтор; второй тоже невалидный → ошибка', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, 'not json')).mockResolvedValueOnce(resp(200, { slots: {} }));
    expect(await analyze(1, 'текст')).toEqual({ ok: false, demo: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('невалидный, потом валидный → ok', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, { nope: 1 })).mockResolvedValueOnce(resp(200, VALID));
    expect((await analyze(1, 'текст')).ok).toBe(true);
  });

  it('502 (невалидный JSON от LLM) → повтор', async () => {
    fetchMock.mockResolvedValueOnce(resp(502, { error: 'upstream' })).mockResolvedValueOnce(resp(200, VALID));
    expect((await analyze(1, 'текст')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('прочий не-200 (429, 500) → сразу ошибка, без повтора', async () => {
    for (const status of [400, 429, 500, 504]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(resp(status, { error: 'x' }, true));
      expect(await analyze(1, 'текст')).toEqual({ ok: false, demo: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('AC-9.3: нет ответа 4 с → ошибка, запрос отменён', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          signal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    const p = analyze(1, 'текст');
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toEqual({ ok: false, demo: false });
    expect(signal?.aborted).toBe(true);
  });

  it('повтор не начинается, если окно уже вышло', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      () => new Promise((res) => setTimeout(() => res(resp(502, {})), 4100)),
    );
    const p = analyze(1, 'текст');
    await vi.advanceTimersByTimeAsync(4200);
    expect((await p).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('внешний signal отменяет запрос', async () => {
    const outer = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('abort')))),
    );
    const p = analyze(1, 'текст', outer.signal);
    outer.abort();
    expect((await p).ok).toBe(false);
  });
});

describe('generate — поток', () => {
  const REQ = { answers: [{ q: 1 as const, status: 'raw' as const, transcript: 'ревью' }] };
  const streamOf = (chunks: string[], failAfter = false) => {
      let i = 0;
      return new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (i < chunks.length) ctrl.enqueue(new TextEncoder().encode(chunks[i++]));
          else if (failAfter) ctrl.error(new Error('cut'));
          else ctrl.close();
        },
      });
    };

  it('фрагменты приходят по мере поступления → done', async () => {
    fetchMock.mockResolvedValueOnce(new Response(streamOf(['## Роль', ' (предположение)']), { headers: { 'X-Demo': '1' } }));
    const got: string[] = [];
    let demo = false;
    expect(await generate(REQ, (t) => got.push(t), undefined, () => (demo = true))).toBe('done');
    expect(got.join('')).toBe('## Роль (предположение)');
    expect(demo).toBe(true);
  });

  it('обрыв после фрагмента → cut (S18′)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(streamOf(['## Роль'], true)));
    expect(await generate(REQ, () => {})).toBe('cut');
  });

  it('не-200 или пустой поток → fail (S18)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"upstream"}', { status: 502 }));
    expect(await generate(REQ, () => {})).toBe('fail');
    fetchMock.mockResolvedValueOnce(new Response(streamOf([])));
    expect(await generate(REQ, () => {})).toBe('fail');
  });

  it('сеть упала до ответа → fail', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    expect(await generate(REQ, () => {})).toBe('fail');
  });
});

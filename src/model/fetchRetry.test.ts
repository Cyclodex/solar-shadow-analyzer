import { describe, expect, it, vi } from 'vitest';
import {
  NetError,
  RETRY_DEFAULTS,
  fetchBytesWithRetry,
  fetchReadWithRetry,
  fetchWithRetry,
  isRetryableStatus,
  retryDelayMs,
} from './fetchRetry';

const ok = (body = 'ok'): Response => new Response(body, { status: 200 });
const status = (s: number): Response => new Response('', { status: s });

/** Fetch stub answering from a script; `calls` counts the requests. */
function scripted(steps: (Response | Error)[]): typeof fetch & { readonly calls: number } {
  let calls = 0;
  const f = async (): Promise<Response> => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls++;
    if (step instanceof Error) throw step;
    return step.clone();
  };
  Object.defineProperty(f, 'calls', { get: () => calls });
  return f as unknown as typeof fetch & { readonly calls: number };
}

/** Instant sleep that records the requested delays. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return { delays, sleep: (ms: number) => (delays.push(ms), Promise.resolve()) };
}

describe('retryDelayMs', () => {
  it('truncated exponential backoff plus jitter (geo.admin.ch: 1 s, 2 s, 4 s … + jitter)', () => {
    const noJitter = { random: () => 0 };
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n, noJitter))).toEqual([
      1000, 2000, 4000, 8000, 8000, 8000,
    ]);
    expect(retryDelayMs(1, { random: () => 0.5 })).toBe(1000 + RETRY_DEFAULTS.jitterMs / 2);
    expect(retryDelayMs(3, { baseDelayMs: 100, maxDelayMs: 300, jitterMs: 0 })).toBe(300);
  });

  it('retryable statuses: 408, 429, 5xx', () => {
    expect([408, 429, 500, 503, 599].every(isRetryableStatus)).toBe(true);
    expect([200, 204, 400, 403, 404, 410].some(isRetryableStatus)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('returns the first ok response after transient failures, waiting with backoff', async () => {
    const fetchImpl = scripted([new TypeError('Failed to fetch'), status(503), status(429), ok('done')]);
    const { sleep, delays } = recordingSleep();
    const res = await fetchWithRetry('https://x.test/a', { fetchImpl, sleep, random: () => 0 });
    expect(await res.text()).toBe('done');
    expect(fetchImpl.calls).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('does not retry permanent HTTP errors', async () => {
    const fetchImpl = scripted([status(404), ok()]);
    const { sleep, delays } = recordingSleep();
    const err = await fetchWithRetry('https://x.test/b', { fetchImpl, sleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetError);
    expect(err).toMatchObject({ kind: 'http', status: 404, attempts: 1, url: 'https://x.test/b' });
    expect(delays).toEqual([]);
  });

  it('gives up after the retries with the last error', async () => {
    const fetchImpl = scripted([status(500)]);
    const { sleep } = recordingSleep();
    await expect(fetchWithRetry('https://x.test/c', { fetchImpl, sleep, retries: 2 })).rejects.toMatchObject({
      kind: 'http',
      status: 500,
      attempts: 3,
    });
    const net = scripted([new TypeError('offline')]);
    await expect(
      fetchWithRetry('https://x.test/c', { fetchImpl: net, sleep, retries: 1 }),
    ).rejects.toMatchObject({
      kind: 'network',
      attempts: 2,
    });
  });

  it('stops at the deadline instead of starting a retry after it', async () => {
    let t = 0;
    const fetchImpl = scripted([status(503)]);
    const sleep = (ms: number): Promise<void> => {
      t += ms;
      return Promise.resolve();
    };
    const err = await fetchWithRetry('https://x.test/d', {
      fetchImpl,
      sleep,
      now: () => t,
      random: () => 0,
      retries: 10,
      deadlineMs: 5000,
    }).catch((e: unknown) => e);
    // Waits 1 s and 2 s (t = 3 s); the next retry (4 s) would end after the 5 s deadline.
    expect(err).toMatchObject({ kind: 'timeout', status: 503, attempts: 3 });
    expect(fetchImpl.calls).toBe(3);
  });

  it('aborts: before the first attempt, during a request and while waiting', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      fetchWithRetry('https://x.test/e', { signal: ctrl.signal, fetchImpl: scripted([ok()]) }),
    ).rejects.toMatchObject({
      kind: 'aborted',
    });

    const during = new AbortController();
    const rejecting = (async () => {
      during.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(
      fetchWithRetry('https://x.test/e', { signal: during.signal, fetchImpl: rejecting }),
    ).rejects.toMatchObject({
      kind: 'aborted',
    });

    vi.useFakeTimers();
    try {
      const waiting = new AbortController();
      const p = fetchWithRetry('https://x.test/e', {
        signal: waiting.signal,
        fetchImpl: scripted([status(503)]),
      });
      const settled = p.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10);
      waiting.abort();
      expect(await settled).toMatchObject({ kind: 'aborted' });
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A 200 response whose body delivers `first` and then fails like a dropped connection. */
function droppingBody(first: Uint8Array): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (!sent) {
        sent = true;
        ctrl.enqueue(first);
      } else {
        ctrl.error(new TypeError('network error'));
      }
    },
  });
  return new Response(body, { status: 200 });
}

/** A fetch whose requests never settle; with `honourSignal` they reject when their signal aborts. */
function stalled(honourSignal: boolean): typeof fetch & { readonly calls: number } {
  let calls = 0;
  const f = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls++;
    return new Promise((_resolve, reject) => {
      if (honourSignal) {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }
    });
  };
  Object.defineProperty(f, 'calls', { get: () => calls });
  return f as unknown as typeof fetch & { readonly calls: number };
}

describe('attempt time limit', () => {
  it('aborts a stalled attempt after attemptTimeoutMs and retries it; the last one fails as timeout', async () => {
    for (const honourSignal of [true, false]) {
      const fetchImpl = stalled(honourSignal);
      const { sleep, delays } = recordingSleep();
      const err = await fetchWithRetry('https://x.test/t', {
        fetchImpl,
        sleep,
        random: () => 0,
        retries: 2,
        attemptTimeoutMs: 20,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetError);
      expect(err).toMatchObject({ kind: 'timeout', attempts: 3 });
      expect(fetchImpl.calls).toBe(3);
      expect(delays).toEqual([1000, 2000]);
    }
  });

  it('a timed-out attempt followed by a good one succeeds', async () => {
    let calls = 0;
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      ++calls === 1 ? stalled(true)(_input, init) : Promise.resolve(ok('late'))) as typeof fetch;
    const { sleep } = recordingSleep();
    const bytes = await fetchBytesWithRetry('https://x.test/t', { fetchImpl, sleep, attemptTimeoutMs: 20 });
    expect(new TextDecoder().decode(bytes.bytes)).toBe('late');
    expect(calls).toBe(2);
  });

  it("the caller's abort during a stalled attempt is 'aborted', not a timeout, and is not retried", async () => {
    const fetchImpl = stalled(true);
    const ctrl = new AbortController();
    const p = fetchWithRetry('https://x.test/t', {
      fetchImpl,
      signal: ctrl.signal,
      attemptTimeoutMs: 60_000,
    });
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl.calls).toBe(1);
  });

  it('defaults: 15 s per attempt', () => {
    expect(RETRY_DEFAULTS.attemptTimeoutMs).toBe(15000);
  });
});

describe('fetchReadWithRetry / fetchBytesWithRetry', () => {
  it('retries a body that fails while downloading (network), as a failed request', async () => {
    const chunk = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(droppingBody(chunk))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5]) as BlobPart, { status: 200 }));
    const { sleep, delays } = recordingSleep();
    const r = await fetchBytesWithRetry('https://x.test/b', { fetchImpl, sleep, random: () => 0 });
    expect([...r.bytes]).toEqual([4, 5]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([1000]);

    const always = vi.fn<typeof fetch>(() => Promise.resolve(droppingBody(chunk)));
    await expect(
      fetchBytesWithRetry('https://x.test/b', { fetchImpl: always, sleep, retries: 2 }),
    ).rejects.toMatchObject({ kind: 'network', attempts: 3, message: 'network error' });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it('times the body too: a body that stalls after the headers is retried', async () => {
    const stallingBody = (): Response =>
      new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }), {
        status: 200,
      });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(stallingBody())
      .mockResolvedValueOnce(ok('body'));
    const { sleep } = recordingSleep();
    const text = await fetchReadWithRetry('https://x.test/s', (res) => res.text(), {
      fetchImpl,
      sleep,
      attemptTimeoutMs: 20,
    });
    expect(text).toBe('body');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('passes other errors of `read` (e.g. a parse error) through without retrying', async () => {
    const fetchImpl = scripted([ok('not json')]);
    const err = await fetchReadWithRetry('https://x.test/j', (res) => res.json(), { fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SyntaxError);
    expect(fetchImpl.calls).toBe(1);
  });

  it("fetchWithRetry: the caller's signal still aborts a body read after the headers", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
    const ctrl = new AbortController();
    const res = await fetchWithRetry('https://x.test/l', { fetchImpl, signal: ctrl.signal });
    const reading = res.arrayBuffer();
    ctrl.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });
});

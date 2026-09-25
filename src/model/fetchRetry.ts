// ─────────────────────────────────────────────
// HTTP WITH RETRIES (geo.admin.ch and other public services)
// Truncated exponential backoff with jitter, as geo.admin.ch asks for
// (https://docs.geo.admin.ch/get-started/retry.html): retry n waits min(base · 2^(n−1), maxDelay) + jitter,
// jitter uniform in [0, jitterMs); no retry starts after the deadline. Only transient failures are retried:
// network errors (fetch rejects with a TypeError), HTTP 408, 429 and 5xx. Aborts are never retried.
// fetchWithRetry throws a typed NetError; public loaders built on it catch it and return typed results
// (never throw to the UI).
// ─────────────────────────────────────────────

/** Why a request failed. */
export type NetErrorKind = 'aborted' | 'network' | 'http' | 'timeout';

/** Failure of fetchWithRetry. `status` is set for kind 'http'. */
export class NetError extends Error {
  readonly kind: NetErrorKind;
  readonly status: number | undefined;
  readonly url: string;
  /** Attempts made (1 = no retry). */
  readonly attempts: number;

  constructor(kind: NetErrorKind, url: string, message: string, attempts: number, status?: number) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
    this.url = url;
    this.attempts = attempts;
    this.status = status;
  }
}

export interface RetryOptions {
  signal?: AbortSignal;
  /** fetch implementation (tests); default globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Request options besides the signal (e.g. headers). */
  init?: Omit<RequestInit, 'signal'>;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** Delay before the first retry without jitter, ms. Default 1000 (geo.admin.ch example: 1 s, 2 s, 4 s …). */
  baseDelayMs?: number;
  /** Upper bound of the exponential part, ms. Default 8000 (interactive use). */
  maxDelayMs?: number;
  /** Jitter added to every delay: uniform in [0, jitterMs). Default 1000. */
  jitterMs?: number;
  /** No retry starts later than this after the first attempt, ms. Default 20000. */
  deadlineMs?: number;
  /** Random source in [0, 1) for the jitter (tests). */
  random?: () => number;
  /** Clock in ms (tests). */
  now?: () => number;
  /** Waits `ms`, rejecting when `signal` aborts (tests may resolve immediately). */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

/** Default retry parameters (see RetryOptions). */
export const RETRY_DEFAULTS = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitterMs: 1000,
  deadlineMs: 20000,
} as const;

/** HTTP statuses worth retrying: request timeout, rate limit, server errors. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Delay before retry `retry` (1-based), ms: min(base · 2^(retry−1), maxDelay) + jitter. */
export function retryDelayMs(retry: number, opts: RetryOptions = {}): number {
  const base = opts.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs;
  const max = opts.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs;
  const jitter = opts.jitterMs ?? RETRY_DEFAULTS.jitterMs;
  const random = opts.random ?? Math.random;
  return Math.min(base * 2 ** Math.max(0, retry - 1), max) + random() * jitter;
}

function abortReason(signal: AbortSignal | undefined): NetError | null {
  return signal?.aborted ? new NetError('aborted', '', 'The request was aborted.', 0) : null;
}

/** Resolves after `ms`; rejects with an 'aborted' NetError when `signal` aborts first. */
export function sleepWithSignal(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const early = abortReason(signal);
    if (early) {
      reject(early);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(id);
      reject(new NetError('aborted', '', 'The request was aborted.', 0));
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * GET (or `init`) `url` and resolve with the first ok response; transient failures are retried with truncated
 * exponential backoff and jitter. Throws a NetError: 'aborted' (signal), 'http' (non-retryable status, or the
 * last retryable one), 'network' (fetch rejected on every attempt) or 'timeout' (deadline reached before a
 * retry could start).
 */
export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const retries = Math.max(0, Math.floor(opts.retries ?? RETRY_DEFAULTS.retries));
  const deadline = opts.deadlineMs ?? RETRY_DEFAULTS.deadlineMs;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepWithSignal;
  const { signal } = opts;
  const started = now();
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new NetError('aborted', url, 'The request was aborted.', attempt - 1);
    let lastError: NetError;
    try {
      const res = await doFetch(url, { ...opts.init, signal });
      if (res.ok) return res;
      lastError = new NetError('http', url, `HTTP ${res.status} for ${url}`, attempt, res.status);
      if (!isRetryableStatus(res.status)) throw lastError;
    } catch (e) {
      if (e instanceof NetError) throw e;
      if (signal?.aborted) throw new NetError('aborted', url, 'The request was aborted.', attempt);
      lastError = new NetError('network', url, e instanceof Error ? e.message : String(e), attempt);
    }
    if (attempt > retries) throw lastError;
    const delay = retryDelayMs(attempt, opts);
    if (now() - started + delay > deadline) {
      throw new NetError(
        'timeout',
        url,
        `Gave up after ${attempt} attempts: ${lastError.message}`,
        attempt,
        lastError.status,
      );
    }
    try {
      await sleep(delay, signal);
    } catch {
      throw new NetError('aborted', url, 'The request was aborted.', attempt);
    }
  }
}

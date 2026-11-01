/** Small async helpers shared by the BLE transports and protocol code. */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

export class AbortedError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rejects if `promise` does not settle within `ms`. The underlying operation is not cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new AbortedError();
}

/**
 * Runs async jobs one at a time, in submission order.
 *
 * Web Bluetooth rejects a GATT operation with "operation already in progress" if another one
 * is still pending, and the Android stack silently drops overlapping requests, so every
 * read/write/subscribe goes through one of these per connection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** A promise whose resolve/reject live outside of it. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  readonly settled: boolean;
}

export function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (v) => {
      if (!settled) {
        settled = true;
        res(v);
      }
    };
    reject = (r) => {
      if (!settled) {
        settled = true;
        rej(r);
      }
    };
  });
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return settled;
    },
  };
}

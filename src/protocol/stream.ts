import { AbortedError, TimeoutError, type Deferred } from '../lib/async';

export interface StreamWaitOptions {
  done: Deferred<void>;
  signal?: AbortSignal;
  /** Epoch ms of the last packet received, or null if none yet. */
  lastActivity: () => number | null;
  /** How long to wait for the first packet. The stock firmware can take several seconds. */
  firstPacketTimeoutMs: number;
  /** How long a silence after the first packet means "the device stopped sending". */
  idleTimeoutMs: number;
  /** Called once if the first packet never arrives; return true to keep waiting (after a retry). */
  onFirstPacketTimeout?: () => Promise<boolean>;
  pollMs?: number;
}

export type StreamEnd = 'done' | 'idle';

/**
 * Waits for a notification stream to finish.
 *
 * Resolves 'done' when the protocol saw its end condition, or 'idle' after a silence following
 * at least one packet. Rejects on abort, or if nothing ever arrived.
 */
export function waitForStream(opts: StreamWaitOptions): Promise<StreamEnd> {
  const { done, signal, lastActivity, idleTimeoutMs, pollMs = 100 } = opts;
  let firstDeadline = Date.now() + opts.firstPacketTimeoutMs;
  let retried = false;
  let checking = false;

  return new Promise<StreamEnd>((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearInterval(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new AbortedError()));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    done.promise.then(() => finish(() => resolve('done')), (err) => finish(() => reject(err)));

    const timer = setInterval(async () => {
      if (checking || done.settled) return;
      const last = lastActivity();
      const now = Date.now();
      if (last !== null) {
        if (now - last > idleTimeoutMs) finish(() => resolve('idle'));
        return;
      }
      if (now <= firstDeadline) return;
      if (!retried && opts.onFirstPacketTimeout) {
        retried = true;
        checking = true;
        try {
          if (await opts.onFirstPacketTimeout()) {
            firstDeadline = Date.now() + opts.firstPacketTimeoutMs;
            return;
          }
        } catch (err) {
          return finish(() => reject(err));
        } finally {
          checking = false;
        }
      }
      finish(() => reject(new TimeoutError('Waiting for the device to send history', opts.firstPacketTimeoutMs)));
    }, pollMs);
  });
}

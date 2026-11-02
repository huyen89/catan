/** Classic token bucket: `capacity` burst, refilled at `perSecond` tokens per second. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Every socket event: 20/s sustained, bursts of 40 (ICE candidates arrive in bursts). */
export const messageBucket = () => new TokenBucket(40, 20);
/** Chat: 5 messages per 10 seconds. */
export const chatBucket = () => new TokenBucket(5, 0.5);
/** One bucket per key (e.g. userId), shared by every socket of that key. */
export class KeyedBuckets {
  private readonly buckets = new Map<string, { bucket: TokenBucket; last: number }>();

  constructor(
    private readonly make: () => TokenBucket,
    /** Buckets unused this long are forgotten (they would be full again by then). */
    private readonly idleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    if (this.buckets.size > 256) {
      for (const [k, v] of this.buckets) if (t - v.last > this.idleMs) this.buckets.delete(k);
    }
    let e = this.buckets.get(key);
    if (!e) this.buckets.set(key, (e = { bucket: this.make(), last: t }));
    e.last = t;
    return e.bucket.take();
  }
}

/**
 * room:create writes a DB row each time: per user, 3 burst then one every 5 seconds
 * (relaxed in TEST_MODE, where e2e runs create many rooms quickly).
 */
export const createBuckets = (testMode: boolean) =>
  testMode
    ? new KeyedBuckets(() => new TokenBucket(100, 50), 60_000)
    : new KeyedBuckets(() => new TokenBucket(3, 0.2), 60_000);

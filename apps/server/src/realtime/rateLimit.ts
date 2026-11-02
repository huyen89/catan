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
/** room:create writes a DB row each time: 3 burst, then one every 5 seconds. */
export const createBucket = () => new TokenBucket(3, 0.2);

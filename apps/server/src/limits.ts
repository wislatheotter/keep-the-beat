export class Bucket {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly capacity: number, private readonly perSecond: number) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    if (!this.can(cost)) return false;
    this.tokens -= cost;
    return true;
  }

  can(cost = 1): boolean {
    this.refill();
    return this.tokens >= cost;
  }

  get full() {
    this.refill();
    return this.tokens >= this.capacity;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
  }
}

export class KeyedBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly capacity: number, private readonly perSecond: number) {}

  take(key: string, cost = 1): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket(this.capacity, this.perSecond);
      this.buckets.set(key, bucket);
    }
    return bucket.take(cost);
  }

  can(key: string, cost = 1): boolean {
    return this.buckets.get(key)?.can(cost) ?? true;
  }

  prune() {
    for (const [key, bucket] of this.buckets) if (bucket.full) this.buckets.delete(key);
  }
}

export const LIMITS = {
  connectionsPerAddress: 100,
  connections: 1500,
  rooms: 250,
  messageBytes: 64 * 1024,
  idleMs: 60_000,
} as const;

export const connectRate = () => new KeyedBuckets(100, 1);
export const createRate = () => new KeyedBuckets(30, 0.2);
export const joinRate = () => new KeyedBuckets(100, 1);
export const missRate = () => new KeyedBuckets(30, 0.1);

export function socketBudget() {
  return {
    pose: new Bucket(90, 60),
    action: new Bucket(80, 40),
    ping: new Bucket(20, 4),
    room: new Bucket(10, 1),
    strikes: new Bucket(200, 10),
  };
}

export function clientAddress(forwardedFor: string | string[] | undefined, peer: string | undefined): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const last = header?.split(',').pop()?.trim();
  return last || peer || 'unknown';
}

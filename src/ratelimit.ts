/** Token bucket per client: allows short bursts up to `capacity`, refills steadily. */
export class RateLimiter {
  #buckets = new Map<string, { tokens: number; updatedAt: number }>();
  #capacity: number;
  #refillPerMs: number;

  constructor(capacity: number, refillPerSecond: number) {
    this.#capacity = capacity;
    this.#refillPerMs = refillPerSecond / 1000;
  }

  take(key: string, now = Date.now()): boolean {
    // Crude memory bound; a cleared bucket simply starts full again.
    if (this.#buckets.size > 50_000) this.#buckets.clear();

    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updatedAt: now };
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs);
    bucket.updatedAt = now;
    this.#buckets.set(key, bucket);

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

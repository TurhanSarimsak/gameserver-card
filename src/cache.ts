/**
 * TTL cache with request coalescing: if 500 READMEs request the same server at
 * once, only one query goes out and every caller awaits the same promise.
 * Map insertion order doubles as a cheap LRU for eviction.
 */
export class TtlCache<V> {
  #entries = new Map<string, { value: V; expiresAt: number }>();
  #inflight = new Map<string, Promise<V>>();
  #ttlMs: number;
  #maxEntries: number;

  constructor(ttlMs: number, maxEntries = 5000) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.#entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const pending = this.#inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        this.#set(key, value);
        return value;
      })
      .finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }

  #set(key: string, value: V) {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
    if (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }
}

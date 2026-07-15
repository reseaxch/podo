// In-memory response cache for checkout sessions.
//
// DEFECT (cache-growth scenario): entries are inserted but never evicted.
// There is no max-size bound and no TTL, so under sustained traffic the map
// grows without limit, driving heap usage up until the process OOMs and the
// endpoint starts returning HTTP 500.
//
// A correct implementation would bound the cache (max entries and/or a TTL).

export interface CacheEntry<T> {
  value: T
  storedAt: number
}

export class CheckoutCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  get(key: string): T | undefined {
    return this.entries.get(key)?.value
  }

  set(key: string, value: T): void {
    // No eviction, no TTL, no size cap — this is the defect under investigation.
    this.entries.set(key, { value, storedAt: Date.now() })
  }

  get size(): number {
    return this.entries.size
  }
}

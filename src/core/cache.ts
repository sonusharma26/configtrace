/** Bounded FIFO cache: constant-time hits and bounded metadata retention. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Cache capacity must be positive.');
  }
  get(key: K): V | undefined { return this.entries.get(key); }
  set(key: K, value: V): void {
    if (!this.entries.has(key) && this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, value);
  }
  get size(): number { return this.entries.size; }
}

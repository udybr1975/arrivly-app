/**
 * Run an async mapper over `items` with at most `limit` calls in flight at once.
 *
 * Caps in-flight work so total wall-clock ≈ ceil(N / limit) × slowest-item instead
 * of the sum of every item run end-to-end — this is what keeps a many-apartment cron
 * run inside the 60s function maxDuration rather than being killed mid-loop.
 *
 * Results are returned in INPUT ORDER (index-preserving), not completion order.
 *
 * `fn` is expected to handle its own errors and resolve. As a safety net a
 * thrown/rejected mapper is caught so it cannot abort sibling workers (that slot is
 * simply left empty) — but callers should keep their mappers TOTAL so every slot is
 * populated. Pure control-flow utility: no I/O, no env, no shared state.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const workers = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  async function run(): Promise<void> {
    // Each worker pulls the next index off the shared cursor until the list is
    // exhausted; at most `workers` of these run concurrently.
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch {
        // Safety net only — a rejected mapper is swallowed so other workers finish.
        // Call sites use total mappers, so this branch is not expected to hit.
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

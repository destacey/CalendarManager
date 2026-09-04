/**
 * Temporary timing instrumentation for the post-sync UI stall.
 *
 * A large sync left the window unresponsive for roughly 30 seconds. Static
 * analysis accounted for a few seconds of that — 8.2MB of unread `description`
 * crossing IPC (since fixed), and ~850ms of `dayjs.utc().tz()` conversions —
 * but not the rest, so this measures the real thing instead of guessing again.
 *
 * Deliberately crude: `performance.now()` around each stage, logged to the
 * console. It stays until the stall is explained, then comes out. It is not a
 * metrics system and should not grow into one.
 */

const enabled = true

/** Times a promise and logs how long it took. */
export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!enabled) return work()

  const started = performance.now()
  try {
    return await work()
  } finally {
    console.log(`[perf] ${label}: ${Math.round(performance.now() - started)}ms`)
  }
}

/** Times synchronous work and logs how long it took. */
export function timedSync<T>(label: string, work: () => T): T {
  if (!enabled) return work()

  const started = performance.now()
  try {
    return work()
  } finally {
    console.log(`[perf] ${label}: ${Math.round(performance.now() - started)}ms`)
  }
}

/**
 * Reports how long the main thread was blocked, by measuring how late a
 * zero-delay callback actually ran.
 *
 * This is the number that matters for "the UI froze": a stage can be fast on
 * paper while the thread is still wedged by React committing an enormous tree.
 * Anything over ~50ms is a visible jank; seconds means the window is dead.
 */
export function reportBlocking(label: string): void {
  if (!enabled) return

  const scheduled = performance.now()
  setTimeout(() => {
    const late = Math.round(performance.now() - scheduled)
    if (late > 50) {
      console.warn(`[perf] main thread blocked ${late}ms after ${label}`)
    } else {
      console.log(`[perf] main thread free ${late}ms after ${label}`)
    }
  }, 0)
}

/** Rough byte size of an IPC payload, to confirm what actually crossed. */
export function payloadSize(label: string, value: unknown): void {
  if (!enabled) return

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length
    console.log(`[perf] ${label} payload: ${(bytes / 1_048_576).toFixed(2)} MB`)
  } catch {
    // A payload we cannot stringify is not worth failing over.
  }
}

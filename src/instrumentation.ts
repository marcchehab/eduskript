/**
 * Next.js Instrumentation
 *
 * Runs once when the server starts. Used for initializing
 * server-side services like metrics collection.
 */

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMetricsFlush, stopMetricsFlush } = await import('@/lib/metrics')
    startMetricsFlush()

    // Final flush. Metrics are otherwise only written when some other query
    // already has a DB connection open (see maybeFlushOnDbActivity), so on a
    // quiet instance this is the write that saves the window. Not guaranteed
    // to complete: the SIGINT handler in src/lib/prisma.ts calls process.exit()
    // and can win the race.
    const flushOnShutdown = () => {
      void stopMetricsFlush()
    }
    process.once('SIGTERM', flushOnShutdown)
    process.once('SIGINT', flushOnShutdown)

    // Re-render the busiest URLs so the first real visitor after a deploy does
    // not pay for a cold ISR cache. Deliberately not awaited — startup must not
    // block on it — and delayed so the server is actually accepting requests
    // (the warmer calls back in over localhost).
    if (process.env.WARM_ON_BOOT !== '0') {
      setTimeout(() => {
        void import('@/lib/cache-warmer')
          .then(({ warmTopPaths }) => warmTopPaths())
          .catch(error => console.error('[Warmer] Failed to start:', error))
      }, 10_000).unref()
    }
  }
}

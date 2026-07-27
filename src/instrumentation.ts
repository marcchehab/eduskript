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

    // Best-effort final flush. The buffer already flushes every minute, so at
    // most the last <60s is at stake. Not guaranteed to complete: the SIGINT
    // handler in src/lib/prisma.ts calls process.exit() and can win the race.
    const flushOnShutdown = () => {
      void stopMetricsFlush()
    }
    process.once('SIGTERM', flushOnShutdown)
    process.once('SIGINT', flushOnShutdown)
  }
}

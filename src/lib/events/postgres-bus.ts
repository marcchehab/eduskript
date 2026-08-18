/**
 * PostgreSQL LISTEN/NOTIFY EventBus Implementation
 *
 * Uses PostgreSQL's built-in pub/sub mechanism to enable real-time events
 * across multiple server processes (fixes Turbopack worker isolation issue).
 *
 * How it works:
 * - publish() sends NOTIFY on a channel with JSON payload
 * - subscribe() uses a dedicated connection with LISTEN
 * - PostgreSQL broadcasts to all listening connections
 *
 * Reconnection:
 * Managed PostgreSQL services (Koyeb, etc.) periodically kill long-lived
 * connections for maintenance. We handle this with exponential backoff
 * (1s → 2s → 4s → ... → 30s max) and deduplicated reconnect attempts.
 *
 * The LISTEN connection is opened lazily, on the first subscribe(), and closed
 * again when the last subscriber goes away. This matters for cost, not just
 * tidiness: the managed Postgres bills compute-hours and only suspends when no
 * client is connected. Connecting eagerly in the constructor meant that the
 * first request to any of the ~13 routes importing this module (including
 * /api/user-data/sync, hit on every annotation save) pinned the database awake
 * until the next deploy — measured at 99.3% active time in July.
 *
 * publish() does not need the listener: NOTIFY goes through the pool, whose
 * idle clients disconnect after POOL_IDLE_TIMEOUT_MS.
 */

import pg from 'pg'
import type { EventBus, AppEvent } from './types'

const { Pool, Client } = pg

type Handler = (event: AppEvent) => void

// Channel prefix to avoid conflicts with other PostgreSQL NOTIFY users
const CHANNEL_PREFIX = 'eduskript_'

// Sanitize channel names for PostgreSQL (alphanumeric + underscore only)
// PostgreSQL channel names are limited to 63 characters (NAMEDATALEN - 1)
const MAX_CHANNEL_LENGTH = 63

// Reconnection parameters
const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

// How long a publish-only (NOTIFY) connection may sit idle in the pool before
// pg closes it. Kept short so a one-off publish cannot hold the database awake.
const POOL_IDLE_TIMEOUT_MS = 5_000

function sanitizeChannel(channel: string): string {
  const sanitized = CHANNEL_PREFIX + channel.replace(/[^a-zA-Z0-9]/g, '_')
  // Truncate to PostgreSQL's limit if necessary
  if (sanitized.length > MAX_CHANNEL_LENGTH) {
    return sanitized.substring(0, MAX_CHANNEL_LENGTH)
  }
  return sanitized
}

// Parse SSL config from DATABASE_URL or environment
function getSSLConfig(): boolean | { rejectUnauthorized: boolean } {
  const url = process.env.DATABASE_URL || ''
  // If sslmode is specified in URL, let pg handle it
  if (url.includes('sslmode=')) {
    return false // Let connection string handle SSL
  }
  // Enable SSL for production (non-localhost databases)
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
    return { rejectUnauthorized: false } // Accept self-signed certs
  }
  return false
}

class PostgresEventBus implements EventBus {
  private pool: pg.Pool
  private listenerClient: pg.Client | null = null
  private subscribers = new Map<string, Set<Handler>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryMs = INITIAL_RETRY_MS
  private isReconnecting = false
  // pg.Client (unlike Pool) has no protection against overlapping queries on
  // one connection — two concurrent subscribe() calls issuing unawaited
  // LISTEN queries on the same client can desync its query/response matching
  // and hang the connection forever (this is what pg's "client.query() when
  // already executing" deprecation warns about). Chaining every LISTEN/UNLISTEN
  // through this promise serializes them onto the single connection.
  private listenQueryChain: Promise<unknown> = Promise.resolve()

  private queueListenerQuery(sql: string): void {
    const client = this.listenerClient
    if (!client) return
    this.listenQueryChain = this.listenQueryChain
      .catch(() => {})
      .then(() => client.query(sql))
      .catch(err => console.error(`[PostgresEventBus] ${sql} failed:`, err))
  }

  constructor() {
    const sslConfig = getSSLConfig()
    // Create a pool for publishing (uses connection pooling)
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3, // Small pool just for NOTIFY commands
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      ...(sslConfig && { ssl: sslConfig }),
    })

    // No LISTEN connection yet — subscribe() opens one on demand. See the file
    // header: connecting here kept the database from ever suspending.
  }

  /**
   * Establish the dedicated LISTEN connection.
   * Serialized: only one connect attempt runs at a time.
   */
  private async connect(): Promise<void> {
    if (this.isReconnecting) return
    // Nothing to listen for — don't hold a connection open (see file header).
    if (this.subscribers.size === 0) return
    this.isReconnecting = true

    try {
      // Clean up any stale client before creating a new one
      if (this.listenerClient) {
        this.listenerClient.removeAllListeners()
        this.listenerClient.end().catch(() => {})
        this.listenerClient = null
      }

      const sslConfig = getSSLConfig()
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
        // A query that never gets a response (e.g. a desynced connection)
        // must error out and trigger reconnect, not hang forever — this
        // client has no Pool-level protection against that.
        query_timeout: 10_000,
        ...(sslConfig && { ssl: sslConfig }),
      })

      await client.connect()

      // Connection succeeded — reset backoff
      this.retryMs = INITIAL_RETRY_MS
      this.listenerClient = client
      // A stuck query on the previous client must not block LISTEN calls on
      // this fresh connection.
      this.listenQueryChain = Promise.resolve()

      // Handle incoming notifications
      client.on('notification', (msg) => {
        if (!msg.channel.startsWith(CHANNEL_PREFIX)) return

        try {
          const event = JSON.parse(msg.payload || '{}') as AppEvent

          for (const [subscribedChannel, handlers] of this.subscribers) {
            const sanitized = sanitizeChannel(subscribedChannel)
            if (sanitized === msg.channel) {
              handlers.forEach(handler => {
                try {
                  handler(event)
                } catch (error) {
                  console.error(`[PostgresEventBus] Handler error for ${subscribedChannel}:`, error)
                }
              })
            }
          }
        } catch (error) {
          console.error('[PostgresEventBus] Failed to parse notification:', error)
        }
      })

      // Both 'error' and 'end' feed into the same reconnect path.
      // The error handler fires first (with the PG error), then 'end' fires.
      // We only schedule one reconnect via scheduleReconnect().
      // Only reconnect while something is actually listening — otherwise a
      // closed connection would be reopened forever and hold the DB awake.
      client.on('error', () => {
        // Connection lost — will reconnect via 'end' or scheduleReconnect
        this.listenerClient = null
        if (this.subscribers.size > 0) this.scheduleReconnect()
      })

      client.on('end', () => {
        this.listenerClient = null
        if (this.subscribers.size > 0) this.scheduleReconnect()
      })

      // Re-subscribe to all active channels on this new connection
      for (const channel of this.subscribers.keys()) {
        const pgChannel = sanitizeChannel(channel)
        await client.query(`LISTEN ${pgChannel}`)
      }

      if (this.retryMs > INITIAL_RETRY_MS) {
        // Only log if we recovered from a previous failure
        console.log('[PostgresEventBus] Listener connection restored')
      }
    } catch (error) {
      this.listenerClient = null
      console.warn(`[PostgresEventBus] Connection failed, retrying in ${this.retryMs}ms`)
      this.scheduleReconnect()
    } finally {
      this.isReconnecting = false
    }
  }

  /**
   * Schedule a reconnect with exponential backoff.
   * Deduplicates: only one pending timer at a time.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return // Already scheduled
    if (this.subscribers.size === 0) return // Nobody listening

    const delay = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  async publish(channel: string, event: AppEvent): Promise<void> {
    const pgChannel = sanitizeChannel(channel)
    const payload = JSON.stringify(event)

    try {
      // Use pool for publishing (connection reuse)
      await this.pool.query(`SELECT pg_notify($1, $2)`, [pgChannel, payload])
    } catch (error) {
      console.error(`[PostgresEventBus] Failed to publish to ${channel}:`, error)
      throw error
    }
  }

  subscribe(channel: string, handler: Handler): () => void {
    const pgChannel = sanitizeChannel(channel)

    // Add to local subscribers map
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set())
    }
    this.subscribers.get(channel)!.add(handler)

    // Start LISTEN on the channel if we have a connection
    if (this.listenerClient) {
      this.queueListenerQuery(`LISTEN ${pgChannel}`)
    } else {
      // First subscriber (or reconnecting) — connect() re-LISTENs every
      // channel in `subscribers`, which now includes this one.
      void this.connect()
    }

    // Return unsubscribe function
    return () => {
      this.subscribers.get(channel)?.delete(handler)

      // If no more handlers for this channel, UNLISTEN
      if (this.subscribers.get(channel)?.size === 0) {
        this.subscribers.delete(channel)

        if (this.listenerClient) {
          this.queueListenerQuery(`UNLISTEN ${pgChannel}`)
        }
      }

      // Nobody left listening: drop the connection so the managed Postgres can
      // suspend. The next subscribe() opens a fresh one.
      if (this.subscribers.size === 0) {
        this.disconnectListener()
      }
    }
  }

  /**
   * Close the LISTEN connection and cancel any pending reconnect.
   * Safe to call when already disconnected.
   */
  private disconnectListener(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const client = this.listenerClient
    if (!client) return

    // Null it first so the 'end' handler sees no client and, with no
    // subscribers left, does not schedule a reconnect.
    this.listenerClient = null
    client.removeAllListeners()
    client.end().catch(() => {
      // Closing a already-broken connection is not an error worth surfacing.
    })
  }

  /**
   * Get number of subscribers for a channel (for debugging/metrics)
   */
  getSubscriberCount(channel: string): number {
    return this.subscribers.get(channel)?.size ?? 0
  }

  /**
   * Get all active channels (for debugging/metrics)
   */
  getActiveChannels(): string[] {
    return Array.from(this.subscribers.keys())
  }

  /**
   * Cleanup connections (for graceful shutdown)
   */
  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.listenerClient) {
      this.listenerClient.removeAllListeners()
      await this.listenerClient.end()
      this.listenerClient = null
    }
    await this.pool.end()
  }
}

// Singleton instance
export const postgresEventBus = new PostgresEventBus()

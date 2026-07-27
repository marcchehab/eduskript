/**
 * The LISTEN connection must exist only while something is subscribed.
 *
 * The managed Postgres bills compute-hours and suspends only when no client is
 * connected, so an always-open listener pinned it awake 24/7 (99.3% active in
 * July 2026). These tests lock the lazy-connect / disconnect-when-empty
 * behaviour in place.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const clients: Array<{ connect: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; ended: boolean }> = []
const poolQuery = vi.fn(() => Promise.resolve({ rows: [] }))
const poolConfig: Record<string, unknown>[] = []

vi.mock('pg', () => {
  class FakeClient {
    ended = false
    connect = vi.fn(() => Promise.resolve())
    query = vi.fn(() => Promise.resolve({ rows: [] }))
    end = vi.fn(() => { this.ended = true; return Promise.resolve() })
    on = vi.fn()
    removeAllListeners = vi.fn()
    constructor() { clients.push(this as never) }
  }
  class FakePool {
    constructor(config: Record<string, unknown>) { poolConfig.push(config) }
    query = poolQuery
    end = vi.fn(() => Promise.resolve())
  }
  return { default: { Pool: FakePool, Client: FakeClient } }
})

async function freshBus() {
  vi.resetModules()
  clients.length = 0
  poolConfig.length = 0
  const mod = await import('@/lib/events/postgres-bus')
  return mod.postgresEventBus
}

beforeEach(() => {
  poolQuery.mockClear()
})

describe('PostgresEventBus connection lifecycle', () => {
  it('opens no connection until something subscribes', async () => {
    await freshBus()
    expect(clients).toHaveLength(0)
  })

  it('connects on first subscribe and disconnects when the last one leaves', async () => {
    const bus = await freshBus()

    const unsubscribe = bus.subscribe('page:abc', () => {})
    await vi.waitFor(() => expect(clients).toHaveLength(1))
    expect(clients[0].connect).toHaveBeenCalled()

    unsubscribe()
    await vi.waitFor(() => expect(clients[0].end).toHaveBeenCalled())
  })

  it('keeps the connection while other subscribers remain', async () => {
    const bus = await freshBus()

    const first = bus.subscribe('page:abc', () => {})
    const second = bus.subscribe('page:def', () => {})
    await vi.waitFor(() => expect(clients).toHaveLength(1))

    first()
    expect(clients[0].end).not.toHaveBeenCalled()

    second()
    await vi.waitFor(() => expect(clients[0].end).toHaveBeenCalled())
  })

  it('publishes without opening a listener connection', async () => {
    const bus = await freshBus()

    await bus.publish('page:abc', { type: 'class-invitation', classId: 'c1', className: 'X' } as never)

    expect(poolQuery).toHaveBeenCalled()
    expect(clients).toHaveLength(0)
  })

  it('bounds how long an idle publish connection lingers', async () => {
    await freshBus()
    expect(poolConfig[0]?.idleTimeoutMillis).toBeGreaterThan(0)
  })
})

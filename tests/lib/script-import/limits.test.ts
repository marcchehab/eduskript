import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ count: vi.fn(), aggregate: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { scriptImport: { count: mocks.count, aggregate: mocks.aggregate } },
}))

import { checkLimits, PER_IP_PER_DAY } from '@/lib/script-import/limits'

describe('checkLimits', () => {
  beforeEach(() => {
    mocks.count.mockReset()
    mocks.aggregate.mockReset().mockResolvedValue({ _sum: { costUsd: 0 } })
  })

  it('caps anonymous uploads per IP', async () => {
    mocks.count.mockResolvedValue(PER_IP_PER_DAY)
    expect(await checkLimits('ip')).toMatch(/documents per day/)
  })

  it('skips the per-IP cap for signed-in teachers, without querying it', async () => {
    mocks.count.mockResolvedValue(0) // global count
    expect(await checkLimits('ip', { skipPerIp: true })).toBeNull()
    expect(mocks.count).toHaveBeenCalledTimes(1)
    expect(mocks.count.mock.calls[0][0].where.ipHash).toBeUndefined()
  })

  it('keeps the global cap and budget for signed-in teachers', async () => {
    mocks.count.mockResolvedValue(10_000)
    expect(await checkLimits('ip', { skipPerIp: true })).toMatch(/Too many imports/)
    mocks.count.mockResolvedValue(0)
    mocks.aggregate.mockResolvedValue({ _sum: { costUsd: 1_000 } })
    expect(await checkLimits('ip', { skipPerIp: true })).toMatch(/Too many imports/)
  })
})

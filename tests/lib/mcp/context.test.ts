import { describe, it, expect } from 'vitest'
import {
  getMcpContext,
  hasScope,
  requireScope,
  runWithMcpContext,
  tryGetMcpContext,
} from '@/lib/mcp/context'

const ctx = {
  userId: 'u1',
  clientId: 'mcp_x',
  scopes: ['content:read', 'content:write'],
  tokenId: 't1',
}

describe('McpContext (AsyncLocalStorage)', () => {
  it('throws when getMcpContext() is called outside runWithMcpContext', () => {
    expect(() => getMcpContext()).toThrow(/MCP context not available/)
  })

  it('returns the active context inside runWithMcpContext', async () => {
    await runWithMcpContext(ctx, async () => {
      expect(getMcpContext()).toEqual(ctx)
    })
  })

  it('propagates context through awaited async work (nested calls)', async () => {
    await runWithMcpContext(ctx, async () => {
      async function inner() {
        await new Promise((r) => setTimeout(r, 1))
        return getMcpContext().userId
      }
      expect(await inner()).toBe('u1')
    })
  })

  it('isolates concurrent contexts', async () => {
    const a = runWithMcpContext({ ...ctx, userId: 'a' }, async () => {
      await new Promise((r) => setTimeout(r, 5))
      return getMcpContext().userId
    })
    const b = runWithMcpContext({ ...ctx, userId: 'b' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return getMcpContext().userId
    })
    const [aRes, bRes] = await Promise.all([a, b])
    expect(aRes).toBe('a')
    expect(bRes).toBe('b')
  })

  it('hasScope / requireScope reflect the current context', async () => {
    await runWithMcpContext(ctx, async () => {
      expect(hasScope('content:read')).toBe(true)
      expect(hasScope('content:delete')).toBe(false)
      expect(() => requireScope('content:delete')).toThrow(/Missing required scope/)
    })
    expect(tryGetMcpContext()).toBeUndefined()
  })
})

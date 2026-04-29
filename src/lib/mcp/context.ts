/**
 * Per-request MCP context (userId / scopes / clientId), accessible from any
 * tool handler without threading the data through every function.
 *
 * The transport route validates the bearer token, builds an `McpContext`, and
 * wraps the handler invocation in `runWithMcpContext`. Tool handlers call
 * `getMcpContext()` to read the current actor — same pattern Node's
 * `AsyncLocalStorage` is designed for.
 */

import { AsyncLocalStorage } from 'async_hooks'

export interface McpContext {
  userId: string
  clientId: string
  /** Display name registered via DCR — e.g. "Claude", "Cursor", "Claude Code". */
  clientName: string
  scopes: string[]
  tokenId: string
}

const storage = new AsyncLocalStorage<McpContext>()

export function runWithMcpContext<T>(ctx: McpContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(ctx, fn)
}

export function getMcpContext(): McpContext {
  const ctx = storage.getStore()
  if (!ctx) {
    throw new Error(
      'MCP context not available — getMcpContext() called outside runWithMcpContext()'
    )
  }
  return ctx
}

export function tryGetMcpContext(): McpContext | undefined {
  return storage.getStore()
}

export function hasScope(scope: string): boolean {
  const ctx = tryGetMcpContext()
  return !!ctx && ctx.scopes.includes(scope)
}

export function requireScope(scope: string): void {
  if (!hasScope(scope)) {
    throw new Error(`Missing required scope: ${scope}`)
  }
}

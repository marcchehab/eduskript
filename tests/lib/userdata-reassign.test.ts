import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock the Dexie `db` export in `@/lib/userdata/schema` so we can assert
// the exact mutation contract of `reassignVersionHistory` without spinning
// up a real IndexedDB. The contract under test:
//
// 1. Every row matched by [userId+pageId+fromComponentId] has its
//    componentId rewritten to toComponentId via .update(id, { componentId }).
// 2. No other field on the row is touched.
// 3. versionBlobs is never accessed (refCounts are not affected).
// 4. Everything happens inside a Dexie transaction.

// vi.mock factories are hoisted; vi.hoisted lets us share refs with them.
const mocks = vi.hoisted(() => {
  const mockUpdate = vi.fn(async () => 1)
  const mockToArray = vi.fn()
  const mockEquals = vi.fn(() => ({ toArray: mockToArray }))
  const mockWhere = vi.fn(() => ({ equals: mockEquals }))
  const mockTransaction = vi.fn(async (_mode: string, _table: unknown, fn: () => Promise<number>) => fn())
  const mockBlobsGet = vi.fn()
  const mockBlobsPut = vi.fn()
  const mockBlobsUpdate = vi.fn()
  const mockBlobsDelete = vi.fn()
  return {
    mockUpdate, mockToArray, mockEquals, mockWhere, mockTransaction,
    mockBlobsGet, mockBlobsPut, mockBlobsUpdate, mockBlobsDelete,
  }
})

vi.mock('@/lib/userdata/schema', () => ({
  db: {
    userData_history: {
      where: mocks.mockWhere,
      update: mocks.mockUpdate,
    },
    versionBlobs: {
      get: mocks.mockBlobsGet,
      put: mocks.mockBlobsPut,
      update: mocks.mockBlobsUpdate,
      delete: mocks.mockBlobsDelete,
    },
    transaction: mocks.mockTransaction,
  },
}))

const {
  mockUpdate, mockToArray, mockEquals, mockWhere, mockTransaction,
  mockBlobsGet, mockBlobsPut, mockBlobsUpdate, mockBlobsDelete,
} = mocks

// Stub the provider's currentUserId. The userDataService is a singleton and
// reads `currentUserId` from a setter the provider calls on session change.
// For this test we just need a stable string that matches the seeded rows.
import { userDataService } from '@/lib/userdata/userDataService'

beforeEach(() => {
  vi.clearAllMocks()
  // The service exposes a setter through its provider; reach in directly
  // with a typed cast. 'test-user' is what we seed rows with below.
  ;(userDataService as unknown as { currentUserId: string }).currentUserId = 'test-user'
})

describe('userDataService.reassignVersionHistory', () => {
  it('rewrites componentId on every matched row and leaves blobs alone', async () => {
    const seedRows = [
      { id: 1, userId: 'test-user', pageId: 'p1', componentId: 'code-editor-old', versionNumber: 1, dataHash: 'h1', blobId: 'b1', createdAt: 1000, sizeBytes: 10 },
      { id: 2, userId: 'test-user', pageId: 'p1', componentId: 'code-editor-old', versionNumber: 2, dataHash: 'h2', blobId: 'b2', createdAt: 2000, sizeBytes: 20 },
      { id: 3, userId: 'test-user', pageId: 'p1', componentId: 'code-editor-old', versionNumber: 3, dataHash: 'h3', blobId: 'b3', createdAt: 3000, sizeBytes: 30 },
    ]
    mockToArray.mockResolvedValueOnce(seedRows)

    const moved = await userDataService.reassignVersionHistory('p1', 'code-editor-old', 'code-editor-new')

    expect(moved).toBe(3)
    // Selected the right slice of the index.
    expect(mockWhere).toHaveBeenCalledWith('[userId+pageId+componentId]')
    expect(mockEquals).toHaveBeenCalledWith(['test-user', 'p1', 'code-editor-old'])
    // Updated each row by id with ONLY componentId — nothing else is touched.
    expect(mockUpdate).toHaveBeenCalledTimes(3)
    expect(mockUpdate).toHaveBeenNthCalledWith(1, 1, { componentId: 'code-editor-new' })
    expect(mockUpdate).toHaveBeenNthCalledWith(2, 2, { componentId: 'code-editor-new' })
    expect(mockUpdate).toHaveBeenNthCalledWith(3, 3, { componentId: 'code-editor-new' })
    // Blobs are untouched.
    expect(mockBlobsGet).not.toHaveBeenCalled()
    expect(mockBlobsPut).not.toHaveBeenCalled()
    expect(mockBlobsUpdate).not.toHaveBeenCalled()
    expect(mockBlobsDelete).not.toHaveBeenCalled()
    // The whole batch ran inside one transaction in 'rw' mode.
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.calls[0][0]).toBe('rw')
  })

  it('returns 0 and writes nothing when no rows match', async () => {
    mockToArray.mockResolvedValueOnce([])

    const moved = await userDataService.reassignVersionHistory('p1', 'code-editor-missing', 'code-editor-new')

    expect(moved).toBe(0)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockBlobsGet).not.toHaveBeenCalled()
  })

  it('skips rows lacking an auto-increment id without throwing', async () => {
    const seedRows = [
      { id: 1, userId: 'test-user', pageId: 'p1', componentId: 'code-editor-old', versionNumber: 1, dataHash: 'h1', blobId: 'b1', createdAt: 1000, sizeBytes: 10 },
      { /* id missing */ userId: 'test-user', pageId: 'p1', componentId: 'code-editor-old', versionNumber: 2, dataHash: 'h2', blobId: 'b2', createdAt: 2000, sizeBytes: 20 },
    ]
    mockToArray.mockResolvedValueOnce(seedRows)

    const moved = await userDataService.reassignVersionHistory('p1', 'code-editor-old', 'code-editor-new')

    // Reports the input length (rows scanned), but only updates rows with ids.
    expect(moved).toBe(2)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(1, { componentId: 'code-editor-new' })
  })
})

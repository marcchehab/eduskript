import { describe, it, expect } from 'vitest'
import { isReturnedFromLatest, returnedLockResponse, RETURN_EVENTS } from '@/lib/scoring/return-state'

describe('isReturnedFromLatest', () => {
  it('is returned only when the latest return-relevant event is a return', () => {
    expect(isReturnedFromLatest('return')).toBe(true)
  })

  it('a take_back un-returns', () => {
    expect(isReturnedFromLatest('take_back')).toBe(false)
  })

  it('a reopen un-returns (reopen appends a reopened event)', () => {
    expect(isReturnedFromLatest('reopened')).toBe(false)
  })

  it('no return-relevant event yet → not returned', () => {
    expect(isReturnedFromLatest(null)).toBe(false)
    expect(isReturnedFromLatest(undefined)).toBe(false)
  })

  it('only the three return-relevant events are considered', () => {
    // started/submitted are filtered out by the query, so the latest of the
    // RELEVANT set decides — these three are exactly that set.
    expect(RETURN_EVENTS).toEqual(['return', 'take_back', 'reopened'])
  })
})

describe('returnedLockResponse', () => {
  it('blocks per-student edits with 409 + machine code', async () => {
    const res = returnedLockResponse('student')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('EXAM_RETURNED_LOCKED')
    expect(body.error).toMatch(/take it back/i)
  })

  it('blocks exam-level (rubric) edits with the same code', async () => {
    const res = returnedLockResponse('exam')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('EXAM_RETURNED_LOCKED')
    expect(body.error).toMatch(/rubric/i)
  })
})

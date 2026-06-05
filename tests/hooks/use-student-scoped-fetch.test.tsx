import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStudentScopedFetch } from '@/hooks/use-student-scoped-fetch'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useStudentScopedFetch — airtight student isolation', () => {
  it('withholds data until the matching fetch resolves, then surfaces it', async () => {
    const d = deferred<string>()
    const { result } = renderHook(({ id }) => useStudentScopedFetch(id, [], () => d.promise), {
      initialProps: { id: 'A' },
    })
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)

    d.resolve('dataA')
    await waitFor(() => expect(result.current.data).toBe('dataA'))
    expect(result.current.loadedStudentId).toBe('A')
    expect(result.current.isLoading).toBe(false)
  })

  it('discards an OUT-OF-ORDER response for a previously-selected student', async () => {
    const a = deferred<string>()
    const b = deferred<string>()
    const fetcher = (id: string) => (id === 'A' ? a.promise : b.promise)
    const { result, rerender } = renderHook(({ id }) => useStudentScopedFetch(id, [], fetcher), {
      initialProps: { id: 'A' },
    })
    // Switch to B while A is still in flight.
    rerender({ id: 'B' })
    // B (current) resolves first.
    b.resolve('dataB')
    await waitFor(() => expect(result.current.data).toBe('dataB'))
    // A (previous student) resolves LATE — must be discarded, never shown.
    a.resolve('dataA')
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.data).toBe('dataB')
    expect(result.current.loadedStudentId).toBe('B')
  })

  it('returns null (loading) the instant a new student is selected, before their data lands', async () => {
    const a = deferred<string>()
    const b = deferred<string>()
    const fetcher = (id: string) => (id === 'A' ? a.promise : b.promise)
    const { result, rerender } = renderHook(({ id }) => useStudentScopedFetch(id, [], fetcher), {
      initialProps: { id: 'A' },
    })
    a.resolve('dataA')
    await waitFor(() => expect(result.current.data).toBe('dataA'))

    rerender({ id: 'B' }) // switched — A's data must NOT show under B
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)

    b.resolve('dataB')
    await waitFor(() => expect(result.current.data).toBe('dataB'))
  })

  it('null studentId → no data, not loading', () => {
    const { result } = renderHook(() => useStudentScopedFetch(null, [], () => Promise.resolve('x')))
    expect(result.current.data).toBeNull()
    expect(result.current.loadedStudentId).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('surfaces an error only for the current student', async () => {
    const d = deferred<string>()
    const { result } = renderHook(({ id }) => useStudentScopedFetch(id, [], () => d.promise), {
      initialProps: { id: 'A' },
    })
    d.reject(new Error('boom'))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.data).toBeNull()
  })
})

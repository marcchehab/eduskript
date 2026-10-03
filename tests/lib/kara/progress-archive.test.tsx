/**
 * Kara archive: progress.ts saves the winning code of `archive: true` levels;
 * <kara-archive> shows it, or the author's fallback when nothing is saved.
 * userDataService is replaced by an in-memory store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const store = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/userdata', () => ({
  userDataService: {
    get: async (page: string, key: string) => {
      const data = store.get(`${page}:${key}`)
      return data === undefined ? null : { data }
    },
    save: async (page: string, key: string, data: unknown) => {
      await new Promise(r => setTimeout(r, 5)) // slow write: concurrent merges must not lose data
      store.set(`${page}:${key}`, JSON.parse(JSON.stringify(data)))
    },
    subscribe: () => () => {},
  },
}))
vi.mock('@/lib/userdata/provider', () => ({ useUserDataContext: () => ({ isDbReady: true }) }))

import { recordKaraResult, loadKaraArchive, loadKaraProgress } from '@/lib/kara/progress'
import { KaraArchive, karaArchiveFallback, KARA_ARCHIVE_TITLE } from '@/components/markdown/kara-archive'

beforeEach(() => store.clear())

describe('progress archive', () => {
  it('saves the code only on a win, and the latest win replaces it', async () => {
    await recordKaraResult('sk', 'w5-l3', 0, [], 'while True:\n    move()')
    expect(await loadKaraArchive('sk', 'w5-l3')).toBeNull()
    await recordKaraResult('sk', 'w5-l3', 2, [], 'v1')
    expect((await loadKaraArchive('sk', 'w5-l3'))?.code).toBe('v1')
    await recordKaraResult('sk', 'w5-l3', 1, [], 'v2')
    const p = await loadKaraProgress('sk')
    expect(p.archive?.['w5-l3'].code).toBe('v2')
    expect(p.levels['w5-l3']).toBe(2) // stars never go down
  })

  it('a level without archiveCode keeps the other archives', async () => {
    await recordKaraResult('sk', 'w5-l3', 3, [], 'mine')
    await recordKaraResult('sk', 'w1-l1', 3, [])
    expect((await loadKaraArchive('sk', 'w5-l3'))?.code).toBe('mine')
    expect(await loadKaraArchive('sk', 'w1-l1')).toBeNull()
  })

  it('concurrent writes are merged, not lost', async () => {
    await Promise.all([
      recordKaraResult('sk', 'w5-l3', 0, [{ id: 'chip-1', title: 'Chip', text: 'x' }]),
      recordKaraResult('sk', 'w5-l3', 3, [], 'code'),
    ])
    const p = await loadKaraProgress('sk')
    expect(p.evidence['chip-1']).toBeDefined()
    expect(p.archive?.['w5-l3'].code).toBe('code')
  })
})

describe('karaArchiveFallback', () => {
  it('unwraps a literal fence, turns \\n escapes into newlines, trims', () => {
    expect(karaArchiveFallback('\n```python\nwhile not on_target():\n    move()\n```\n')).toBe('while not on_target():\n    move()')
    expect(karaArchiveFallback('while True:\\n    move()')).toBe('while True:\n    move()')
    expect(karaArchiveFallback(undefined)).toBe('')
  })
})

describe('<KaraArchive>', () => {
  it('shows the fallback when nothing is saved', async () => {
    render(<KaraArchive skriptId="sk" of="w5-l3" fallback={'while not on_target():\n    move()'} />)
    await waitFor(() => expect(screen.getByText('source: reference copy')).toBeTruthy())
    expect(screen.getByText(KARA_ARCHIVE_TITLE)).toBeTruthy()
    expect(screen.getByText('while not on_target():')).toBeTruthy()
  })

  it('shows the saved code instead of the fallback', async () => {
    await recordKaraResult('sk', 'w5-l3', 3, [], 'mein_code()')
    render(<KaraArchive skriptId="sk" of="w5-l3" title="Archiv" fallback="fallback()" />)
    await waitFor(() => expect(screen.getByText('mein_code()')).toBeTruthy())
    expect(screen.queryByText('fallback()')).toBeNull()
    expect(screen.getByText(/source: your program/)).toBeTruthy()
  })

  it('without a skript (preview) shows the fallback right away', () => {
    render(<KaraArchive of="w5-l3" fallback="x = 1" />)
    expect(screen.getByText('x = 1')).toBeTruthy()
  })
})

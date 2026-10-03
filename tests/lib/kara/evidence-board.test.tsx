/**
 * <evidence-board>: shows the page's clue definitions, found = saved id;
 * `levels="w1-"` filters by level-id prefix. userDataService is an in-memory
 * store (same mock as progress-archive.test.tsx).
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
      store.set(`${page}:${key}`, JSON.parse(JSON.stringify(data)))
    },
    subscribe: () => () => {},
  },
}))
vi.mock('@/lib/userdata/provider', () => ({ useUserDataContext: () => ({ isDbReady: true }) }))

import { recordKaraResult } from '@/lib/kara/progress'
import { EvidenceBoard } from '@/components/markdown/evidence-board'
import type { KaraPageClue } from '@/lib/kara/world'

// Definitions on the page. The saved copies below carry older text on purpose.
const CLUES: KaraPageClue[] = [
  { id: 'dienstplan', title: 'Dienstplan', text: 'Party um 20 Uhr', level: 'w1-l5', kind: 'chip', section: 'Level 5' },
  { id: 'w1-l4-log-0', title: 'Log', text: 'Schleuse offen', level: 'w1-l4', kind: 'log', section: 'Level 4: Treppenhaus' },
  { id: 'laborbuch', title: 'Laborbuch', text: 'Gerald', level: 'w2-l4', kind: 'chip' },
  { id: 'spam', title: 'Spam', text: 'x', level: 'w10-l1', kind: 'chip' },
]

beforeEach(async () => {
  store.clear()
  await recordKaraResult('sk', 'w1-l5', 3, [{ id: 'dienstplan', title: 'Dienstplan alt', text: 'alter Text' }])
  await recordKaraResult('sk', 'w2-l4', 3, [{ id: 'laborbuch', title: 'Laborbuch', text: 'Gerald' }])
  await recordKaraResult('sk', 'w10-l1', 3, [{ id: 'spam', title: 'Spam', text: 'x' }])
})

describe('EvidenceBoard', () => {
  it('shows the definitions, not the saved copies, and placeholders for unfound clues', async () => {
    render(<EvidenceBoard skriptId="sk" clues={CLUES} />)
    await waitFor(() => expect(screen.getByText('Party um 20 Uhr')).toBeTruthy())
    expect(screen.queryByText('alter Text')).toBeNull()
    expect(screen.getByText('in Level 4: Treppenhaus')).toBeTruthy()
    expect(screen.getByText('3 of 4 clues found · 3 levels solved')).toBeTruthy()
  })

  it('never shows saved evidence that no level on the page defines', async () => {
    await recordKaraResult('sk', 'w1-l9', 1, [{ id: 'ghost', title: 'Ghost', text: 'gone' }])
    render(<EvidenceBoard skriptId="sk" clues={CLUES} />)
    await waitFor(() => expect(screen.getByText('Laborbuch')).toBeTruthy())
    expect(screen.queryByText('Ghost')).toBeNull()
  })

  it('filters by level-id prefix (w1- does not match w10-)', async () => {
    render(<EvidenceBoard skriptId="sk" clues={CLUES} levels="w1-" />)
    await waitFor(() => expect(screen.getByText('Dienstplan')).toBeTruthy())
    expect(screen.queryByText('Laborbuch')).toBeNull()
    expect(screen.queryByText('Spam')).toBeNull()
    expect(screen.getByText('1 of 2 clues found · 1 level solved')).toBeTruthy()
  })

  it('accepts several prefixes', async () => {
    render(<EvidenceBoard skriptId="sk" clues={CLUES} levels="w1-, w2-" />)
    await waitFor(() => expect(screen.getByText('Laborbuch')).toBeTruthy())
    expect(screen.queryByText('Spam')).toBeNull()
  })
})

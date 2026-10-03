/**
 * <evidence-board levels="w1-">: only evidence from matching level ids, so an
 * early page does not spoil what was found later. userDataService is an
 * in-memory store (same mock as progress-archive.test.tsx).
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

beforeEach(async () => {
  store.clear()
  await recordKaraResult('sk', 'w1-l5', 3, [{ id: 'dienstplan', title: 'Dienstplan', text: 'Party' }])
  await recordKaraResult('sk', 'w2-l4', 3, [{ id: 'laborbuch', title: 'Laborbuch', text: 'Gerald' }])
  await recordKaraResult('sk', 'w10-l1', 3, [{ id: 'spam', title: 'Spam', text: 'x' }])
})

describe('EvidenceBoard levels filter', () => {
  it('shows everything without a filter', async () => {
    render(<EvidenceBoard skriptId="sk" />)
    await waitFor(() => expect(screen.getByText('Laborbuch')).toBeTruthy())
    expect(screen.getByText('Dienstplan')).toBeTruthy()
    expect(screen.getByText('3 clues · 3 levels solved')).toBeTruthy()
  })

  it('filters by level-id prefix (w1- does not match w10-)', async () => {
    render(<EvidenceBoard skriptId="sk" levels="w1-" />)
    await waitFor(() => expect(screen.getByText('Dienstplan')).toBeTruthy())
    expect(screen.queryByText('Laborbuch')).toBeNull()
    expect(screen.queryByText('Spam')).toBeNull()
    expect(screen.getByText('1 clue · 1 level solved')).toBeTruthy()
  })

  it('accepts several prefixes', async () => {
    render(<EvidenceBoard skriptId="sk" levels="w1-, w2-" />)
    await waitFor(() => expect(screen.getByText('Laborbuch')).toBeTruthy())
    expect(screen.queryByText('Spam')).toBeNull()
  })
})

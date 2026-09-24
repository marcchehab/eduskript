import { describe, it, expect } from 'vitest'
import { getVisibility } from '@/lib/visibility'

const pub = { isPublished: true, isUnlisted: false }
const draft = { isPublished: false, isUnlisted: false }
const unlisted = { isPublished: true, isUnlisted: true }

describe('getVisibility', () => {
  it('is public when page, skript and placement are all ok', () => {
    expect(getVisibility({ page: pub, skript: pub, placed: true }).state).toBe('public')
  })

  it('hides a draft page in a published skript', () => {
    const v = getVisibility({ page: draft, skript: pub, placed: true })
    expect(v.state).toBe('hidden')
    expect(v.checks.find((c) => c.level === 'page')?.status).toBe('blocked')
  })

  it('hides a published page in a draft skript', () => {
    expect(getVisibility({ page: pub, skript: draft, placed: true }).state).toBe('hidden')
  })

  it('hides when both are drafts', () => {
    expect(getVisibility({ page: draft, skript: draft }).state).toBe('hidden')
  })

  it('is link-only when unlisted at either level', () => {
    expect(getVisibility({ page: unlisted, skript: pub, placed: true }).state).toBe('link-only')
    expect(getVisibility({ page: pub, skript: unlisted, placed: true }).state).toBe('link-only')
  })

  it('is link-only when not placed on the page', () => {
    expect(getVisibility({ page: pub, skript: pub, placed: false }).state).toBe('link-only')
  })

  it('hides unplaced org content (placement required)', () => {
    expect(getVisibility({ skript: pub, placed: false, placementRequired: true }).state).toBe('hidden')
  })

  it('omits the placement check when placement is unknown', () => {
    const v = getVisibility({ skript: pub })
    expect(v.state).toBe('public')
    expect(v.checks.map((c) => c.level)).toEqual(['skript'])
  })
})

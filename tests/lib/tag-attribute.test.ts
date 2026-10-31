import { describe, it, expect } from 'vitest'
import { setTagAttribute } from '@/lib/tag-attribute'
import { toListName } from '@/components/markdown/share-list-options'

describe('setTagAttribute', () => {
  it('adds, replaces and removes an attribute', () => {
    expect(setTagAttribute('<leaderboard />', 'leaderboard', 1, 'source', 'a')).toBe('<leaderboard source="a" />')
    expect(setTagAttribute('<leaderboard source="a" limit="5" />', 'leaderboard', 1, 'source', 'b'))
      .toBe('<leaderboard limit="5" source="b" />')
    expect(setTagAttribute("<plugin src='x' share='a' />", 'plugin', 1, 'share', null)).toBe("<plugin src='x' />")
  })

  it('picks the tag at the given line, not the first on the page', () => {
    expect(setTagAttribute('<leaderboard />\n\ntext\n\n<leaderboard />', 'leaderboard', 5, 'source', 'b'))
      .toBe('<leaderboard />\n\ntext\n\n<leaderboard source="b" />')
  })

  it('returns null without a matching tag', () => {
    expect(setTagAttribute('text', 'leaderboard', 1, 'source', 'a')).toBeNull()
    expect(setTagAttribute('<leaderboard />', 'leaderboard', 9, 'source', 'a')).toBeNull()
  })
})

describe('toListName', () => {
  it('turns a typed name into a valid list name', () => {
    expect(toListName(' Kapitel 3! ')).toBe('kapitel-3')
  })
})

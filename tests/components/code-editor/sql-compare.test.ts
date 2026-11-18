import { describe, it, expect } from 'vitest'
import { compareResultSets, hasTopLevelOrderBy } from '@/components/public/code-editor/sql-compare'
import type { SqlResultSet } from '@/components/public/code-editor/types'

const set = (values: unknown[][], columns = ['a', 'b']): SqlResultSet[] =>
  [{ columns, values } as SqlResultSet]

describe('hasTopLevelOrderBy', () => {
  it('finds a plain ORDER BY, case-insensitive and across line breaks', () => {
    expect(hasTopLevelOrderBy('SELECT a FROM t ORDER BY a')).toBe(true)
    expect(hasTopLevelOrderBy('select a from t\norder\n  by a desc limit 3;')).toBe(true)
  })

  it('is false without ORDER BY', () => {
    expect(hasTopLevelOrderBy('SELECT a FROM t JOIN u ON t.id = u.id WHERE a > 1')).toBe(false)
  })

  it('ignores ORDER BY in subqueries and window definitions', () => {
    expect(hasTopLevelOrderBy('SELECT * FROM (SELECT a FROM t ORDER BY a LIMIT 5)')).toBe(false)
    expect(hasTopLevelOrderBy('SELECT a, ROW_NUMBER() OVER (PARTITION BY b ORDER BY a) FROM t')).toBe(false)
    expect(hasTopLevelOrderBy('SELECT a FROM t WHERE b IN (SELECT b FROM (SELECT b FROM u ORDER BY b))')).toBe(false)
  })

  it('still finds the outer ORDER BY next to a subquery', () => {
    expect(hasTopLevelOrderBy('SELECT * FROM (SELECT a FROM t ORDER BY a) ORDER BY a DESC')).toBe(true)
  })

  it('ignores ORDER BY in strings, quoted identifiers and comments', () => {
    expect(hasTopLevelOrderBy("SELECT a FROM t WHERE b = 'order by c'")).toBe(false)
    expect(hasTopLevelOrderBy("SELECT a FROM t WHERE b = 'it''s (order by'")).toBe(false)
    expect(hasTopLevelOrderBy('SELECT "order by" FROM t')).toBe(false)
    expect(hasTopLevelOrderBy('SELECT a FROM t -- order by a\n')).toBe(false)
    expect(hasTopLevelOrderBy('SELECT a FROM t /* order by a */')).toBe(false)
  })

  it('finds ORDER BY after a string that contains a parenthesis', () => {
    expect(hasTopLevelOrderBy("SELECT a FROM t WHERE b = 'Unholy (feat.' ORDER BY a")).toBe(true)
  })
})

describe('compareResultSets', () => {
  const rows = [['David Guetta', 'dance'], ['David Guetta', 'edm'], ['Becky Hill', 'dance']]
  const shuffled = [['Becky Hill', 'dance'], ['David Guetta', 'dance'], ['David Guetta', 'edm']]

  it('accepts the same rows in another order when unordered', () => {
    expect(compareResultSets(set(shuffled), set(rows), { ordered: false })).toBe(true)
  })

  it('rejects the same rows in another order when ordered', () => {
    expect(compareResultSets(set(shuffled), set(rows), { ordered: true })).toBe(false)
    expect(compareResultSets(set(rows), set(rows), { ordered: true })).toBe(true)
  })

  it('counts duplicates: same distinct rows but different multiplicity is wrong', () => {
    const a = [['x', 1], ['x', 1], ['y', 2]]
    const b = [['x', 1], ['y', 2], ['y', 2]]
    expect(compareResultSets(set(a), set(b), { ordered: false })).toBe(false)
  })

  it('rejects different rows, row counts and column counts', () => {
    expect(compareResultSets(set([['x', 1]]), set([['x', 2]]), { ordered: false })).toBe(false)
    expect(compareResultSets(set([['x', 1]]), set([['x', 1], ['x', 1]]), { ordered: false })).toBe(false)
    expect(compareResultSets(set([['x']], ['a']), set([['x', 1]]), { ordered: false })).toBe(false)
  })

  it('keeps column order significant and ignores column names', () => {
    expect(compareResultSets(set([[1, 'x']]), set([['x', 1]]), { ordered: false })).toBe(false)
    expect(compareResultSets(set([['x', 1]], ['artist', 'n']), set([['x', 1]], ['name', 'count']), { ordered: false })).toBe(true)
  })

  it('string-coerces values and does not confuse cell boundaries', () => {
    expect(compareResultSets(set([[1, null]]), set([['1', 'null']]), { ordered: true })).toBe(true)
    expect(compareResultSets(set([['a,b', 'c']]), set([['a', 'b,c']]), { ordered: false })).toBe(false)
  })

  it('compares several result sets pairwise', () => {
    const two = (v: unknown[][]) => [...set(v), ...set(v)]
    expect(compareResultSets(two(rows), two(shuffled), { ordered: false })).toBe(true)
    expect(compareResultSets(two(rows), set(rows), { ordered: false })).toBe(false)
  })
})

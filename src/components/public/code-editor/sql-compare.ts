import type { SqlResultSet } from './types'

/**
 * True when the SQL has an ORDER BY at the top level of a statement, i.e. one
 * that determines the order of the final result. An ORDER BY inside a subquery
 * or a window definition (`OVER (ORDER BY …)`) does not count: both sit inside
 * parentheses and leave the outer row order undefined.
 */
export function hasTopLevelOrderBy(sql: string): boolean {
  let s = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]')
  // Drop parenthesised groups from the inside out until none are left.
  let previous: string
  do {
    previous = s
    s = s.replace(/\([^()]*\)/g, ' ')
  } while (s !== previous)
  return /\border\s+by\b/i.test(s)
}

const rowKey = (row: unknown[]): string => JSON.stringify(row.map(String))

/**
 * Compare a student's SQL result against the solution's result.
 * Values are string-coerced; column names are ignored, column count and
 * column order matter.
 *
 * `ordered: true` requires the same rows in the same order. `ordered: false`
 * requires the same rows the same number of times in any order — SQL leaves
 * the row order undefined without ORDER BY, so two correct queries may return
 * the same rows in a different order (e.g. JOINs written in another order).
 */
export function compareResultSets(
  student: SqlResultSet[],
  solution: SqlResultSet[],
  { ordered }: { ordered: boolean }
): boolean {
  if (student.length !== solution.length) return false
  for (let i = 0; i < student.length; i++) {
    if (student[i].columns.length !== solution[i].columns.length) return false
    if (student[i].values.length !== solution[i].values.length) return false
    const a = student[i].values.map(rowKey)
    const b = solution[i].values.map(rowKey)
    if (!ordered) {
      a.sort()
      b.sort()
    }
    if (a.some((key, j) => key !== b[j])) return false
  }
  return true
}

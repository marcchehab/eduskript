/**
 * The single canonical ordering for an exam roster, shared by the ClassToolbar
 * student list and the StudentNavigator prev/next arrows so the arrows always
 * step up/down the visible list (no jumping around).
 *
 * Order: submitted first (the grading case), then taking, then not-started;
 * ties broken by display name.
 */

export type RosterStatus = 'submitted' | 'taking' | 'not_started' | null | undefined

export function rosterRank(status: RosterStatus): number {
  return status === 'submitted' ? 0 : status === 'taking' ? 1 : 2
}

export function compareRoster(
  a: { status: RosterStatus; name: string },
  b: { status: RosterStatus; name: string },
): number {
  const r = rosterRank(a.status) - rosterRank(b.status)
  if (r !== 0) return r
  return a.name.localeCompare(b.name)
}

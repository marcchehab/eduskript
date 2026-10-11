/**
 * Atomic writes to Site.extraSettings (shape + parsing: src/lib/settings.ts).
 *
 * The old pattern — read the bag, mergeExtraSettings() in JS, write the whole
 * bag back — loses updates when two saves overlap (e.g. theme editor and
 * page settings): the later write carries the earlier read and drops the
 * other request's keys. This does the merge inside one UPDATE statement,
 * so concurrent patches touching different keys both survive. Concurrent
 * patches of the SAME key: last statement wins, as you'd expect.
 */

import { prisma } from './prisma'
import type { SiteExtraSettings } from './settings'

type Db = Pick<typeof prisma, '$executeRaw'>

/** Split a change set into keys to set and keys to delete (undefined = delete). */
export function splitExtraSettingsChanges(changes: Partial<SiteExtraSettings>) {
  const set: Record<string, unknown> = {}
  const remove: string[] = []
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) remove.push(key)
    else set[key] = value
  }
  return { set, remove }
}

/**
 * `extra_settings = (extra_settings - removedKeys) || setKeys` for one site.
 * A non-object stored value (hand-edited row) is treated as {}.
 */
export async function patchSiteExtraSettings(
  siteId: string,
  changes: Partial<SiteExtraSettings>,
  db: Db = prisma,
): Promise<void> {
  const { set, remove } = splitExtraSettingsChanges(changes)
  if (remove.length === 0 && Object.keys(set).length === 0) return
  await db.$executeRaw`
    UPDATE sites
    SET extra_settings =
          (CASE WHEN jsonb_typeof(extra_settings) = 'object' THEN extra_settings ELSE '{}'::jsonb END
            - ${remove}::text[])
          || ${JSON.stringify(set)}::jsonb,
        updated_at = NOW()
    WHERE id = ${siteId}`
}

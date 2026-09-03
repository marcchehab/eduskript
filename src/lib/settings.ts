/**
 * Typed accessors for the `extraSettings` jsonb on Site and Organization.
 *
 * The point of the column is that a new preference costs no migration. The
 * point of this module is that the looseness stops here: every setting is
 * declared once, with a default and a parser, so callers get types and cannot
 * invent a second spelling of the same key.
 *
 * What belongs in there: per-entity preferences nothing queries ACROSS rows.
 * What does not: anything filtered, joined, sorted or billed on — billingPlan,
 * accountType, permissions and friends stay real columns, where constraints
 * and indexes work. The name says "extra" for that reason: the ordinary
 * settings are still columns.
 *
 * Reads are total: a missing, malformed or hand-edited value falls back to the
 * default rather than throwing, because this data is not validated by the DB.
 */

/** Everything storable in Site.extraSettings. Add a key here, not at a call site. */
export interface SiteExtraSettings {
  /**
   * Brevo list backing the site's <newsletter> box, provisioned on first use.
   * Stored rather than derived from the slug: Brevo list names are not stable
   * identifiers, so a slug rename would otherwise orphan the subscribers.
   */
  newsletterListId?: number

  /**
   * Sidebar title-row style: the default icon+pageName row, or a wide logo
   * image in its place. 'logo' with no logoUrl set falls back to 'icon'.
   */
  titleStyle?: 'icon' | 'logo'
  /** Wide logo image URL, shown when titleStyle is 'logo'. */
  logoUrl?: string

  /**
   * Hide the supporter badge on this site's public sidebar AND drop the site
   * from the /supporters listing. Only meaningful while the owner's
   * billingPlan is a supporter plan.
   */
  supporterBadgeHidden?: boolean
  /** Custom supporter badge text; falls back to DEFAULT_SUPPORTER_MESSAGE. */
  supporterBadgeMessage?: string
}

/** Shown on the public badge when the supporter has not set a custom message. */
export const DEFAULT_SUPPORTER_MESSAGE = 'I support 🇨🇭open-source'

/** Everything storable in Organization.extraSettings. */
export interface OrgExtraSettings {
  newsletterListId?: number
}

type ExtraSettings = SiteExtraSettings & OrgExtraSettings

/** Prisma hands back `JsonValue`; narrow it without trusting the contents. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Read the whole bag off an entity. Accepts the entity or the raw column, so a
 * `select: { extraSettings: true }` result can be passed straight in.
 */
export function readExtraSettings(source: { extraSettings?: unknown } | unknown): ExtraSettings {
  const raw = asRecord(source)
  const bag = 'extraSettings' in raw ? asRecord(raw.extraSettings) : raw
  const out: ExtraSettings = {}

  const listId = toPositiveInt(bag.newsletterListId)
  if (listId !== undefined) out.newsletterListId = listId

  if (bag.titleStyle === 'icon' || bag.titleStyle === 'logo') out.titleStyle = bag.titleStyle
  if (typeof bag.logoUrl === 'string' && bag.logoUrl) out.logoUrl = bag.logoUrl

  if (bag.supporterBadgeHidden === true) out.supporterBadgeHidden = true
  if (typeof bag.supporterBadgeMessage === 'string' && bag.supporterBadgeMessage.trim()) {
    out.supporterBadgeMessage = bag.supporterBadgeMessage.trim().slice(0, 60)
  }

  return out
}

/**
 * Merge changes into an existing bag, returning what to write back.
 *
 * Shallow on purpose: these are flat scalars. Passing `undefined` for a key
 * deletes it, which is how a setting is reset to its default.
 */
export function mergeExtraSettings(
  current: unknown,
  changes: Partial<ExtraSettings>
): Record<string, unknown> {
  const raw = asRecord(current)
  const next = { ...asRecord('extraSettings' in raw ? raw.extraSettings : raw) }

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }

  return next
}

/** Ints arrive as numbers or strings depending on who wrote them. */
function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

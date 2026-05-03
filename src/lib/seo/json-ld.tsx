/**
 * JSON-LD schema injection for rich-result eligibility.
 *
 * `<JsonLd>` emits a single `<script type="application/ld+json">` tag.
 * Pass either one schema object or an array; the renderer serialises
 * with `JSON.stringify` into the `dangerouslySetInnerHTML` payload.
 *
 * Schema factories return plain objects following schema.org vocabulary.
 * Keep them shallow — Google's structured-data parser is fine with the
 * basic shapes here, and richer typing (`@type: 'Course'` requires
 * provider/offers/etc.) buys little for our content surface.
 *
 * The hygiene gate at `tests/seo/json-ld.test.ts` renders pages and
 * asserts a `<script type="application/ld+json">` tag is present with a
 * recognised `@type`.
 */

interface JsonLdProps {
  schema: object | object[]
}

export function JsonLd({ schema }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}

export function organizationSchema(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Eduskript',
    url: 'https://eduskript.org',
    logo: 'https://eduskript.org/og-default.svg',
    description:
      'Open-source platform for teachers to host interactive class material.',
    sameAs: ['https://github.com/marcchehab/eduskript'],
  }
}

interface LearningResourceArgs {
  title: string
  description: string
  url: string
  // BCP-47 language tag (e.g. "de-CH", "en"). Pass `null` when the teacher
  // hasn't configured one — we'd rather omit the field than ship a wrong
  // value, since `inLanguage` is a strong indexing signal that an `en`
  // default would mis-classify a German page.
  inLanguage: string | null
  author: string
  // Accept both — Next.js's `unstable_cache` JSON-serialises return values,
  // so cached query helpers hand us ISO strings even when Prisma returned
  // Date objects originally. Normalise on the way in.
  dateCreated: Date | string
  dateModified: Date | string
}

function toIsoString(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString()
}

export function learningResourceSchema(args: LearningResourceArgs): object {
  const out: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: args.title,
    description: args.description,
    url: args.url,
    author: { '@type': 'Person', name: args.author },
    dateCreated: toIsoString(args.dateCreated),
    dateModified: toIsoString(args.dateModified),
    isAccessibleForFree: true,
    learningResourceType: 'Lesson',
  }
  if (args.inLanguage) out.inLanguage = args.inLanguage
  return out
}

interface PersonArgs {
  name: string
  url: string
  // Optional pieces — only emit fields the teacher actually filled in;
  // schema.org parsers ignore missing properties without complaint.
  jobTitle?: string | null
  description?: string | null
  image?: string | null
  // Other URLs that represent the same person (custom domain ↔ eduskript.org).
  // Helps Google merge identity signals across hosts and reinforces E-A-T
  // for the LearningResource.author references on content pages.
  sameAs?: string[]
}

export function personSchema(args: PersonArgs): object {
  const out: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: args.name,
    url: args.url,
  }
  if (args.jobTitle) out.jobTitle = args.jobTitle
  if (args.description) out.description = args.description
  if (args.image) out.image = args.image
  if (args.sameAs && args.sameAs.length > 0) out.sameAs = args.sameAs
  return out
}

export function breadcrumbSchema(items: { name: string; url: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

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
  inLanguage: string
  author: string
  dateCreated: Date
  dateModified: Date
}

export function learningResourceSchema(args: LearningResourceArgs): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: args.title,
    description: args.description,
    url: args.url,
    inLanguage: args.inLanguage,
    author: { '@type': 'Person', name: args.author },
    dateCreated: args.dateCreated.toISOString(),
    dateModified: args.dateModified.toISOString(),
    isAccessibleForFree: true,
    learningResourceType: 'Lesson',
  }
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

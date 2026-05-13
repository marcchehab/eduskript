import { describe, it, expect } from 'vitest'
import {
  buildSiteStructure,
  buildContextualStructure,
  type SiteStructure,
} from '@/lib/site-structure'

describe('Site Structure Utilities', () => {
  // Helper to create test data
  const createPage = (id: string, title: string, slug: string, options?: { isPublished?: boolean; order?: number }) => ({
    id,
    title,
    slug,
    isPublished: options?.isPublished ?? true,
    order: options?.order ?? 0,
  })

  const createSkript = (id: string, title: string, slug: string, pages: ReturnType<typeof createPage>[], options?: { isPublished?: boolean }) => ({
    id,
    title,
    slug,
    isPublished: options?.isPublished ?? true,
    pages,
  })

  const createCollectionSkript = (skript: ReturnType<typeof createSkript>, order?: number) => ({
    order: order ?? null,
    skript,
  })

  const createCollection = (
    id: string,
    title: string,
    _slug: string,
    collectionSkripts: ReturnType<typeof createCollectionSkript>[],
    options?: { accentColor?: string }
  ) => ({
    id,
    title,
    accentColor: options?.accentColor ?? null,
    collectionSkripts,
  })

  describe('buildSiteStructure', () => {
    describe('Basic Transformation', () => {
      it('should transform a simple collection structure', () => {
        const collections = [
          createCollection('col-1', 'Algebra', 'algebra', [
            createCollectionSkript(
              createSkript('skript-1', 'Linear Equations', 'linear-equations', [
                createPage('page-1', 'Introduction', 'introduction'),
                createPage('page-2', 'Examples', 'examples'),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe('Algebra')
        expect(result[0].id).toBe('col-1')
        expect(result[0].skripts).toHaveLength(1)
        expect(result[0].skripts[0].title).toBe('Linear Equations')
        expect(result[0].skripts[0].pages).toHaveLength(2)
      })

      it('should preserve collection accentColor', () => {
        const collections = [
          createCollection('col-1', 'Math', 'math', [
            createCollectionSkript(
              createSkript('skript-1', 'Numbers', 'numbers', [
                createPage('page-1', 'Intro', 'intro'),
              ])
            ),
          ], { accentColor: '#FF5733' }),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].accentColor).toBe('#FF5733')
      })

      it('should handle null accentColor', () => {
        const collections = [
          createCollection('col-1', 'Math', 'math', [
            createCollectionSkript(
              createSkript('skript-1', 'Numbers', 'numbers', [
                createPage('page-1', 'Intro', 'intro'),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].accentColor).toBeNull()
      })
    })

    describe('Published Content Filtering', () => {
      it('should show all collections (collections are purely organizational, no publish status)', () => {
        const collections = [
          createCollection('col-1', 'Collection A', 'collection-a', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript 1', 'skript-1', [
                createPage('page-1', 'Page 1', 'page-1'),
              ])
            ),
          ]),
          createCollection('col-2', 'Collection B', 'collection-b', [
            createCollectionSkript(
              createSkript('skript-2', 'Skript 2', 'skript-2', [
                createPage('page-2', 'Page 2', 'page-2'),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(2)
      })

      it('should filter out unpublished skripts by default', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Published Skript', 'published', [
                createPage('page-1', 'Page 1', 'page-1'),
              ], { isPublished: true })
            ),
            createCollectionSkript(
              createSkript('skript-2', 'Unpublished Skript', 'unpublished', [
                createPage('page-2', 'Page 2', 'page-2'),
              ], { isPublished: false })
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts).toHaveLength(1)
        expect(result[0].skripts[0].title).toBe('Published Skript')
      })

      it('should filter out unpublished pages by default', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript', 'skript', [
                createPage('page-1', 'Published Page', 'published', { isPublished: true }),
                createPage('page-2', 'Unpublished Page', 'unpublished', { isPublished: false }),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts[0].pages).toHaveLength(1)
        expect(result[0].skripts[0].pages[0].title).toBe('Published Page')
      })

      it('should include unpublished content when onlyPublished is false', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript', 'skript', [
                createPage('page-1', 'Published', 'published', { isPublished: true }),
                createPage('page-2', 'Unpublished', 'unpublished', { isPublished: false }),
              ], { isPublished: false })
            ),
          ], { isPublished: false }),
        ]

        const result = buildSiteStructure(collections, { onlyPublished: false })

        expect(result).toHaveLength(1)
        expect(result[0].skripts).toHaveLength(1)
        expect(result[0].skripts[0].pages).toHaveLength(2)
      })
    })

    describe('Sorting', () => {
      it('should sort skripts by order field', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-3', 'Third', 'third', [createPage('p-3', 'P3', 'p3')]),
              3
            ),
            createCollectionSkript(
              createSkript('skript-1', 'First', 'first', [createPage('p-1', 'P1', 'p1')]),
              1
            ),
            createCollectionSkript(
              createSkript('skript-2', 'Second', 'second', [createPage('p-2', 'P2', 'p2')]),
              2
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts[0].title).toBe('First')
        expect(result[0].skripts[1].title).toBe('Second')
        expect(result[0].skripts[2].title).toBe('Third')
      })

      it('should handle null order values (treat as 0)', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-2', 'With Order', 'with-order', [createPage('p-2', 'P2', 'p2')]),
              1
            ),
            createCollectionSkript(
              createSkript('skript-1', 'No Order', 'no-order', [createPage('p-1', 'P1', 'p1')])
              // order is null/undefined
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts[0].title).toBe('No Order')
        expect(result[0].skripts[1].title).toBe('With Order')
      })

      it('should sort pages by order field', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript', 'skript', [
                createPage('page-3', 'Third Page', 'third', { order: 3 }),
                createPage('page-1', 'First Page', 'first', { order: 1 }),
                createPage('page-2', 'Second Page', 'second', { order: 2 }),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts[0].pages[0].title).toBe('First Page')
        expect(result[0].skripts[0].pages[1].title).toBe('Second Page')
        expect(result[0].skripts[0].pages[2].title).toBe('Third Page')
      })

      it('should assign correct order index to skripts after sorting', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-b', 'B', 'b', [createPage('p-b', 'PB', 'pb')]),
              2
            ),
            createCollectionSkript(
              createSkript('skript-a', 'A', 'a', [createPage('p-a', 'PA', 'pa')]),
              1
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts[0].order).toBe(0) // First after sorting
        expect(result[0].skripts[1].order).toBe(1) // Second after sorting
      })
    })

    describe('Empty Content Removal', () => {
      it('should remove collections with no visible skripts', () => {
        const collections = [
          createCollection('col-1', 'Has Skripts', 'has-skripts', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript', 'skript', [
                createPage('page-1', 'Page', 'page'),
              ])
            ),
          ]),
          createCollection('col-2', 'No Skripts', 'no-skripts', []),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(1)
        expect(result[0].title).toBe('Has Skripts')
      })

      it('should remove skripts with no visible pages', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Has Pages', 'has-pages', [
                createPage('page-1', 'Page', 'page'),
              ])
            ),
            createCollectionSkript(
              createSkript('skript-2', 'No Pages', 'no-pages', [])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result[0].skripts).toHaveLength(1)
        expect(result[0].skripts[0].title).toBe('Has Pages')
      })

      it('should remove collection if all skripts have no pages', () => {
        const collections = [
          createCollection('col-1', 'Empty Collection', 'empty', [
            createCollectionSkript(
              createSkript('skript-1', 'Empty Skript', 'empty-skript', [])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(0)
      })

      it('should remove collection if all pages are unpublished', () => {
        const collections = [
          createCollection('col-1', 'Collection', 'collection', [
            createCollectionSkript(
              createSkript('skript-1', 'Skript', 'skript', [
                createPage('page-1', 'Hidden Page', 'hidden', { isPublished: false }),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(0)
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty collections array', () => {
        const result = buildSiteStructure([])

        expect(result).toEqual([])
      })

      it('should handle multiple collections', () => {
        const collections = [
          createCollection('col-1', 'Math', 'math', [
            createCollectionSkript(
              createSkript('skript-1', 'Algebra', 'algebra', [
                createPage('page-1', 'Intro', 'intro'),
              ])
            ),
          ]),
          createCollection('col-2', 'Physics', 'physics', [
            createCollectionSkript(
              createSkript('skript-2', 'Mechanics', 'mechanics', [
                createPage('page-2', 'Newton', 'newton'),
              ])
            ),
          ]),
        ]

        const result = buildSiteStructure(collections)

        expect(result).toHaveLength(2)
        expect(result[0].title).toBe('Math')
        expect(result[1].title).toBe('Physics')
      })

      it('should handle undefined isPublished (treat as published)', () => {
        const collection = {
          id: 'col-1',
          title: 'Collection',
          slug: 'collection',
          collectionSkripts: [
            {
              order: null,
              skript: {
                id: 'skript-1',
                title: 'Skript',
                slug: 'skript',
                // isPublished is undefined
                pages: [
                  { id: 'page-1', title: 'Page', slug: 'page' },
                ],
              },
            },
          ],
        }

        const result = buildSiteStructure([collection])

        expect(result).toHaveLength(1)
        expect(result[0].skripts).toHaveLength(1)
        expect(result[0].skripts[0].pages).toHaveLength(1)
      })
    })
  })

  describe('buildContextualStructure', () => {
    const testCollection = createCollection('col-1', 'Math', 'math', [
      createCollectionSkript(
        createSkript('skript-1', 'Algebra', 'algebra', [
          createPage('page-1', 'Intro', 'intro'),
        ]),
        1
      ),
      createCollectionSkript(
        createSkript('skript-2', 'Geometry', 'geometry', [
          createPage('page-2', 'Shapes', 'shapes'),
        ]),
        2
      ),
    ])

    it('should return full collection when no skriptSlug provided', () => {
      const result = buildContextualStructure(testCollection)

      expect(result).toHaveLength(1)
      expect(result[0].skripts).toHaveLength(2)
    })

    it('should filter to specific skript when skriptSlug provided', () => {
      const result = buildContextualStructure(testCollection, 'algebra')

      expect(result).toHaveLength(1)
      expect(result[0].skripts).toHaveLength(1)
      expect(result[0].skripts[0].slug).toBe('algebra')
    })

    it('should return empty when skriptSlug does not match', () => {
      const result = buildContextualStructure(testCollection, 'nonexistent')

      expect(result).toHaveLength(0)
    })

    it('should respect onlyPublished option', () => {
      const collectionWithUnpublished = createCollection('col-1', 'Math', 'math', [
        createCollectionSkript(
          createSkript('skript-1', 'Algebra', 'algebra', [
            createPage('page-1', 'Intro', 'intro', { isPublished: false }),
          ])
        ),
      ])

      const publishedResult = buildContextualStructure(collectionWithUnpublished, undefined, { onlyPublished: true })
      const allResult = buildContextualStructure(collectionWithUnpublished, undefined, { onlyPublished: false })

      expect(publishedResult).toHaveLength(0) // Empty because page is unpublished
      expect(allResult).toHaveLength(1) // Includes unpublished page
    })

    it('should preserve collection properties when filtering', () => {
      const collectionWithColor = createCollection('col-1', 'Math', 'math', [
        createCollectionSkript(
          createSkript('skript-1', 'Algebra', 'algebra', [
            createPage('page-1', 'Intro', 'intro'),
          ])
        ),
      ], { accentColor: '#123456' })

      const result = buildContextualStructure(collectionWithColor, 'algebra')

      expect(result[0].accentColor).toBe('#123456')
    })
  })
})

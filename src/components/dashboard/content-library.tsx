'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Droppable } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DraggableCollection, DraggableSkript } from './draggable-content'
import { Search, BookOpen, FileText } from 'lucide-react'
import { CollectionAuthor, SkriptAuthor, User, Collection, Skript } from '@prisma/client'
import { checkSkriptPermissions } from '@/lib/permissions'
import { api, handleJsonResponse } from '@/lib/api-error-handler'
import { CreateSkriptModal } from './create-skript-modal'
import { useRouter } from 'next/navigation'
import type { PageBuilderContext } from './page-builder-interface'

interface CollectionWithAuthors extends Collection {
  authors: (CollectionAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  collectionSkripts: Array<{
    skript: Skript
  }>
}

interface SkriptWithAuthors extends Skript {
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  collectionSkripts: Array<{
    collection: {
      slug: string
      authors: (CollectionAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
    }
  }>
  pages: Array<{ id: string }>
}

interface ContentLibraryProps {
  onDataLoad?: (data: { collections: any[], skripts: any[] }) => void
  refreshTrigger?: number
  context?: PageBuilderContext
}

export function ContentLibrary({ onDataLoad, refreshTrigger, context = { type: 'user' } }: ContentLibraryProps = {}) {
  const { data: session } = useSession()
  const router = useRouter()
  const [collections, setCollections] = useState<CollectionWithAuthors[]>([])
  const [skripts, setSkripts] = useState<SkriptWithAuthors[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchContent = useCallback(async () => {
    if (!session?.user?.id) return

    try {
      let collectionsData: CollectionWithAuthors[] = []
      let skriptsData: SkriptWithAuthors[] = []

      if (context.type === 'organization' && context.organizationId) {
        // For organizations: fetch content available to org admins
        const response = await api.get(
          `/api/organizations/${context.organizationId}/available-content`
        )
        const json = await handleJsonResponse(response)
        collectionsData = json.data?.collections || []
        skriptsData = json.data?.skripts || []
      } else {
        // For users: fetch personal content
        const collectionsResponse = await api.get('/api/collections?includeShared=true')
        const collectionsJson = await handleJsonResponse(collectionsResponse)
        collectionsData = collectionsJson.data || []

        const skriptsResponse = await api.get('/api/skripts?includeShared=true')
        const skriptsJson = await handleJsonResponse(skriptsResponse)
        skriptsData = skriptsJson.data || []
      }

      setCollections(collectionsData)
      setSkripts(skriptsData)

      // Share data with parent component
      onDataLoad?.({ collections: collectionsData, skripts: skriptsData })
    } catch (error) {
      console.error('Error fetching content:', error)
      // API errors will be handled by the global error handler
      // This catch is for any other unexpected errors
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id, onDataLoad, context.type, context.organizationId])

  useEffect(() => {
    fetchContent()
  }, [fetchContent, refreshTrigger])

  // Filter content based on search term
  const filteredCollections = collections.filter(collection =>
    collection.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (collection.description?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  )

  const filteredSkripts = skripts.filter(skript =>
    skript.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (skript.description?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  )

  if (!session?.user?.id) {
    return null
  }

  if (loading) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Content Library
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading your content...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="min-h-[400px]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Content Library
        </CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search collections and skripts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        {collections.length > 0 && (
          <CreateSkriptModal
            collections={collections.map(c => ({ id: c.id, title: c.title }))}
            onSkriptCreated={() => fetchContent()}
            onSkriptCreatedWithSlug={(slug) => router.push(`/dashboard/skripts/${slug}`)}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Collections Section */}
        {filteredCollections.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Collections ({filteredCollections.length})
            </h3>
            <Droppable droppableId="library-collections" isDropDisabled={true}>
              {(provided) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {filteredCollections.map((collection, index) => {
                    return (
                      <DraggableCollection
                        key={collection.id}
                        type="collection"
                        id={collection.id}
                        title={collection.title}
                        description={collection.description || undefined}
                        skriptCount={collection.collectionSkripts.length}
                        authors={collection.authors}
                        currentUserId={session.user.id}
                        isViewOnly={false}
                        index={index}
                        slug={collection.slug}
                      />
                    )
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        )}

        {/* Skripts Section */}
        {filteredSkripts.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Skripts ({filteredSkripts.length})
            </h3>
            <Droppable droppableId="library-skripts" isDropDisabled={true}>
              {(provided) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {filteredSkripts.map((skript, index) => {
                    const permissions = checkSkriptPermissions(
                      session.user.id,
                      skript.authors
                    )
                    const isViewOnly = !permissions.canEdit

                    return (
                      <DraggableSkript
                        key={skript.id}
                        type="skript"
                        id={skript.id}
                        title={skript.title}
                        description={skript.description || undefined}
                        pageCount={skript.pages.length}
                        authors={skript.authors}
                        currentUserId={session.user.id}
                        isViewOnly={isViewOnly}
                        index={index}
                        slug={skript.slug}
                      />
                    )
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        )}

        {/* Empty State */}
        {filteredCollections.length === 0 && filteredSkripts.length === 0 && (
          <div className="text-center py-8">
            {searchTerm ? (
              <div>
                <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No content found matching &quot;{searchTerm}&quot;</p>
              </div>
            ) : (
              <div>
                <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No content available</p>
                <p className="text-xs text-muted-foreground mt-1">Create collections and skripts to get started</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
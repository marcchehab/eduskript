'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Droppable } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DraggableCollection, DraggableSkript } from './draggable-content'
import { Search, BookOpen, FileText } from 'lucide-react'
import { SkriptAuthor, User, Collection, Skript } from '@prisma/client'
import { checkSkriptPermissions } from '@/lib/permissions'
import { api, handleJsonResponse } from '@/lib/api-error-handler'
import { CreateSkriptModal } from './create-skript-modal'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { useRouter } from 'next/navigation'
import type { PageBuilderContext } from './page-builder-interface'

interface LibraryCollection extends Collection {
  collectionSkripts: Array<{
    skript: Skript
  }>
}

interface SkriptWithAuthors extends Skript {
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  collectionSkripts: Array<{
    collection: {
      site: { userId: string | null; organizationId: string | null } | null
    }
  }>
  pages: Array<{ id: string }>
}

interface ContentLibraryProps {
  onDataLoad?: (data: { collections: any[], skripts: any[] }) => void
  refreshTrigger?: number
  context?: PageBuilderContext
  // A collection edited in the page builder (rename / accent colour). When the
  // reference changes we merge it into the library list so the card updates
  // without a full refetch.
  collectionUpdate?: { id: string; title: string; accentColor?: string | null } | null
  // Bump the parent's refreshTrigger — reloads both the library and the page
  // builder. Used after a destructive action (e.g. deleting a collection that
  // may also be pinned in the layout). Falls back to a library-only refetch.
  onRefresh?: () => void
}

export function ContentLibrary({ onDataLoad, refreshTrigger, context = { type: 'user' }, collectionUpdate, onRefresh }: ContentLibraryProps = {}) {
  const { data: session } = useSession()
  const router = useRouter()
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [skripts, setSkripts] = useState<SkriptWithAuthors[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const alertDialog = useAlertDialog()

  const fetchContent = useCallback(async () => {
    if (!session?.user?.id) return

    try {
      let collectionsData: LibraryCollection[] = []
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

  // Merge an in-place collection edit (rename / accent colour) from the page
  // builder. Avoids a full refetch — fetchContent would also pick it up, but
  // only on the next refreshTrigger bump.
  useEffect(() => {
    if (!collectionUpdate) return
    setCollections(prev =>
      prev.map(c =>
        c.id === collectionUpdate.id
          ? { ...c, title: collectionUpdate.title, accentColor: collectionUpdate.accentColor ?? null }
          : c
      )
    )
  }, [collectionUpdate])

  // Runs after the card's ConfirmationDialog is accepted — the confirm step
  // is the modal, not a browser confirm().
  const handleDeleteCollection = async (id: string) => {
    try {
      const res = await fetch(`/api/collections/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alertDialog.showError(data.error || 'Failed to delete collection')
        return
      }
      // onRefresh reloads the page builder too (the collection may be pinned
      // there); without it, fall back to a library-only refetch.
      if (onRefresh) onRefresh()
      else fetchContent()
    } catch {
      alertDialog.showError('Failed to delete collection')
    }
  }

  // Filter content based on search term. Collections no longer have a
  // description field, so we search the title only.
  const filteredCollections = collections.filter(collection =>
    collection.title.toLowerCase().includes(searchTerm.toLowerCase())
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
    <>
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
        <CreateSkriptModal
          collections={collections.map(c => ({ id: c.id, title: c.title }))}
          onSkriptCreated={() => fetchContent()}
          onSkriptCreatedWithSlug={(slug) => router.push(`/dashboard/skripts/${slug}`)}
        />
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
                        skriptCount={collection.collectionSkripts.length}
                        accentColor={collection.accentColor}
                        isViewOnly={false}
                        index={index}
                        onDelete={handleDeleteCollection}
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
                      skript.authors,
                      session.user.isAdmin
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
    <AlertDialogModal
      open={alertDialog.open}
      onOpenChange={alertDialog.setOpen}
      type={alertDialog.type}
      title={alertDialog.title}
      message={alertDialog.message}
      onConfirm={alertDialog.onConfirm}
      showCancel={alertDialog.showCancel}
      confirmText={alertDialog.confirmText}
      cancelText={alertDialog.cancelText}
      destructive={alertDialog.destructive}
    />
    </>
  )
}
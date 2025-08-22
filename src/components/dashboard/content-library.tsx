'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DraggableCollection, DraggableSkript } from './draggable-content'
import { Search, BookOpen, FileText } from 'lucide-react'
import { CollectionAuthor, SkriptAuthor, User, Collection, Skript } from '@prisma/client'
import { checkCollectionPermissions, checkSkriptPermissions } from '@/lib/permissions'

interface CollectionWithAuthors extends Collection {
  authors: (CollectionAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  skripts: Skript[]
}

interface SkriptWithAuthors extends Skript {
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  collection: {
    authors: (CollectionAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  }
  pages: Array<{ id: string }>
}

export function ContentLibrary() {
  const { data: session } = useSession()
  const [collections, setCollections] = useState<CollectionWithAuthors[]>([])
  const [skripts, setSkripts] = useState<SkriptWithAuthors[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchContent = async () => {
      if (!session?.user?.id) return

      try {
        // Fetch collections with author information
        const collectionsResponse = await fetch('/api/collections?includeShared=true')
        if (collectionsResponse.ok) {
          const collectionsData = await collectionsResponse.json()
          setCollections(collectionsData.data || [])
        }

        // Fetch skripts with author information
        const skriptsResponse = await fetch('/api/skripts?includeShared=true')
        if (skriptsResponse.ok) {
          const skriptsData = await skriptsResponse.json()
          setSkripts(skriptsData.data || [])
        }
      } catch (error) {
        console.error('Error fetching content:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchContent()
  }, [session?.user?.id])

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
    <Card className="h-full">
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
      </CardHeader>
      <CardContent className="space-y-6 overflow-auto max-h-[calc(100vh-200px)]">
        {/* Collections Section */}
        {filteredCollections.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Collections ({filteredCollections.length})
            </h3>
            <div className="space-y-2">
              {filteredCollections.map((collection) => {
                const permissions = checkCollectionPermissions(session.user.id, collection.authors)
                const isViewOnly = !permissions.canEdit

                return (
                  <DraggableCollection
                    key={collection.id}
                    type="collection"
                    id={collection.id}
                    title={collection.title}
                    description={collection.description || undefined}
                    skriptCount={collection.skripts.length}
                    authors={collection.authors}
                    currentUserId={session.user.id}
                    isViewOnly={isViewOnly}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Skripts Section */}
        {filteredSkripts.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Skripts ({filteredSkripts.length})
            </h3>
            <div className="space-y-2">
              {filteredSkripts.map((skript) => {
                const permissions = checkSkriptPermissions(
                  session.user.id,
                  skript.authors,
                  skript.collection.authors
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
                  />
                )
              })}
            </div>
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
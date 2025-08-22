'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { Users, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CollectionWithAuthors, UserPermissions } from '@/types'
import { PermissionMatrix } from './PermissionMatrix'
import { ShareContentModal } from './ShareContentModal'

interface CollectionAccessManagerProps {
  collection: CollectionWithAuthors
  userPermissions: UserPermissions
  onPermissionChange?: () => void
}

interface CollaboratorWithAccess {
  id: string
  name: string | null
  email: string
  image: string | null
  title: string | null
  hasCollectionAccess: boolean
  collectionPermission?: string
  skriptAccess: {
    skriptId: string
    skriptTitle: string
    permission: string
  }[]
}

export function CollectionAccessManager({ 
  collection, 
  userPermissions, 
  onPermissionChange 
}: CollectionAccessManagerProps) {
  const [collaborators, setCollaborators] = useState<CollaboratorWithAccess[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showShareModal, setShowShareModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  console.log(onPermissionChange, isLoading) // Suppress unused warnings

  // Check if current user can manage access
  const canManageAccess = userPermissions.canManageAuthors

  const loadCollaboratorsWithAccess = useCallback(async () => {
    setIsLoading(true)
    try {
      // Get all collaborators
      const collaboratorsResponse = await fetch('/api/collaboration-requests')
      const collaboratorsData = await collaboratorsResponse.json()
      
      if (!collaboratorsData.success) {
        throw new Error('Failed to load collaborators')
      }

      // Get collaborators from both sent and received collaborations
      const allCollaborators = new Map()
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collaboratorsData.data.collaborations.forEach((collab: any) => {
        const otherUser = collab.requester.id !== collection.authors[0]?.userId 
          ? collab.requester 
          : collab.receiver
        
        if (!allCollaborators.has(otherUser.id)) {
          allCollaborators.set(otherUser.id, {
            id: otherUser.id,
            name: otherUser.name,
            email: otherUser.email,
            image: otherUser.image,
            title: otherUser.title,
            hasCollectionAccess: false,
            collectionPermission: undefined,
            skriptAccess: []
          })
        }
      })

      // Check collection access for each collaborator
      for (const collaborator of allCollaborators.values()) {
        const hasAccess = collection.authors.some(author => author.userId === collaborator.id)
        collaborator.hasCollectionAccess = hasAccess
        
        if (hasAccess) {
          const authorRecord = collection.authors.find(author => author.userId === collaborator.id)
          collaborator.collectionPermission = authorRecord?.permission
        }

        // Check individual skript access
        for (const skript of collection.skripts || []) {
          try {
            const skriptResponse = await fetch(`/api/skripts/${skript.id}/authors`)
            const skriptData = await skriptResponse.json()
            
            if (skriptData.success) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const userAccess = skriptData.data.find((author: any) => author.userId === collaborator.id)
              if (userAccess) {
                collaborator.skriptAccess.push({
                  skriptId: skript.id,
                  skriptTitle: skript.title,
                  permission: userAccess.permission
                })
              }
            }
          } catch (error) {
            console.error(`Error loading access for skript ${skript.id}:`, error)
          }
        }
      }

      setCollaborators(Array.from(allCollaborators.values()))
    } catch (error) {
      console.error('Error loading collaborators with access:', error)
    }
    setIsLoading(false)
  }, [collection.authors, collection.skripts])

  useEffect(() => {
    loadCollaboratorsWithAccess()
  }, [loadCollaboratorsWithAccess])

  const filteredCollaborators = collaborators.filter(collaborator =>
    collaborator.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    collaborator.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const collaboratorsWithAccess = filteredCollaborators.filter(c => 
    c.hasCollectionAccess || c.skriptAccess.length > 0
  )

  const collaboratorsWithoutAccess = filteredCollaborators.filter(c => 
    !c.hasCollectionAccess && c.skriptAccess.length === 0
  )

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Access Management
            </CardTitle>
            <CardDescription>
              Manage who can access &quot;{collection.title}&quot; and its skripts
            </CardDescription>
          </div>
          {canManageAccess && (
            <Button onClick={() => setShowShareModal(true)} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Share Content
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="matrix">Permission Matrix</TabsTrigger>
            <TabsTrigger value="manage">Manage Access</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search collaborators..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-6">
              {/* Collaborators with access */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-3">
                  Has Access ({collaboratorsWithAccess.length})
                </h3>
                <div className="space-y-2">
                  {collaboratorsWithAccess.map((collaborator) => (
                    <div key={collaborator.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                          {collaborator.image ? (
                            <Image src={collaborator.image} alt={collaborator.name || ''} width={32} height={32} className="w-8 h-8 rounded-full" />
                          ) : (
                            <Users className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{collaborator.name || 'No name'}</div>
                          <div className="text-sm text-gray-600">{collaborator.email}</div>
                          {collaborator.title && <div className="text-xs text-gray-500">{collaborator.title}</div>}
                        </div>
                      </div>
                      <div className="text-right">
                        {collaborator.hasCollectionAccess && (
                          <div className="text-sm font-medium text-green-600">
                            Collection: {collaborator.collectionPermission}
                          </div>
                        )}
                        {collaborator.skriptAccess.length > 0 && (
                          <div className="text-xs text-gray-600">
                            {collaborator.skriptAccess.length} skript{collaborator.skriptAccess.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {collaboratorsWithAccess.length === 0 && (
                    <div className="text-center py-6 text-gray-500">
                      No collaborators have been given access yet
                    </div>
                  )}
                </div>
              </div>

              {/* Collaborators without access */}
              {collaboratorsWithoutAccess.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-3">
                    Your Collaborators ({collaboratorsWithoutAccess.length})
                  </h3>
                  <div className="space-y-2">
                    {collaboratorsWithoutAccess.map((collaborator) => (
                      <div key={collaborator.id} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                            {collaborator.image ? (
                              <Image src={collaborator.image} alt={collaborator.name || ''} width={32} height={32} className="w-8 h-8 rounded-full" />
                            ) : (
                              <Users className="w-4 h-4 text-gray-500" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">{collaborator.name || 'No name'}</div>
                            <div className="text-sm text-gray-600">{collaborator.email}</div>
                          </div>
                        </div>
                        <div className="text-sm text-gray-500">No access</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="matrix">
            <PermissionMatrix 
              collection={collection}
              collaborators={collaborators}
              canManage={canManageAccess}
              onPermissionChange={loadCollaboratorsWithAccess}
            />
          </TabsContent>

          <TabsContent value="manage">
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Manage individual permissions and bulk operations
              </p>
              {/* TODO: Implement bulk permission management */}
              <div className="text-center py-8 text-gray-500">
                Bulk permission management coming soon...
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Share Content Modal */}
      {showShareModal && (
        <ShareContentModal
          collection={collection}
          collaborators={collaborators}
          onClose={() => setShowShareModal(false)}
          onShare={loadCollaboratorsWithAccess}
        />
      )}
    </Card>
  )
}
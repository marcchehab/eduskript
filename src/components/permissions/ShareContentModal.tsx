'use client'

import { useState } from 'react'
import { Users, Share2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CollectionWithAuthors, Permission } from '@/types'

interface ShareContentModalProps {
  collection: CollectionWithAuthors
  collaborators: Array<{
    id: string
    name: string | null
    email: string
    image: string | null
    hasCollectionAccess: boolean
    collectionPermission?: string
    skriptAccess: {
      skriptId: string
      skriptTitle: string
      permission: string
    }[]
  }>
  onClose: () => void
  onShare: () => void
}

interface ShareAction {
  type: 'collection' | 'skript'
  id: string
  title: string
  permission: Permission
}

export function ShareContentModal({ 
  collection, 
  collaborators, 
  onClose, 
  onShare 
}: ShareContentModalProps) {
  const [selectedCollaborator, setSelectedCollaborator] = useState<string>('')
  const [shareActions, setShareActions] = useState<ShareAction[]>([])
  const [isSharing, setIsSharing] = useState(false)

  // Filter collaborators who don't already have full collection access
  const availableCollaborators = collaborators.filter(c => 
    !c.hasCollectionAccess || c.collectionPermission !== 'author'
  )

  const selectedCollaboratorData = availableCollaborators.find(c => c.id === selectedCollaborator)

  const handleShareActionChange = (
    type: 'collection' | 'skript',
    id: string,
    title: string,
    checked: boolean,
    permission: Permission = 'viewer'
  ) => {
    if (checked) {
      setShareActions(prev => [...prev.filter(a => !(a.type === type && a.id === id)), {
        type,
        id,
        title,
        permission
      }])
    } else {
      setShareActions(prev => prev.filter(a => !(a.type === type && a.id === id)))
    }
  }

  const handlePermissionChange = (actionIndex: number, permission: Permission) => {
    setShareActions(prev => prev.map((action, index) => 
      index === actionIndex ? { ...action, permission } : action
    ))
  }

  const handleShare = async () => {
    if (!selectedCollaborator || shareActions.length === 0) return

    setIsSharing(true)
    try {
      // Execute all share actions
      for (const action of shareActions) {
        if (action.type === 'collection') {
          await fetch(`/api/collections/${action.id}/authors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId: selectedCollaborator, 
              permission: action.permission 
            })
          })
        } else {
          await fetch(`/api/skripts/${action.id}/authors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId: selectedCollaborator, 
              permission: action.permission 
            })
          })
        }
      }

      onShare()
      onClose()
    } catch (error) {
      console.error('Error sharing content:', error)
      // TODO: Add toast notification
    }
    setIsSharing(false)
  }

  const getCollaboratorCurrentAccess = (collaboratorId: string) => {
    const collaborator = collaborators.find(c => c.id === collaboratorId)
    if (!collaborator) return { collection: false, skripts: [] }

    return {
      collection: collaborator.hasCollectionAccess,
      collectionPermission: collaborator.collectionPermission,
      skripts: collaborator.skriptAccess.map(access => ({
        id: access.skriptId,
        permission: access.permission
      }))
    }
  }

  const currentAccess = selectedCollaborator ? getCollaboratorCurrentAccess(selectedCollaborator) : null

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Share Content
          </DialogTitle>
          <DialogDescription>
            Give a collaborator access to &quot;{collection.title}&quot; or specific skripts within it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Select Collaborator */}
          <div>
            <label className="text-sm font-medium">Select Collaborator</label>
            <Select value={selectedCollaborator} onValueChange={setSelectedCollaborator}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Choose a collaborator to share with..." />
              </SelectTrigger>
              <SelectContent>
                {availableCollaborators.map((collaborator) => (
                  <SelectItem key={collaborator.id} value={collaborator.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
                        {collaborator.image ? (
                          <img src={collaborator.image} alt={collaborator.name || ''} className="w-6 h-6 rounded-full" />
                        ) : (
                          <Users className="w-3 h-3 text-gray-500" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{collaborator.name || 'No name'}</div>
                        <div className="text-xs text-gray-600">{collaborator.email}</div>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {availableCollaborators.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                No collaborators available to share with. All your collaborators already have full access to this collection.
              </p>
            )}
          </div>

          {/* Current Access Status */}
          {selectedCollaboratorData && currentAccess && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Current Access</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Collection:</span>
                  <span className={currentAccess.collection ? 'text-green-600' : 'text-gray-500'}>
                    {currentAccess.collection 
                      ? `${currentAccess.collectionPermission} access` 
                      : 'No access'
                    }
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Individual skripts:</span>
                  <span className="text-gray-600">
                    {currentAccess.skripts.length} of {collection.skripts?.length || 0} skripts
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Share Options */}
          {selectedCollaborator && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium">What would you like to share?</h3>

              {/* Collection Access */}
              {!currentAccess?.collection && (
                <Card className="border-2 border-dashed">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="share-collection"
                        checked={shareActions.some(a => a.type === 'collection')}
                        onCheckedChange={(checked) => 
                          handleShareActionChange('collection', collection.id, collection.title, !!checked)
                        }
                      />
                      <div className="flex-1">
                        <label htmlFor="share-collection" className="font-medium cursor-pointer">
                          Entire Collection
                        </label>
                        <p className="text-sm text-gray-600 mt-1">
                          Grant access to &quot;{collection.title}&quot; and all skripts within it
                        </p>
                        
                        {shareActions.find(a => a.type === 'collection') && (
                          <div className="mt-3">
                            <Select
                              value={shareActions.find(a => a.type === 'collection')?.permission || 'viewer'}
                              onValueChange={(value) => {
                                const actionIndex = shareActions.findIndex(a => a.type === 'collection')
                                if (actionIndex >= 0) {
                                  handlePermissionChange(actionIndex, value as Permission)
                                }
                              }}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">Viewer</SelectItem>
                                <SelectItem value="author">Author</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Individual Skripts */}
              <div>
                <h4 className="text-sm font-medium mb-3">Or share individual skripts:</h4>
                <div className="space-y-2">
                  {collection.skripts?.map((skript) => {
                    const hasCurrentAccess = currentAccess?.skripts.some(s => s.id === skript.id)
                    const isShared = shareActions.some(a => a.type === 'skript' && a.id === skript.id)
                    
                    if (hasCurrentAccess && !isShared) {
                      return (
                        <div key={skript.id} className="flex items-center justify-between p-3 border rounded bg-gray-50">
                          <div>
                            <div className="font-medium text-sm">{skript.title}</div>
                            <div className="text-xs text-gray-600">Already has access</div>
                          </div>
                          <Check className="w-4 h-4 text-green-500" />
                        </div>
                      )
                    }

                    return (
                      <Card key={skript.id} className="border">
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              id={`share-skript-${skript.id}`}
                              checked={isShared}
                              onCheckedChange={(checked) => 
                                handleShareActionChange('skript', skript.id, skript.title, !!checked)
                              }
                            />
                            <div className="flex-1">
                              <label htmlFor={`share-skript-${skript.id}`} className="font-medium cursor-pointer text-sm">
                                {skript.title}
                              </label>
                              {skript.description && (
                                <p className="text-xs text-gray-600 mt-1">{skript.description}</p>
                              )}
                              
                              {isShared && (
                                <div className="mt-2">
                                  <Select
                                    value={shareActions.find(a => a.type === 'skript' && a.id === skript.id)?.permission || 'viewer'}
                                    onValueChange={(value) => {
                                      const actionIndex = shareActions.findIndex(a => a.type === 'skript' && a.id === skript.id)
                                      if (actionIndex >= 0) {
                                        handlePermissionChange(actionIndex, value as Permission)
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-32">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="viewer">Viewer</SelectItem>
                                      <SelectItem value="author">Author</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleShare}
              disabled={!selectedCollaborator || shareActions.length === 0 || isSharing}
            >
              {isSharing ? 'Sharing...' : `Share ${shareActions.length} item${shareActions.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
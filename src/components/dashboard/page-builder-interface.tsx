'use client'

import { DragDropContext, DropResult, DragStart } from '@hello-pangea/dnd'
import { useState, useEffect } from 'react'
import { ContentLibrary } from './content-library'
import { PageBuilder } from './page-builder'
import { ImportExportSettings } from './import-export-settings'
import { useSession } from 'next-auth/react'
import { checkCollectionPermissions, checkSkriptPermissions } from '@/lib/permissions'

interface PageItem {
  id: string
  type: 'collection' | 'skript'
  title: string
  description?: string
  order: number
  slug?: string
  collectionSlug?: string // For skripts
  parentId?: string // For nested skripts under collections
  skripts?: PageItem[] // For collections containing skripts
  isInLayout?: boolean // For skripts: whether they're explicitly in the page layout
  isFromLibrary?: boolean // For skripts: whether they were just added from library (skip move API)
  isPublished?: boolean // For skripts: whether the skript is published
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
}

interface DragData {
  type: 'collection' | 'skript'
  id: string
  title: string
  description?: string
  fromLibrary?: boolean
  parentId?: string
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
}

export function PageBuilderInterface() {
  const { data: session } = useSession()
  const [pageItems, setPageItems] = useState<PageItem[]>([])
  const [activeItem, setActiveItem] = useState<DragData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [libraryData, setLibraryData] = useState<{ collections: any[], skripts: any[] }>({ collections: [], skripts: [] })
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Load existing page layout on component mount
  useEffect(() => {
    const loadPageLayout = async () => {
      try {
        const response = await fetch('/api/page-layout')
        if (response.ok) {
          const data = await response.json()
          if (data.data?.items) {
            // Separate collections and skripts
            const collections = data.data.items.filter((item: { type: string }) => item.type === 'collection')
            const skripts = data.data.items.filter((item: { type: string }) => item.type === 'skript')
            
            // Fetch collection details with their skripts from junction table
            const collectionsWithSkripts = await Promise.all(
              collections.map(async (item: { contentId: string; order: number }) => {
                try {
                  const contentResponse = await fetch(`/api/collections/${item.contentId}`)
                  if (contentResponse.ok) {
                    const contentData = await contentResponse.json()
                    const collection = contentData.data || contentData
                    
                    // Get skripts from the junction table (CollectionSkript) and fetch their individual permissions
                    const collectionSkripts = await Promise.all(
                      (collection.collectionSkripts || [])
                        .map(async (cs: { skript: { id: string; title: string; description?: string; slug: string; isPublished: boolean }, order: number }) => {
                          // Fetch individual skript permissions
                          // Note: The API now properly handles collection-level permission inheritance
                          // If the user has collection access, the API will return at minimum view-only permissions
                          let skriptPermissions = { canEdit: false, canView: true }
                          try {
                            const skriptResponse = await fetch(`/api/skripts/${cs.skript.id}`)
                            if (skriptResponse.ok) {
                              const skriptData = await skriptResponse.json()
                              skriptPermissions = skriptData.permissions || skriptPermissions
                            }
                          } catch {
                            // Silently use default permissions
                          }

                          return {
                            id: cs.skript.id,
                            type: 'skript' as const,
                            title: cs.skript.title || `skript ${cs.skript.id}`,
                            description: cs.skript.description,
                            order: cs.order, // Use order from junction table
                            slug: cs.skript.slug,
                            collectionSlug: collection.slug,
                            parentId: item.contentId,
                            permissions: skriptPermissions, // Use individual skript permissions
                            isInLayout: true, // All skripts in CollectionSkript are part of the layout
                            isPublished: cs.skript.isPublished
                          }
                        })
                    )
                    
                    return {
                      id: item.contentId,
                      type: 'collection' as const,
                      title: collection.title || contentData.title || `collection ${item.contentId}`,
                      description: collection.description || contentData.description,
                      order: item.order,
                      slug: collection.slug || contentData.slug,
                      permissions: contentData.permissions,
                      skripts: collectionSkripts.sort((a: { order: number }, b: { order: number }) => a.order - b.order)
                    }
                  }
                } catch {
                  // Silently use fallback
                }
                
                return {
                  id: item.contentId,
                  type: 'collection' as const,
                  title: `collection ${item.contentId}`,
                  order: item.order,
                  skripts: []
                }
              })
            )
            
            // Fetch root-level skripts from junction table (collectionId = null, userId = currentUser)
            // For now, we'll use the skripts from page layout that aren't in collections
            // TODO: Later we should fetch actual root-level skripts from CollectionSkript with collectionId = null
            const rootSkripts = await Promise.all(
              skripts.map(async (item: { contentId: string; order: number }) => {
                try {
                  const contentResponse = await fetch(`/api/skripts/${item.contentId}`)
                  if (contentResponse.ok) {
                    const contentData = await contentResponse.json()
                    const skript = contentData.data || contentData
                    
                    // Check if this skript is already included in a collection above
                    const isInCollection = collectionsWithSkripts.some(c => 
                      c.skripts?.some((s: PageItem) => s.id === item.contentId)
                    )
                    
                    if (!isInCollection) {
                      return {
                        id: item.contentId,
                        type: 'skript' as const,
                        title: skript.title || contentData.title || `skript ${item.contentId}`,
                        description: skript.description || contentData.description,
                        order: item.order,
                        slug: skript.slug || contentData.slug,
                        permissions: contentData.permissions
                      }
                    }
                  }
                } catch {
                  // Silently continue
                }
                return null
              })
            )
            
            const validRootSkripts = rootSkripts.filter(s => s !== null)
            
            // Combine collections and root skripts
            const allItems = [...collectionsWithSkripts, ...validRootSkripts]
              .sort((a, b) => a.order - b.order)
            
            setPageItems(allItems)
            
            // Auto-expand all collections by default
            const collectionsToExpand = allItems
              .filter(item => item.type === 'collection')
              .map(item => item.id)
            setExpandedCollections(collectionsToExpand)
          }
        }
      } catch {
        // Silent error - will show empty page builder
      } finally {
        setLoading(false)
      }
    }

    loadPageLayout()
  }, [])

  const handleItemsChange = async (items: PageItem[], changedCollectionIds?: Set<string>) => {
    // Update UI state immediately
    setPageItems(items)
    
    try {
      // Save page layout  
      const pageLayoutItems = items
        .filter(item => item.type === 'collection' || !item.parentId)
        .map((item, index) => ({
          id: item.id,
          type: item.type,
          order: index
        }))
      
      await fetch('/api/page-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: pageLayoutItems }),
      })

      // Save collection memberships using batch update
      // Only update collections that changed (if we know which ones)
      const collectionsToUpdate = changedCollectionIds 
        ? items.filter(item => item.type === 'collection' && changedCollectionIds.has(item.id))
        : items.filter(item => item.type === 'collection')
      
      for (const collection of collectionsToUpdate) {
        // Skip collections without edit permissions
        if (!collection.permissions?.canEdit) {
          continue
        }

        // Prepare skripts data for batch update
        const skriptsData = collection.skripts?.map((skript, index) => ({
          id: skript.id,
          order: index
        })) || []

        // Use batch update endpoint
        await fetch(`/api/collections/${collection.id}/skripts/batch`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skripts: skriptsData }),
        })
      }
    } catch {
      // Silent error - UI already updated optimistically
    }
  }

  const handleDragStart = (start: DragStart) => {
    // Parse the draggable ID to get drag data
    const draggableId = start.draggableId
    
    let dragData: DragData | null = null
    
    if (draggableId.startsWith('library-collection-')) {
      const collectionId = draggableId.replace('library-collection-', '')
      // Find collection data from library
      const collection = libraryData.collections.find(c => c.id === collectionId)
      dragData = { 
        type: 'collection', 
        id: collectionId, 
        title: collection?.title || '', 
        description: collection?.description,
        fromLibrary: true 
      }
    } else if (draggableId.startsWith('library-skript-')) {
      const skriptId = draggableId.replace('library-skript-', '')
      // Find skript data from library
      const skript = libraryData.skripts.find(s => s.id === skriptId)
      dragData = { 
        type: 'skript', 
        id: skriptId, 
        title: skript?.title || '', 
        description: skript?.description,
        fromLibrary: true 
      }
    } else if (draggableId.startsWith('collection-')) {
      const collectionId = draggableId.replace('collection-', '')
      const collection = pageItems.find(item => item.id === collectionId)
      if (collection) {
        dragData = { type: 'collection', id: collectionId, title: collection.title, description: collection.description }
      }
    } else if (draggableId.includes('-skript-')) {
      // Handle skript dragging: parentId-skript-skriptId
      const [parentId, , skriptId] = draggableId.split('-')
      const collection = pageItems.find(item => item.id === parentId)
      const skript = collection?.skripts?.find(s => s.id === skriptId)
      if (skript) {
        dragData = { 
          type: 'skript', 
          id: skriptId, 
          title: skript.title, 
          description: skript.description,
          parentId,
          permissions: skript.permissions
        }
      }
    }
    
    setActiveItem(dragData)
    
    // Auto-expand editable collections when dragging skripts
    if (dragData?.type === 'skript') {
      const editableCollections = pageItems
        .filter(item => item.type === 'collection' && item.permissions?.canEdit)
        .map(c => c.id)
      setExpandedCollections(prev => [...new Set([...prev, ...editableCollections])])
    }
  }


  const handleDragEnd = (result: DropResult) => {
    setActiveItem(null)

    const { destination, draggableId } = result
    if (!destination) {
      return
    }

    // Parse draggable data from draggableId
    let dragData: (DragData & { parentId?: string }) | null = null
    
    if (draggableId.startsWith('library-collection-')) {
      const collectionId = draggableId.replace('library-collection-', '')
      // Find collection in library data
      const collection = libraryData.collections.find(c => c.id === collectionId)
      dragData = { 
        type: 'collection', 
        id: collectionId, 
        title: collection?.title || `Collection ${collectionId}`, 
        description: collection?.description,
        fromLibrary: true 
      }
    } else if (draggableId.startsWith('library-skript-')) {
      const skriptId = draggableId.replace('library-skript-', '')
      // Find skript in library data  
      const skript = libraryData.skripts.find(s => s.id === skriptId)
      dragData = { 
        type: 'skript', 
        id: skriptId, 
        title: skript?.title || `Skript ${skriptId}`, 
        description: skript?.description,
        fromLibrary: true 
      }
    } else if (draggableId.startsWith('collection-')) {
      const collectionId = draggableId.replace('collection-', '')
      const collection = pageItems.find(item => item.id === collectionId)
      if (collection) {
        dragData = { type: 'collection', id: collectionId, title: collection.title, description: collection.description }
      }
    } else if (draggableId.includes('-skript-')) {
      const [parentId, , skriptId] = draggableId.split('-')
      const collection = pageItems.find(item => item.id === parentId)
      const skript = collection?.skripts?.find(s => s.id === skriptId)
      if (skript) {
        dragData = { 
          type: 'skript', 
          id: skriptId, 
          title: skript.title, 
          description: skript.description,
          parentId,
          permissions: skript.permissions
        }
      }
    }
    
    if (!dragData) {
      return
    }

    const destinationId = destination.droppableId

    // Check if trying to drop a skript at root level (not allowed)
    if (destinationId === 'page-builder' && dragData?.type === 'skript') {
      return // Skripts can only be in collections
    }

    // Simple insertion logic based on drop target
    let updatedItems = [...pageItems]
    let hasChanges = false
    const changedCollectionIds = new Set<string>()

    // Track whether this is a move operation (not from library AND has a parent)
    const isMovingExistingSkript = !dragData?.fromLibrary && dragData?.type === 'skript' && dragData?.parentId

    if (destinationId === 'page-builder') {
      // Drop to root level
      if (dragData?.type === 'collection') {
        if (dragData.fromLibrary && !pageItems.some(item => item.id === dragData.id && item.type === dragData.type)) {
          // Add new collection from library
          const collection = libraryData.collections.find(c => c.id === dragData.id)
          const collectionPermissions = collection && session?.user?.id 
            ? checkCollectionPermissions(session.user.id, collection.authors)
            : { canEdit: false, canView: false }
          
          const newItem: PageItem = {
            id: dragData.id,
            type: dragData.type,
            title: dragData.title,
            description: dragData.description,
            order: pageItems.length,
            permissions: collectionPermissions,
            slug: collection?.slug,
            skripts: collection?.collectionSkripts?.map((cs: any, idx: number) => {
              // Calculate skript permissions
              // According to permission model: "Collection authors can view all skripts in their collections"
              const directSkriptPermissions = session?.user?.id
                ? checkSkriptPermissions(session.user.id, cs.skript.authors || [])
                : { canEdit: false, canView: false }

              // If user has collection access but no direct skript access, grant view-only
              const skriptPermissions = directSkriptPermissions.canView
                ? directSkriptPermissions
                : collectionPermissions.canView || collectionPermissions.canEdit
                  ? { canEdit: false, canView: true }  // Collection-level view inheritance
                  : { canEdit: false, canView: false }

              return {
                id: cs.skript.id,
                type: 'skript' as const,
                title: cs.skript.title,
                description: cs.skript.description,
                order: idx,
                parentId: dragData.id,
                slug: cs.skript.slug,
                collectionSlug: collection.slug,
                permissions: skriptPermissions
              }
            }) || []
          }
          updatedItems.push(newItem)
          hasChanges = true
          
          // Auto-expand the newly added collection to show its skripts
          setExpandedCollections(prev => [...new Set([...prev, dragData.id])])
        } else if (!dragData.fromLibrary) {
          // Reorder existing collection within page builder
          const sourceIndex = updatedItems.findIndex(item => item.id === dragData.id)
          if (sourceIndex !== -1 && sourceIndex !== destination.index) {
            // Remove from current position
            const [movedItem] = updatedItems.splice(sourceIndex, 1)
            // Insert at new position
            updatedItems.splice(destination.index, 0, movedItem)
            // Update order for all items
            updatedItems.forEach((item, index) => {
              item.order = index
            })
            hasChanges = true
          }
        }
      }
    } else if (destinationId.startsWith('collection-')) {
      // Drop into collection header
      const collectionId = destinationId.replace('collection-', '')
      const collectionIndex = updatedItems.findIndex(item => item.id === collectionId)
      
      if (collectionIndex !== -1) {
        // Only allow skripts to be dropped on collection headers, not other collections
        if (dragData?.type === 'collection') {
          return // Collections can't be nested
        }
        
        if (dragData?.type === 'skript') {
          const targetCollection = updatedItems[collectionIndex]
          
          // Check target collection permissions FIRST
          if (!targetCollection.permissions?.canEdit) {
            return // No edit permissions
          }
          
          // Remove from source if moving
          if (isMovingExistingSkript) {
            const sourceCollectionIndex = updatedItems.findIndex(item => item.id === dragData.parentId)
            if (sourceCollectionIndex !== -1) {
              const sourceCollection = updatedItems[sourceCollectionIndex]
              if (sourceCollection.skripts) {
                sourceCollection.skripts = sourceCollection.skripts.filter(s => s.id !== dragData.id)
                sourceCollection.skripts = sourceCollection.skripts.map((s, idx) => ({
                  ...s,
                  order: idx
                }))
                if (dragData.parentId) changedCollectionIds.add(dragData.parentId)
              }
            }
          }
          
          // Add/move skript to collection header (above collection)
          if (!targetCollection.skripts) targetCollection.skripts = []
          
          // Check if already exists
          if (!targetCollection.skripts.some(s => s.id === dragData.id)) {
            const newSkript = {
              id: dragData.id,
              type: 'skript' as const,
              title: dragData.title,
              description: dragData.description,
              order: 0, // Place at beginning when dropping on header
              parentId: collectionId,
              permissions: dragData.permissions
            }
            targetCollection.skripts.unshift(newSkript) // Add at beginning
            changedCollectionIds.add(collectionId)
            hasChanges = true
          }
        }
      }
    } else if (destinationId.startsWith('empty-')) {
      // Drop into empty collection
      const collectionId = destinationId.replace('empty-', '')
      const collectionIndex = updatedItems.findIndex(item => item.id === collectionId)
      
      if (collectionIndex !== -1 && dragData?.type === 'skript') {
        const targetCollection = updatedItems[collectionIndex]
        
        // Check target collection permissions FIRST
        if (!targetCollection.permissions?.canEdit) {
          return // No edit permissions
        }
        
        // Remove from source if moving
        if (isMovingExistingSkript) {
          const sourceCollectionIndex = updatedItems.findIndex(item => item.id === dragData.parentId)
          if (sourceCollectionIndex !== -1) {
            const sourceCollection = updatedItems[sourceCollectionIndex]
            if (sourceCollection.skripts) {
              sourceCollection.skripts = sourceCollection.skripts.filter(s => s.id !== dragData.id)
              sourceCollection.skripts = sourceCollection.skripts.map((s, idx) => ({
                ...s,
                order: idx
              }))
              if (dragData.parentId) changedCollectionIds.add(dragData.parentId)
            }
          }
        }
        
        if (!targetCollection.skripts) targetCollection.skripts = []
        
        // Check if skript is already in this collection to prevent duplicates
        const isAlreadyInCollection = targetCollection.skripts.some(s => s.id === dragData.id)
        if (isAlreadyInCollection) {
          return // Already in collection
        }
        
        const newSkript = {
          id: dragData.id,
          type: 'skript' as const,
          title: dragData.title,
          description: dragData.description,
          order: 0,
          parentId: collectionId,
          permissions: dragData.permissions
        }
        targetCollection.skripts.push(newSkript)
        changedCollectionIds.add(collectionId)
        hasChanges = true
      }
    } else if (destinationId.startsWith('skript-')) {
      // Drop before another skript - use destination.index for position
      const collectionId = destinationId.replace('skript-', '')
      
      const collectionIndex = updatedItems.findIndex(item => item.id === collectionId)
      
      if (collectionIndex !== -1 && dragData?.type === 'skript') {
        const targetCollection = updatedItems[collectionIndex]
        
        // Check target collection permissions FIRST
        if (!targetCollection.permissions?.canEdit) {
          return // No edit permissions
        }

        if (!targetCollection.skripts) targetCollection.skripts = []

        // Check if we're moving within the same collection
        const isMovingWithinSameCollection = isMovingExistingSkript && dragData.parentId === collectionId
        
        if (isMovingWithinSameCollection) {
          // Special handling for reordering within the same collection
          const skriptIndex = targetCollection.skripts!.findIndex(s => s.id === dragData.id)
          if (skriptIndex !== -1) {
            // Remove the skript from its current position
            const [movedSkript] = targetCollection.skripts!.splice(skriptIndex, 1)
            // Insert it at the new position
            targetCollection.skripts!.splice(destination.index, 0, movedSkript)
            // Update order for all skripts
            targetCollection.skripts = targetCollection.skripts!.map((s, idx) => ({
              ...s,
              order: idx
            }))
            changedCollectionIds.add(collectionId)
          }
        } else {
          // Remove from source if moving from a different collection
          if (isMovingExistingSkript) {
            const sourceCollectionIndex = updatedItems.findIndex(item => item.id === dragData.parentId)
            if (sourceCollectionIndex !== -1) {
              const sourceCollection = updatedItems[sourceCollectionIndex]
              if (sourceCollection.skripts) {
                sourceCollection.skripts = sourceCollection.skripts.filter(s => s.id !== dragData.id)
                sourceCollection.skripts = sourceCollection.skripts.map((s, idx) => ({
                  ...s,
                  order: idx
                }))
                if (dragData.parentId) changedCollectionIds.add(dragData.parentId)
              }
            }
          }
          
          // Check if skript is already in this collection to prevent duplicates
          const isAlreadyInCollection = targetCollection.skripts.some(s => s.id === dragData.id)
          if (isAlreadyInCollection && !isMovingExistingSkript) {
            return // Already in collection
          }
          
          const newSkript = {
            id: dragData.id,
            type: 'skript' as const,
            title: dragData.title,
            description: dragData.description,
            order: destination.index,
            parentId: collectionId,
            permissions: dragData.permissions
          }
          
          // Insert at the specified position
          targetCollection.skripts.splice(destination.index, 0, newSkript)
          
          // Reorder all skripts in the collection
          targetCollection.skripts = targetCollection.skripts.map((s, idx) => ({
            ...s,
            order: idx
          }))
        }
        
        changedCollectionIds.add(collectionId)
        hasChanges = true
      }
    }

    if (hasChanges) {
      setPageItems(updatedItems)
      handleItemsChange(updatedItems, changedCollectionIds)
    }
  }

  const handlePreview = () => {
    // Open teacher's public page in a new tab
    if (session?.user?.pageSlug) {
      // Use origin which includes protocol + host correctly
      const url = `${window.location.origin}/${session.user.pageSlug}`
      window.open(url, '_blank')
    } else {
      // Username not set - redirect to settings
      alert('You need to set a Page URL first. Go to Settings > Page Settings to configure it.')
      window.location.href = '/dashboard/settings'
    }
  }

  if (loading) {
    return (
      <DragDropContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-6 h-[calc(100vh-120px)]">
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Loading page builder...</p>
          </div>
          <div className="w-80 flex-shrink-0">
            <ContentLibrary
              onDataLoad={setLibraryData}
              refreshTrigger={refreshTrigger}
            />
          </div>
        </div>
      </DragDropContext>
    )
  }

  return (
    <DragDropContext
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-6 min-h-[400px]">
        {/* Page Builder - Left Side */}
        <div className="flex-1 flex flex-col gap-6">
          <PageBuilder
            items={pageItems}
            onItemsChange={handleItemsChange}
            onPreview={handlePreview}
            expandedCollections={expandedCollections}
            onToggleCollection={(collectionId) => {
              setExpandedCollections(prev =>
                prev.includes(collectionId)
                  ? prev.filter(id => id !== collectionId)
                  : [...prev, collectionId]
              )
            }}
            draggedItem={activeItem}
            onRefresh={() => setRefreshTrigger(prev => prev + 1)}
          />

          {/* Import/Export - under page builder */}
          <ImportExportSettings />
        </div>

        {/* Content Library - Right Side */}
        <div className="w-80 flex-shrink-0">
          <ContentLibrary
            onDataLoad={setLibraryData}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>
    </DragDropContext>
  )
}


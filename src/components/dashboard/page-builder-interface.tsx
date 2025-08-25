'use client'

import { DragDropContext, DropResult, DragStart } from '@hello-pangea/dnd'
import { useState, useEffect } from 'react'
import { ContentLibrary } from './content-library'
import { PageBuilder } from './page-builder'

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
  const [pageItems, setPageItems] = useState<PageItem[]>([])
  const [activeItem, setActiveItem] = useState<DragData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [libraryData, setLibraryData] = useState<{ collections: any[], skripts: any[] }>({ collections: [], skripts: [] })

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
                        .filter((cs: { skript: { isPublished: boolean } }) => cs.skript.isPublished) // Only published skripts
                        .map(async (cs: { skript: { id: string; title: string; description?: string; slug: string; isPublished: boolean }, order: number }) => {
                          // Fetch individual skript permissions
                          let skriptPermissions = { canEdit: false, canView: true }
                          try {
                            const skriptResponse = await fetch(`/api/skripts/${cs.skript.id}`)
                            if (skriptResponse.ok) {
                              const skriptData = await skriptResponse.json()
                              skriptPermissions = skriptData.permissions || skriptPermissions
                            } else if (skriptResponse.status === 403) {
                              // User doesn't have access to this skript - set as view-only
                              skriptPermissions = { canEdit: false, canView: false }
                            } else {
                              console.warn(`Failed to fetch permissions for skript ${cs.skript.id}: ${skriptResponse.status}`)
                            }
                          } catch (error) {
                            console.error(`Error fetching permissions for skript ${cs.skript.id}:`, error)
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
                            isInLayout: true // All skripts in CollectionSkript are part of the layout
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
                } catch (error) {
                  console.error(`Error fetching collection details:`, error)
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
                } catch (error) {
                  console.error(`Error fetching skript details:`, error)
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
      } catch (error) {
        console.error('Error loading page layout:', error)
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
        console.log(`Collection ${collection.id}:`, {
          title: collection.title,
          permissions: collection.permissions,
          skriptsCount: collection.skripts?.length || 0
        })
        
        // Skip collections without edit permissions
        if (!collection.permissions?.canEdit) {
          console.log(`Skipping collection ${collection.id} - no edit permissions`)
          continue
        }
        
        // Prepare skripts data for batch update
        const skriptsData = collection.skripts?.map((skript, index) => ({
          id: skript.id,
          order: index
        })) || []
        
        console.log(`Updating collection ${collection.id} with ${skriptsData.length} skripts`)
        
        // Use batch update endpoint
        const response = await fetch(`/api/collections/${collection.id}/skripts/batch`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skripts: skriptsData }),
        })
        
        if (!response.ok) {
          console.error(`Failed to update collection ${collection.id}:`, await response.text())
        } else {
          console.log(`Successfully updated collection ${collection.id}`)
        }
      }
    } catch (error) {
      console.error('Error saving:', error)
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
    
    console.log('Drag ended:', result)
    
    const { destination, draggableId } = result
    if (!destination) {
      console.log('No destination - drag cancelled')
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
      console.log('No drag data found for:', draggableId)
      return
    }
    
    const destinationId = destination.droppableId
    console.log('Drag data:', dragData, 'Destination:', destinationId)

    // Check if trying to drop a skript at root level (not allowed)
    if (destinationId === 'page-builder' && dragData?.type === 'skript') {
      console.log('Cannot drop skripts at root level - only collections allowed')
      return // Exit early without making any changes
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
          const newItem: PageItem = {
            id: dragData.id,
            type: dragData.type,
            title: dragData.title,
            description: dragData.description,
            order: pageItems.length
          }
          updatedItems.push(newItem)
          hasChanges = true
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
          console.log('Cannot drop collections into other collections')
          return // Exit early without making any changes
        }
        
        if (dragData?.type === 'skript') {
          const targetCollection = updatedItems[collectionIndex]
          
          // Check target collection permissions FIRST
          if (!targetCollection.permissions?.canEdit) {
            console.log(`Cannot drop skript into collection ${collectionId} - no edit permissions`)
            return // Exit early without making any changes
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
          console.log(`Cannot drop skript into empty collection ${collectionId} - no edit permissions`)
          return // Exit early without making any changes
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
          console.log(`Cannot drop skript into collection ${collectionId} - no edit permissions`)
          return // Exit early without making any changes
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
      console.log('Drag ended with changes, updating items:', {
        sourceCollection: dragData?.parentId,
        targetLocation: destinationId,
        skriptId: dragData?.id,
        changedCollections: Array.from(changedCollectionIds)
      })
      setPageItems(updatedItems)
      handleItemsChange(updatedItems, changedCollectionIds)
    } else {
      console.log('Drag ended with no changes')
    }
  }

  const handlePreview = () => {
    // Navigate to preview page or open in new tab
    console.log('Opening preview with items:', pageItems)
    // Could use router.push to a preview route
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
            <ContentLibrary onDataLoad={setLibraryData} />
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
        <div className="flex-1">
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
          />
        </div>

        {/* Content Library - Right Side */}
        <div className="w-80 flex-shrink-0">
          <ContentLibrary onDataLoad={setLibraryData} />
        </div>
      </div>
    </DragDropContext>
  )
}


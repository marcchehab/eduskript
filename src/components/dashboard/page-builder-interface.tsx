'use client'

import { DragDropContext, DropResult, DragStart } from '@hello-pangea/dnd'
import { useState, useEffect } from 'react'
import { ContentLibrary } from './content-library'
import { PageBuilder } from './page-builder'
import { ImportExportSettings } from './import-export-settings'
import { useSession } from 'next-auth/react'
import { checkSkriptPermissions } from '@/lib/permissions'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'

interface PageItem {
  id: string
  type: 'collection' | 'skript'
  title: string
  description?: string
  order: number
  slug?: string
  parentId?: string // For nested skripts under collections
  accentColor?: string | null // For collections: sidebar accent colour
  skripts?: PageItem[] // For collections containing skripts
  isInLayout?: boolean // For skripts: whether they're explicitly in the page layout
  isFromLibrary?: boolean // For skripts: whether they were just added from library (skip move API)
  isPublished?: boolean // For skripts: whether the skript is published
  isUnlisted?: boolean // For skripts: whether the skript is hidden from navigation
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
  // Set when the drag source is an existing root-level skript (sibling of
  // collections in pageItems). Distinguishes "root → collection" moves from
  // library inserts so the source can be removed instead of copied.
  fromRoot?: boolean
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
  // Full source PageItem for skript drags. Spread verbatim on drop so the
  // moved skript keeps every field. Rebuilding it from scattered sources
  // used to silently drop slug + isPublished, which killed the edit button
  // (needs slug) and the publish badge (needs isPublished) on drop.
  sourceItem?: PageItem
}

export interface PageBuilderContext {
  type: 'user' | 'organization'
  organizationId?: string
  organizationSlug?: string
}

interface PageBuilderInterfaceProps {
  context?: PageBuilderContext
}

export function PageBuilderInterface({ context = { type: 'user' } }: PageBuilderInterfaceProps) {
  // Determine API endpoints based on context
  const pageLayoutEndpoint =
    context.type === 'organization' && context.organizationId
      ? `/api/organizations/${context.organizationId}/page-layout`
      : '/api/page-layout'
  const { data: session } = useSession()
  const [pageItems, setPageItems] = useState<PageItem[]>([])
  const [activeItem, setActiveItem] = useState<DragData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [libraryData, setLibraryData] = useState<{ collections: any[], skripts: any[] }>({ collections: [], skripts: [] })
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  // Last collection edited in the page builder (rename / accent colour). Fed to
  // ContentLibrary so its card updates in place without waiting for a refetch.
  const [libraryCollectionUpdate, setLibraryCollectionUpdate] = useState<
    { id: string; title: string; accentColor?: string | null } | null
  >(null)
  const alert = useAlertDialog()

  // Load existing page layout on component mount
  useEffect(() => {
    const loadPageLayout = async () => {
      try {
        const response = await fetch(pageLayoutEndpoint)
        if (response.ok) {
          const data = await response.json()
          // The endpoint returns items fully hydrated (collections with their
          // skripts + permissions) in one request — no per-item fetches.
          const items: PageItem[] = data.data?.items ?? []
          const sorted = [...items].sort((a, b) => a.order - b.order)
          setPageItems(sorted)
          // Auto-expand all collections by default
          setExpandedCollections(
            sorted.filter(item => item.type === 'collection').map(item => item.id)
          )
        }
      } catch {
        // Silent error - will show empty page builder
      } finally {
        setLoading(false)
      }
    }

    loadPageLayout()
  }, [pageLayoutEndpoint, refreshTrigger])

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
      
      await fetch(pageLayoutEndpoint, {
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
      // Handle skript dragging: parentId-skript-skriptId. Split on the
      // literal `-skript-` separator, not on every `-` — UUID-style skript
      // IDs contain hyphens, so `split('-')[2]` would only return the first
      // chunk and the lookup below would silently fail.
      const sep = draggableId.indexOf('-skript-')
      const parentId = draggableId.slice(0, sep)
      const skriptId = draggableId.slice(sep + '-skript-'.length)
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
      const skriptPermissions = session?.user?.id && skript?.authors
        ? checkSkriptPermissions(session.user.id, skript.authors, session.user.isAdmin)
        : { canEdit: true, canView: true }
      dragData = {
        type: 'skript',
        id: skriptId,
        title: skript?.title || `Skript ${skriptId}`,
        description: skript?.description,
        fromLibrary: true,
        sourceItem: skript ? {
          id: skript.id,
          type: 'skript',
          title: skript.title,
          description: skript.description,
          order: 0,
          slug: skript.slug,
          isPublished: skript.isPublished,
          isUnlisted: skript.isUnlisted,
          permissions: skriptPermissions,
        } : undefined,
      }
    } else if (draggableId.startsWith('root-skript-')) {
      // Root-level skript (sibling of collections) — fromRoot lets the
      // collection-destination handlers remove the source from pageItems so
      // it moves rather than gets copied.
      const skriptId = draggableId.replace('root-skript-', '')
      const skript = pageItems.find(item => item.id === skriptId && item.type === 'skript')
      if (skript) {
        dragData = {
          type: 'skript',
          id: skriptId,
          title: skript.title,
          description: skript.description,
          sourceItem: skript,
          fromRoot: true,
        }
      }
    } else if (draggableId.startsWith('collection-')) {
      const collectionId = draggableId.replace('collection-', '')
      const collection = pageItems.find(item => item.id === collectionId)
      if (collection) {
        dragData = { type: 'collection', id: collectionId, title: collection.title, description: collection.description }
      }
    } else if (draggableId.includes('-skript-')) {
      const sep = draggableId.indexOf('-skript-')
      const parentId = draggableId.slice(0, sep)
      const skriptId = draggableId.slice(sep + '-skript-'.length)
      const collection = pageItems.find(item => item.id === parentId)
      const skript = collection?.skripts?.find(s => s.id === skriptId)
      if (skript) {
        dragData = {
          type: 'skript',
          id: skriptId,
          title: skript.title,
          description: skript.description,
          parentId,
          sourceItem: skript,
        }
      }
    }

    if (!dragData) {
      return
    }

    // Collections can never nest inside another collection. If the library
    // picked a collection-internal droppable as destination (which happens
    // whenever a collection drag overlaps another collection's body, since
    // gap strips only cover ~12px between items), redirect the drop to the
    // gap right after that collection. Without this the handler used to
    // return early and @hello-pangea/dnd would snap the item back — looking
    // like reordering randomly "didn't take."
    let destinationId = destination.droppableId
    if (dragData.type === 'collection') {
      let targetCollectionId: string | null = null
      if (destinationId.startsWith('collection-')) targetCollectionId = destinationId.replace('collection-', '')
      else if (destinationId.startsWith('empty-')) targetCollectionId = destinationId.replace('empty-', '')
      else if (destinationId.startsWith('skript-')) targetCollectionId = destinationId.replace('skript-', '')
      if (targetCollectionId) {
        const idx = pageItems.findIndex(i => i.id === targetCollectionId && i.type === 'collection')
        if (idx !== -1) destinationId = `root-gap-${idx + 1}`
      }
    }

    // Simple insertion logic based on drop target.
    // Clone each item AND its skripts array — the branches below mutate
    // skripts in place (push/splice) and reassign collection.skripts. A plain
    // [...pageItems] shares those nested arrays with React state, so drags
    // leak into each other and skripts get duplicated (the "ghost" rows).
    let updatedItems: PageItem[] = pageItems.map(item => ({
      ...item,
      skripts: item.skripts ? [...item.skripts] : item.skripts,
    }))
    let hasChanges = false
    const changedCollectionIds = new Set<string>()

    // Track whether this is a move operation (not from library AND has a parent)
    const isMovingExistingSkript = !dragData?.fromLibrary && dragData?.type === 'skript' && dragData?.parentId

    if (destinationId.startsWith('root-gap-')) {
      // Gap-strip drop. The droppableId encodes the insertion position in
      // the root list (0..items.length). Gap strips are how root-level
      // moves happen now that the outer page-builder droppable is disabled
      // when items exist — they isolate root drops from collection-internal
      // ones so @hello-pangea/dnd doesn't shadow nested droppables.
      const insertIndex = parseInt(destinationId.replace('root-gap-', ''), 10)

      if (dragData?.type === 'collection') {
        const existingIndex = updatedItems.findIndex(item => item.id === dragData.id && item.type === 'collection')
        if (existingIndex !== -1) {
          // Reorder an existing collection. Splice-then-insert needs an
          // adjusted index because removal shifts subsequent items left.
          const adjusted = existingIndex < insertIndex ? insertIndex - 1 : insertIndex
          if (existingIndex !== adjusted) {
            const [moved] = updatedItems.splice(existingIndex, 1)
            updatedItems.splice(adjusted, 0, moved)
            updatedItems.forEach((it, idx) => { it.order = idx })
            hasChanges = true
          }
        } else if (dragData.fromLibrary) {
          // New collection from the library, inserted at insertIndex.
          const collection = libraryData.collections.find(c => c.id === dragData.id)
          const collectionPermissions = { canEdit: true, canView: true }
          const newItem: PageItem = {
            id: dragData.id,
            type: 'collection',
            title: dragData.title,
            description: dragData.description,
            order: insertIndex,
            permissions: collectionPermissions,
            skripts: collection?.collectionSkripts?.map((cs: any, idx: number) => {
              const skriptPermissions = session?.user?.id
                ? checkSkriptPermissions(session.user.id, cs.skript.authors || [], session.user.isAdmin)
                : { canEdit: false, canView: false }
              return {
                id: cs.skript.id,
                type: 'skript' as const,
                title: cs.skript.title,
                description: cs.skript.description,
                order: idx,
                parentId: dragData.id,
                slug: cs.skript.slug,
                permissions: skriptPermissions
              }
            }) || []
          }
          updatedItems.splice(insertIndex, 0, newItem)
          updatedItems.forEach((it, idx) => { it.order = idx })
          hasChanges = true
          setExpandedCollections(prev => [...new Set([...prev, dragData.id])])
        }
      } else if (dragData?.type === 'skript') {
        const existingRootIndex = updatedItems.findIndex(item => item.id === dragData.id && item.type === 'skript')
        if (existingRootIndex !== -1) {
          // Already at root — reorder.
          const adjusted = existingRootIndex < insertIndex ? insertIndex - 1 : insertIndex
          if (existingRootIndex !== adjusted) {
            const [moved] = updatedItems.splice(existingRootIndex, 1)
            updatedItems.splice(adjusted, 0, moved)
            updatedItems.forEach((it, idx) => { it.order = idx })
            hasChanges = true
          }
        } else {
          // Promoted from a collection or freshly dragged in from the library.
          if (isMovingExistingSkript && dragData.parentId) {
            const sourceCollectionIndex = updatedItems.findIndex(item => item.id === dragData.parentId)
            if (sourceCollectionIndex !== -1) {
              const sourceCollection = updatedItems[sourceCollectionIndex]
              if (sourceCollection.skripts) {
                sourceCollection.skripts = sourceCollection.skripts
                  .filter(s => s.id !== dragData.id)
                  .map((s, idx) => ({ ...s, order: idx }))
                changedCollectionIds.add(dragData.parentId)
              }
            }
          }

          // Spread the full source item so slug / isPublished / permissions
          // survive the move — parentId cleared since this lands at root.
          const newRootSkript: PageItem = {
            ...dragData.sourceItem!,
            type: 'skript',
            order: insertIndex,
            parentId: undefined,
          }
          updatedItems.splice(insertIndex, 0, newRootSkript)
          updatedItems.forEach((it, idx) => { it.order = idx })
          hasChanges = true
        }
      }
    } else if (destinationId === 'page-builder') {
      // Drop to root level
      if (dragData?.type === 'collection') {
        if (dragData.fromLibrary && !pageItems.some(item => item.id === dragData.id && item.type === dragData.type)) {
          // Add new collection from library
          const collection = libraryData.collections.find(c => c.id === dragData.id)
          // Collections are always editable by the page owner (just grouping)
          const collectionPermissions = { canEdit: true, canView: true }

          const newItem: PageItem = {
            id: dragData.id,
            type: dragData.type,
            title: dragData.title,
            description: dragData.description,
            order: pageItems.length,
            permissions: collectionPermissions,
            skripts: collection?.collectionSkripts?.map((cs: any, idx: number) => {
              const skriptPermissions = session?.user?.id
                ? checkSkriptPermissions(session.user.id, cs.skript.authors || [], session.user.isAdmin)
                : { canEdit: false, canView: false }

              return {
                id: cs.skript.id,
                type: 'skript' as const,
                title: cs.skript.title,
                description: cs.skript.description,
                order: idx,
                parentId: dragData.id,
                slug: cs.skript.slug,
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
      } else if (dragData?.type === 'skript') {
        // Skript dropped at root level — place as a standalone item, sibling of collections
        const existingRootIndex = updatedItems.findIndex(item => item.id === dragData.id && item.type === 'skript')

        if (existingRootIndex !== -1) {
          // Already at root — reorder within root
          if (existingRootIndex !== destination.index) {
            const [moved] = updatedItems.splice(existingRootIndex, 1)
            updatedItems.splice(destination.index, 0, moved)
            updatedItems.forEach((item, index) => { item.order = index })
            hasChanges = true
          }
        } else {
          // New root skript — from library or moved out of a collection
          // If it came from a collection in pageItems, remove it from that collection's skripts
          if (isMovingExistingSkript && dragData.parentId) {
            const sourceCollectionIndex = updatedItems.findIndex(item => item.id === dragData.parentId)
            if (sourceCollectionIndex !== -1) {
              const sourceCollection = updatedItems[sourceCollectionIndex]
              if (sourceCollection.skripts) {
                sourceCollection.skripts = sourceCollection.skripts
                  .filter(s => s.id !== dragData.id)
                  .map((s, idx) => ({ ...s, order: idx }))
                changedCollectionIds.add(dragData.parentId)
              }
            }
          }

          // Spread the full source item so slug / isPublished / permissions
          // survive the move — parentId cleared since this lands at root.
          const newRootSkript: PageItem = {
            ...dragData.sourceItem!,
            type: 'skript',
            order: destination.index ?? updatedItems.length,
            parentId: undefined,
          }

          // Insert at destination.index
          updatedItems.splice(destination.index, 0, newRootSkript)
          updatedItems.forEach((item, index) => { item.order = index })
          hasChanges = true
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
          } else if (dragData.fromRoot) {
            // Demoting from root into a collection — drop the top-level entry
            // so the skript is moved, not copied. The collection-index lookup
            // above stays valid because dragData.id ≠ collectionId.
            const rootIndex = updatedItems.findIndex(i => i.id === dragData.id && i.type === 'skript')
            if (rootIndex !== -1) {
              updatedItems.splice(rootIndex, 1)
              updatedItems.forEach((it, idx) => { it.order = idx })
            }
          }

          // Add/move skript to collection header (above collection)
          if (!targetCollection.skripts) targetCollection.skripts = []
          
          // Check if already exists
          if (!targetCollection.skripts.some(s => s.id === dragData.id)) {
            // Spread the full source item so slug / isPublished / permissions
            // survive the move.
            const newSkript: PageItem = {
              ...dragData.sourceItem!,
              type: 'skript',
              order: 0, // Place at beginning when dropping on header
              parentId: collectionId,
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
        } else if (dragData.fromRoot) {
          const rootIndex = updatedItems.findIndex(i => i.id === dragData.id && i.type === 'skript')
          if (rootIndex !== -1) {
            updatedItems.splice(rootIndex, 1)
            updatedItems.forEach((it, idx) => { it.order = idx })
          }
        }

        if (!targetCollection.skripts) targetCollection.skripts = []

        // Check if skript is already in this collection to prevent duplicates
        const isAlreadyInCollection = targetCollection.skripts.some(s => s.id === dragData.id)
        if (isAlreadyInCollection) {
          return // Already in collection
        }
        
        // Spread the full source item so slug / isPublished / permissions
        // survive the move.
        const newSkript: PageItem = {
          ...dragData.sourceItem!,
          type: 'skript',
          order: 0,
          parentId: collectionId,
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
          } else if (dragData.fromRoot) {
            const rootIndex = updatedItems.findIndex(i => i.id === dragData.id && i.type === 'skript')
            if (rootIndex !== -1) {
              updatedItems.splice(rootIndex, 1)
              updatedItems.forEach((it, idx) => { it.order = idx })
            }
          }

          // Check if skript is already in this collection to prevent duplicates
          const isAlreadyInCollection = targetCollection.skripts.some(s => s.id === dragData.id)
          if (isAlreadyInCollection && !isMovingExistingSkript && !dragData.fromRoot) {
            return // Already in collection
          }
          
          // Spread the full source item so slug / isPublished / permissions
          // survive the move.
          const newSkript: PageItem = {
            ...dragData.sourceItem!,
            type: 'skript',
            order: destination.index,
            parentId: collectionId,
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
    // Open the public page in a new tab
    if (context.type === 'organization' && context.organizationSlug) {
      window.open(`${window.location.origin}/org/${context.organizationSlug}`, '_blank')
    } else if (session?.user?.pageSlug) {
      const url = `${window.location.origin}/${session.user.pageSlug}`
      window.open(url, '_blank')
    } else {
      // Username not set - show info dialog and redirect to settings
      alert.showInfo(
        'You need to set a Page URL first. You will be redirected to Page Settings.',
        'Page URL Required'
      )
      setTimeout(() => {
        window.location.href = '/dashboard/settings'
      }, 1500)
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
              collectionUpdate={libraryCollectionUpdate}
              onRefresh={() => setRefreshTrigger(prev => prev + 1)}
              context={context}
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
            onCollectionUpdate={(updated) => {
              // Modal handles the API call itself; we just sync local state
              // so the title + accentColor refresh without a full reload.
              setPageItems(items =>
                items.map(it =>
                  it.id === updated.id && it.type === 'collection'
                    ? { ...it, title: updated.title, accentColor: updated.accentColor ?? null }
                    : it
                )
              )
              // Mirror the edit into the content library card.
              setLibraryCollectionUpdate(updated)
            }}
            draggedItem={activeItem}
            onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            context={context}
          />

          {/* Import/Export - under page builder */}
          <ImportExportSettings />
        </div>

        {/* Content Library - Right Side */}
        <div className="w-80 flex-shrink-0">
          <ContentLibrary
            onDataLoad={setLibraryData}
            refreshTrigger={refreshTrigger}
            collectionUpdate={libraryCollectionUpdate}
            onRefresh={() => setRefreshTrigger(prev => prev + 1)}
            context={context}
          />
        </div>
      </div>

      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
        onConfirm={alert.onConfirm}
        showCancel={alert.showCancel}
        confirmText={alert.confirmText}
        cancelText={alert.cancelText}
        destructive={alert.destructive}
      />
    </DragDropContext>
  )
}


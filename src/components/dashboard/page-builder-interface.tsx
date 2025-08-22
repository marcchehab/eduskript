'use client'

import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useState, useEffect } from 'react'
import { ContentLibrary } from './content-library'
import { PageBuilder } from './page-builder'
import { Card, CardContent } from '@/components/ui/card'
import { BookOpen, FileText } from 'lucide-react'

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
}

export function PageBuilderInterface() {
  const [pageItems, setPageItems] = useState<PageItem[]>([])
  const [activeItem, setActiveItem] = useState<DragData | null>(null)
  const [loading, setLoading] = useState(true)

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
            
            // Fetch collection details with their skripts
            const collectionsWithSkripts = await Promise.all(
              collections.map(async (item: { contentId: string; order: number }) => {
                try {
                  const contentResponse = await fetch(`/api/collections/${item.contentId}`)
                  if (contentResponse.ok) {
                    const contentData = await contentResponse.json()
                    const collection = contentData.data || contentData
                    
                    // Fetch skripts that belong to this collection from the page layout
                    const collectionSkripts = await Promise.all(
                      skripts
                        .map(async (skriptItem: { contentId: string; order: number }) => {
                          try {
                            const skriptResponse = await fetch(`/api/skripts/${skriptItem.contentId}`)
                            if (skriptResponse.ok) {
                              const skriptData = await skriptResponse.json()
                              const skript = skriptData.data || skriptData
                              
                              // Only include if it belongs to this collection
                              if (skript.collection?.id === item.contentId) {
                                return {
                                  id: skriptItem.contentId,
                                  type: 'skript' as const,
                                  title: skript.title || skriptData.title || `skript ${skriptItem.contentId}`,
                                  description: skript.description || skriptData.description,
                                  order: skriptItem.order,
                                  slug: skript.slug || skriptData.slug,
                                  collectionSlug: collection.slug,
                                  parentId: item.contentId,
                                  permissions: skriptData.permissions
                                }
                              }
                            }
                          } catch (error) {
                            console.error(`Error fetching skript details:`, error)
                          }
                          return null
                        })
                    )
                    
                    const validSkripts = collectionSkripts.filter(s => s !== null)
                    
                    return {
                      id: item.contentId,
                      type: 'collection' as const,
                      title: collection.title || contentData.title || `collection ${item.contentId}`,
                      description: collection.description || contentData.description,
                      order: item.order,
                      slug: collection.slug || contentData.slug,
                      permissions: contentData.permissions,
                      skripts: validSkripts.sort((a, b) => a.order - b.order)
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
            
            // Fetch root-level skripts (not belonging to any collection in the layout)
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
                        collectionSlug: skript.collection?.slug,
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

  const handleDragStart = (event: DragStartEvent) => {
    const dragData = event.active.data.current as DragData
    console.log('Drag started:', dragData)
    setActiveItem(dragData)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    console.log('Drag ended:', {
      over: event.over?.id,
      active: event.active.id,
      activeData: event.active.data.current
    })
    
    setActiveItem(null)
    
    const { active, over } = event
    
    if (!over) return

    // Handle adding new items from content library
    if (over.id === 'page-builder' && active.data.current) {
      const dragData = active.data.current as DragData
      
      console.log('Dropping item from library:', dragData)
      
      // Check if item is already in the page
      if (pageItems.some(item => item.id === dragData.id && item.type === dragData.type)) {
        console.log('Item already exists in page')
        return
      }

      const newItem: PageItem = {
        id: dragData.id,
        type: dragData.type,
        title: dragData.title,
        description: dragData.description,
        order: pageItems.length
      }

      console.log('Adding new item:', newItem)
      const updated = [...pageItems, newItem]
      setPageItems(updated)
      
      // Save to backend
      handleItemsChange(updated)
      return
    }

    // Handle reordering existing items
    if (active.id !== over.id) {
      console.log('Reordering items:', { activeId: active.id, overId: over.id })
      
      const oldIndex = pageItems.findIndex(item => item.id === active.id)
      const newIndex = pageItems.findIndex(item => item.id === over.id)
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedItems = arrayMove(pageItems, oldIndex, newIndex)
          .map((item, index) => ({ ...item, order: index }))
        
        setPageItems(reorderedItems)
        handleItemsChange(reorderedItems)
      }
    }
  }

  const handleItemsChange = async (items: PageItem[]) => {
    setPageItems(items)
    
    // Flatten the nested structure back to individual items for saving
    const flattenedItems: Array<{ id: string; type: string; order: number }> = []
    
    items.forEach((item, index) => {
      if (item.type === 'collection') {
        // Add the collection itself
        flattenedItems.push({
          id: item.id,
          type: item.type,
          order: index
        })
        
        // Add any nested skripts
        if (item.skripts) {
          item.skripts.forEach((skript) => {
            flattenedItems.push({
              id: skript.id,
              type: skript.type,
              order: flattenedItems.length // Sequential order after collection
            })
          })
        }
      } else {
        // Root-level skript
        flattenedItems.push({
          id: item.id,
          type: item.type,
          order: index
        })
      }
    })
    
    // Save to backend
    try {
      const response = await fetch('/api/page-layout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items: flattenedItems }),
      })
      
      if (response.ok) {
        console.log('Page layout saved successfully')
      } else {
        console.error('Failed to save page layout')
      }
    } catch (error) {
      console.error('Error saving page layout:', error)
    }
  }

  const handlePreview = () => {
    // Navigate to preview page or open in new tab
    console.log('Opening preview with items:', pageItems)
    // Could use router.push to a preview route
  }

  if (loading) {
    return (
      <div className="flex gap-6 h-[calc(100vh-120px)]">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading page builder...</p>
        </div>
        <div className="w-80 flex-shrink-0">
          <ContentLibrary />
        </div>
      </div>
    )
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-6 h-[calc(100vh-120px)]">
        {/* Page Builder - Left Side */}
        <div className="flex-1">
          <PageBuilder
            items={pageItems}
            onItemsChange={handleItemsChange}
            onPreview={handlePreview}
          />
        </div>

        {/* Content Library - Right Side */}
        <div className="w-80 flex-shrink-0">
          <ContentLibrary />
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeItem ? (
          <DragPreview item={activeItem} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface DragPreviewProps {
  item: DragData
}

function DragPreview({ item }: DragPreviewProps) {
  const Icon = item.type === 'collection' ? BookOpen : FileText

  return (
    <Card className="w-64 opacity-90 rotate-2 shadow-lg">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className="w-5 h-5 mt-0.5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm truncate">{item.title}</h3>
            {item.description && (
              <p className="text-xs text-muted-foreground truncate mt-1">
                {item.description}
              </p>
            )}
            <span className="text-xs text-muted-foreground capitalize mt-1 block">
              {item.type}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
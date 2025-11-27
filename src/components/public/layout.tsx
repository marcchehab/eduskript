'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Menu, X, Home, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReadingProgress } from './reading-progress'
import { PublicThemeToggle } from './theme-toggle'
import { AuthButton } from './auth-button'
import { FontSizeControls } from './font-size-controls'
import { SyncStatusButton } from '@/components/ui/sync-status'
import { useLayout } from '@/contexts/layout-context'

interface Teacher {
  name: string
  username: string
  bio?: string
  title?: string
}

interface SiteStructure {
  id: string
  title: string
  slug: string
  skripts: {
    id: string
    title: string
    slug: string
    pages: {
      id: string
      title: string
      slug: string
    }[]
  }[]
}

interface RootSkript {
  id: string
  title: string
  description: string | null
  slug: string
  collection: { title: string, slug: string }
  pages: Array<{ id: string, title: string, slug: string }>
}

interface PublicSiteLayoutProps {
  teacher: Teacher
  siteStructure: SiteStructure[]
  rootSkripts?: RootSkript[]
  children: React.ReactNode
  currentPath?: string
  fullSiteStructure?: SiteStructure[] // Full site structure when sidebarBehavior is "full"
  sidebarBehavior?: 'contextual' | 'full'
  typographyPreference?: 'modern' | 'classic'
  editUrl?: string // URL to edit current page (only shown if user has permission)
}

export function PublicSiteLayout({
  teacher,
  siteStructure,
  rootSkripts = [],
  children,
  currentPath,
  fullSiteStructure,
  sidebarBehavior = 'contextual',
  typographyPreference = 'modern',
  editUrl
}: PublicSiteLayoutProps) {
  const router = useRouter()
  const { setSidebarCollapsed: setSidebarCollapsedInContext, sidebarWidth } = useLayout()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Sync local sidebar collapse state with global context
  useEffect(() => {
    setSidebarCollapsedInContext(isSidebarCollapsed)
  }, [isSidebarCollapsed, setSidebarCollapsedInContext])
  
  // Storage keys for persistence
  const EXPANDED_SCRIPTS_KEY = `expanded-collections-${teacher.username}`
  const EXPANDED_SKRIPTS_KEY = `expanded-skripts-${teacher.username}`
  
  // Initialize with persistent state or defaults
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [expandedSkripts, setExpandedSkripts] = useState<string[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Get initial expanded state from localStorage or defaults
  const getInitialExpandedCollections = useCallback(() => {
    if (typeof window === 'undefined') return siteStructure.map(collection => collection.id)
    
    const stored = localStorage.getItem(EXPANDED_SCRIPTS_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch {
        return siteStructure.map(collection => collection.id)
      }
    }
    // Default: all collections expanded
    return siteStructure.map(collection => collection.id)
  }, [siteStructure, EXPANDED_SCRIPTS_KEY])

  const getInitialExpandedSkripts = useCallback(() => {
    if (typeof window === 'undefined') return []
    
    const stored = localStorage.getItem(EXPANDED_SKRIPTS_KEY)
    let expandedFromStorage: string[] = []
    
    if (stored) {
      try {
        expandedFromStorage = JSON.parse(stored)
      } catch {
        expandedFromStorage = []
      }
    }
    
    // Auto-expand skripts that contain the current page
    const expandedFromCurrentPath: string[] = []
    if (currentPath) {
      siteStructure.forEach(collection => {
        collection.skripts.forEach(skript => {
          const hasCurrentPage = skript.pages.some(page => 
            currentPath === `/${collection.slug}/${skript.slug}/${page.slug}`
          )
          if (hasCurrentPage && !expandedFromStorage.includes(skript.id)) {
            expandedFromCurrentPath.push(skript.id)
          }
        })
      })
    }
    
    return [...expandedFromStorage, ...expandedFromCurrentPath]
  }, [siteStructure, currentPath, EXPANDED_SKRIPTS_KEY])

  // Initialize state from localStorage on client side
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedCollections(getInitialExpandedCollections())
     
    setExpandedSkripts(getInitialExpandedSkripts())
     
    setIsInitialized(true)
  }, [getInitialExpandedCollections, getInitialExpandedSkripts])

  // Update expanded skripts when current path changes
  useEffect(() => {
    if (!isInitialized || !currentPath) return
    
    const newExpandedSkripts = [...expandedSkripts]
    let hasChanges = false
    
    siteStructure.forEach(collection => {
      collection.skripts.forEach(skript => {
        const hasCurrentPage = skript.pages.some(page => 
          currentPath === `/${collection.slug}/${skript.slug}/${page.slug}`
        )
        if (hasCurrentPage && !newExpandedSkripts.includes(skript.id)) {
          newExpandedSkripts.push(skript.id)
          hasChanges = true
        }
      })
    })

    if (hasChanges) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedSkripts(newExpandedSkripts)
    }
  }, [currentPath, isInitialized, expandedSkripts, siteStructure])

  // Persist expanded collections to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_SCRIPTS_KEY, JSON.stringify(expandedCollections))
  }, [expandedCollections, isInitialized, EXPANDED_SCRIPTS_KEY])

  // Persist expanded skripts to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_SKRIPTS_KEY, JSON.stringify(expandedSkripts))
  }, [expandedSkripts, isInitialized, EXPANDED_SKRIPTS_KEY])

  const toggleCollection = (collectionId: string) => {
    setExpandedCollections(prev => 
      prev.includes(collectionId) 
        ? prev.filter(id => id !== collectionId)
        : [...prev, collectionId]
    )
  }

  const toggleSkript = (skriptId: string) => {
    setExpandedSkripts(prev => 
      prev.includes(skriptId) 
        ? prev.filter(id => id !== skriptId)
        : [...prev, skriptId]
    )
  }

  const isCurrentPage = (collectionSlug: string, skriptSlug: string, pageSlug: string) => {
    return currentPath === `/${collectionSlug}/${skriptSlug}/${pageSlug}`
  }

  const navigateToPage = (collectionSlug: string, skriptSlug: string, pageSlug: string) => {
    // Always use path-based routing with username
    const url = `/${teacher.username}/${collectionSlug}/${skriptSlug}/${pageSlug}`

    router.push(url)
    setIsSidebarOpen(false)
  }

  const navigateToSkript = (collectionSlug: string, skriptSlug: string, skriptId: string) => {
    // Navigate to skript frontpage and expand the skript
    const url = `/${teacher.username}/${collectionSlug}/${skriptSlug}`

    // Ensure the skript is expanded
    if (!expandedSkripts.includes(skriptId)) {
      setExpandedSkripts(prev => [...prev, skriptId])
    }

    router.push(url)
    setIsSidebarOpen(false)
  }

  return (
    <div
      className="min-h-screen bg-background overflow-visible"
      data-typography={typographyPreference}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <ReadingProgress />

      {/* Top-right controls - only visible on mobile when sidebar is closed */}
      <div className="lg:hidden fixed top-4 right-4 z-50 flex items-center gap-2">
        <FontSizeControls />
        <PublicThemeToggle />
        <AuthButton editUrl={editUrl} />
      </div>

      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 bg-card rounded-md shadow-md border border-border"
        >
          {isSidebarOpen ? <X className="w-5 h-5 text-foreground" /> : <Menu className="w-5 h-5 text-foreground" />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 bg-card paper-shadow transform transition-all duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${
        isSidebarCollapsed ? 'w-16 min-w-16' : 'w-80'
      }`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className={`border-b border-border ${isSidebarCollapsed ? 'p-4' : 'p-6'}`}>
            {isSidebarCollapsed ? (
              /* Collapsed sidebar header */
              <div className="flex flex-col items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className="p-2"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
                <AuthButton editUrl={editUrl} />
                <PublicThemeToggle />
                <FontSizeControls orientation="vertical" />
              </div>
            ) : (
              /* Expanded sidebar header */
              <>
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-xl font-bold text-foreground">
                    {teacher.name}
                  </h1>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                      className="p-2"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <FontSizeControls />
                  <PublicThemeToggle />
                  <AuthButton editUrl={editUrl} />
                </div>
                {teacher.title && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {teacher.title}
                  </p>
                )}
                {teacher.bio && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {teacher.bio}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col">
            {isSidebarCollapsed ? (
              /* Simplified navigation when collapsed - just show essential icons */
              <nav className="space-y-2">
                {(() => {
                  const showHomeButton = sidebarBehavior === 'contextual' && siteStructure.length === 1
                  
                  return (
                    <>
                      {showHomeButton && (
                        <button
                          onClick={() => {
                            const url = `/${teacher.username}`
                            router.push(url)
                            setIsSidebarOpen(false)
                          }}
                          className="flex items-center justify-center w-full px-2 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:bg-muted hover:text-foreground mb-4"
                          title="Home"
                        >
                          <Home className="w-5 h-5" />
                        </button>
                      )}
                    </>
                  )
                })()}
              </nav>
            ) : (
              /* Full navigation when expanded */
              <nav className="space-y-2">
              {/* Determine which structure to show based on sidebarBehavior */}
              {(() => {
                const displayStructure = sidebarBehavior === 'full' && fullSiteStructure 
                  ? fullSiteStructure 
                  : siteStructure
                
                const showHomeButton = sidebarBehavior === 'contextual' && siteStructure.length === 1
                
                return (
                  <>
                    {/* Home button - only show when viewing a single collection in contextual mode */}
                    {showHomeButton && (
                      <button
                        onClick={() => {
                          // Navigate to teacher's root page
                          const url = `/${teacher.username}`
                          router.push(url)
                          setIsSidebarOpen(false)
                        }}
                        className="flex items-center w-full text-left px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:bg-muted hover:text-foreground mb-4"
                      >
                        <Home className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span>Home</span>
                      </button>
                    )}
                    
                    {displayStructure.map((collection) => (
                <div key={collection.id} className="space-y-1">
                  {/* Collection Title */}
                  <button
                    onClick={() => toggleCollection(collection.id)}
                    className={`flex items-center w-full text-left px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      expandedCollections.includes(collection.id)
                        ? 'text-foreground bg-muted'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {expandedCollections.includes(collection.id) ? (
                      <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0" />
                    )}
                    <span className="truncate">{collection.title}</span>
                  </button>

                  {/* Skripts */}
                  {expandedCollections.includes(collection.id) && (
                    <div className="ml-6 space-y-1">
                      {collection.skripts.map((skript) => (
                        <div key={skript.id} className="space-y-1">
                          {/* Skript Title - split into chevron (toggle only) and title (navigate + expand) */}
                          <div
                            className={`flex items-center w-full text-left px-3 py-1 text-sm rounded-md transition-colors ${
                              expandedSkripts.includes(skript.id)
                                ? 'text-foreground bg-muted/50'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                          >
                            {/* Chevron - toggle only */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSkript(skript.id)
                              }}
                              className="p-0.5 -ml-0.5 mr-1 hover:bg-muted rounded flex-shrink-0"
                              aria-label={expandedSkripts.includes(skript.id) ? 'Collapse' : 'Expand'}
                            >
                              {expandedSkripts.includes(skript.id) ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                            {/* Title - navigate to frontpage and expand */}
                            <button
                              onClick={() => navigateToSkript(collection.slug, skript.slug, skript.id)}
                              className="truncate flex-1 text-left hover:underline"
                            >
                              {skript.title}
                            </button>
                          </div>

                          {/* Pages */}
                          {expandedSkripts.includes(skript.id) && (
                            <div className="ml-5 space-y-1">
                              {skript.pages.map((page) => (
                                <button
                                  key={page.id}
                                  onClick={() => navigateToPage(collection.slug, skript.slug, page.slug)}
                                  className={`block w-full text-left px-3 py-1 text-sm rounded-md truncate transition-colors ${
                                    isCurrentPage(collection.slug, skript.slug, page.slug)
                                      ? 'bg-primary/10 text-primary font-medium'
                                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                  }`}
                                >
                                  {page.title}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                    ))}
                  </>
                )
              })()}
              
              {/* Root-level skripts */}
              {rootSkripts.length > 0 && (
                <div className="mt-4 space-y-1">
                  <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Individual Skripts
                  </h3>
                  {rootSkripts.map((skript) => (
                    <div key={skript.id} className="space-y-1">
                      {/* Root Skript Title - split into chevron (toggle only) and title (navigate + expand) */}
                      <div
                        className={`flex items-center w-full text-left px-3 py-1 text-sm rounded-md transition-colors ${
                          expandedSkripts.includes(skript.id)
                            ? 'text-foreground bg-muted/50'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        {/* Chevron - toggle only */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSkript(skript.id)
                          }}
                          className="p-0.5 -ml-0.5 mr-1 hover:bg-muted rounded flex-shrink-0"
                          aria-label={expandedSkripts.includes(skript.id) ? 'Collapse' : 'Expand'}
                        >
                          {expandedSkripts.includes(skript.id) ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                        </button>
                        {/* Title - navigate to frontpage and expand */}
                        <button
                          onClick={() => navigateToSkript(skript.collection.slug, skript.slug, skript.id)}
                          className="truncate flex-1 text-left hover:underline"
                        >
                          {skript.title}
                        </button>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({skript.collection.title})
                        </span>
                      </div>

                      {/* Root Skript Pages */}
                      {expandedSkripts.includes(skript.id) && (
                        <div className="ml-5 space-y-1">
                          {skript.pages.map((page) => (
                            <button
                              key={page.id}
                              onClick={() => navigateToPage(skript.collection.slug, skript.slug, page.slug)}
                              className={`block w-full text-left px-3 py-1 text-sm rounded-md truncate transition-colors ${
                                isCurrentPage(skript.collection.slug, skript.slug, page.slug)
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                              }`}
                            >
                              {page.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              </nav>
            )}

            {/* Sync Status Button - bottom of sidebar */}
            <div className={`mt-auto pt-4 ${isSidebarCollapsed ? 'flex justify-center' : ''}`}>
              <SyncStatusButton />
            </div>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Main content with scroll container */}
      <div
        id="scroll-container"
        className={`transition-all duration-300 h-screen overflow-auto ${
          isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-80'
        }`}
      >
        <main className="p-6 lg:p-8 bg-background min-h-screen">
          {children}
        </main>
      </div>
    </div>
  )
}

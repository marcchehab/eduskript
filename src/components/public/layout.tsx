'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { ChevronDown, ChevronRight, Menu, X, ChevronLeft, NotebookPen } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ReadingProgress } from './reading-progress'
import { PublicThemeToggle } from './theme-toggle'
import { AuthButton } from './auth-button'
import { FontSizeControls } from './font-size-controls'
import { SyncStatusButton } from '@/components/ui/sync-status'
import { InlineMarkdown } from '@/components/ui/inline-markdown'
import { useLayout } from '@/contexts/layout-context'
import { TeacherClassProvider } from '@/contexts/teacher-class-context'
import { AdminToolbox } from './admin-toolbox'

interface Teacher {
  name: string | null
  pageSlug: string
  pageName?: string | null
  pageDescription?: string | null
  pageIcon?: string | null
  bio?: string | null
  title?: string | null
}

interface SiteStructure {
  id: string
  title: string
  slug: string
  accentColor?: string | null // Hex color for letter markers
  skripts: {
    id: string
    title: string
    slug: string
    order?: number // Position within collection (0-indexed) for letter markers
    hasFrontpage?: boolean // Whether the skript has a frontpage
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
  hasFrontpage?: boolean
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
  pageId?: string // Page ID for lazy edit permission check
  routePrefix?: string // Custom route prefix (e.g., '/org/slug' for orgs, defaults to '/{pageSlug}')
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
  pageId,
  routePrefix
}: PublicSiteLayoutProps) {
  const router = useRouter()

  // Helper to get the correct base prefix for navigation
  // Must check at navigation time because SSR doesn't have window
  const getBasePrefix = () => {
    if (typeof window === 'undefined') return routePrefix ?? `/${teacher.pageSlug}`
    const hostname = window.location.hostname
    // Tunnel/dev domains (ngrok, localhost.run, etc.) behave like eduskript.org:
    // the proxy rewrites their paths to /org/[orgSlug]/[teacherPageSlug]/... so
    // we must include the teacher pageSlug in the base prefix.
    const isTunnelDomain = hostname.endsWith('.ngrok-free.dev') || hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok.io')
    const isCustom = !isTunnelDomain && !['localhost', 'eduskript.org', 'www.eduskript.org'].includes(hostname)
    return isCustom ? '' : (routePrefix ?? `/${teacher.pageSlug}`)
  }
  const { data: session } = useSession()
  const { setSidebarCollapsed: setSidebarCollapsedInContext, sidebarWidth } = useLayout()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Track last visited teacher page for students (used for "Back to" link, signout redirect, and nav logo)
  // Runs on every page navigation (currentPath dep) so href always reflects the exact current lesson
  useEffect(() => {
    if (session?.user?.accountType === 'student' && teacher.pageSlug) {
      const lastTeacherPage = {
        slug: teacher.pageSlug,
        name: teacher.pageName || teacher.name || teacher.pageSlug,
        pageIcon: teacher.pageIcon ?? null,
        href: window.location.href,
      }
      localStorage.setItem('lastTeacherPage', JSON.stringify(lastTeacherPage))
    }
  }, [session?.user?.accountType, teacher.pageSlug, teacher.pageName, teacher.name, teacher.pageIcon, currentPath])

  // Sync local sidebar collapse state with global context
  useEffect(() => {
    setSidebarCollapsedInContext(isSidebarCollapsed)
  }, [isSidebarCollapsed, setSidebarCollapsedInContext])
  
  // Storage keys for persistence
  const EXPANDED_SCRIPTS_KEY = `expanded-collections-${teacher.pageSlug}`
  const EXPANDED_SKRIPTS_KEY = `expanded-skripts-${teacher.pageSlug}`
  const SIDEBAR_SCROLL_KEY = `sidebar-scroll-${teacher.pageSlug}`

  // Ref for sidebar navigation scroll container
  const sidebarNavRef = useRef<HTMLDivElement>(null)

  // Initialize with all collections expanded for SSR, then hydrate from localStorage
  const [expandedCollections, setExpandedCollections] = useState<string[]>(
    () => siteStructure.map(collection => collection.id)
  )

  // Initialize expandedSkripts as empty for SSR, then hydrate from localStorage
  const [expandedSkripts, setExpandedSkripts] = useState<string[]>([])

  // Track if we've finished first render (for enabling animations after mount)
  const [isInitialized, setIsInitialized] = useState(false)

  // Hydrate expanded state from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    // Hydrate expandedCollections
    const storedCollections = localStorage.getItem(EXPANDED_SCRIPTS_KEY)
    if (storedCollections) {
      try {
        const parsed = JSON.parse(storedCollections)
        if (Array.isArray(parsed)) {
          setExpandedCollections(parsed)
        }
      } catch {
        // Keep default (all expanded)
      }
    }

    // Hydrate expandedSkripts
    const storedSkripts = localStorage.getItem(EXPANDED_SKRIPTS_KEY)
    let expandedFromStorage: string[] = []

    if (storedSkripts) {
      try {
        expandedFromStorage = JSON.parse(storedSkripts)
      } catch {
        expandedFromStorage = []
      }
    }

    // Also auto-expand skripts that contain the current page
    if (currentPath) {
      siteStructure.forEach(collection => {
        collection.skripts.forEach(skript => {
          const hasCurrentPage = skript.pages.some(page =>
            currentPath === `/${skript.slug}/${page.slug}`
          )
          if (hasCurrentPage && !expandedFromStorage.includes(skript.id)) {
            expandedFromStorage.push(skript.id)
          }
        })
      })
      // Also check root skripts
      rootSkripts.forEach(skript => {
        const hasCurrentPage = skript.pages.some(page =>
          currentPath === `/${skript.slug}/${page.slug}`
        )
        if (hasCurrentPage && !expandedFromStorage.includes(skript.id)) {
          expandedFromStorage.push(skript.id)
        }
      })
    }

    setExpandedSkripts(expandedFromStorage)

    // Delay enabling animations until after the state has been applied
    // This prevents the collapse→expand flash on initial load
    requestAnimationFrame(() => {
      setIsInitialized(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, [])

  // Update expanded skripts when current path changes
  useEffect(() => {
    if (!isInitialized || !currentPath) return
    
    const newExpandedSkripts = [...expandedSkripts]
    let hasChanges = false
    
    siteStructure.forEach(collection => {
      collection.skripts.forEach(skript => {
        const hasCurrentPage = skript.pages.some(page =>
          currentPath === `/${skript.slug}/${page.slug}`
        )
        if (hasCurrentPage && !newExpandedSkripts.includes(skript.id)) {
          newExpandedSkripts.push(skript.id)
          hasChanges = true
        }
      })
    })

    if (hasChanges) {
       
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

  // Restore sidebar scroll position after mount
  useEffect(() => {
    if (!isInitialized || !sidebarNavRef.current) return
    const savedScroll = sessionStorage.getItem(SIDEBAR_SCROLL_KEY)
    if (savedScroll) {
      sidebarNavRef.current.scrollTop = parseInt(savedScroll, 10)
    }
  }, [isInitialized, SIDEBAR_SCROLL_KEY])

  // Save sidebar scroll position on scroll
  useEffect(() => {
    const nav = sidebarNavRef.current
    if (!nav) return

    const handleScroll = () => {
      sessionStorage.setItem(SIDEBAR_SCROLL_KEY, nav.scrollTop.toString())
    }

    nav.addEventListener('scroll', handleScroll, { passive: true })
    return () => nav.removeEventListener('scroll', handleScroll)
  }, [SIDEBAR_SCROLL_KEY])

  // Apply paper scale for narrow viewports (< 1024px)
  // This scales the paper to fit viewport width while maintaining fixed internal dimensions
  useEffect(() => {
    const PAPER_WIDTH = 1024

    const updatePaperScale = () => {
      const vw = window.innerWidth
      if (vw < PAPER_WIDTH) {
        const scale = vw / PAPER_WIDTH
        document.documentElement.style.setProperty('--paper-scale', scale.toString())
        // Negative margin to compensate for scaled height
        const marginAdjust = `calc(-1 * (1 - ${scale}) * var(--paper-height, 0px))`
        document.documentElement.style.setProperty('--paper-scale-margin', marginAdjust)
      } else {
        document.documentElement.style.removeProperty('--paper-scale')
        document.documentElement.style.removeProperty('--paper-scale-margin')
      }
    }

    updatePaperScale()
    window.addEventListener('resize', updatePaperScale)
    return () => window.removeEventListener('resize', updatePaperScale)
  }, [])

  const toggleSkript = (skriptId: string) => {
    setExpandedSkripts(prev => 
      prev.includes(skriptId) 
        ? prev.filter(id => id !== skriptId)
        : [...prev, skriptId]
    )
  }

  const isCurrentPage = (skriptSlug: string, pageSlug: string) => {
    return currentPath === `/${skriptSlug}/${pageSlug}`
  }

  const navigateToPage = (skriptSlug: string, pageSlug: string) => {
    // Use getBasePrefix() at click time for correct custom domain handling
    const url = `${getBasePrefix()}/${skriptSlug}/${pageSlug}`

    router.push(url)
    setIsSidebarOpen(false)
  }

  const navigateToSkript = (skriptSlug: string, skriptId: string, hasFrontpage?: boolean) => {
    if (hasFrontpage) {
      // Navigate to skript frontpage and expand the skript
      const url = `${getBasePrefix()}/${skriptSlug}`

      // Ensure the skript is expanded
      if (!expandedSkripts.includes(skriptId)) {
        setExpandedSkripts(prev => [...prev, skriptId])
      }

      router.push(url)
      setIsSidebarOpen(false)
    } else {
      // No frontpage - just toggle expand/collapse
      toggleSkript(skriptId)
    }
  }

  return (
    <TeacherClassProvider>
      <div
        className="min-h-screen bg-background overflow-visible"
        data-typography={typographyPreference}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <ReadingProgress />

      {/* Top-right controls - only visible on mobile when sidebar is closed */}
      <div className="min-[1344px]:hidden fixed top-8 right-4 z-50 flex items-center gap-2">
        <AdminToolbox pageId={pageId} />
        <FontSizeControls />
        <PublicThemeToggle />
        <AuthButton pageId={pageId} teacherPageSlug={teacher.pageSlug} isOrgPage={routePrefix?.startsWith('/org/')} orgSlug={routePrefix?.startsWith('/org/') ? routePrefix.split('/')[2] : undefined} />
      </div>

      {/* Mobile menu button */}
      <div className="min-[1344px]:hidden fixed top-8 left-4 z-50">
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
      } min-[1344px]:translate-x-0 ${
        isSidebarCollapsed ? 'w-16 min-w-16' : 'w-80'
      }`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className={`border-b border-border ${isSidebarCollapsed ? 'p-4' : 'p-6'}`}>
            {isSidebarCollapsed ? (
              /* Collapsed sidebar header */
              <div className="flex flex-col items-center gap-2">
                {/* Icon: custom URL, default NotebookPen, or letter placeholder - clickable as home link */}
                <button
                  onClick={() => {
                    const homeUrl = getBasePrefix() || '/'
                    router.push(homeUrl)
                    setIsSidebarOpen(false)
                  }}
                  className="cursor-pointer"
                  title="Go to homepage"
                >
                  {teacher.pageIcon === 'default' ? (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <NotebookPen className="w-6 h-6 text-muted-foreground" />
                    </div>
                  ) : teacher.pageIcon ? (
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-background">
                      <Image
                        src={teacher.pageIcon}
                        alt="Page icon"
                        fill
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <span className="text-muted-foreground text-lg font-heading">
                        {(teacher.pageName || teacher.name || 'P').charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className="p-2"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
                <AdminToolbox pageId={pageId} />
                <AuthButton pageId={pageId} teacherPageSlug={teacher.pageSlug} isOrgPage={routePrefix?.startsWith('/org/')} orgSlug={routePrefix?.startsWith('/org/') ? routePrefix.split('/')[2] : undefined} />
                <PublicThemeToggle />
                <FontSizeControls orientation="vertical" />
              </div>
            ) : (
              /* Expanded sidebar header */
              <>
                {/* Row 1: Icon + Page name - clickable as home link */}
                <button
                  onClick={() => {
                    const homeUrl = getBasePrefix() || '/'
                    router.push(homeUrl)
                    setIsSidebarOpen(false)
                  }}
                  className="flex items-center justify-center gap-3 cursor-pointer w-full"
                  title="Go to homepage"
                >
                  {/* Icon: custom URL, default NotebookPen, or letter placeholder */}
                  {teacher.pageIcon === 'default' ? (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <NotebookPen className="w-6 h-6 text-muted-foreground" />
                    </div>
                  ) : teacher.pageIcon ? (
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-background">
                      <Image
                        src={teacher.pageIcon}
                        alt="Page icon"
                        fill
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <span className="text-muted-foreground text-lg font-heading">
                        {(teacher.pageName || teacher.name || 'P').charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="text-2xl font-bold text-foreground truncate font-heading">
                    {teacher.pageName || teacher.name || 'Untitled Page'}
                  </div>
                </button>

                {/* Row 2: Description (if exists) - supports markdown links */}
                {teacher.pageDescription && (
                  <p className="text-sm text-muted-foreground mt-2 text-center">
                    <InlineMarkdown>{teacher.pageDescription}</InlineMarkdown>
                  </p>
                )}

                {/* Row 3: Controls centered, collapse on right */}
                <div className="flex items-center mt-6">
                  {/* Spacer to balance the collapse button */}
                  <div className="w-9" />
                  <div className="flex-1 flex items-center justify-center gap-2">
                    <AdminToolbox pageId={pageId} />
                    <FontSizeControls />
                    <PublicThemeToggle />
                    <AuthButton pageId={pageId} teacherPageSlug={teacher.pageSlug} isOrgPage={routePrefix?.startsWith('/org/')} orgSlug={routePrefix?.startsWith('/org/') ? routePrefix.split('/')[2] : undefined} />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                    className="p-2"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Navigation */}
          <div
            ref={sidebarNavRef}
            className="flex-1 p-4 pr-2 flex flex-col overflow-y-scroll [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&:hover::-webkit-scrollbar-thumb]:bg-muted-foreground/30"
          >
            {isSidebarCollapsed ? (
              /* Collapsed navigation - empty, use header icon to go home */
              <nav className="space-y-2" />
            ) : (
              /* Full navigation when expanded */
              <nav className="space-y-2">
              {/* Determine which structure to show based on sidebarBehavior */}
              {(() => {
                const displayStructure = sidebarBehavior === 'full' && fullSiteStructure
                  ? fullSiteStructure
                  : siteStructure

                // In contextual mode with single skript, chevron is just decorative (always expanded)
                const isContextualSingleSkript = sidebarBehavior === 'contextual' &&
                  siteStructure.length === 1 &&
                  siteStructure[0]?.skripts?.length === 1

                return (
                  <>
                    {displayStructure.map((collection, index) => (
                <div key={collection.id} className={`${index > 0 ? 'mt-5' : ''} mb-4`}>
                  {/* Collection Title - Docusaurus-style category header */}
                  <div className="py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {collection.title}
                  </div>

                  {/* Skripts - always visible */}
                  <div className="space-y-1.5 mt-1">
                      {collection.skripts.map((skript, skriptIndex) => (
                        <div key={skript.id}>
                          {/* Skript Title - letter marker, title, chevron */}
                          <div
                            className={`flex items-center w-full text-left py-1 text-sm rounded-md transition-colors ${
                              expandedSkripts.includes(skript.id)
                                ? 'text-foreground font-medium bg-muted/50'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                          >
                            {/* Letter marker - uses skript.order (position in collection) or fallback to index */}
                            <span
                              className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center mr-2 flex-shrink-0 text-white"
                              style={{ backgroundColor: collection.accentColor || '#6b7280' }}
                            >
                              {String.fromCharCode(65 + (skript.order ?? skriptIndex))}
                            </span>
                            {/* Title - navigate to frontpage (if exists) or toggle expand */}
                            <button
                              onClick={() => navigateToSkript(skript.slug, skript.id, skript.hasFrontpage)}
                              className="truncate flex-1 text-left hover:text-primary"
                            >
                              {skript.title}
                            </button>
                            {/* Chevron - toggle only, right-aligned (non-interactive in contextual single skript mode) */}
                            {isContextualSingleSkript ? (
                              <span className="p-1.5 ml-1 flex-shrink-0 text-muted-foreground">
                                <ChevronDown className="w-4 h-4" />
                              </span>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleSkript(skript.id)
                                }}
                                className="p-1.5 ml-1 hover:bg-muted rounded flex-shrink-0 text-muted-foreground cursor-pointer"
                                aria-label={expandedSkripts.includes(skript.id) ? 'Collapse' : 'Expand'}
                              >
                                {expandedSkripts.includes(skript.id) ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* Pages - with smooth slide transition (disabled until initialized to prevent flash) */}
                          <div className={`grid ${isInitialized ? 'transition-[grid-template-rows] duration-200 ease-out' : ''} ${
                            expandedSkripts.includes(skript.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                          }`}>
                            <div className="overflow-hidden">
                              <div className="space-y-0.5 py-1 ml-4">
                                {skript.pages.map((page, pageIndex) => (
                                  <button
                                    key={page.id}
                                    onClick={() => navigateToPage(skript.slug, page.slug)}
                                    className={`flex items-center w-full text-left py-1.5 px-2 text-sm rounded-md transition-colors ${
                                      isCurrentPage(skript.slug, page.slug)
                                        ? 'text-primary font-medium bg-primary/10'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                                  >
                                    {/* Page number marker */}
                                    <span className="w-5 h-5 rounded text-xs font-medium flex items-center justify-center mr-2 flex-shrink-0 bg-muted text-muted-foreground">
                                      {pageIndex + 1}
                                    </span>
                                    <span className="truncate">{page.title}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                </div>
                    ))}
                  </>
                )
              })()}
              
              {/* Root-level skripts */}
              {rootSkripts.length > 0 && (
                <div className="mt-5 mb-4">
                  <div className="py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Individual Skripts
                  </div>
                  <div className="space-y-1.5 mt-1">
                  {rootSkripts.map((skript, skriptIndex) => (
                    <div key={skript.id}>
                      {/* Root Skript Title - letter marker, title, chevron */}
                      <div
                        className={`flex items-center w-full text-left text-sm rounded-md transition-colors ${
                          expandedSkripts.includes(skript.id)
                            ? 'text-foreground font-medium bg-muted/50'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {/* Letter marker */}
                        <span
                          className="w-5 h-5 rounded text-xs font-bold flex items-center justify-center mr-2 flex-shrink-0 text-white bg-gray-500"
                        >
                          {String.fromCharCode(65 + skriptIndex)}
                        </span>
                        {/* Title - navigate to frontpage (if exists) or toggle expand */}
                        <button
                          onClick={() => navigateToSkript(skript.slug, skript.id, skript.hasFrontpage)}
                          className="truncate flex-1 text-left hover:text-primary"
                        >
                          {skript.title}
                        </button>
                        {/* Chevron - toggle only, right-aligned */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSkript(skript.id)
                          }}
                          className="p-1.5 ml-1 hover:bg-muted rounded flex-shrink-0 text-muted-foreground"
                          aria-label={expandedSkripts.includes(skript.id) ? 'Collapse' : 'Expand'}
                        >
                          {expandedSkripts.includes(skript.id) ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Root Skript Pages - with smooth slide transition (disabled until initialized) */}
                      <div className={`grid ${isInitialized ? 'transition-[grid-template-rows] duration-200 ease-out' : ''} ${
                        expandedSkripts.includes(skript.id) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                      }`}>
                        <div className="overflow-hidden">
                          <div className="space-y-0.5 py-1 ml-4">
                            {skript.pages.map((page, pageIndex) => (
                              <button
                                key={page.id}
                                onClick={() => navigateToPage(skript.slug, page.slug)}
                                className={`flex items-center w-full text-left py-1.5 px-2 text-sm rounded-md transition-colors ${
                                  isCurrentPage(skript.slug, page.slug)
                                    ? 'text-primary font-medium bg-primary/10'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                }`}
                              >
                                {/* Page number marker */}
                                <span className="w-5 h-5 rounded text-xs font-medium flex items-center justify-center mr-2 flex-shrink-0 bg-muted text-muted-foreground">
                                  {pageIndex + 1}
                                </span>
                                <span className="truncate">{page.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  </div>
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
          className="fixed inset-0 bg-black/50 z-30 min-[1344px]:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

        {/* Main content with scroll container */}
        <div
          id="scroll-container"
          className={`transition-all duration-300 h-screen overflow-auto ${
            isSidebarCollapsed ? 'min-[1344px]:ml-16' : 'min-[1344px]:ml-80'
          }`}
        >
          <main className="bg-background min-h-screen">
            {children}
          </main>
          <footer className="py-4 text-center text-xs text-muted-foreground/50">
            <Link href="/impressum" className="hover:text-muted-foreground">Legal Notice</Link>
            <span className="mx-2">·</span>
            <Link href="/terms" className="hover:text-muted-foreground">Terms (Mar 2026)</Link>
          </footer>
        </div>
      </div>
    </TeacherClassProvider>
  )
}

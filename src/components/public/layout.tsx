'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Menu, X } from 'lucide-react'
import { ReadingProgress } from './reading-progress'
import { PublicThemeToggle } from './theme-toggle'

interface Teacher {
  name: string
  subdomain: string
  bio?: string
  title?: string
}

interface SiteStructure {
  id: string
  title: string
  slug: string
  chapters: {
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

interface PublicSiteLayoutProps {
  teacher: Teacher
  siteStructure: SiteStructure[]
  children: React.ReactNode
  currentPath?: string
}

export function PublicSiteLayout({ teacher, siteStructure, children, currentPath }: PublicSiteLayoutProps) {
  const router = useRouter()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  
  // Storage keys for persistence
  const EXPANDED_SCRIPTS_KEY = `expanded-collections-${teacher.subdomain}`
  const EXPANDED_CHAPTERS_KEY = `expanded-chapters-${teacher.subdomain}`
  
  // Initialize with persistent state or defaults
  const [expandedCollections, setExpandedCollections] = useState<string[]>([])
  const [expandedChapters, setExpandedChapters] = useState<string[]>([])
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

  const getInitialExpandedChapters = useCallback(() => {
    if (typeof window === 'undefined') return []
    
    const stored = localStorage.getItem(EXPANDED_CHAPTERS_KEY)
    let expandedFromStorage: string[] = []
    
    if (stored) {
      try {
        expandedFromStorage = JSON.parse(stored)
      } catch {
        expandedFromStorage = []
      }
    }
    
    // Auto-expand chapters that contain the current page
    const expandedFromCurrentPath: string[] = []
    if (currentPath) {
      siteStructure.forEach(collection => {
        collection.chapters.forEach(chapter => {
          const hasCurrentPage = chapter.pages.some(page => 
            currentPath === `/${collection.slug}/${chapter.slug}/${page.slug}`
          )
          if (hasCurrentPage && !expandedFromStorage.includes(chapter.id)) {
            expandedFromCurrentPath.push(chapter.id)
          }
        })
      })
    }
    
    return [...expandedFromStorage, ...expandedFromCurrentPath]
  }, [siteStructure, currentPath, EXPANDED_CHAPTERS_KEY])

  // Initialize state from localStorage on client side
  useEffect(() => {
    setExpandedCollections(getInitialExpandedCollections())
    setExpandedChapters(getInitialExpandedChapters())
    setIsInitialized(true)
  }, [getInitialExpandedCollections, getInitialExpandedChapters])

  // Update expanded chapters when current path changes
  useEffect(() => {
    if (!isInitialized || !currentPath) return
    
    const newExpandedChapters = [...expandedChapters]
    let hasChanges = false
    
    siteStructure.forEach(collection => {
      collection.chapters.forEach(chapter => {
        const hasCurrentPage = chapter.pages.some(page => 
          currentPath === `/${collection.slug}/${chapter.slug}/${page.slug}`
        )
        if (hasCurrentPage && !newExpandedChapters.includes(chapter.id)) {
          newExpandedChapters.push(chapter.id)
          hasChanges = true
        }
      })
    })
    
    if (hasChanges) {
      setExpandedChapters(newExpandedChapters)
    }
  }, [currentPath, isInitialized, expandedChapters, siteStructure])

  // Persist expanded collections to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_SCRIPTS_KEY, JSON.stringify(expandedCollections))
  }, [expandedCollections, isInitialized, EXPANDED_SCRIPTS_KEY])

  // Persist expanded chapters to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_CHAPTERS_KEY, JSON.stringify(expandedChapters))
  }, [expandedChapters, isInitialized, EXPANDED_CHAPTERS_KEY])

  const toggleCollection = (collectionId: string) => {
    setExpandedCollections(prev => 
      prev.includes(collectionId) 
        ? prev.filter(id => id !== collectionId)
        : [...prev, collectionId]
    )
  }

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => 
      prev.includes(chapterId) 
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    )
  }

  const isCurrentPage = (collectionSlug: string, chapterSlug: string, pageSlug: string) => {
    return currentPath === `/${collectionSlug}/${chapterSlug}/${pageSlug}`
  }

  const navigateToPage = (collectionSlug: string, chapterSlug: string, pageSlug: string) => {
    // Check if we're on a subdomain by looking at window.location.hostname
    const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
    const isMainDomain = hostname === 'localhost' || hostname === 'eduskript.org' || hostname === 'www.eduskript.org'
    const isOnSubdomain = !isMainDomain && (hostname.endsWith('.localhost') || hostname.endsWith('.eduskript.org'))
    
    // If on subdomain, use relative URL (middleware will handle rewrite)
    // If on main domain, use full path with subdomain
    const url = isOnSubdomain 
      ? `/${collectionSlug}/${chapterSlug}/${pageSlug}`
      : `/${teacher.subdomain}/${collectionSlug}/${chapterSlug}/${pageSlug}`
    
    router.push(url)
    setIsSidebarOpen(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <ReadingProgress />
      
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
      <div className={`fixed inset-y-0 left-0 z-40 w-80 bg-card shadow-lg transform transition-transform duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-xl font-bold text-foreground">
                {teacher.name}
              </h1>
              <PublicThemeToggle />
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
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto p-4">
            <nav className="space-y-2">
              {siteStructure.map((collection) => (
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

                  {/* Chapters */}
                  {expandedCollections.includes(collection.id) && (
                    <div className="ml-6 space-y-1">
                      {collection.chapters.map((chapter) => (
                        <div key={chapter.id} className="space-y-1">
                          {/* Chapter Title */}
                          <button
                            onClick={() => toggleChapter(chapter.id)}
                            className={`flex items-center w-full text-left px-3 py-1 text-sm rounded-md transition-colors ${
                              expandedChapters.includes(chapter.id)
                                ? 'text-foreground bg-muted/50'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                          >
                            {expandedChapters.includes(chapter.id) ? (
                              <ChevronDown className="w-3 h-3 mr-2 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-3 h-3 mr-2 flex-shrink-0" />
                            )}
                            <span className="truncate">{chapter.title}</span>
                          </button>

                          {/* Pages */}
                          {expandedChapters.includes(chapter.id) && (
                            <div className="ml-5 space-y-1">
                              {chapter.pages.map((page) => (
                                <button
                                  key={page.id}
                                  onClick={() => navigateToPage(collection.slug, chapter.slug, page.slug)}
                                  className={`block w-full text-left px-3 py-1 text-sm rounded-md truncate transition-colors ${
                                    isCurrentPage(collection.slug, chapter.slug, page.slug)
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
            </nav>
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

      {/* Main content */}
      <div className="lg:ml-80">
        <main className="p-6 lg:p-8 bg-background min-h-screen">
          {children}
        </main>
      </div>
    </div>
  )
}

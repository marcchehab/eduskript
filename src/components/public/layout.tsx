'use client'

import { useState, useEffect } from 'react'
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
  const EXPANDED_SCRIPTS_KEY = `expanded-scripts-${teacher.subdomain}`
  const EXPANDED_CHAPTERS_KEY = `expanded-chapters-${teacher.subdomain}`
  
  // Initialize with persistent state or defaults
  const [expandedScripts, setExpandedScripts] = useState<string[]>([])
  const [expandedChapters, setExpandedChapters] = useState<string[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Get initial expanded state from localStorage or defaults
  const getInitialExpandedScripts = () => {
    if (typeof window === 'undefined') return siteStructure.map(script => script.id)
    
    const stored = localStorage.getItem(EXPANDED_SCRIPTS_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch {
        return siteStructure.map(script => script.id)
      }
    }
    // Default: all scripts expanded
    return siteStructure.map(script => script.id)
  }

  const getInitialExpandedChapters = () => {
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
      siteStructure.forEach(script => {
        script.chapters.forEach(chapter => {
          const hasCurrentPage = chapter.pages.some(page => 
            currentPath === `/${script.slug}/${chapter.slug}/${page.slug}`
          )
          if (hasCurrentPage && !expandedFromStorage.includes(chapter.id)) {
            expandedFromCurrentPath.push(chapter.id)
          }
        })
      })
    }
    
    return [...expandedFromStorage, ...expandedFromCurrentPath]
  }

  // Initialize state from localStorage on client side
  useEffect(() => {
    setExpandedScripts(getInitialExpandedScripts())
    setExpandedChapters(getInitialExpandedChapters())
    setIsInitialized(true)
  }, [])

  // Update expanded chapters when current path changes
  useEffect(() => {
    if (!isInitialized || !currentPath) return
    
    const newExpandedChapters = [...expandedChapters]
    let hasChanges = false
    
    siteStructure.forEach(script => {
      script.chapters.forEach(chapter => {
        const hasCurrentPage = chapter.pages.some(page => 
          currentPath === `/${script.slug}/${chapter.slug}/${page.slug}`
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
  }, [currentPath, isInitialized])

  // Persist expanded scripts to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_SCRIPTS_KEY, JSON.stringify(expandedScripts))
  }, [expandedScripts, isInitialized])

  // Persist expanded chapters to localStorage
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem(EXPANDED_CHAPTERS_KEY, JSON.stringify(expandedChapters))
  }, [expandedChapters, isInitialized])

  const toggleScript = (scriptId: string) => {
    setExpandedScripts(prev => 
      prev.includes(scriptId) 
        ? prev.filter(id => id !== scriptId)
        : [...prev, scriptId]
    )
  }

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => 
      prev.includes(chapterId) 
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    )
  }

  const isCurrentPage = (scriptSlug: string, chapterSlug: string, pageSlug: string) => {
    return currentPath === `/${scriptSlug}/${chapterSlug}/${pageSlug}`
  }

  const navigateToPage = (scriptSlug: string, chapterSlug: string, pageSlug: string) => {
    const url = `/${teacher.subdomain}/${scriptSlug}/${chapterSlug}/${pageSlug}`
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
              {siteStructure.map((script) => (
                <div key={script.id} className="space-y-1">
                  {/* Script Title */}
                  <button
                    onClick={() => toggleScript(script.id)}
                    className={`flex items-center w-full text-left px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      expandedScripts.includes(script.id)
                        ? 'text-foreground bg-muted'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {expandedScripts.includes(script.id) ? (
                      <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0" />
                    )}
                    <span className="truncate">{script.title}</span>
                  </button>

                  {/* Chapters */}
                  {expandedScripts.includes(script.id) && (
                    <div className="ml-6 space-y-1">
                      {script.chapters.map((chapter) => (
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
                                  onClick={() => navigateToPage(script.slug, chapter.slug, page.slug)}
                                  className={`block w-full text-left px-3 py-1 text-sm rounded-md truncate transition-colors ${
                                    isCurrentPage(script.slug, chapter.slug, page.slug)
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

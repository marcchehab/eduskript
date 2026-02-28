'use client'

import { useState, useEffect, useCallback } from 'react'

interface Chapter {
  id: string
  title: string
  offsetTop: number
  height: number
  widthPercent: number
}

// offsetTop is relative to offsetParent, not necessarily the article.
// e.g. an h2 inside a callout blockquote has the blockquote as offsetParent.
// Walk up the offsetParent chain to get the true offset relative to #paper.
function getOffsetRelativeTo(el: HTMLElement, ancestor: HTMLElement): number {
  let offset = 0
  let current: HTMLElement | null = el
  while (current && current !== ancestor) {
    offset += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }
  return offset
}

function getChaptersFromDOM(): Chapter[] {
  const article = document.querySelector('article.prose-theme')
  if (!article) return []

  const paper = document.getElementById('paper') ?? article as HTMLElement

  const h2s = article.querySelectorAll('h2')
  if (h2s.length === 0) return []

  const articleHeight = article.scrollHeight || (article as HTMLElement).offsetHeight
  const rawChapters: Chapter[] = []

  // Content before first h2 becomes an unlabeled intro segment
  const firstH2 = h2s[0] as HTMLElement
  const firstH2Top = getOffsetRelativeTo(firstH2, paper)
  if (firstH2Top > 10) {
    const h1 = article.querySelector('h1')
    // h1 may have nested <a> from rehypeAutolinkHeadings — use innerText to avoid duplication
    const h1Title = h1?.querySelector('.heading-link')?.textContent?.trim()
      || h1?.innerText?.trim() || ''
    rawChapters.push({
      id: 'intro',
      title: h1Title,
      offsetTop: 0,
      height: firstH2Top,
      widthPercent: 0,
    })
  }

  h2s.forEach((h2, i) => {
    const el = h2 as HTMLElement
    const top = getOffsetRelativeTo(el, paper)
    const nextTop = i < h2s.length - 1
      ? getOffsetRelativeTo(h2s[i + 1] as HTMLElement, paper)
      : articleHeight
    rawChapters.push({
      id: el.id || `chapter-${i}`,
      title: el.querySelector('.heading-link')?.textContent?.trim()
        || el.innerText?.trim() || `Chapter ${i + 1}`,
      offsetTop: top,
      height: nextTop - top,
      widthPercent: 0,
    })
  })

  const totalHeight = rawChapters.reduce((sum, c) => sum + c.height, 0)
  if (totalHeight === 0) return []

  return rawChapters.map(c => ({
    ...c,
    widthPercent: (c.height / totalHeight) * 100,
  }))
}

function getScrollProgress(): number {
  const article = document.querySelector('article.prose-theme')
  if (!article) return 0

  const scrollContainer = document.getElementById('scroll-container')
  const containerTop = scrollContainer?.getBoundingClientRect().top ?? 0
  const containerHeight = scrollContainer?.clientHeight ?? window.innerHeight

  const rect = article.getBoundingClientRect()
  const articleTop = rect.top - containerTop
  const articleHeight = rect.height

  const scrolled = -articleTop
  // 100% when article bottom reaches viewport bottom (the actual scroll limit)
  const totalRange = articleHeight - containerHeight
  if (totalRange <= 0) return 100
  const scrollPercent = (scrolled / totalRange) * 100
  return Math.max(0, Math.min(100, scrollPercent))
}

export function ReadingProgress() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [progress, setProgress] = useState(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    let rafId: number | null = null
    let lastProgress = 0

    const refreshChapters = () => {
      setChapters(getChaptersFromDOM())
    }

    const refreshProgress = () => {
      const p = getScrollProgress()
      if (Math.abs(p - lastProgress) > 0.1) {
        lastProgress = p
        setProgress(p)
      }
    }

    const scheduleUpdate = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          refreshProgress()
          rafId = null
        })
      }
    }

    const handleResize = () => {
      refreshChapters()
      scheduleUpdate()
    }

    const scrollContainer = document.getElementById('scroll-container')

    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('wheel', scheduleUpdate, { passive: true })
    window.addEventListener('touchmove', scheduleUpdate, { passive: true })
    window.addEventListener('resize', handleResize)

    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true })
    }

    // Recompute chapters when article content changes
    const observer = new MutationObserver(refreshChapters)
    const article = document.querySelector('article.prose-theme')
    if (article) {
      observer.observe(article, { childList: true, subtree: true })
    }

    // Initial computation deferred to rAF
    const initRaf = requestAnimationFrame(() => {
      refreshChapters()
      refreshProgress()
    })

    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('wheel', scheduleUpdate)
      window.removeEventListener('touchmove', scheduleUpdate)
      window.removeEventListener('resize', handleResize)
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', scheduleUpdate)
      }
      if (rafId !== null) cancelAnimationFrame(rafId)
      cancelAnimationFrame(initRaf)
      observer.disconnect()
    }
  }, [])

  // Derive active chapter from progress
  const activeIndex = getActiveIndex(chapters, progress)

  // Fallback: simple progress bar when no h2 headings
  if (chapters.length === 0) {
    return (
      <div className="fixed top-0 left-0 w-full h-1 bg-gray-200 dark:bg-gray-700 z-50">
        <div
          className="h-full bg-blue-500 transition-all duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    )
  }

  // Calculate per-chapter fill percentages
  const chapterFills = getChapterFills(chapters, progress)

  return (
    <div className="fixed top-0 left-0 w-full z-50 flex items-start gap-[2px] px-[2px] bg-gray-100/80 dark:bg-gray-900/80 backdrop-blur-sm">
      {chapters.map((chapter, i) => {
        const isActive = i === activeIndex
        const isHovered = i === hoveredIndex
        const fill = chapterFills[i]

        return (
          <div
            key={chapter.id}
            className="relative flex-shrink-0 transition-all duration-200 ease-out cursor-pointer"
            style={{
              flexBasis: `${chapter.widthPercent}%`,
              flexGrow: 0,
              minWidth: '4px',
              height: isActive || isHovered ? '28px' : '20px',
              alignSelf: 'flex-start',
            }}
            title={chapter.title}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => {
              const el = document.getElementById(chapter.id)
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
          >
            {/* Background track */}
            <div className="absolute inset-0 rounded-sm bg-gray-300/60 dark:bg-gray-700/60" />

            {/* Fill bar */}
            <div
              className="absolute left-0 top-0 bottom-0 rounded-sm bg-blue-500 dark:bg-blue-400 transition-[width] duration-150 ease-out"
              style={{ width: `${fill}%` }}
            />

            {/* Chapter label */}
            {chapter.widthPercent > 5 && (
              <div
                className={`absolute inset-0 flex items-center px-1.5 overflow-hidden transition-opacity duration-200 ${
                  isActive || isHovered
                    ? 'opacity-100'
                    : 'opacity-60'
                }`}
              >
                <span
                  className={`truncate select-none leading-none ${
                    isActive
                      ? 'text-[11px] font-semibold text-white dark:text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]'
                      : 'text-[10px] font-medium text-gray-700 dark:text-black'
                  }`}
                >
                  {chapter.title}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function getActiveIndex(chapters: Chapter[], progress: number): number {
  if (chapters.length === 0) return 0
  let cumulative = 0
  for (let i = 0; i < chapters.length; i++) {
    cumulative += chapters[i].widthPercent
    if (progress < cumulative) return i
  }
  return chapters.length - 1
}

function getChapterFills(chapters: Chapter[], progress: number): number[] {
  return chapters.map((chapter, i) => {
    let cumulativeBefore = 0
    for (let j = 0; j < i; j++) {
      cumulativeBefore += chapters[j].widthPercent
    }
    const chapterStart = cumulativeBefore
    const chapterEnd = cumulativeBefore + chapter.widthPercent

    if (progress >= chapterEnd) return 100
    if (progress <= chapterStart) return 0
    return ((progress - chapterStart) / chapter.widthPercent) * 100
  })
}

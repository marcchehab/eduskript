'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Wraps markdown content and preloads images before they enter the viewport.
 *
 * Solves two problems:
 * 1. Native lazy loading triggers too late, causing visible loading flashes.
 *    We observe images with a 1500px rootMargin to start loading them early.
 * 2. Images inside collapsed callouts (grid-template-rows: 0fr) never trigger
 *    the browser's lazy loading. We observe the callout container instead and
 *    eagerly load all its images when it's near the viewport.
 */
export function EagerImageLoader({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Force-load an image by switching from lazy to eager
    const eagerLoad = (img: HTMLImageElement) => {
      if (img.dataset.eagerQueued) return
      img.dataset.eagerQueued = '1'
      img.loading = 'eager'
    }

    // Observer for individual images (large rootMargin = early preload)
    const imageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            eagerLoad(entry.target as HTMLImageElement)
            imageObserver.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '1500px 0px' }
    )

    // Observer for collapsed callouts — preload all contained images
    // when the callout is near the viewport, even if folded
    const calloutObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const imgs = (entry.target as HTMLElement).querySelectorAll('img')
            imgs.forEach(eagerLoad)
            calloutObserver.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '1500px 0px' }
    )

    // Observe all images and foldable callouts
    const observe = () => {
      container.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        imageObserver.observe(img)
      })
      container.querySelectorAll('blockquote.callout-foldable').forEach((callout) => {
        calloutObserver.observe(callout)
      })
    }

    // Initial observation + re-observe on DOM changes (dynamic rendering)
    observe()
    const mutation = new MutationObserver(observe)
    mutation.observe(container, { childList: true, subtree: true })

    return () => {
      imageObserver.disconnect()
      calloutObserver.disconnect()
      mutation.disconnect()
    }
  }, [])

  return <div ref={containerRef}>{children}</div>
}

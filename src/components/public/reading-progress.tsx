'use client'

import { useState, useEffect } from 'react'

export function ReadingProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const updateProgress = () => {
      // Find the article element (contains the actual content)
      const article = document.querySelector('article.prose-theme')
      if (!article) return

      // Get the article's position in screen space (after transform)
      const rect = article.getBoundingClientRect()

      // Calculate progress:
      // - 0%: top of viewport at top of article (rect.top = 0)
      // - 100%: middle of viewport at bottom of article (rect.top = window.innerHeight/2 - rect.height)
      const viewportHalfHeight = window.innerHeight / 2
      const articleTop = rect.top
      const articleHeight = rect.height

      // Distance scrolled from 0% position
      const scrolled = -articleTop
      // Total scroll range (from 0% to 100%)
      const totalRange = articleHeight - viewportHalfHeight
      // Progress percentage
      const scrollPercent = (scrolled / totalRange) * 100

      // Clamp between 0 and 100
      const clampedProgress = Math.max(0, Math.min(100, scrollPercent))
      setProgress(clampedProgress)
    }

    // Update on animation frame for smooth updates during pan/zoom
    let rafId: number
    const animationLoop = () => {
      updateProgress()
      rafId = requestAnimationFrame(animationLoop)
    }
    rafId = requestAnimationFrame(animationLoop)

    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div className="fixed top-0 left-0 w-full h-1 bg-gray-200 dark:bg-gray-700 z-50">
      <div
        className="h-full bg-blue-500 transition-all duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}

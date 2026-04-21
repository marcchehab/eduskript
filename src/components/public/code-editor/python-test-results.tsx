'use client'

import { useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import type { PythonCheckResult } from './types'
import { effects, playEffect, playRandomEffect } from './celebrations'

interface PythonTestResultsProps {
  results: PythonCheckResult[]
  points: number
  earnedPoints: number
  checksUsed: number
  maxChecks: number | null
}

export function PythonTestResults({ results, points, earnedPoints, checksUsed, maxChecks }: PythonTestResultsProps) {
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const percentage = total > 0 ? Math.round((passed / total) * 100) : 0
  const allPassed = passed === total && total > 0
  const containerRef = useRef<HTMLDivElement>(null)
  const lastCelebratedCheck = useRef(0)

  // Compute a rect: width from container left to end of header text, top to bottom of last test row
  const getContentRect = (): DOMRect | undefined => {
    if (!containerRef.current) return undefined
    const el = containerRef.current
    const containerRect = el.getBoundingClientRect()
    // Query the DOM for the header text and test list
    const headerText = el.querySelector('[data-header-text]') as HTMLElement | null
    const testsList = el.querySelector('[data-tests-list]') as HTMLElement | null
    if (!headerText || !testsList) return containerRect
    const headerTextRect = headerText.getBoundingClientRect()
    const testsRect = testsList.getBoundingClientRect()
    const width = headerTextRect.right - containerRect.left
    return new DOMRect(containerRect.left, containerRect.top, width, testsRect.bottom - containerRect.top)
  }

  // Fire random celebration when all tests pass on a new check
  useEffect(() => {
    if (allPassed && checksUsed > lastCelebratedCheck.current && containerRef.current) {
      lastCelebratedCheck.current = checksUsed
      playRandomEffect(containerRef.current, getContentRect())
    }
  }, [allPassed, checksUsed])

  return (
    <div ref={containerRef} className="relative text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div data-header-text className="flex items-center gap-2">
          <span className={`font-medium ${allPassed ? 'text-green-600 dark:text-green-400' : ''}`}>
            {passed}/{total} tests passed ({percentage}%)
          </span>
          {points > 0 && (
            <span className="text-muted-foreground">
              &middot; {earnedPoints}/{points} points
            </span>
          )}
        </div>
        {maxChecks !== null && (
          <span className="text-xs text-muted-foreground">
            Attempts: {checksUsed}/{maxChecks}
          </span>
        )}
      </div>

      {/* Per-test results */}
      <div data-tests-list>
        {results.map((r) => (
          <div key={r.index} className="px-3 py-1.5 flex items-start gap-2">
            {r.passed ? (
              <span data-check-icon className="flex-shrink-0 mt-0.5 relative">
                <Check className="w-4 h-4 text-green-500" />
              </span>
            ) : (
              <X className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <span className={r.passed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {r.label}
              </span>
              {r.error && (
                <div className={`text-xs mt-0.5 ${
                  r.passed
                    ? 'text-green-600/80 dark:text-green-500/80 italic'
                    : 'text-muted-foreground font-mono'
                }`}>
                  {r.error}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Debug: test each effect */}
      {process.env.NODE_ENV === 'development' && (
        <div className="px-3 py-2 flex flex-wrap gap-1 border-t border-border/30 mt-1">
          {effects.map((e, i) => (
            <button
              key={i}
              onClick={() => containerRef.current && playEffect(i, containerRef.current, getContentRect())}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted-foreground/20 text-muted-foreground transition-colors"
            >
              {e.name}
            </button>
          ))}
          <button
            onClick={() => containerRef.current && playRandomEffect(containerRef.current, getContentRect())}
            className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary transition-colors font-medium"
          >
            Random
          </button>
        </div>
      )}
    </div>
  )
}

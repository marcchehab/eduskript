'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Check, X, Minus, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'

interface QuizStats {
  correct: number
  partial: number
  wrong: number
  notAnswered: number
  total: number
}

interface QuizResponseItem {
  studentId: string
  pseudonym: string
  displayName: string
  data: {
    selected?: number[]
    textAnswer?: string
    numberAnswer?: number
    isSubmitted: boolean
  } | null
  submittedAt: number | null
  isCorrect?: boolean
  isPartiallyCorrect?: boolean
}

interface QuizProgressBarProps {
  classId: string
  className: string // Class name for display
  pageId: string
  componentId: string
  questionType: 'single' | 'multiple' | 'text' | 'number'
  correctIndices: number[]
  options?: string[] // Option labels for displaying what was selected
}

export function QuizProgressBar({
  classId,
  className,
  pageId,
  componentId,
  questionType,
  correctIndices,
  options = []
}: QuizProgressBarProps) {
  const [stats, setStats] = useState<QuizStats | null>(null)
  const [responses, setResponses] = useState<QuizResponseItem[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch quiz responses
  const fetchResponses = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        pageId,
        componentId,
        correctIndices: JSON.stringify(correctIndices)
      })
      const res = await fetch(`/api/classes/${classId}/quiz-responses?${params}`)

      if (!res.ok) {
        throw new Error('Failed to fetch responses')
      }

      const data = await res.json()
      setStats(data.stats)
      setResponses(data.responses)
    } catch (e) {
      console.error('Failed to fetch quiz responses:', e)
      setError('Failed to load class responses')
    } finally {
      setIsLoading(false)
    }
  }, [classId, pageId, componentId, correctIndices])

  // Subscribe to real-time quiz submission events via SSE
  useRealtimeEvents(
    ['quiz-submission'],
    (event) => {
      // Only refresh if this event is for our class and page/component
      if (
        event.type === 'quiz-submission' &&
        event.classId === classId &&
        event.pageId === pageId &&
        event.questionId === componentId
      ) {
        console.log('[QuizProgressBar] Received quiz submission via SSE, refreshing')
        fetchResponses()
      }
    },
    { enabled: true }
  )

  // Initial fetch when component mounts
  useEffect(() => {
    fetchResponses()
  }, [fetchResponses])

  if (isLoading && !stats) {
    return (
      <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 text-sm">
        {error}
      </div>
    )
  }

  if (!stats) return null

  const answered = stats.total - stats.notAnswered
  const progressPercent = stats.total > 0 ? (answered / stats.total) * 100 : 0

  // Calculate segment widths for the stacked bar
  const correctWidth = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0
  const partialWidth = stats.total > 0 ? (stats.partial / stats.total) * 100 : 0
  const wrongWidth = stats.total > 0 ? (stats.wrong / stats.total) * 100 : 0
  const notAnsweredWidth = stats.total > 0 ? (stats.notAnswered / stats.total) * 100 : 0

  const isChoiceQuestion = questionType === 'single' || questionType === 'multiple'

  // Format answer for display
  const formatAnswer = (response: QuizResponseItem) => {
    if (!response.data?.isSubmitted) {
      return <span className="text-muted-foreground italic">Not answered</span>
    }

    if (questionType === 'text') {
      return (
        <span className="text-sm break-words">
          &ldquo;{response.data.textAnswer}&rdquo;
        </span>
      )
    }

    if (questionType === 'number') {
      return <span className="font-mono">{response.data.numberAnswer}</span>
    }

    // Choice questions
    if (response.data.selected && response.data.selected.length > 0) {
      const selectedLabels = response.data.selected
        .sort((a, b) => a - b)
        .map(i => options[i] || `Option ${i + 1}`)
        .join(', ')
      return <span>{selectedLabels}</span>
    }

    return <span className="text-muted-foreground italic">No selection</span>
  }

  // Get status icon for a response
  const getStatusIcon = (response: QuizResponseItem) => {
    if (!response.data?.isSubmitted) {
      return <Clock className="h-4 w-4 text-muted-foreground" />
    }

    if (!isChoiceQuestion) {
      // For text/number questions, just show submitted checkmark
      return <Check className="h-4 w-4 text-blue-500" />
    }

    if (response.isCorrect) {
      return <Check className="h-4 w-4 text-green-500" />
    }
    if (response.isPartiallyCorrect) {
      return <Minus className="h-4 w-4 text-yellow-500" />
    }
    return <X className="h-4 w-4 text-red-500" />
  }

  return (
    <div className="mt-4 rounded-lg border border-border overflow-hidden">
      {/* Progress bar header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{className}</span>
            <span>&bull;</span>
            <span>{answered}/{stats.total} answered</span>
            {isChoiceQuestion && stats.correct > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-green-600 dark:text-green-400">{stats.correct} correct</span>
              </>
            )}
            {isChoiceQuestion && stats.partial > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-yellow-600 dark:text-yellow-400">{stats.partial} partial</span>
              </>
            )}
            {isChoiceQuestion && stats.wrong > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-red-600 dark:text-red-400">{stats.wrong} wrong</span>
              </>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Stacked progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden flex">
          {correctWidth > 0 && (
            <div
              className="bg-green-500 transition-all duration-300"
              style={{ width: `${correctWidth}%` }}
            />
          )}
          {partialWidth > 0 && (
            <div
              className="bg-yellow-500 transition-all duration-300"
              style={{ width: `${partialWidth}%` }}
            />
          )}
          {wrongWidth > 0 && (
            <div
              className="bg-red-500 transition-all duration-300"
              style={{ width: `${wrongWidth}%` }}
            />
          )}
          {notAnsweredWidth > 0 && (
            <div
              className="bg-gray-300 dark:bg-gray-600 transition-all duration-300"
              style={{ width: `${notAnsweredWidth}%` }}
            />
          )}
        </div>
      </button>

      {/* Expanded answers panel */}
      {isExpanded && (
        <div className="max-h-72 overflow-y-auto border-t border-border">
          {responses.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No students in this class
            </div>
          ) : (
            <div className="divide-y divide-border">
              {responses
                .sort((a, b) => {
                  // Sort: answered first, then by correctness
                  const aSubmitted = a.data?.isSubmitted ? 1 : 0
                  const bSubmitted = b.data?.isSubmitted ? 1 : 0
                  if (aSubmitted !== bSubmitted) return bSubmitted - aSubmitted

                  if (isChoiceQuestion) {
                    const aScore = a.isCorrect ? 3 : a.isPartiallyCorrect ? 2 : 1
                    const bScore = b.isCorrect ? 3 : b.isPartiallyCorrect ? 2 : 1
                    return bScore - aScore
                  }
                  return 0
                })
                .map(response => (
                  <div
                    key={response.studentId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2 text-sm",
                      !response.data?.isSubmitted && "opacity-60"
                    )}
                  >
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {getStatusIcon(response)}
                    </div>

                    {/* Student name */}
                    <div className="flex-shrink-0 w-32 truncate font-medium">
                      {response.displayName}
                    </div>

                    {/* Answer */}
                    <div className="flex-1 truncate text-muted-foreground">
                      {formatAnswer(response)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

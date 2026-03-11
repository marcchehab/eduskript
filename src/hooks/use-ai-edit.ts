'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { EditProposal, PageEdit } from '@/lib/ai/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit')

interface UseAIEditOptions {
  skriptId: string
  pageId?: string
  currentContent?: string
}

interface EditPlan {
  totalEdits: number
  overallSummary: string
  pages: Array<{
    pageId: string | null
    pageTitle: string
    pageSlug: string
    summary: string
    isNew?: boolean
  }>
  // Overflow info when AI response had text outside JSON
  overflowBefore?: string | null
  overflowAfter?: string | null
  fullResponse?: string
  // AI message when it returned text instead of JSON
  aiMessage?: string
}

interface OverflowInfo {
  overflowBefore: string | null
  overflowAfter: string | null
  fullResponse: string
}

interface FailedPage {
  pageIndex: number
  error: string
}

interface UseAIEditReturn {
  proposal: EditProposal | null
  isLoading: boolean
  error: string | null
  // Progressive state
  plan: EditPlan | null
  currentEditIndex: number
  completedEdits: PageEdit[]
  failedPages: FailedPage[]
  // Overflow info (when AI response had malformed output)
  overflow: OverflowInfo | null
  // AI message (when AI returned text instead of JSON edits)
  aiMessage: string | null
  // Job ID for recovery
  jobId: string | null
  // Actions
  requestEdit: (instruction: string) => Promise<void>
  applyEdits: (edits: PageEdit[]) => Promise<void>
  clearProposal: () => void
  cancelRequest: () => void
  retryPage: (pageIndex: number) => Promise<void>
  recoverJob: (jobId: string) => Promise<void>
}

// Session storage key for persisting active job ID
function getJobStorageKey(skriptId: string): string {
  return `ai-edit-job:${skriptId}`
}

export function useAIEdit({ skriptId, pageId, currentContent }: UseAIEditOptions): UseAIEditReturn {
  const [proposal, setProposal] = useState<EditProposal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Progressive state
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [currentEditIndex, setCurrentEditIndex] = useState(-1)
  const [completedEdits, setCompletedEdits] = useState<PageEdit[]>([])
  const [failedPages, setFailedPages] = useState<FailedPage[]>([])
  const [overflow, setOverflow] = useState<OverflowInfo | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  // AbortController ref for cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Generate a single page edit, updating state progressively.
   * Returns true on success, false on failure.
   */
  const generatePage = useCallback(
    async (currentJobId: string, pageIndex: number, signal: AbortSignal): Promise<PageEdit | null> => {
      const response = await fetch(`/api/ai/edit/${currentJobId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIndex }),
        signal,
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        const errorMsg = data.error || 'Failed to generate edit'
        log.error(`Page ${pageIndex} failed:`, errorMsg)
        setFailedPages(prev => [...prev, { pageIndex, error: errorMsg }])
        return null
      }

      const edit: PageEdit = {
        pageId: data.edit.pageId,
        pageTitle: data.edit.pageTitle,
        pageSlug: data.edit.pageSlug,
        originalContent: data.edit.originalContent,
        proposedContent: data.edit.proposedContent,
        summary: data.edit.summary,
        isNew: data.edit.isNew,
      }

      return edit
    },
    []
  )

  /**
   * Run page generation sequentially for all pages in the plan.
   */
  const generateAllPages = useCallback(
    async (currentJobId: string, planPages: EditPlan['pages'], signal: AbortSignal) => {
      const edits: PageEdit[] = []

      for (let i = 0; i < planPages.length; i++) {
        if (signal.aborted) break

        setCurrentEditIndex(i)

        const edit = await generatePage(currentJobId, i, signal)
        if (edit) {
          edits.push(edit)
          setCompletedEdits([...edits])
        }
      }

      // All done — build proposal
      setCurrentEditIndex(planPages.length)
      if (edits.length > 0) {
        setProposal({
          skriptId,
          edits,
          overallSummary: '', // Will be filled from plan
        })
      }
    },
    [skriptId, generatePage]
  )

  const requestEdit = useCallback(
    async (instruction: string) => {
      // Cancel any existing request
      if (abortControllerRef.current) {
        log('Aborting previous request')
        abortControllerRef.current.abort()
      }

      setIsLoading(true)
      setError(null)
      setPlan(null)
      setCurrentEditIndex(-1)
      setCompletedEdits([])
      setFailedPages([])
      setProposal(null)
      setOverflow(null)
      setAiMessage(null)
      setJobId(null)

      const controller = new AbortController()
      abortControllerRef.current = controller

      log('Starting edit request', { skriptId, pageId, instructionLength: instruction.length })

      try {
        // Phase 1: Create job + get plan
        const response = await fetch('/api/ai/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skriptId, pageId, instruction, currentContent }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to get edit plan')
        }

        const data = await response.json()

        // Handle AI text-only response (no job created)
        if (data.aiMessage) {
          setAiMessage(data.aiMessage)
          setPlan(data.plan)
          setProposal({ skriptId, edits: [], overallSummary: data.plan.overallSummary })
          setIsLoading(false)
          return
        }

        // No edits planned
        if (!data.jobId || data.plan.totalEdits === 0) {
          setPlan(data.plan)
          setProposal({ skriptId, edits: [], overallSummary: data.plan.overallSummary })
          setIsLoading(false)
          return
        }

        // Capture overflow info
        if (data.overflowBefore || data.overflowAfter) {
          setOverflow({
            overflowBefore: data.overflowBefore || null,
            overflowAfter: data.overflowAfter || null,
            fullResponse: data.fullResponse || '',
          })
        }

        const editPlan: EditPlan = data.plan
        setPlan(editPlan)
        setJobId(data.jobId)
        setCurrentEditIndex(0)

        // Store job ID for recovery
        try {
          sessionStorage.setItem(getJobStorageKey(skriptId), data.jobId)
        } catch {
          // sessionStorage may not be available
        }

        // Phase 2: Generate each page edit sequentially
        await generateAllPages(data.jobId, editPlan.pages, controller.signal)

        // Update proposal with overall summary from plan
        setProposal(prev => prev ? { ...prev, overallSummary: editPlan.overallSummary } : prev)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          log('Request aborted by user')
          return
        }
        log.error('Request failed:', err)
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [skriptId, pageId, currentContent, generateAllPages]
  )

  /**
   * Retry a single failed page.
   */
  const retryPage = useCallback(
    async (pageIndex: number) => {
      if (!jobId) return

      const controller = new AbortController()
      abortControllerRef.current = controller

      // Remove from failed list
      setFailedPages(prev => prev.filter(f => f.pageIndex !== pageIndex))

      try {
        const edit = await generatePage(jobId, pageIndex, controller.signal)
        if (edit) {
          setCompletedEdits(prev => {
            const updated = [...prev, edit]
            // Sort by page index to maintain order
            // (index is stored in the edit via the API response)
            setProposal(current => current
              ? { ...current, edits: updated }
              : { skriptId, edits: updated, overallSummary: plan?.overallSummary || '' }
            )
            return updated
          })
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        log.error('Retry failed:', err)
      } finally {
        abortControllerRef.current = null
      }
    },
    [jobId, skriptId, plan, generatePage]
  )

  /**
   * Recover a job after disconnect — fetch status from DB and resume.
   */
  const recoverJob = useCallback(
    async (recoveryJobId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/ai/edit/${recoveryJobId}`)
        if (!response.ok) {
          // Job not found or expired — clear storage
          try { sessionStorage.removeItem(getJobStorageKey(skriptId)) } catch {}
          setIsLoading(false)
          return
        }

        const data = await response.json()

        if (data.status === 'cancelled' || !data.plan) {
          try { sessionStorage.removeItem(getJobStorageKey(skriptId)) } catch {}
          setIsLoading(false)
          return
        }

        // Restore state
        setJobId(recoveryJobId)
        setPlan(data.plan)

        const recovered: PageEdit[] = (data.completedEdits || []).map((e: Record<string, unknown>) => ({
          pageId: e.pageId as string | null,
          pageTitle: e.pageTitle as string,
          pageSlug: e.pageSlug as string,
          originalContent: e.originalContent as string,
          proposedContent: e.proposedContent as string,
          summary: e.summary as string,
          isNew: e.isNew as boolean,
        }))
        setCompletedEdits(recovered)
        setFailedPages(data.failedPages || [])

        const totalPages = data.plan.pages.length
        const doneCount = recovered.length + (data.failedPages?.length || 0)

        if (doneCount >= totalPages || data.status === 'completed') {
          // Job is done
          setCurrentEditIndex(totalPages)
          if (recovered.length > 0) {
            setProposal({
              skriptId,
              edits: recovered,
              overallSummary: data.plan.overallSummary,
            })
          }
          setIsLoading(false)
        } else {
          // Resume generating remaining pages
          const controller = new AbortController()
          abortControllerRef.current = controller

          setCurrentEditIndex(doneCount)

          const completedIndices = new Set([
            ...recovered.map((_: PageEdit, i: number) => i),
            ...(data.failedPages || []).map((f: FailedPage) => f.pageIndex),
          ])

          // Figure out which page indices from completedEdits
          const completedPageIndices = new Set<number>()
          for (const edit of data.completedEdits || []) {
            const idx = (edit as Record<string, unknown>).index as number
            if (typeof idx === 'number') completedPageIndices.add(idx)
          }
          for (const fp of data.failedPages || []) {
            completedPageIndices.add(fp.pageIndex)
          }

          const edits = [...recovered]

          for (let i = 0; i < totalPages; i++) {
            if (controller.signal.aborted) break
            if (completedPageIndices.has(i)) continue

            setCurrentEditIndex(i)

            const edit = await generatePage(recoveryJobId, i, controller.signal)
            if (edit) {
              edits.push(edit)
              setCompletedEdits([...edits])
            }
          }

          setCurrentEditIndex(totalPages)
          if (edits.length > 0) {
            setProposal({
              skriptId,
              edits,
              overallSummary: data.plan.overallSummary,
            })
          }
          setIsLoading(false)
          abortControllerRef.current = null
        }
      } catch (err) {
        log.error('Recovery failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to recover job')
        setIsLoading(false)
      }
    },
    [skriptId, generatePage]
  )

  // Check for recoverable job on mount
  useEffect(() => {
    try {
      const storedJobId = sessionStorage.getItem(getJobStorageKey(skriptId))
      if (storedJobId) {
        setJobId(storedJobId)
      }
    } catch {
      // sessionStorage not available
    }
  }, [skriptId])

  const applyEdits = useCallback(
    async (edits: PageEdit[]) => {
      log(`Applying ${edits.length} edits`)
      // Separate new pages from existing page edits
      const newPages = edits.filter((e) => e.isNew)
      const existingEdits = edits.filter((e) => !e.isNew)

      // Apply edits to existing pages
      const editResults = await Promise.allSettled(
        existingEdits.map(async (edit) => {
          const response = await fetch(`/api/pages/${edit.pageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: edit.proposedContent }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || `Failed to update page: ${edit.pageTitle}`)
          }

          return edit.pageId
        })
      )

      // Create new pages
      const createResults = await Promise.allSettled(
        newPages.map(async (edit) => {
          const response = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skriptId,
              title: edit.pageTitle,
              slug: edit.pageSlug,
              content: edit.proposedContent,
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || `Failed to create page: ${edit.pageTitle}`)
          }

          return edit.pageSlug
        })
      )

      // Check for failures
      const allResults = [...editResults, ...createResults]
      const failures = allResults.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      )

      if (failures.length > 0) {
        const messages = failures.map((f) => f.reason?.message || 'Unknown error')
        throw new Error(`Some edits failed: ${messages.join(', ')}`)
      }

      // Clean up job and session storage
      if (jobId) {
        try { await fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }) } catch {}
        try { sessionStorage.removeItem(getJobStorageKey(skriptId)) } catch {}
      }

      // Clear proposal on success
      setProposal(null)
      setPlan(null)
      setCompletedEdits([])
      setFailedPages([])
      setCurrentEditIndex(-1)
      setJobId(null)
    },
    [skriptId, jobId]
  )

  const clearProposal = useCallback(() => {
    // Cancel job on server if active
    if (jobId) {
      fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }).catch(() => {})
      try { sessionStorage.removeItem(getJobStorageKey(skriptId)) } catch {}
    }

    setProposal(null)
    setError(null)
    setPlan(null)
    setCompletedEdits([])
    setFailedPages([])
    setCurrentEditIndex(-1)
    setOverflow(null)
    setAiMessage(null)
    setJobId(null)
  }, [jobId, skriptId])

  const cancelRequest = useCallback(() => {
    log('Cancel requested', { hasController: !!abortControllerRef.current })
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    // Cancel job on server
    if (jobId) {
      fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }).catch(() => {})
      try { sessionStorage.removeItem(getJobStorageKey(skriptId)) } catch {}
    }
    setIsLoading(false)
  }, [jobId, skriptId])

  return {
    proposal,
    isLoading,
    error,
    plan,
    currentEditIndex,
    completedEdits,
    failedPages,
    overflow,
    aiMessage,
    jobId,
    requestEdit,
    applyEdits,
    clearProposal,
    cancelRequest,
    retryPage,
    recoverJob,
  }
}

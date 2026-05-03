'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { EditProposal, PageEdit } from '@/lib/ai/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit')

/**
 * Where AI edits are targeted.
 * - 'page': edit one or more pages within a skript (multi-page proposal flow)
 * - 'frontpage': edit a single FrontPage content blob (single-edit flow; the
 *   parent component is responsible for actually saving the new content via
 *   the FrontPage save API — the hook does not write to the server)
 */
export type AIEditTarget =
  | { mode: 'page'; skriptId: string; pageId?: string }
  | { mode: 'frontpage'; frontPageId: string }

interface UseAIEditOptions {
  target: AIEditTarget
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
  overflowBefore?: string | null
  overflowAfter?: string | null
  fullResponse?: string
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
  plan: EditPlan | null
  currentEditIndex: number
  completedEdits: PageEdit[]
  failedPages: FailedPage[]
  overflow: OverflowInfo | null
  aiMessage: string | null
  jobId: string | null
  requestEdit: (instruction: string) => Promise<void>
  applyEdits: (edits: PageEdit[]) => Promise<void>
  clearProposal: () => void
  cancelRequest: () => void
  retryPage: (pageIndex: number) => Promise<void>
  recoverJob: (jobId: string) => Promise<void>
}

// Session storage key — namespaced by mode so a frontpage job can't be picked
// up by a skript-mode modal opened with the same skript ID, and vice versa.
function getJobStorageKey(target: AIEditTarget): string {
  return target.mode === 'frontpage'
    ? `ai-edit-job:frontpage:${target.frontPageId}`
    : `ai-edit-job:${target.skriptId}`
}

// Opaque string used as proposal.skriptId — never displayed; only kept for the
// EditProposal type contract. For frontpage mode we use a synthetic prefix.
function proposalScopeId(target: AIEditTarget): string {
  return target.mode === 'frontpage' ? `frontpage:${target.frontPageId}` : target.skriptId
}

export function useAIEdit({ target, currentContent }: UseAIEditOptions): UseAIEditReturn {
  const [proposal, setProposal] = useState<EditProposal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [currentEditIndex, setCurrentEditIndex] = useState(-1)
  const [completedEdits, setCompletedEdits] = useState<PageEdit[]>([])
  const [failedPages, setFailedPages] = useState<FailedPage[]>([])
  const [overflow, setOverflow] = useState<OverflowInfo | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  // Stable scope ID for the current target
  const scopeId = proposalScopeId(target)
  const storageKey = getJobStorageKey(target)

  const generatePage = useCallback(
    async (currentJobId: string, pageIndex: number, signal: AbortSignal): Promise<PageEdit | null> => {
      const response = await fetch(`/api/ai/edit/${currentJobId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIndex }),
        signal,
      })

      const text = await response.text()
      log(`Page ${pageIndex} response: status=${response.status}, length=${text.length}, content-type=${response.headers.get('content-type')}`)
      if (log.enabled) {
        log(`Page ${pageIndex} body:`, text.slice(0, 500))
      }
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        log.error(`Page ${pageIndex}: non-JSON response (status ${response.status}):`, text.slice(0, 200))
        setFailedPages(prev => [...prev, { pageIndex, error: 'Server returned an invalid response. Please try again.' }])
        return null
      }

      if (!response.ok || !data.success) {
        const errorMsg = (data.error as string) || 'Failed to generate edit'
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

      setCurrentEditIndex(planPages.length)
      if (edits.length > 0) {
        setProposal({
          skriptId: scopeId,
          edits,
          overallSummary: '',
        })
      }
    },
    [scopeId, generatePage]
  )

  const requestEdit = useCallback(
    async (instruction: string) => {
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

      log('Starting edit request', { target, instructionLength: instruction.length })

      try {
        // Build the request body based on mode — exactly one of skriptId/frontPageId
        const body: Record<string, unknown> = { instruction, currentContent }
        if (target.mode === 'frontpage') {
          body.frontPageId = target.frontPageId
        } else {
          body.skriptId = target.skriptId
          if (target.pageId) body.pageId = target.pageId
        }

        const response = await fetch('/api/ai/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!response.ok) {
          const text = await response.text()
          let errorMsg = 'Failed to get edit plan'
          try {
            const data = JSON.parse(text)
            errorMsg = data.error || errorMsg
          } catch {
            log.error('Non-JSON error response:', text.slice(0, 200))
          }
          throw new Error(errorMsg)
        }

        const text = await response.text()
        let data: any
        try {
          data = JSON.parse(text)
        } catch {
          log.error('Failed to parse plan response as JSON:', text.slice(0, 200))
          throw new Error('Server returned an invalid response. Please try again.')
        }

        if (data.aiMessage) {
          setAiMessage(data.aiMessage)
          setPlan(data.plan)
          setProposal({ skriptId: scopeId, edits: [], overallSummary: data.plan.overallSummary })
          setIsLoading(false)
          return
        }

        if (!data.jobId || data.plan.totalEdits === 0) {
          setPlan(data.plan)
          setProposal({ skriptId: scopeId, edits: [], overallSummary: data.plan.overallSummary })
          setIsLoading(false)
          return
        }

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

        try {
          sessionStorage.setItem(storageKey, data.jobId)
        } catch {
          // sessionStorage may not be available
        }

        await generateAllPages(data.jobId, editPlan.pages, controller.signal)

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
    [target, currentContent, scopeId, storageKey, generateAllPages]
  )

  const retryPage = useCallback(
    async (pageIndex: number) => {
      if (!jobId) return

      const controller = new AbortController()
      abortControllerRef.current = controller

      setFailedPages(prev => prev.filter(f => f.pageIndex !== pageIndex))

      try {
        const edit = await generatePage(jobId, pageIndex, controller.signal)
        if (edit) {
          setCompletedEdits(prev => {
            const updated = [...prev, edit]
            setProposal(current => current
              ? { ...current, edits: updated }
              : { skriptId: scopeId, edits: updated, overallSummary: plan?.overallSummary || '' }
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
    [jobId, scopeId, plan, generatePage]
  )

  const recoverJob = useCallback(
    async (recoveryJobId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/ai/edit/${recoveryJobId}`)
        if (!response.ok) {
          try { sessionStorage.removeItem(storageKey) } catch {}
          setIsLoading(false)
          return
        }

        const data = await response.json()

        if (data.status === 'cancelled' || !data.plan) {
          try { sessionStorage.removeItem(storageKey) } catch {}
          setIsLoading(false)
          return
        }

        // Sanity-check that the recovered job matches the current target. A
        // mode mismatch shouldn't normally happen because storage keys are
        // namespaced by mode, but a stale frontpage job under a now-skript
        // editor (or vice versa) would corrupt state — clear and bail.
        const recoveredIsFrontpage = !!data.frontPageId
        const targetIsFrontpage = target.mode === 'frontpage'
        if (recoveredIsFrontpage !== targetIsFrontpage) {
          log.warn('Recovered job mode mismatch — discarding', { recoveredIsFrontpage, targetIsFrontpage })
          try { sessionStorage.removeItem(storageKey) } catch {}
          setIsLoading(false)
          return
        }

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
          setCurrentEditIndex(totalPages)
          if (recovered.length > 0) {
            setProposal({
              skriptId: scopeId,
              edits: recovered,
              overallSummary: data.plan.overallSummary,
            })
          }
          setIsLoading(false)
        } else {
          const controller = new AbortController()
          abortControllerRef.current = controller

          setCurrentEditIndex(doneCount)

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
              skriptId: scopeId,
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
    [target.mode, scopeId, storageKey, generatePage]
  )

  // Restore a stored job ID for this scope on mount (modal will call recoverJob).
  useEffect(() => {
    try {
      const storedJobId = sessionStorage.getItem(storageKey)
      if (storedJobId) {
        setJobId(storedJobId)
      }
    } catch {
      // sessionStorage not available
    }
  }, [storageKey])

  const applyEdits = useCallback(
    async (edits: PageEdit[]) => {
      log(`Applying ${edits.length} edits`)

      // Frontpage mode: the hook does NOT save server-side. The modal hands the
      // proposed content back to the parent via `onEditsApplied(newContent)` and
      // the parent's existing FrontPage save endpoint persists it. Just clean up
      // the job and reset state here.
      if (target.mode === 'frontpage') {
        if (jobId) {
          try { await fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }) } catch {}
          try { sessionStorage.removeItem(storageKey) } catch {}
        }

        setProposal(null)
        setPlan(null)
        setCompletedEdits([])
        setFailedPages([])
        setCurrentEditIndex(-1)
        setJobId(null)
        return
      }

      // Skript mode: write existing pages via PATCH and create new pages via POST.
      const newPages = edits.filter((e) => e.isNew)
      const existingEdits = edits.filter((e) => !e.isNew)

      const editResults = await Promise.allSettled(
        existingEdits.map(async (edit) => {
          const response = await fetch(`/api/pages/${edit.pageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: edit.proposedContent,
              ...(edit.proposedDescription !== undefined
                ? { description: edit.proposedDescription }
                : {}),
              editSource: 'ai-edit',
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || `Failed to update page: ${edit.pageTitle}`)
          }

          return edit.pageId
        })
      )

      const createResults = await Promise.allSettled(
        newPages.map(async (edit) => {
          const response = await fetch('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skriptId: target.skriptId,
              title: edit.pageTitle,
              slug: edit.pageSlug,
              ...(edit.proposedDescription
                ? { description: edit.proposedDescription }
                : {}),
              content: edit.proposedContent,
              editSource: 'ai-edit',
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || `Failed to create page: ${edit.pageTitle}`)
          }

          return edit.pageSlug
        })
      )

      const allResults = [...editResults, ...createResults]
      const failures = allResults.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      )

      if (failures.length > 0) {
        const messages = failures.map((f) => f.reason?.message || 'Unknown error')
        throw new Error(`Some edits failed: ${messages.join(', ')}`)
      }

      if (jobId) {
        try { await fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }) } catch {}
        try { sessionStorage.removeItem(storageKey) } catch {}
      }

      setProposal(null)
      setPlan(null)
      setCompletedEdits([])
      setFailedPages([])
      setCurrentEditIndex(-1)
      setJobId(null)
    },
    [target, jobId, storageKey]
  )

  const clearProposal = useCallback(() => {
    if (jobId) {
      fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }).catch(() => {})
      try { sessionStorage.removeItem(storageKey) } catch {}
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
  }, [jobId, storageKey])

  const cancelRequest = useCallback(() => {
    log('Cancel requested', { hasController: !!abortControllerRef.current })
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (jobId) {
      fetch(`/api/ai/edit/${jobId}`, { method: 'DELETE' }).catch(() => {})
      try { sessionStorage.removeItem(storageKey) } catch {}
    }
    setIsLoading(false)
  }, [jobId, storageKey])

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

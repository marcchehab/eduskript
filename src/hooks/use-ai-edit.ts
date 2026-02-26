'use client'

import { useState, useCallback, useRef } from 'react'
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

interface UseAIEditReturn {
  proposal: EditProposal | null
  isLoading: boolean
  error: string | null
  // Streaming state
  plan: EditPlan | null
  currentEditIndex: number
  completedEdits: PageEdit[]
  // Overflow info (when AI response had malformed output)
  overflow: OverflowInfo | null
  // AI message (when AI returned text instead of JSON edits)
  aiMessage: string | null
  // Actions
  requestEdit: (instruction: string) => Promise<void>
  applyEdits: (edits: PageEdit[]) => Promise<void>
  clearProposal: () => void
  cancelRequest: () => void
}

export function useAIEdit({ skriptId, pageId, currentContent }: UseAIEditOptions): UseAIEditReturn {
  const [proposal, setProposal] = useState<EditProposal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Streaming state
  const [plan, setPlan] = useState<EditPlan | null>(null)
  const [currentEditIndex, setCurrentEditIndex] = useState(-1)
  const [completedEdits, setCompletedEdits] = useState<PageEdit[]>([])
  const [overflow, setOverflow] = useState<OverflowInfo | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)

  // AbortController ref for cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

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
      setProposal(null)
      setOverflow(null)
      setAiMessage(null)

      const controller = new AbortController()
      abortControllerRef.current = controller

      log('Starting edit request', { skriptId, pageId, instructionLength: instruction.length })

      try {
        const response = await fetch('/api/ai/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skriptId, pageId, instruction, currentContent }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to get edit proposal')
        }

        // Handle SSE stream
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let buffer = ''
        const edits: PageEdit[] = []
        let overallSummary = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events from buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer

          log(`Processing chunk: ${lines.length} lines, buffer remaining: ${buffer.length} chars`)

          let eventType = ''
          let eventData = ''

          for (const line of lines) {
            if (line.trim()) {
              log(`Line: ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`)
            }
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6)
              log(`Got data line, length: ${eventData.length}, eventType: ${eventType}`)

              if (eventType && eventData && eventData.trim()) {
                try {
                  log(`Parsing eventData (${eventData.length} chars):`, eventData.slice(0, 200))
                  const data = JSON.parse(eventData)
                  log(`Received event: ${eventType}`, data)

                  switch (eventType) {
                    case 'plan':
                      setPlan(data)
                      overallSummary = data.overallSummary
                      setCurrentEditIndex(0)
                      // Capture overflow info if present
                      if (data.overflowBefore || data.overflowAfter) {
                        setOverflow({
                          overflowBefore: data.overflowBefore || null,
                          overflowAfter: data.overflowAfter || null,
                          fullResponse: data.fullResponse || ''
                        })
                      }
                      break

                    case 'edit':
                      const edit: PageEdit = {
                        pageId: data.pageId,
                        pageTitle: data.pageTitle,
                        pageSlug: data.pageSlug,
                        originalContent: data.originalContent,
                        proposedContent: data.proposedContent,
                        summary: data.summary,
                        isNew: data.isNew,
                      }
                      edits.push(edit)
                      log(`Edit ${data.index + 1} received: "${data.pageTitle}", total edits: ${edits.length}`)
                      setCompletedEdits([...edits])
                      setCurrentEditIndex(data.index + 1)
                      break

                    case 'complete':
                      // Build final proposal from locally accumulated edits
                      // Server sends { success: true }, edits were sent progressively via 'edit' events
                      log(`Complete event. Local edits: ${edits.length}, data.edits: ${data.edits?.length ?? 'undefined'}`)
                      log('Local edit titles:', edits.map(e => e.pageTitle))

                      // Handle AI text-only response (no JSON edits)
                      if (data.aiMessage) {
                        log('AI returned text instead of JSON edits')
                        setAiMessage(data.aiMessage)
                      }

                      // Prefer locally accumulated edits (from streaming) - only fall back to data.edits if empty
                      const finalEdits = edits.length > 0 ? edits : (data.edits || [])
                      log(`Setting proposal with ${finalEdits.length} edits`)
                      if (finalEdits.length > 0) {
                        setProposal({
                          skriptId,
                          edits: finalEdits,
                          overallSummary: data.overallSummary || overallSummary,
                        })
                      } else {
                        setProposal({
                          skriptId,
                          edits: [],
                          overallSummary: data.overallSummary || 'No changes needed',
                        })
                      }
                      break

                    case 'error':
                      // Preserve full response for display if available
                      if (data.fullResponse) {
                        setOverflow({
                          overflowBefore: null,
                          overflowAfter: null,
                          fullResponse: data.fullResponse
                        })
                      }
                      throw new Error(data.error || 'Unknown error')
                  }
                } catch (parseError) {
                  log.error('Parse error:', parseError, 'Data:', eventData)
                  if (!(parseError instanceof SyntaxError)) {
                    throw parseError
                  }
                }

                eventType = ''
                eventData = ''
              }
            }
          }
        }
        log(`Stream ended. Edits received: ${edits.length}`, edits.map(e => e.pageTitle))
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
    [skriptId, pageId, currentContent]
  )

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

      // Clear proposal on success
      setProposal(null)
      setPlan(null)
      setCompletedEdits([])
      setCurrentEditIndex(-1)
    },
    [skriptId]
  )

  const clearProposal = useCallback(() => {
    setProposal(null)
    setError(null)
    setPlan(null)
    setCompletedEdits([])
    setCurrentEditIndex(-1)
    setOverflow(null)
    setAiMessage(null)
  }, [])

  const cancelRequest = useCallback(() => {
    log('Cancel requested', { hasController: !!abortControllerRef.current })
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }, [])

  return {
    proposal,
    isLoading,
    error,
    plan,
    currentEditIndex,
    completedEdits,
    overflow,
    aiMessage,
    requestEdit,
    applyEdits,
    clearProposal,
    cancelRequest,
  }
}

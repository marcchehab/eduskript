'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logger'
import type { BusyPhase, ContentModel } from './use-ai-edit-chat'

const log = createLogger('ai:edit:inline')

/**
 * In-editor AI Edit (the "AI Edit" ribbon tab). Same two server steps as the
 * chat modal — /api/ai/edit/agent (plan, scope 'page') then
 * /api/ai/edit/[jobId]/generate (content) — but the result is NOT written to
 * the server. It is handed to `onProposal`, which shows it as an inline diff
 * in the page editor; the teacher accepts/rejects there and saves with the
 * editor's normal Save. Only the open page can be edited.
 *
 * Conversation history is kept so follow-ups ("make it shorter") work; it is
 * ephemeral (lost on reload), like the modal's.
 */

export interface InlineTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface Options {
  skriptId: string
  pageId: string
  contentModel: ContentModel
  /** Live editor buffer, read when a message is sent. */
  getContent: () => string
  /** Called with the buffer the AI worked on and its proposed replacement. */
  onProposal: (original: string, proposed: string) => void
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const raw = await res.text()
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error('Server returned an invalid response.')
  }
}

export function useInlineAIEdit({ skriptId, pageId, contentModel, getContent, onProposal }: Options) {
  const [turns, setTurns] = useState<InlineTurn[]>([])
  const [phase, setPhaseState] = useState<BusyPhase>(null)
  const [phaseSince, setPhaseSince] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const abortRef = useRef<AbortController | null>(null)

  const setPhase = useCallback((p: BusyPhase) => {
    setPhaseState(p)
    setPhaseSince(p ? Date.now() : null)
  }, [])

  const isBusy = phase !== null

  /** Resolves false on failure; the user turn is then removed so the caller can restore the text. */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const instruction = text.trim()
      if (!instruction || phase) return false
      setError(null)
      setErrorCode(null)
      const controller = new AbortController()
      abortRef.current = controller
      const userTurnId = newId()
      setTurns(prev => [...prev, { id: userTurnId, role: 'user', text: instruction }])
      historyRef.current = [...historyRef.current, { role: 'user', content: instruction }]
      const original = getContent()

      try {
        setPhase('planning')
        const res = await fetch('/api/ai/edit/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skriptId, pageId, scope: 'page', currentContent: original, messages: historyRef.current }),
          signal: controller.signal,
        })
        const data = await readJson<{
          content?: string
          code?: string
          error?: string
          jobId?: string | null
          plan?: { totalEdits: number; pages: Array<{ summary: string }> }
        }>(res)
        if (!res.ok) {
          if (data.code) setErrorCode(data.code)
          throw new Error(data.error || 'Failed to reach the assistant')
        }

        const reply = (data.content ?? '').trim()
        const hasEdit = !!data.jobId && !!data.plan && data.plan.totalEdits > 0
        const summary = hasEdit ? data.plan!.pages[0]?.summary : ''
        const assistantText = reply || summary || (hasEdit ? '' : 'Let me know what you would like to change.')
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: hasEdit ? `${assistantText}\n\n(I proposed this change in the editor.)`.trim() : assistantText },
        ]
        if (assistantText) setTurns(prev => [...prev, { id: newId(), role: 'assistant', text: assistantText }])
        if (!hasEdit) return true

        setPhase('writing')
        const genRes = await fetch(`/api/ai/edit/${data.jobId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageIndex: 0, contentModel }),
          signal: controller.signal,
        })
        const gen = await readJson<{ success?: boolean; error?: string; code?: string; edit?: { proposedContent?: string } }>(genRes)
        if (!genRes.ok || !gen.success || typeof gen.edit?.proposedContent !== 'string') {
          if (gen.code) setErrorCode(gen.code)
          throw new Error(gen.error || 'The AI could not write this change. Please try again.')
        }
        onProposal(original, gen.edit.proposedContent)
        return true
      } catch (err) {
        if (controller.signal.aborted) {
          setTurns(prev => [...prev, { id: newId(), role: 'assistant', text: 'Stopped.' }])
          return true
        }
        const message = err instanceof Error ? err.message : 'An error occurred'
        log.error('inline AI edit failed:', message)
        setTurns(prev => prev.filter(t => t.id !== userTurnId))
        historyRef.current = historyRef.current.filter(m => m.content !== instruction || m.role !== 'user')
        setError(message)
        return false
      } finally {
        abortRef.current = null
        setPhase(null)
      }
    },
    [phase, skriptId, pageId, contentModel, getContent, onProposal, setPhase]
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const clear = useCallback(() => {
    historyRef.current = []
    setTurns([])
    setError(null)
    setErrorCode(null)
  }, [])

  return { turns, phase, phaseSince, isBusy, error, errorCode, send, stop, clear }
}

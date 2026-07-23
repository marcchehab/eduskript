'use client'

import { useState, useCallback, useRef } from 'react'
import { createLogger } from '@/lib/logger'
import type { AIEditTarget } from './use-ai-edit'

const log = createLogger('ai:edit:chat')

/**
 * Chat-style AI Edit state machine (Claude-Code-inspired).
 *
 * Turns the one-way plan→generate→apply flow into a back-and-forth conversation
 * with two modes:
 *   - 'auto': each generated change is applied to the page immediately and shown
 *     as a card the user can Reject (revert) or Respond to. A Stop button halts
 *     the in-flight queue.
 *   - 'ask': each change is proposed first; the user Accepts / Rejects / Responds
 *     one card at a time before the next is generated.
 *
 * Multi-page: changes are surfaced ONE AT A TIME (no bulk accept). Ephemeral —
 * no persistence beyond the existing ImportJob the plan/generate endpoints use.
 *
 * Revert strategy (no dedicated snapshot API needed): existing pages revert by
 * PATCHing back to `originalContent` (a forward version, matching how the app's
 * version-restore works); auto-applied NEW pages revert by DELETE.
 */

export type ChatMode = 'auto' | 'ask'

export type CardStatus =
  | 'generating' // model is producing the content
  | 'proposed' // ask mode: awaiting accept/reject
  | 'applying' // write in flight
  | 'applied' // written to the page
  | 'reverting' // revert write in flight
  | 'rejected' // discarded (ask) or reverted (auto)
  | 'stopped' // aborted by the user mid-generation
  | 'failed' // generation or write error

export interface ChangeCard {
  id: string
  turnId: string
  jobId: string
  pageIndex: number
  pageId: string | null // existing page id, or null for a planned new page
  pageTitle: string
  pageSlug: string
  isNew: boolean
  summary: string
  note?: string // model's short prose lead-in shown above the card
  originalContent: string
  proposedContent: string // user-editable (MergeEditor writes back here)
  status: CardStatus
  error?: string
  // For a NEW page applied in auto mode: the id of the created page, so Reject
  // can DELETE it. Null until the create succeeds.
  createdPageId?: string | null
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  cardIds: string[]
  pending?: boolean // assistant turn still generating / awaiting user action
}

interface PlanState {
  jobId: string
  pages: Array<{
    pageId: string | null
    pageTitle: string
    pageSlug: string
    summary: string
    isNew?: boolean
    note?: string
  }>
  nextIndex: number
}

interface UseAIEditChatOptions {
  target: AIEditTarget
  currentContent?: string
  mode: ChatMode
  // Called when the currently-open page (the focused page or a frontpage) is
  // changed on disk, so the surrounding editor can sync its buffer.
  onEditsApplied?: (newContent?: string) => void
}

interface UseAIEditChatReturn {
  turns: Turn[]
  cards: Record<string, ChangeCard>
  isBusy: boolean
  error: string | null
  sendInstruction: (text: string) => Promise<void>
  acceptCard: (cardId: string) => Promise<void>
  rejectCard: (cardId: string) => Promise<void>
  respondToCard: (cardId: string, feedback: string) => Promise<void>
  updateCardContent: (cardId: string, content: string) => void
  stop: () => void
  reset: () => void
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Non-secure contexts: a collision-safe-enough fallback for ephemeral keys.
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

export function useAIEditChat({
  target,
  currentContent,
  mode,
  onEditsApplied,
}: UseAIEditChatOptions): UseAIEditChatReturn {
  const [turns, setTurns] = useState<Turn[]>([])
  const [cards, setCards] = useState<Record<string, ChangeCard>>({})
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-assistant-turn plan cursors (jobId + remaining page pointer).
  const plansRef = useRef<Record<string, PlanState>>({})
  // Stop flag for the auto-mode queue. A ref so the running driver sees it.
  const stopRef = useRef(false)
  // Aborts the in-flight generate() fetch so Stop actually cancels it.
  const abortRef = useRef<AbortController | null>(null)
  // Latest content of the focused/open page, threaded into follow-up plan
  // requests so the model sees what's actually on the page now.
  const liveContentRef = useRef<string | undefined>(currentContent)
  // Conversation history sent to the agent endpoint (prose only — tool results
  // aren't fed back in v1). Grows as user/assistant turns are added.
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  // Mode is read live by the driver (user may toggle mid-conversation).
  const modeRef = useRef<ChatMode>(mode)
  modeRef.current = mode

  const focusedPageId = target.mode === 'page' ? target.pageId : undefined

  const patchCard = useCallback((cardId: string, patch: Partial<ChangeCard>) => {
    setCards(prev => (prev[cardId] ? { ...prev, [cardId]: { ...prev[cardId], ...patch } } : prev))
  }, [])

  const setTurnPending = useCallback((turnId: string, pending: boolean) => {
    setTurns(prev => prev.map(t => (t.id === turnId ? { ...t, pending } : t)))
  }, [])

  // True when a change targets the page currently open in the editor.
  const isFocusedCard = useCallback(
    (card: ChangeCard) =>
      target.mode === 'frontpage' || (!!focusedPageId && card.pageId === focusedPageId),
    [target.mode, focusedPageId]
  )

  // --- Server writes -------------------------------------------------------

  // Apply a card's proposed content to the page. Returns the created page id
  // for new pages (so revert can delete it), or null.
  const writeApply = useCallback(
    async (card: ChangeCard): Promise<string | null> => {
      // Frontpage mode never writes server-side here — the parent editor owns
      // the save. We just hand content up.
      if (target.mode === 'frontpage') {
        onEditsApplied?.(card.proposedContent)
        return null
      }

      if (card.isNew) {
        // Re-applying a revised NEW page that was already created (e.g. after
        // "respond" in auto mode): the page exists, so PATCH it instead of
        // POSTing a duplicate slug.
        if (card.createdPageId) {
          const res = await fetch(`/api/pages/${card.createdPageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: card.proposedContent, editSource: 'ai-edit' }),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d.error || `Failed to update page: ${card.pageTitle}`)
          }
          return card.createdPageId
        }
        const res = await fetch('/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skriptId: target.skriptId,
            title: card.pageTitle,
            slug: card.pageSlug,
            content: card.proposedContent,
            editSource: 'ai-edit',
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `Failed to create page: ${card.pageTitle}`)
        }
        const d = await res.json().catch(() => ({}))
        return d.id ?? d.page?.id ?? null
      }

      const res = await fetch(`/api/pages/${card.pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: card.proposedContent, editSource: 'ai-edit' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Failed to update page: ${card.pageTitle}`)
      }
      if (isFocusedCard(card)) {
        liveContentRef.current = card.proposedContent
        onEditsApplied?.(card.proposedContent)
      }
      return null
    },
    [target, onEditsApplied, isFocusedCard]
  )

  // Undo an applied card.
  const writeRevert = useCallback(
    async (card: ChangeCard): Promise<void> => {
      if (target.mode === 'frontpage') {
        liveContentRef.current = card.originalContent
        onEditsApplied?.(card.originalContent)
        return
      }

      // New page: delete the page that was created.
      if (card.isNew) {
        if (card.createdPageId) {
          const res = await fetch(`/api/pages/${card.createdPageId}`, { method: 'DELETE' })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d.error || `Failed to remove page: ${card.pageTitle}`)
          }
        }
        return
      }

      // Existing page: restore original content as a forward version.
      const res = await fetch(`/api/pages/${card.pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: card.originalContent, editSource: 'ai-edit' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Failed to revert page: ${card.pageTitle}`)
      }
      if (isFocusedCard(card)) {
        liveContentRef.current = card.originalContent
        onEditsApplied?.(card.originalContent)
      }
    },
    [target, onEditsApplied, isFocusedCard]
  )

  // --- Generation ----------------------------------------------------------

  // Generate one page's content. Returns the filled-in fields or throws.
  const generate = useCallback(
    async (
      jobId: string,
      pageIndex: number,
      feedback?: string
    ): Promise<{ pageId: string | null; pageTitle: string; pageSlug: string; originalContent: string; proposedContent: string; summary: string; isNew: boolean }> => {
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch(`/api/ai/edit/${jobId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIndex, ...(feedback ? { feedback } : {}) }),
        signal: controller.signal,
      })
      const text = await res.text()
      let data: { success?: boolean; error?: string; edit?: Record<string, unknown> }
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('Server returned an invalid response.')
      }
      if (!res.ok || !data.success || !data.edit) {
        throw new Error(data.error || 'Failed to generate change')
      }
      const e = data.edit
      return {
        pageId: (e.pageId as string | null) ?? null,
        pageTitle: e.pageTitle as string,
        pageSlug: e.pageSlug as string,
        originalContent: e.originalContent as string,
        proposedContent: e.proposedContent as string,
        summary: e.summary as string,
        isNew: !!e.isNew,
      }
    },
    []
  )

  // Drive the queue for an assistant turn: pull the next planned page, generate
  // it, and (auto) apply it. In ask mode the driver stops after one card and
  // waits for the user; acceptCard/rejectCard resume it.
  const drive = useCallback(
    async (turnId: string) => {
      const plan = plansRef.current[turnId]
      if (!plan) return

      while (plan.nextIndex < plan.pages.length) {
        if (stopRef.current) {
          setTurnPending(turnId, false)
          return
        }
        const pageIndex = plan.nextIndex
        plan.nextIndex += 1

        const planned = plan.pages[pageIndex]
        const cardId = newId()
        const card: ChangeCard = {
          id: cardId,
          turnId,
          jobId: plan.jobId,
          pageIndex,
          pageId: planned.pageId,
          pageTitle: planned.pageTitle,
          pageSlug: planned.pageSlug,
          isNew: planned.isNew === true || planned.pageId === null,
          summary: planned.summary,
          note: planned.note,
          originalContent: '',
          proposedContent: '',
          status: 'generating',
        }
        setCards(prev => ({ ...prev, [cardId]: card }))
        setTurns(prev => prev.map(t => (t.id === turnId ? { ...t, cardIds: [...t.cardIds, cardId] } : t)))

        try {
          const gen = await generate(plan.jobId, pageIndex)
          // Stop pressed while this page was generating: discard the result —
          // don't apply or propose it.
          if (stopRef.current) {
            patchCard(cardId, { status: 'stopped' })
            setTurnPending(turnId, false)
            setIsBusy(false)
            return
          }
          const filled: ChangeCard = {
            ...card,
            pageId: gen.pageId,
            pageTitle: gen.pageTitle,
            pageSlug: gen.pageSlug,
            originalContent: gen.originalContent,
            proposedContent: gen.proposedContent,
            summary: gen.summary,
            isNew: gen.isNew,
          }

          if (modeRef.current === 'auto') {
            filled.status = 'applying'
            setCards(prev => ({ ...prev, [cardId]: filled }))
            try {
              const createdPageId = await writeApply(filled)
              patchCard(cardId, { status: 'applied', createdPageId, proposedContent: filled.proposedContent, originalContent: filled.originalContent, isNew: filled.isNew, pageId: filled.pageId, pageTitle: filled.pageTitle, pageSlug: filled.pageSlug })
            } catch (err) {
              patchCard(cardId, { status: 'failed', error: err instanceof Error ? err.message : 'Apply failed', proposedContent: filled.proposedContent, originalContent: filled.originalContent })
            }
            // auto: continue to the next page in the loop
          } else {
            // ask: reveal the proposal and pause — we're now idle waiting for
            // the user, so clear the busy/pending indicators. accept/reject
            // resume the queue.
            filled.status = 'proposed'
            setCards(prev => ({ ...prev, [cardId]: filled }))
            setTurnPending(turnId, false)
            setIsBusy(false)
            return
          }
        } catch (err) {
          const aborted = stopRef.current || (err instanceof Error && err.name === 'AbortError')
          if (aborted) {
            patchCard(cardId, { status: 'stopped' })
            setTurnPending(turnId, false)
            setIsBusy(false)
            return
          }
          patchCard(cardId, { status: 'failed', error: err instanceof Error ? err.message : 'Generation failed' })
          // auto: keep going with remaining pages; ask: pause for the user.
          if (modeRef.current === 'ask') {
            setTurnPending(turnId, false)
            setIsBusy(false)
            return
          }
        }
      }

      // Queue drained.
      setTurnPending(turnId, false)
      setIsBusy(false)
    },
    [generate, writeApply, patchCard, setTurnPending]
  )

  // --- Public actions ------------------------------------------------------

  const sendInstruction = useCallback(
    async (text: string) => {
      const instruction = text.trim()
      if (!instruction || isBusy) return

      setError(null)
      setIsBusy(true)
      stopRef.current = false

      const userTurnId = newId()
      setTurns(prev => [...prev, { id: userTurnId, role: 'user', text: instruction, cardIds: [] }])
      historyRef.current = [...historyRef.current, { role: 'user', content: instruction }]

      try {
        const body: Record<string, unknown> = {
          currentContent: liveContentRef.current,
          messages: historyRef.current,
        }
        if (target.mode === 'frontpage') {
          body.frontPageId = target.frontPageId
        } else {
          body.skriptId = target.skriptId
          if (target.pageId) body.pageId = target.pageId
        }

        const res = await fetch('/api/ai/edit/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const raw = await res.text()
        let data: {
          content?: string
          jobId?: string | null
          plan?: {
            totalEdits: number
            overallSummary: string
            pages: PlanState['pages']
          }
          error?: string
        }
        try {
          data = JSON.parse(raw)
        } catch {
          throw new Error('Server returned an invalid response.')
        }
        if (!res.ok) throw new Error(data.error || 'Failed to reach the assistant')

        const assistantTurnId = newId()
        const assistantText = data.content ?? data.plan?.overallSummary ?? ''
        // Record the assistant turn in history INCLUDING any edits it proposed,
        // so the next turn's model knows those edits are already handled and
        // doesn't re-emit them when the user asks something unrelated.
        const proposedTitles = (data.plan?.pages ?? []).map(p => p.pageTitle)
        const historyContent = proposedTitles.length
          ? `${assistantText ? assistantText + '\n\n' : ''}(I already proposed edits to: ${proposedTitles.join(', ')}. They are shown to the user as cards — do not repeat them.)`
          : assistantText
        if (historyContent.trim()) {
          historyRef.current = [...historyRef.current, { role: 'assistant', content: historyContent }]
        }

        // Pure conversation — no edits.
        if (!data.jobId || !data.plan || data.plan.totalEdits === 0) {
          setTurns(prev => [...prev, { id: assistantTurnId, role: 'assistant', text: assistantText || 'Let me know what you would like to change.', cardIds: [] }])
          setIsBusy(false)
          return
        }

        setTurns(prev => [
          ...prev,
          { id: assistantTurnId, role: 'assistant', text: assistantText, cardIds: [], pending: true },
        ])
        plansRef.current[assistantTurnId] = {
          jobId: data.jobId,
          pages: data.plan.pages,
          nextIndex: 0,
        }
        await drive(assistantTurnId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        log.error('sendInstruction failed:', message)
        setError(message)
        setIsBusy(false)
      }
    },
    [isBusy, target, drive]
  )

  const acceptCard = useCallback(
    async (cardId: string) => {
      const card = cards[cardId]
      if (!card || card.status !== 'proposed') return
      patchCard(cardId, { status: 'applying' })
      try {
        const createdPageId = await writeApply(card)
        patchCard(cardId, { status: 'applied', createdPageId })
      } catch (err) {
        patchCard(cardId, { status: 'failed', error: err instanceof Error ? err.message : 'Apply failed' })
      }
      // Resume the queue for this turn (ask mode: next card). Re-enter the busy
      // state so the composer shows Stop while the next card generates; drive()
      // clears it again when the queue drains.
      const plan = plansRef.current[card.turnId]
      if (!stopRef.current && plan && plan.nextIndex < plan.pages.length) {
        setIsBusy(true)
        setTurnPending(card.turnId, true)
        await drive(card.turnId)
      }
    },
    [cards, patchCard, writeApply, drive, setTurnPending]
  )

  const rejectCard = useCallback(
    async (cardId: string) => {
      const card = cards[cardId]
      if (!card) return

      // Applied (auto or accepted): revert the write. Proposed/failed: discard.
      if (card.status === 'applied') {
        patchCard(cardId, { status: 'reverting' })
        try {
          await writeRevert(card)
          patchCard(cardId, { status: 'rejected' })
        } catch (err) {
          patchCard(cardId, { status: 'applied', error: err instanceof Error ? err.message : 'Revert failed' })
          return
        }
      } else {
        patchCard(cardId, { status: 'rejected' })
      }

      // In ask mode a rejected proposal should advance the queue.
      const plan = plansRef.current[card.turnId]
      if (card.status === 'proposed' && !stopRef.current && plan && plan.nextIndex < plan.pages.length) {
        setIsBusy(true)
        setTurnPending(card.turnId, true)
        await drive(card.turnId)
      }
    },
    [cards, patchCard, writeRevert, drive, setTurnPending]
  )

  const respondToCard = useCallback(
    async (cardId: string, feedback: string) => {
      const card = cards[cardId]
      const fb = feedback.trim()
      if (!card || !fb) return
      const wasApplied = card.status === 'applied'
      patchCard(cardId, { status: 'generating', error: undefined })
      try {
        const gen = await generate(card.jobId, card.pageIndex, fb)
        const next: Partial<ChangeCard> = {
          proposedContent: gen.proposedContent,
          originalContent: gen.originalContent,
          summary: gen.summary,
        }
        if (wasApplied) {
          // Re-apply the revised content on top of what's already on the page.
          patchCard(cardId, { ...next, status: 'applying' })
          const revised = { ...card, ...next } as ChangeCard
          const createdPageId = await writeApply(revised)
          patchCard(cardId, { status: 'applied', createdPageId })
        } else {
          patchCard(cardId, { ...next, status: 'proposed' })
        }
      } catch (err) {
        patchCard(cardId, { status: wasApplied ? 'applied' : 'failed', error: err instanceof Error ? err.message : 'Revision failed' })
      }
    },
    [cards, patchCard, generate, writeApply]
  )

  const updateCardContent = useCallback(
    (cardId: string, content: string) => {
      // Only editable before apply (ask mode) — after apply the diff is history.
      patchCard(cardId, { proposedContent: content })
    },
    [patchCard]
  )

  const stop = useCallback(() => {
    stopRef.current = true
    abortRef.current?.abort()
    setIsBusy(false)
    setTurns(prev => prev.map(t => (t.pending ? { ...t, pending: false } : t)))
  }, [])

  const reset = useCallback(() => {
    plansRef.current = {}
    stopRef.current = false
    liveContentRef.current = currentContent
    historyRef.current = []
    setTurns([])
    setCards({})
    setIsBusy(false)
    setError(null)
  }, [currentContent])

  return {
    turns,
    cards,
    isBusy,
    error,
    sendInstruction,
    acceptCard,
    rejectCard,
    respondToCard,
    updateCardContent,
    stop,
    reset,
  }
}

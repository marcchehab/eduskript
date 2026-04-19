'use client'

import { useState, useCallback, useEffect } from 'react'
import { Wand2, Loader2, X, Check, FileText, Plus, ChevronDown, ChevronRight, AlertTriangle, RotateCcw, Copy } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useAIEdit, type AIEditTarget } from '@/hooks/use-ai-edit'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit-modal')
import { MergeEditor, SimpleEditor } from './merge-editor'
import type { PageEdit } from '@/lib/ai/types'

interface AIEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Discriminated target — page (in a skript) or single front page */
  target: AIEditTarget
  /** Display title for the target — used in the header and recovery storage scope */
  targetTitle: string
  /** Optional secondary label (e.g. skript title when editing a page within it) */
  targetSubtitle?: string
  /** Current editor content (may have unsaved changes) */
  currentContent?: string
  /** Called after edits are applied, with the new content for the focused edit */
  onEditsApplied?: (newContent?: string) => void
}

// Helper to get unique key for an edit
function getEditKey(edit: PageEdit): string {
  return edit.pageId ?? `new:${edit.pageSlug}`
}

export function AIEditModal({
  open,
  onOpenChange,
  target,
  targetTitle,
  targetSubtitle,
  currentContent,
  onEditsApplied,
}: AIEditModalProps) {
  const [instruction, setInstruction] = useState('')
  const {
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
  } = useAIEdit({ target, currentContent })

  // The "focused" id we use to find which edit's new content to hand back to
  // the parent after apply. In page mode it's the pageId (may be undefined when
  // editing a whole skript), in frontpage mode it's the frontPageId.
  const focusedId = target.mode === 'frontpage' ? target.frontPageId : target.pageId
  // For sessionStorage recovery key — keep modal-side recovery scoped per target.
  const recoveryScope = target.mode === 'frontpage'
    ? `frontpage:${target.frontPageId}`
    : target.skriptId
  const isFrontpageMode = target.mode === 'frontpage'

  // Track merged content for each page (user can edit while streaming)
  const [mergedContent, setMergedContent] = useState<Record<string, string>>({})
  const [expandedEdits, setExpandedEdits] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [showFullResponse, setShowFullResponse] = useState(false)
  const [recoveryChecked, setRecoveryChecked] = useState(false)

  // "Copy context" button state. `null` = idle, string = transient label
  // shown briefly after a successful copy or a failure.
  const [copyState, setCopyState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'copied'; tokens: number } | { kind: 'error'; message: string }>({ kind: 'idle' })

  const handleCopyContext = useCallback(async () => {
    setCopyState({ kind: 'loading' })
    try {
      // Mirror the body shape requestEdit builds: exactly one of skriptId or
      // frontPageId, plus optional pageId and the editor's current content
      // (so the copied context reflects unsaved changes).
      const body: Record<string, unknown> = { currentContent }
      if (target.mode === 'frontpage') {
        body.frontPageId = target.frontPageId
      } else {
        body.skriptId = target.skriptId
        if (target.pageId) body.pageId = target.pageId
      }

      const res = await fetch('/api/ai/edit/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load context')
      }

      await navigator.clipboard.writeText(data.context as string)
      setCopyState({ kind: 'copied', tokens: data.estimatedTokens as number })
      setTimeout(() => setCopyState({ kind: 'idle' }), 2500)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Copy failed'
      log.error('Copy context failed:', err)
      setCopyState({ kind: 'error', message })
      setTimeout(() => setCopyState({ kind: 'idle' }), 3000)
    }
  }, [target, currentContent])

  // Check for recoverable job when modal opens. The storage key is namespaced
  // by mode so a frontpage job and a skript job can coexist for the same scope.
  useEffect(() => {
    if (open && !recoveryChecked && !isLoading && !proposal && completedEdits.length === 0) {
      setRecoveryChecked(true)
      try {
        const storedJobId = sessionStorage.getItem(`ai-edit-job:${recoveryScope}`)
        if (storedJobId) {
          log('Found recoverable job:', storedJobId)
          recoverJob(storedJobId)
        }
      } catch {
        // sessionStorage not available
      }
    }
  }, [open, recoveryChecked, isLoading, proposal, completedEdits.length, recoveryScope, recoverJob])

  // Reset recovery check when modal closes (to retry recovery on next open)
  useEffect(() => {
    if (!open) {
      setRecoveryChecked(false)
    }
  }, [open])

  const handleContentChange = useCallback((key: string, content: string) => {
    setMergedContent(prev => ({ ...prev, [key]: content }))
  }, [])

  const toggleExpanded = (key: string) => {
    setExpandedEdits(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!instruction.trim() || isLoading) return
    log('Submitting edit request', { instructionLength: instruction.trim().length, target })
    // Reset state for new request
    setMergedContent({})
    setExpandedEdits(new Set())
    await requestEdit(instruction.trim())
  }

  const handleSave = async () => {
    // Use completed edits (either from streaming or final proposal)
    const editsToApply = (proposal?.edits || completedEdits).map(edit => {
      const key = getEditKey(edit)
      return {
        ...edit,
        proposedContent: mergedContent[key] ?? edit.proposedContent,
      }
    })

    if (editsToApply.length === 0) return

    log(`Saving ${editsToApply.length} edits`)
    setIsSaving(true)
    try {
      await applyEdits(editsToApply)
      // Find the edit whose new content should be handed back to the parent
      // editor. In page mode that's keyed by pageId; in frontpage mode there's
      // exactly one edit so we just use the first.
      const focusedEdit = isFrontpageMode
        ? editsToApply[0]
        : (focusedId ? editsToApply.find(e => e.pageId === focusedId) : undefined)
      log('Edits applied successfully', { focusedPageId: focusedEdit?.pageId })
      onEditsApplied?.(focusedEdit?.proposedContent)
      onOpenChange(false)
    } catch (err) {
      log.error('Failed to apply edits:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    log('Cancel/clear', { isLoading, hasProposal: !!proposal, completedEdits: completedEdits.length })
    if (isLoading) {
      cancelRequest()
    }
    clearProposal()
    setMergedContent({})
    setExpandedEdits(new Set())
    setShowFullResponse(false)
  }

  const handleClose = (open: boolean) => {
    log('Dialog close', { open, isLoading })
    if (!open && isLoading) {
      // Only cancel if generation is in-flight
      cancelRequest()
    }
    // Don't clear proposal or instruction on close — user can reopen to review
    onOpenChange(open)
  }

  const contextLabel = isFrontpageMode
    ? `Editing front page: ${targetTitle}`
    : (targetSubtitle ? `Editing: ${targetTitle} (in ${targetSubtitle})` : `Editing: ${targetTitle}`)

  // Calculate progress
  const totalEdits = plan?.totalEdits || 0
  const doneCount = completedEdits.length + failedPages.length
  const progressPercent = totalEdits > 0 ? (doneCount / totalEdits) * 100 : 0
  const isComplete = (proposal && !isLoading) || (totalEdits > 0 && doneCount >= totalEdits && !isLoading)

  // Show progressive view when we have a plan or completed edits
  const showProgressiveView = (plan && currentEditIndex >= 0) || completedEdits.length > 0 || proposal

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0"
        onInteractOutside={(e) => {
          // Prevent accidental close while generating
          if (isLoading) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent accidental close while generating
          if (isLoading) {
            e.preventDefault()
          }
        }}
      >
        {showProgressiveView ? (
          // Progressive view - show edits as they complete
          <div className="flex flex-col h-full">
            {/* Header with progress */}
            <div className="flex-shrink-0 border-b px-4 py-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">
                    {isComplete ? 'Review Changes' : 'Generating Changes'}
                  </h2>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {plan?.overallSummary || proposal?.overallSummary}
              </p>

              {/* Overflow warning - AI response had text outside JSON */}
              {overflow && (
                <div className="mb-3 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Oops, our AI didn&apos;t quite format the response correctly
                      </p>
                      {overflow.overflowBefore && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 font-mono truncate">
                          Before: {overflow.overflowBefore.slice(0, 100)}{overflow.overflowBefore.length > 100 ? '...' : ''}
                        </p>
                      )}
                      {overflow.overflowAfter && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 font-mono truncate">
                          After: {overflow.overflowAfter.slice(0, 100)}{overflow.overflowAfter.length > 100 ? '...' : ''}
                        </p>
                      )}
                      {overflow.fullResponse && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => setShowFullResponse(!showFullResponse)}
                            className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                          >
                            {showFullResponse ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            {showFullResponse ? 'Hide' : 'Show'} full response
                          </button>
                          {showFullResponse && (
                            <pre className="mt-2 p-2 text-xs bg-amber-100 dark:bg-amber-900/50 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                              {overflow.fullResponse}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!isComplete && totalEdits > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Generating {Math.min(currentEditIndex + 1, totalEdits)} of {totalEdits}...</span>
                    <span>{Math.round(progressPercent)}%</span>
                  </div>
                  <Progress value={progressPercent} className="h-1.5" />
                </div>
              )}
            </div>

            {/* Edit list - progressive with merge editors */}
            <div className="flex-1 overflow-y-auto">
              {(() => { log(`Rendering edits: proposal=${proposal?.edits?.length ?? 'none'}, completedEdits=${completedEdits.length}`); return null })()}

              {/* AI text-only response (no JSON edits) */}
              {aiMessage && (proposal?.edits?.length === 0 || completedEdits.length === 0) && (
                <div className="p-4 space-y-3">
                  <div className="p-4 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                      AI Response
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-300 whitespace-pre-wrap">
                      {aiMessage}
                    </p>
                  </div>
                </div>
              )}
              {(proposal?.edits || completedEdits).map((edit) => {
                const key = getEditKey(edit)
                const isExpanded = expandedEdits.has(key)
                const content = mergedContent[key] ?? edit.proposedContent

                return (
                  <div key={key} className="border-b">
                    {/* Edit header */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleExpanded(key)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      {edit.isNew ? (
                        <Plus className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {edit.pageTitle}
                          {edit.isNew && (
                            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                              NEW
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">{edit.summary}</div>
                      </div>
                    </div>

                    {/* Merge editor - keep mounted to preserve state, hide when collapsed */}
                    <div className={isExpanded ? 'px-4 pb-4' : 'hidden'}>
                      {edit.isNew ? (
                        <SimpleEditor
                          content={content}
                          onChange={(c) => handleContentChange(key, c)}
                          className="h-[400px] border rounded-md overflow-hidden"
                        />
                      ) : (
                        <MergeEditor
                          original={edit.originalContent}
                          proposed={edit.proposedContent}
                          onChange={(c) => handleContentChange(key, c)}
                          className="h-[400px] border rounded-md overflow-hidden"
                        />
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Show failed pages with retry button */}
              {failedPages.map((fp) => {
                const page = plan?.pages[fp.pageIndex]
                if (!page) return null

                return (
                  <div key={`failed:${fp.pageIndex}`} className="border-b">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-4 h-4" /> {/* Spacer for chevron */}
                      <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                        <X className="w-3 h-3 text-white" />
                      </div>
                      {page.isNew ? (
                        <Plus className="h-4 w-4 text-red-500 flex-shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{page.pageTitle}</div>
                        <div className="text-sm text-red-500 truncate">{fp.error}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryPage(fp.pageIndex)}
                        disabled={isLoading}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                    </div>
                  </div>
                )
              })}

              {/* Show pending pages */}
              {!isComplete && plan?.pages.slice(doneCount).map((page, idx) => {
                const actualIndex = doneCount + idx
                const isCurrent = actualIndex === currentEditIndex

                return (
                  <div key={page.pageSlug} className="border-b">
                    <div className="flex items-center gap-3 px-4 py-3 opacity-60">
                      <div className="w-4 h-4" /> {/* Spacer for chevron */}
                      {isCurrent ? (
                        <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                      )}
                      {page.isNew ? (
                        <Plus className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {page.pageTitle}
                          {page.isNew && (
                            <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                              NEW
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">{page.summary}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer actions */}
            <div className="flex-shrink-0 border-t px-4 py-3 bg-background flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {completedEdits.length || proposal?.edits.length || 0} {(completedEdits.length || proposal?.edits.length || 0) === 1 ? 'page' : 'pages'} ready
                {failedPages.length > 0 && `, ${failedPages.length} failed`}
                {!isComplete && totalEdits > 0 && ` (${totalEdits - doneCount} generating...)`}
              </p>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isSaving || (completedEdits.length === 0 && !proposal)}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Save {isComplete ? 'Changes' : `${completedEdits.length} Ready`}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Input mode
          <>
            <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-primary" />
                <DialogTitle>AI Edit</DialogTitle>
              </div>
              <p className="text-sm text-muted-foreground">{contextLabel}</p>
            </DialogHeader>

            <div className="flex-1 flex flex-col p-6 gap-4">
              <div className="flex-1 flex flex-col gap-2">
                <label htmlFor="instruction" className="text-sm font-medium">
                  What would you like to change?
                </label>
                <Textarea
                  id="instruction"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    isFrontpageMode
                      ? 'e.g., "Make this more welcoming" or "Add a section listing my courses"'
                      : focusedId
                        ? 'e.g., "Add more examples to explain recursion" or "Translate this page to German"'
                        : 'e.g., "Add learning objectives to each page" or "Improve the introduction"'
                  }
                  className="flex-1 min-h-[120px] resize-none"
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  {isFrontpageMode
                    ? 'The AI will rewrite the front page based on your instruction. The new content lands in the editor — review and save it from there.'
                    : focusedId
                      ? 'The AI will focus on the current page but has access to the entire skript for context.'
                      : 'The AI can propose changes to any pages in this skript.'}
                </p>
              </div>

              {error && (
                <div className="space-y-2">
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm whitespace-pre-wrap">
                    {error}
                  </div>
                  {/* Show full AI response if available */}
                  {overflow?.fullResponse && (
                    <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                            AI Response:
                          </p>
                          <div>
                            <button
                              type="button"
                              onClick={() => setShowFullResponse(!showFullResponse)}
                              className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                            >
                              {showFullResponse ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              {showFullResponse ? 'Hide' : 'Show'} full response
                            </button>
                            {showFullResponse && (
                              <pre className="mt-2 p-2 text-xs bg-amber-100 dark:bg-amber-900/50 rounded overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                                {overflow.fullResponse}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Show initial loading state before plan arrives */}
              {isLoading && !plan && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Planning changes...
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                {/* Copy the same skript/frontpage content the AI would see, so
                    users can paste it into their own external chatbot. */}
                <Button
                  variant="outline"
                  onClick={handleCopyContext}
                  disabled={copyState.kind === 'loading' || isLoading}
                  title="Copy the skript content the AI sees, so you can paste it into your own chatbot"
                >
                  {copyState.kind === 'loading' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading…
                    </>
                  ) : copyState.kind === 'copied' ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-600" />
                      Copied! (~{copyState.tokens.toLocaleString()} tokens)
                    </>
                  ) : copyState.kind === 'error' ? (
                    <>
                      <AlertTriangle className="h-4 w-4 mr-2 text-destructive" />
                      {copyState.message}
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy context
                    </>
                  )}
                </Button>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => handleClose(false)}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={!instruction.trim() || isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4 mr-2" />
                        Generate Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

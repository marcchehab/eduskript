'use client'

import { useState, useCallback } from 'react'
import { Wand2, Loader2, X, Check, FileText, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
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
import { useAIEdit } from '@/hooks/use-ai-edit'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit-modal')
import { MergeEditor, SimpleEditor } from './merge-editor'
import type { PageEdit } from '@/lib/ai/types'

interface AIEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skriptId: string
  skriptTitle: string
  pageId?: string
  pageTitle?: string
  /** Current editor content (may have unsaved changes) */
  currentContent?: string
  /** Called after edits are applied, with the new content for the focused page */
  onEditsApplied?: (newContent?: string) => void
}

// Helper to get unique key for an edit
function getEditKey(edit: PageEdit): string {
  return edit.pageId ?? `new:${edit.pageSlug}`
}

export function AIEditModal({
  open,
  onOpenChange,
  skriptId,
  skriptTitle,
  pageId,
  pageTitle,
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
    overflow,
    aiMessage,
    requestEdit,
    applyEdits,
    clearProposal,
    cancelRequest,
  } = useAIEdit({ skriptId, pageId, currentContent })

  // Track merged content for each page (user can edit while streaming)
  const [mergedContent, setMergedContent] = useState<Record<string, string>>({})
  const [expandedEdits, setExpandedEdits] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [showFullResponse, setShowFullResponse] = useState(false)

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
    log('Submitting edit request', { instructionLength: instruction.trim().length, skriptId, pageId })
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
      // Find the edit for the focused page and pass its content back
      const focusedEdit = pageId ? editsToApply.find(e => e.pageId === pageId) : undefined
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
    if (!open) {
      handleCancel()
      setInstruction('')
    }
    onOpenChange(open)
  }

  const contextLabel = pageTitle
    ? `Editing: ${pageTitle} (in ${skriptTitle})`
    : `Editing: ${skriptTitle}`

  // Calculate progress
  const totalEdits = plan?.totalEdits || 0
  const progressPercent = totalEdits > 0 ? (currentEditIndex / totalEdits) * 100 : 0
  const isComplete = proposal && !isLoading

  // Show progressive view when we have a plan or completed edits
  const showProgressiveView = (plan && currentEditIndex >= 0) || completedEdits.length > 0 || proposal

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 gap-0">
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
                {!isComplete && (
                  <Button variant="ghost" size="sm" onClick={handleCancel}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
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
              {(proposal?.edits || completedEdits).map((edit, index) => {
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

              {/* Show pending pages */}
              {!isComplete && plan?.pages.slice(currentEditIndex).map((page, idx) => {
                const actualIndex = currentEditIndex + idx
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
                {!isComplete && totalEdits > 0 && ` (${totalEdits - currentEditIndex} generating...)`}
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
                    pageId
                      ? 'e.g., "Add more examples to explain recursion" or "Translate this page to German"'
                      : 'e.g., "Add learning objectives to each page" or "Improve the introduction"'
                  }
                  className="flex-1 min-h-[120px] resize-none"
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  {pageId
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

              <div className="flex justify-end gap-3">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

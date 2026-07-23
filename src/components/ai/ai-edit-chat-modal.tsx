'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MergeEditor, SimpleEditor } from './merge-editor'
import { useAIEditChat, type ChangeCard, type ChatMode } from '@/hooks/use-ai-edit-chat'
import type { AIEditTarget } from '@/hooks/use-ai-edit'
import {
  Loader2,
  Check,
  X,
  MessageSquare,
  Send,
  Square,
  Sparkles,
  FilePlus2,
  RotateCcw,
} from 'lucide-react'

interface AIEditChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: AIEditTarget
  targetTitle: string
  targetSubtitle?: string
  currentContent?: string
  onEditsApplied?: (newContent?: string) => void
}

export function AIEditChatModal({
  open,
  onOpenChange,
  target,
  targetTitle,
  targetSubtitle,
  currentContent,
  onEditsApplied,
}: AIEditChatModalProps) {
  const [mode, setMode] = useState<ChatMode>('ask')
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Tracks which assistant turn we've already auto-scrolled to, so we jump to
  // the first change of a new turn exactly once (not on every card update).
  const scrolledTurnRef = useRef<string | null>(null)

  const {
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
  } = useAIEditChat({ target, currentContent, mode, onEditsApplied })

  // The conversation persists across close/open for the session — the modal
  // component stays mounted, so hook state survives. (A fresh page load or
  // switching to a different page remounts it and starts clean.)

  // When a turn's edits first appear, scroll its FIRST change into view so the
  // user doesn't have to hunt for it; otherwise keep the newest content in view.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const lastEditTurn = [...turns].reverse().find(t => t.role === 'assistant' && t.cardIds.length > 0)
    if (
      lastEditTurn &&
      cards[lastEditTurn.cardIds[0]] &&
      scrolledTurnRef.current !== lastEditTurn.id
    ) {
      const node = el.querySelector(`[data-card-id="${lastEditTurn.cardIds[0]}"]`)
      if (node) {
        node.scrollIntoView({ block: 'start', behavior: 'smooth' })
        scrolledTurnRef.current = lastEditTurn.id
        return
      }
    }
    el.scrollTop = el.scrollHeight
  }, [turns, cards])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput('')
    void sendInstruction(text)
  }, [input, isBusy, sendInstruction])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const isEmpty = turns.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">AI Edit — {targetTitle}</span>
              </DialogTitle>
              <DialogDescription className="mt-0.5 truncate">
                {targetSubtitle || 'Chat to edit this content. Each change is reviewed on its own.'}
              </DialogDescription>
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        </DialogHeader>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isEmpty && (
            <EmptyState mode={mode} />
          )}

          {turns.map(turn => (
            <div key={turn.id} className="space-y-3">
              {turn.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3.5 py-2 text-sm whitespace-pre-wrap">
                    {turn.text}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {turn.text && (
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-4 w-4 mt-2.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border bg-muted/40 px-3.5 py-2.5">
                        <ProseMarkdown text={turn.text} />
                      </div>
                    </div>
                  )}
                  {turn.cardIds.map(id => {
                    const card = cards[id]
                    if (!card) return null
                    return (
                      <div key={id} data-card-id={id} className="space-y-1.5">
                        {card.note && (
                          <div className="flex items-start gap-2 text-sm text-muted-foreground pl-6">
                            <span>{card.note}</span>
                          </div>
                        )}
                        <ChangeCardView
                          card={card}
                          mode={mode}
                          onAccept={() => acceptCard(id)}
                          onReject={() => rejectCard(id)}
                          onRespond={fb => respondToCard(id, fb)}
                          onContentChange={content => updateCardContent(id, content)}
                        />
                      </div>
                    )
                  })}
                  {turn.pending && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {mode === 'auto' ? 'Applying changes…' : 'Preparing the next change…'}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                isEmpty
                  ? 'Describe the change you want (e.g. "add a worked example to the loops page")…'
                  : 'Reply, or ask for another change…'
              }
              rows={2}
              className="resize-none min-h-[52px]"
            />
            {isBusy ? (
              <Button variant="destructive" size="icon" onClick={stop} title="Stop" className="shrink-0 h-[52px] w-[52px]">
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button size="icon" onClick={handleSend} disabled={!input.trim()} title="Send (⌘/Ctrl+Enter)" className="shrink-0 h-[52px] w-[52px]">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {mode === 'auto'
              ? 'Auto mode: changes apply immediately — reject to undo.'
              : 'Ask mode: changes are proposed one at a time — accept to apply.'}
            {' '}⌘/Ctrl+Enter to send.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Renders assistant prose as markdown. Formatting classes are applied via
// descendant selectors so it doesn't depend on the Tailwind typography plugin.
function ProseMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function ModeToggle({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border bg-muted/40 text-xs">
      {(['ask', 'auto'] as const).map((m, i) => {
        const activeClass =
          m === 'ask'
            ? 'bg-orange-500 text-white'
            : 'bg-green-600 text-white'
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`px-3 py-1 font-medium capitalize transition-colors duration-200 ${
              i > 0 ? 'border-l' : ''
            } ${mode === m ? activeClass : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}

function EmptyState({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground gap-2 py-10">
      <MessageSquare className="h-8 w-8 opacity-40" />
      <p className="text-sm max-w-sm">
        Chat about this skript, or ask for changes. Edits show up as cards you can{' '}
        {mode === 'auto' ? 'reject or refine' : 'accept, reject, or refine'} — one at a time.
      </p>
    </div>
  )
}

const STATUS_LABEL: Record<ChangeCard['status'], string> = {
  generating: 'Generating…',
  proposed: 'Proposed',
  applying: 'Applying…',
  applied: 'Applied',
  reverting: 'Reverting…',
  rejected: 'Reverted',
  stopped: 'Stopped',
  failed: 'Failed',
}

function ChangeCardView({
  card,
  mode,
  onAccept,
  onReject,
  onRespond,
  onContentChange,
}: {
  card: ChangeCard
  mode: ChatMode
  onAccept: () => void
  onReject: () => void
  onRespond: (feedback: string) => void
  onContentChange: (content: string) => void
}) {
  const [responding, setResponding] = useState(false)
  const [feedback, setFeedback] = useState('')

  const busy = card.status === 'generating' || card.status === 'applying' || card.status === 'reverting'
  const isRejected = card.status === 'rejected'
  const inactive = isRejected || card.status === 'stopped'
  const canDiff =
    card.status === 'proposed' ||
    card.status === 'applied' ||
    card.status === 'failed' ||
    isRejected

  const submitFeedback = () => {
    const fb = feedback.trim()
    if (!fb) return
    setFeedback('')
    setResponding(false)
    onRespond(fb)
  }

  const statusColor =
    card.status === 'applied'
      ? 'text-green-600 dark:text-green-400 border-green-600/30'
      : card.status === 'failed'
        ? 'text-destructive border-destructive/30'
        : inactive
          ? 'text-muted-foreground border-border'
          : 'text-primary border-primary/30'

  return (
    <div className={`rounded-lg border bg-card ${inactive ? 'opacity-60' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        {card.isNew ? (
          <FilePlus2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
        ) : (
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{card.pageTitle}</span>
        {card.isNew && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            NEW
          </Badge>
        )}
        <Badge variant="outline" className={`ml-auto h-5 px-1.5 text-[10px] gap-1 ${statusColor}`}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {card.status === 'applied' && <Check className="h-3 w-3" />}
          {STATUS_LABEL[card.status]}
        </Badge>
      </div>

      {/* Summary */}
      {card.summary && (
        <p className="px-3 pt-2 text-xs text-muted-foreground">{card.summary}</p>
      )}

      {/* Diff */}
      {canDiff && card.proposedContent !== undefined && (
        <div className="p-3">
          <div className="h-64 md:h-72 overflow-hidden rounded-md border">
            {card.isNew ? (
              <SimpleEditor
                content={card.proposedContent}
                onChange={card.status === 'proposed' ? onContentChange : () => {}}
                className="h-full"
              />
            ) : (
              <MergeEditor
                original={card.originalContent}
                proposed={card.proposedContent}
                onChange={card.status === 'proposed' ? onContentChange : () => {}}
                className="h-full"
              />
            )}
          </div>
        </div>
      )}

      {card.error && (
        <p className="px-3 pb-2 text-xs text-destructive">{card.error}</p>
      )}

      {/* Actions */}
      {!inactive && !busy && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {card.status === 'proposed' && (
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onAccept}>
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
          )}
          {(card.status === 'proposed' || card.status === 'applied') && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs text-red-600 hover:text-red-700"
              onClick={onReject}
            >
              {card.status === 'applied' ? <RotateCcw className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {card.status === 'applied' ? 'Reject (undo)' : 'Reject'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setResponding(v => !v)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Respond
          </Button>
        </div>
      )}

      {/* Per-card respond box */}
      {responding && !busy && (
        <div className="px-3 pb-3">
          <Textarea
            autoFocus
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submitFeedback()
              }
            }}
            placeholder="What should change about this edit? (e.g. 'shorter', 'add an example')"
            rows={2}
            className="resize-none text-sm"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setResponding(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={submitFeedback} disabled={!feedback.trim()}>
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

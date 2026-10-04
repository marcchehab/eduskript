'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
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
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MergeEditor, SimpleEditor } from './merge-editor'
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer.client'
import { PAYWALL_COPY } from '@/components/dashboard/upgrade-prompt'
import { UiLocaleSwitcher, useUiLocale } from '@/lib/i18n/client'
import { normalizeContent } from '@/lib/ai/normalize-content'
import { changedExcerpt } from '@/lib/ai/changed-excerpt'
import { useAIEditChat, type ChangeCard, type ChatMode, type ContentModel } from '@/hooks/use-ai-edit-chat'
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
  FileText,
  RotateCcw,
  Zap,
  BrainCircuit,
  Lock,
  Eye,
  Code2,
} from 'lucide-react'

const CONTENT_MODEL_STORAGE_KEY = 'eduskript:ai-edit-content-model'
const MODE_STORAGE_KEY = 'eduskript:ai-edit-mode'

function loadStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(key)
    return (allowed as readonly string[]).includes(saved ?? '') ? (saved as T) : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode / storage disabled — the toggle still works for this session.
  }
}

// Subject-neutral starters shown in the empty state; a click fills the composer.
const EXAMPLE_PROMPTS = [
  'Add a practice exercise with a collapsible solution',
  'Simplify the language for 14-year-olds',
  'Turn this section into three quiz questions',
]

interface AIEditChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: AIEditTarget
  targetTitle: string
  targetSubtitle?: string
  currentContent?: string
  onEditsApplied?: (newContent?: string) => void
  /** Free plan: show what AI Edit does and an upgrade link instead of the chat. */
  locked?: boolean
  /** Opened from the skript header (several pages) — only changes the wording. */
  skriptScope?: { openPageTitle: string }
  /** Lets the rendered preview resolve images / videos like the editor preview. */
  fileList?: Array<{ id: string; name: string; url?: string; updatedAt?: string | Date; width?: number; height?: number }>
  videoList?: React.ComponentProps<typeof MarkdownRenderer>['videoList']
}

export function AIEditChatModal(props: AIEditChatModalProps) {
  const { open, onOpenChange, locked } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {locked ? <LockedContent {...props} /> : <ChatContent {...props} />}
    </Dialog>
  )
}

function ChatContent({
  skriptScope,
  target,
  targetTitle,
  targetSubtitle,
  currentContent,
  onEditsApplied,
  fileList,
  videoList,
}: AIEditChatModalProps) {
  const [mode, setModeState] = useState<ChatMode>(() => loadStored(MODE_STORAGE_KEY, ['ask', 'auto'] as const, 'ask'))
  const [contentModel, setContentModelState] = useState<ContentModel>(() =>
    loadStored(CONTENT_MODEL_STORAGE_KEY, ['flash', 'thinking'] as const, 'flash')
  )
  const [input, setInput] = useState('')
  // Card the next composer message refines ("Ask for changes"), if any.
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const confirm = useAlertDialog()

  const setMode = useCallback((m: ChatMode) => {
    setModeState(m)
    store(MODE_STORAGE_KEY, m)
  }, [])
  const setContentModel = useCallback((m: ContentModel) => {
    setContentModelState(m)
    store(CONTENT_MODEL_STORAGE_KEY, m)
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  // Tracks which assistant turn we've already auto-scrolled to, so we jump to
  // the first change of a new turn exactly once (not on every card update).
  const scrolledTurnRef = useRef<string | null>(null)

  const {
    turns,
    cards,
    isBusy,
    phase,
    phaseSince,
    error,
    errorCode,
    sendInstruction,
    acceptCard,
    rejectCard,
    respondToCard,
    updateCardContent,
    stop,
  } = useAIEditChat({ target, currentContent, mode, contentModel, onEditsApplied })

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

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput('')
    if (replyTo && cards[replyTo]) {
      const cardId = replyTo
      setReplyTo(null)
      await respondToCard(cardId, text)
      return
    }
    const ok = await sendInstruction(text)
    // Failed: give the teacher their text back instead of making them retype it.
    if (!ok) setInput(prev => prev || text)
  }, [input, isBusy, replyTo, cards, respondToCard, sendInstruction])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  const askForChanges = useCallback((cardId: string) => {
    setReplyTo(cardId)
    inputRef.current?.focus()
  }, [])

  // Undo restores the page as it was before this change. If the open page was
  // edited since (by hand or by a later card), that work would be lost — ask.
  const handleUndo = useCallback(
    (card: ChangeCard) => {
      const focused = target.mode === 'frontpage' || (target.mode === 'page' && card.pageId === target.pageId)
      const changedSince =
        focused &&
        currentContent !== undefined &&
        normalizeContent(currentContent) !== normalizeContent(card.proposedContent)
      if (changedSince) {
        confirm.showConfirm(
          'This page was changed after the AI edit. Undo restores the version from before the AI edit, so those later changes will be lost.',
          () => void rejectCard(card.id),
          { title: 'Undo this AI edit?', confirmText: 'Undo anyway', destructive: true }
        )
      } else {
        void rejectCard(card.id)
      }
    },
    [target, currentContent, confirm, rejectCard]
  )

  const isEmpty = turns.length === 0
  const replyCard = replyTo ? cards[replyTo] : undefined
  const subtitle =
    target.mode === 'frontpage'
      ? 'Edits this front page. Each message is turned into a proposed change.'
      : skriptScope
        ? `Can change several pages of this skript and add new ones. Open page: “${skriptScope.openPageTitle}”.`
        : `Edits this page. Can also add new pages to ${targetSubtitle ? `“${targetSubtitle}”` : 'this skript'}.`

  return (
    <>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">AI Edit — {targetTitle}</span>
              </DialogTitle>
              <DialogDescription className="mt-0.5">{subtitle}</DialogDescription>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <ModeToggle mode={mode} onChange={setMode} />
              <ContentModelToggle model={contentModel} onChange={setContentModel} />
            </div>
          </div>
        </DialogHeader>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isEmpty && (
            <EmptyState
              onPick={text => {
                setInput(text)
                inputRef.current?.focus()
              }}
            />
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
                          position={turn.planTotal && turn.planTotal > 1 ? `${card.pageIndex + 1} of ${turn.planTotal}` : undefined}
                          isReplyTarget={replyTo === id}
                          skriptId={target.mode === 'page' ? target.skriptId : undefined}
                          fileList={fileList}
                          videoList={videoList}
                          onApply={() => acceptCard(id)}
                          onDiscard={() => rejectCard(id)}
                          onUndo={() => handleUndo(card)}
                          onRetry={() => respondToCard(id, '')}
                          onAskForChanges={() => askForChanges(id)}
                          onContentChange={content => updateCardContent(id, content)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}

          {isBusy && phase && (
            <BusyIndicator
              phase={phase}
              since={phaseSince}
              position={(() => {
                const turn = [...turns].reverse().find(t => t.role === 'assistant' && t.pending)
                if (!turn?.planTotal || turn.planTotal < 2) return undefined
                return `${Math.min(turn.cardIds.length, turn.planTotal)} of ${turn.planTotal}`
              })()}
            />
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
              {errorCode === 'paid_only' ? (
                <>
                  {' '}
                  <Link href="/dashboard/billing" className="underline font-medium">
                    View plans
                  </Link>
                </>
              ) : (
                <span className="text-destructive/80"> Your message is back in the box below — send it again to retry.</span>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          {replyCard && (
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1">
                <MessageSquare className="h-3 w-3" />
                Changes to: <span className="font-medium truncate max-w-[16rem]">{replyCard.summary || replyCard.pageTitle}</span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                  title="Cancel — send a new request instead"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                replyCard
                  ? 'What should be different? (e.g. "shorter", "add a second example")'
                  : isEmpty
                    ? 'Describe the change you want…'
                    : 'Ask for another change…'
              }
              rows={2}
              className="resize-none min-h-[52px]"
            />
            {isBusy ? (
              <Button variant="destructive" size="icon" onClick={stop} title="Stop" className="shrink-0 h-[52px] w-[52px]">
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button size="icon" onClick={() => void handleSend()} disabled={!input.trim()} title="Send (⌘/Ctrl+Enter)" className="shrink-0 h-[52px] w-[52px]">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {mode === 'auto'
              ? 'Apply directly: changes are saved right away. You can undo each one.'
              : 'Review each: every change is shown first and only saved when you apply it.'}
            {' '}⌘/Ctrl+Enter to send.
          </p>
        </div>
      </DialogContent>
      <AlertDialogModal
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        type={confirm.type}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        showCancel={confirm.showCancel}
        confirmText={confirm.confirmText}
        cancelText={confirm.cancelText}
        destructive={confirm.destructive}
      />
    </>
  )
}

// Free plan: same entry point, but explain the feature instead of silently
// redirecting to Billing. Bilingual like the other paywall hints.
function LockedContent({ targetTitle }: AIEditChatModalProps) {
  const locale = useUiLocale()
  const t = PAYWALL_COPY[locale]
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          {t.aiEditLockedTitle}
        </DialogTitle>
        <DialogDescription className="sr-only">AI Edit — {targetTitle}</DialogDescription>
      </DialogHeader>
      <UiLocaleSwitcher className="absolute top-3 right-12" />
      <p className="text-sm text-muted-foreground">{t.aiEditLockedBody}</p>
      <ul className="space-y-1.5">
        {t.aiEditLockedExamples.map(example => (
          <li key={example} className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            {example}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/dashboard/billing">{t.aiEditLockedCta}</Link>
        </Button>
      </div>
    </DialogContent>
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

function SegmentToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; title: string; icon?: React.ReactNode; activeClass: string }>
}) {
  return (
    <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border bg-muted/40 text-xs">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          aria-pressed={value === o.value}
          className={`flex items-center gap-1 px-3 py-1 font-medium transition-colors duration-200 ${
            i > 0 ? 'border-l' : ''
          } ${value === o.value ? o.activeClass : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ModeToggle({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  return (
    <SegmentToggle
      value={mode}
      onChange={onChange}
      options={[
        { value: 'ask', label: 'Review each', title: 'Each change is shown first and only saved when you apply it.', activeClass: 'bg-orange-500 text-white' },
        { value: 'auto', label: 'Apply directly', title: 'Changes are saved right away. You can undo each one.', activeClass: 'bg-green-600 text-white' },
      ]}
    />
  )
}

function ContentModelToggle({ model, onChange }: { model: ContentModel; onChange: (m: ContentModel) => void }) {
  return (
    <SegmentToggle
      value={model}
      onChange={onChange}
      options={[
        { value: 'flash', label: 'Quick', title: 'Quick: a few seconds per change. Good for small edits.', icon: <Zap className="h-3 w-3" />, activeClass: 'bg-primary text-primary-foreground' },
        { value: 'thinking', label: 'Thorough', title: 'Thorough: slower, better for larger rewrites and new pages.', icon: <BrainCircuit className="h-3 w-3" />, activeClass: 'bg-primary text-primary-foreground' },
      ]}
    />
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground gap-3 py-10">
      <Sparkles className="h-8 w-8 opacity-40" />
      <p className="text-sm max-w-md">
        Describe what should change. The AI sees this page and the titles of the other pages in the skript.
        You review each change before it is saved.
      </p>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {EXAMPLE_PROMPTS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-full border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function BusyIndicator({
  phase,
  since,
  position,
}: {
  phase: 'planning' | 'writing'
  since: number | null
  position?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = since ? Math.max(0, Math.round((now - since) / 1000)) : 0
  const label =
    phase === 'planning'
      ? 'Reading the page and planning the change…'
      : `Writing the change${position ? ` (${position})` : ''}…`
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{label}</span>
      <span className="tabular-nums">{seconds}s</span>
      {phase === 'writing' && seconds >= 20 && <span>· longer pages take up to a minute</span>}
    </div>
  )
}

function statusLabel(card: ChangeCard): string {
  switch (card.status) {
    case 'generating':
      return 'Writing…'
    case 'proposed':
      return 'Ready to review'
    case 'applying':
      return 'Saving…'
    case 'applied':
      return 'Saved'
    case 'reverting':
      return 'Undoing…'
    case 'rejected':
      return card.undone ? 'Undone' : 'Discarded'
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return 'Failed'
  }
}

function ChangeCardView({
  card,
  position,
  isReplyTarget,
  skriptId,
  fileList,
  videoList,
  onApply,
  onDiscard,
  onUndo,
  onRetry,
  onAskForChanges,
  onContentChange,
}: {
  card: ChangeCard
  position?: string
  isReplyTarget: boolean
  skriptId?: string
  fileList?: AIEditChatModalProps['fileList']
  videoList?: AIEditChatModalProps['videoList']
  onApply: () => void
  onDiscard: () => void
  onUndo: () => void
  onRetry: () => void
  onAskForChanges: () => void
  onContentChange: (content: string) => void
}) {
  const [view, setView] = useState<'preview' | 'markdown'>('preview')

  const busy = card.status === 'generating' || card.status === 'applying' || card.status === 'reverting'
  const isRejected = card.status === 'rejected'
  const inactive = isRejected || card.status === 'stopped'
  const hasContent = card.proposedContent !== '' && card.status !== 'generating'
  const editable = card.status === 'proposed'

  const preview = useMemo(
    () =>
      card.isNew
        ? { excerpt: card.proposedContent, removedOnly: false }
        : changedExcerpt(card.originalContent, card.proposedContent),
    [card.isNew, card.originalContent, card.proposedContent]
  )

  const statusColor =
    card.status === 'applied'
      ? 'text-green-600 dark:text-green-400 border-green-600/30'
      : card.status === 'failed'
        ? 'text-destructive border-destructive/30'
        : inactive
          ? 'text-muted-foreground border-border'
          : 'text-primary border-primary/30'

  return (
    <div className={`rounded-lg border bg-card ${inactive ? 'opacity-60' : ''} ${isReplyTarget ? 'ring-2 ring-primary/40' : ''}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        {card.isNew ? (
          <FilePlus2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-medium truncate">{card.pageTitle}</span>
        {card.isNew && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            NEW PAGE
          </Badge>
        )}
        {position && <span className="text-[11px] text-muted-foreground">Change {position}</span>}
        <Badge variant="outline" className={`ml-auto h-5 px-1.5 text-[10px] gap-1 ${statusColor}`}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {card.status === 'applied' && <Check className="h-3 w-3" />}
          {statusLabel(card)}
        </Badge>
      </div>

      {/* Summary */}
      {card.summary && <p className="px-3 pt-2 text-xs text-muted-foreground">{card.summary}</p>}

      {/* Preview / Markdown */}
      {hasContent && !inactive && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setView('preview')}
              aria-pressed={view === 'preview'}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${view === 'preview' ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'}`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => setView('markdown')}
              aria-pressed={view === 'markdown'}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${view === 'markdown' ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'}`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Changes in Markdown
            </button>
            {view === 'preview' && !card.isNew && (
              <span className="ml-auto text-muted-foreground">Showing only the changed part</span>
            )}
          </div>
          {view === 'preview' ? (
            <div className="max-h-96 overflow-y-auto rounded-md border bg-background px-4 py-3">
              {preview.excerpt ? (
                <div className="prose-theme">
                  <MarkdownRenderer content={preview.excerpt} skriptId={skriptId} fileList={fileList} videoList={videoList} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {preview.removedOnly
                    ? 'This change only removes content. Switch to “Changes in Markdown” to see what is removed.'
                    : 'No visible change — the AI returned the same content.'}
                </p>
              )}
            </div>
          ) : (
            <div className="h-72 overflow-hidden rounded-md border">
              {card.isNew ? (
                <SimpleEditor
                  content={card.proposedContent}
                  onChange={editable ? onContentChange : () => {}}
                  readOnly={!editable}
                  className="h-full"
                />
              ) : (
                <MergeEditor
                  original={card.originalContent}
                  proposed={card.proposedContent}
                  onChange={editable ? onContentChange : () => {}}
                  reviewMode
                  readOnly={!editable}
                  className="h-full"
                />
              )}
            </div>
          )}
        </div>
      )}

      {card.error && <p className="px-3 pb-2 text-xs text-destructive">{card.error}</p>}

      {card.status === 'applied' && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Saved as a new version of this page. Undo restores the version before this change (also in Version history).
        </p>
      )}

      {/* Actions */}
      {!inactive && !busy && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {card.status === 'proposed' && (
            <>
              <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onApply}>
                <Check className="h-3.5 w-3.5" />
                Apply
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onDiscard}>
                <X className="h-3.5 w-3.5" />
                Discard
              </Button>
            </>
          )}
          {card.status === 'applied' && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onUndo}>
              <RotateCcw className="h-3.5 w-3.5" />
              Undo
            </Button>
          )}
          {card.status === 'failed' && (
            <>
              <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onDiscard}>
                <X className="h-3.5 w-3.5" />
                Dismiss
              </Button>
            </>
          )}
          {(card.status === 'proposed' || card.status === 'applied') && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onAskForChanges}>
              <MessageSquare className="h-3.5 w-3.5" />
              Ask for changes
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

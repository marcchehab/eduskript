'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PAYWALL_COPY } from '@/components/dashboard/upgrade-prompt'
import { useUiLocale } from '@/lib/i18n/client'
import type { useInlineAIEdit } from '@/hooks/use-inline-ai-edit'
import type { ContentModel } from '@/hooks/use-ai-edit-chat'
import { Sparkles, Send, Square, Loader2, Check, X, Zap, BrainCircuit, Lock, RotateCcw } from 'lucide-react'

const EXAMPLE_PROMPTS = [
  'Add a practice exercise with a collapsible solution',
  'Simplify the language for 14-year-olds',
  'Add two quiz questions at the end',
]

/**
 * The "AI Edit" ribbon tab of the page editor: a full-width chat strip above
 * the page. Proposals are shown in the editor itself (inline diff, see
 * codemirror-editor.tsx showAIProposal); this panel only talks to the AI and
 * offers Accept all / Reject all. Saving is the page's normal Save.
 */
export function AIEditPanel({
  locked,
  chat,
  contentModel,
  onContentModelChange,
  pendingChanges,
  onAcceptAll,
  onRejectAll,
}: {
  locked: boolean
  chat: ReturnType<typeof useInlineAIEdit>
  contentModel: ContentModel
  onContentModelChange: (m: ContentModel) => void
  pendingChanges: number
  onAcceptAll: () => void
  onRejectAll: () => void
}) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.turns, chat.phase])

  if (locked) return <LockedPanel />

  const send = async () => {
    const text = input.trim()
    if (!text || chat.isBusy) return
    setInput('')
    const ok = await chat.send(text)
    if (!ok) setInput(prev => prev || text)
  }

  return (
    <div className="flex w-full min-w-0 gap-3 py-1.5 min-h-[220px]">
      {/* Conversation + composer */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {(chat.turns.length > 0 || chat.error) && (
          <div ref={scrollRef} className="flex-1 min-h-0 max-h-72 overflow-y-auto space-y-1.5 text-sm pr-1">
            {chat.turns.map(t => (
              <div key={t.id} className={t.role === 'user' ? 'text-right' : ''}>
                <span
                  className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-2.5 py-1 text-left ${
                    t.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border'
                  }`}
                >
                  {t.text}
                </span>
              </div>
            ))}
            {chat.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-destructive">
                {chat.error}{' '}
                {chat.errorCode === 'paid_only' ? (
                  <Link href="/dashboard/billing" className="underline font-medium">View plans</Link>
                ) : (
                  <span className="text-destructive/80">Your message is back in the box — send it again to retry.</span>
                )}
              </div>
            )}
          </div>
        )}
        {chat.turns.length === 0 && !chat.error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <span>Ask the AI to change this page. Changes appear in the editor below, marked for review.</span>
            <div className="flex flex-wrap justify-center gap-1.5">
            {EXAMPLE_PROMPTS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setInput(p)}
                className="rounded-full border bg-background px-2.5 py-0.5 text-foreground hover:bg-muted"
              >
                {p}
              </button>
            ))}
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={pendingChanges > 0 ? 'Review the marked changes first, or ask for a different version…' : 'Describe the change you want… (Enter to send, Shift+Enter for a new line)'}
            rows={3}
            className="min-h-[76px] resize-y bg-background text-sm"
          />
          {chat.isBusy ? (
            <Button variant="destructive" size="icon" onClick={chat.stop} title="Stop" className="h-[76px] w-[44px] shrink-0">
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} disabled={!input.trim()} title="Send (Enter)" className="h-[76px] w-[44px] shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex w-64 shrink-0 flex-col justify-between gap-2 border-l pl-3 text-xs">
        <div className="inline-flex self-start overflow-hidden rounded-full border bg-background">
          {(['flash', 'thinking'] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => onContentModelChange(m)}
              aria-pressed={contentModel === m}
              title={m === 'flash' ? 'Quick: a few seconds per change. Good for small edits.' : 'Thorough: slower, better for larger rewrites.'}
              className={`flex items-center gap-1 px-2.5 py-0.5 ${i > 0 ? 'border-l' : ''} ${
                contentModel === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {m === 'flash' ? <Zap className="h-3 w-3" /> : <BrainCircuit className="h-3 w-3" />}
              {m === 'flash' ? 'Quick' : 'Thorough'}
            </button>
          ))}
        </div>
        {chat.isBusy ? (
          <BusyLine phase={chat.phase!} since={chat.phaseSince} />
        ) : pendingChanges > 0 ? (
          <div className="space-y-1.5">
            <p>
              <span className="font-medium text-foreground">{pendingChanges} {pendingChanges === 1 ? 'change' : 'changes'}</span>{' '}
              marked in the editor. Accept or reject each there, or:
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={onAcceptAll}>
                <Check className="h-3.5 w-3.5" /> Accept all
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRejectAll}>
                <X className="h-3.5 w-3.5" /> Reject all
              </Button>
            </div>
            <p className="text-muted-foreground">Not saved yet — Save the page as usual.</p>
          </div>
        ) : chat.turns.length > 0 ? (
          <button type="button" onClick={chat.clear} className="flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> New conversation
          </button>
        ) : (
          <p className="text-muted-foreground">Only this page is changed. For several pages, use AI Edit in the skript header.</p>
        )}
      </div>
    </div>
  )
}

function BusyLine({ phase, since }: { phase: 'planning' | 'writing'; since: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const seconds = since ? Math.max(0, Math.round((now - since) / 1000)) : 0
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground" role="status">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{phase === 'planning' ? 'Planning the change…' : 'Writing the change…'}</span>
      <span className="tabular-nums">{seconds}s</span>
    </div>
  )
}

function LockedPanel() {
  const t = PAYWALL_COPY[useUiLocale()]
  return (
    <div className="flex w-full items-center gap-3 py-1 text-sm">
      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{t.aiEditLockedTitle}.</span>{' '}
        <span className="text-muted-foreground">{t.aiEditLockedBody}</span>
      </div>
      <Sparkles className="hidden h-4 w-4 text-primary sm:block" />
      <Button asChild size="sm">
        <Link href="/dashboard/billing">{t.aiEditLockedCta}</Link>
      </Button>
    </div>
  )
}

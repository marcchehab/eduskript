/**
 * Floating onboarding checklist for new teachers. Mounted once at the app
 * root (via OnboardingQuestGate in providers.tsx) so it persists across the
 * dashboard and the teacher's own public site alike.
 *
 * State lives server-side in UserData (adapter: 'onboarding-quest', itemId:
 * 'global') — read once here via the generic GET route, updated by
 * useQuestStep()'s POSTs (fired from this widget for route-detectable steps,
 * and from scattered dashboard/public call sites for action-detectable
 * ones). The centered/expanded presentation still doesn't block the page
 * underneath (no backdrop, pointer-events pass through the overlay wrapper)
 * — the whole point is the teacher keeps interacting with the page while
 * this stays visible.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Check, Minus, PartyPopper, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { fetchQuestState, refreshQuestState, subscribeQuestUpdates, useQuestStep } from '@/lib/onboarding-quest/use-quest-step'
import { QUEST_STEPS, type QuestState, type QuestStep } from '@/lib/onboarding-quest/types'

// Same dynamic-import pattern as MuxVideo (src/components/markdown/mux-video.tsx)
// — mux-player is a custom element and needs client-only rendering.
const MuxPlayer = dynamic(
  () => import('@mux/mux-player-react').then((mod) => mod.default),
  { ssr: false }
)

type StepVideo = { playbackId: string; poster?: string; aspectRatio?: number }

const QUEST_TITLE = 'Start here to build your site!'

// The card sits centered over the page, right where the teacher often needs
// to click next — dragging it aside is the whole point, so the offset is
// remembered per device (localStorage; unlike quest completion, this doesn't
// need to survive the dashboard/public-site origin boundary).
const POSITION_KEY = 'eduskript:quest-position'
// Minimized/expanded is a per-device UI preference, not quest progress.
const MINIMIZED_FLAG = 'eduskript:quest-minimized'

function loadPositionPreference(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  try {
    const raw = window.localStorage.getItem(POSITION_KEY)
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw)
    return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function loadMinimizedPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MINIMIZED_FLAG) === '1'
  } catch {
    return false
  }
}

const STEP_LABELS: Record<QuestStep, string> = {
  place_skript: 'Place your first skript on your page',
  visit_public_page: 'Visit your public page',
  return_to_builder: 'Go back to your page builder on the dashboard',
  open_page_editor: 'Open a skript to edit its pages',
  rename_skript: 'Rename your skript',
  view_pages: "View the skript's pages and open another page",
  edit_page_content: 'Edit a page',
  view_via_eye_icon: 'Preview a page with the eye icon',
  return_via_edit_link: 'Return to page editor via edit button',
  use_ai_edit: 'Use AI edit to add a page',
}

// Shown only for the active (next-incomplete) step.
const STEP_DESCRIPTIONS: Record<QuestStep, React.ReactNode> = {
  place_skript:
    'This is your page builder. We added a first skript to your library on the right. Drag it onto your page so it appears on your public eduskript website.',
  visit_public_page: "Great, now let's look at your public page to see if the skript appeared.",
  return_to_builder:
    "You're now on your public eduskript website. The skript you just placed is visible in the sidebar. Let's continue building your site by going back to the page builder. Click on your profile icon to go back to the dashboard.",
  open_page_editor: "Click on the skript name (edit icon) to get to the editor.",
  rename_skript: "Here you can edit a skript and its pages. Begin by renaming this skript however you like.",
  view_pages: "A skript normally contains multiple pages. Click on Pages to view them and select a page you want to edit.",
  edit_page_content: "Now edit this page however you like and press \"Save\" when you're done.",
  view_via_eye_icon: "To directly view your page on your public page, you can use the eye icon.",
  return_via_edit_link: "You can directly edit this page, by clicking on this edit button.",
  use_ai_edit: "Now use \"AI Edit\" to tell the AI to add a new page for you. Request whatever you like — push the limits!",
}

// Blue accent so the widget pops against the dashboard's neutral chrome.
const POP_BORDER = 'border-2 border-blue-400/70 dark:border-blue-500/60 shadow-xl shadow-blue-500/20'

function detectRouteStep(pathname: string, pageSlug: string | null | undefined): QuestStep | null {
  // The profile-icon link on a teacher's own public page (auth-button.tsx)
  // sends them to the site- or org-scoped page-builder route, not the bare
  // /dashboard/page-builder — only the /dashboard fallback (no known site/org
  // id) redirects through the bare route.
  if (/^\/dashboard\/(?:page-builder|site\/[^/]+\/page-builder|org\/[^/]+\/page-builder)(\/|$)/.test(pathname)) {
    return 'return_to_builder'
  }
  // Note: NOT /dashboard/skripts/[slug] bare — that route always
  // server-redirects to the first page's /pages/[slug]/edit before the
  // browser ever shows it, so a check for the bare path can never match.
  // view_pages instead fires from the "Pages" tab click itself (editor-with-media.tsx).
  if (/^\/dashboard\/skripts\/[^/]+\/pages\/[^/]+\/edit(\/|$)/.test(pathname)) return 'open_page_editor'

  // Public-page visit. Only matches the eduskript.org / org path-based
  // routes (segment compared against the teacher's own pageSlug) — a
  // custom-domain visit isn't detected here, since confirming domain
  // ownership client-side would need an extra fetch. Acceptable: new
  // teachers doing onboarding essentially never have a custom domain set
  // up yet.
  if (pageSlug) {
    const segments = pathname.split('/').filter(Boolean)
    if (segments[0] === pageSlug) return 'visit_public_page'
    if (segments[0] === 'org' && segments[2] === pageSlug) return 'visit_public_page'
  }
  return null
}

export function OnboardingQuestWidget() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const { completeStep, dismissQuest, jumpToStep } = useQuestStep()
  const [state, setState] = useState<QuestState | null>(null)
  const [justGrantedBanner, setJustGrantedBanner] = useState(false)
  // Lazy initializer reads localStorage once on mount — same pattern as
  // NicknameModalGate's shouldOpenInitially, avoids a cascading-render effect.
  const [position, setPosition] = useState(loadPositionPreference)
  const [stepVideos, setStepVideos] = useState<Partial<Record<QuestStep, StepVideo>>>({})
  const [minimized, setMinimized] = useState(loadMinimizedPreference)
  const cardRef = useRef<HTMLDivElement>(null)

  const setMinimizedPersisted = (value: boolean) => {
    setMinimized(value)
    try {
      window.localStorage.setItem(MINIMIZED_FLAG, value ? '1' : '0')
    } catch {
      // ignore
    }
  }

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startX = position.x
    const startY = position.y

    const onMove = (ev: MouseEvent) => {
      const x = startX + (ev.clientX - startMouseX)
      const y = startY + (ev.clientY - startMouseY)
      if (cardRef.current) cardRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
    const onUp = (ev: MouseEvent) => {
      const next = { x: startX + (ev.clientX - startMouseX), y: startY + (ev.clientY - startMouseY) }
      setPosition(next)
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    let cancelled = false
    fetchQuestState().then((result) => {
      if (!cancelled && result) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/onboarding-quest/step-videos')
      .then((res) => (res.ok ? res.json() : {}))
      .then((body) => {
        if (!cancelled) setStepVideos(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Browser back/forward into a bfcache-restored page resumes the frozen
  // React tree without re-running the mount effect above — this widget's
  // `state` would otherwise stay stale (e.g. a step completed on the public
  // page before navigating back doesn't show as checked until a hard
  // refresh). Re-fetch on the same triggers AnnotationLayer already uses for
  // its own staleness reconciliation.
  useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === 'visible') refreshQuestState()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshQuestState()
    }
    document.addEventListener('visibilitychange', reconcile)
    window.addEventListener('focus', reconcile)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', reconcile)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  useEffect(() => {
    return subscribeQuestUpdates((update) => {
      setState(update.state)
      if (update.justGranted) setJustGrantedBanner(true)
    })
  }, [])

  // "Come back to the page builder" et al. describe a RETURN — matching them
  // to any visit of that route (including the very first, before earlier
  // steps are done) marks them complete before the user has done anything.
  // Only auto-complete a route-detected step when it's actually next in the
  // sequence, so route detection can't complete steps out of order.
  const activeStep = state ? QUEST_STEPS.find((step) => !state.completedSteps[step]) ?? null : null

  useEffect(() => {
    if (!pathname || state?.dismissed || !activeStep) return
    const step = detectRouteStep(pathname, session?.user?.pageSlug)
    if (step === activeStep) completeStep(step)
  }, [pathname, session?.user?.pageSlug, state, activeStep, completeStep])

  if (!state || state.dismissed) return null

  if (justGrantedBanner) {
    return (
      <Card className={`fixed bottom-4 right-4 z-50 w-80 ${POP_BORDER}`}>
        <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
          <PartyPopper className="w-8 h-8 text-primary" />
          <p className="font-medium text-sm">
            Congratulations! You now understand the basic idea of Eduskript and we doubled your access to pro
            features like AI edit.
          </p>
          <a
            href="https://eduskript.org/c/first-steps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Want to go deeper? Read the User Manual
          </a>
          <Button
            size="sm"
            onClick={() => {
              setJustGrantedBanner(false)
              dismissQuest()
            }}
          >
            Nice
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (state.rewardGranted) return null

  if (minimized) {
    return (
      <Card
        className={`fixed bottom-4 right-4 z-50 cursor-pointer hover:opacity-90 ${POP_BORDER}`}
        onClick={() => setMinimizedPersisted(false)}
        title="Expand"
      >
        <CardContent className="py-2.5 px-4">
          <span className="text-sm font-bold text-foreground">{QUEST_TITLE}</span>
        </CardContent>
      </Card>
    )
  }

  const checklist = (
    <ul className="space-y-1.5">
      {QUEST_STEPS.map((step, index) => {
        const done = Boolean(state.completedSteps[step])
        const active = step === activeStep
        return (
          <li key={step} className={`flex flex-col gap-0.5 ${active ? 'my-2.5' : ''}`}>
            <div
              className="flex items-start gap-2 text-sm cursor-pointer hover:opacity-80"
              onClick={() => jumpToStep(step)}
              title="Jump to this step"
            >
              {done ? (
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              ) : (
                <span
                  className={
                    active
                      ? 'w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-[10px] font-bold text-white rounded-full bg-blue-500'
                      : 'w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground rounded-full border border-muted-foreground/40'
                  }
                >
                  {index + 1}
                </span>
              )}
              <span
                className={
                  done
                    ? 'text-muted-foreground line-through'
                    : active
                      ? 'font-bold text-blue-600 dark:text-blue-400'
                      : ''
                }
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {active && (
              <>
                <p className="ml-6 text-sm text-blue-600 dark:text-blue-400">{STEP_DESCRIPTIONS[step]}</p>
                {stepVideos[step] && (
                  <div className="ml-6 mt-1.5">
                    <MuxPlayer
                      playbackId={stepVideos[step]!.playbackId}
                      poster={stepVideos[step]!.poster}
                      style={{
                        aspectRatio: stepVideos[step]!.aspectRatio ?? 16 / 9,
                        // mux-player's own CSS var — hides the whole control bar, same as
                        // the markdown <muxvideo gif /> treatment (mux-video.tsx).
                        '--controls': 'none',
                        pointerEvents: 'none' as const,
                      }}
                      className="w-full rounded-lg overflow-hidden"
                      autoPlay="muted"
                      muted
                      loop
                      playsInline
                      nohotkeys
                      preload="auto"
                      disableTracking
                    />
                  </div>
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
      <Card
        ref={cardRef}
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        className={`pointer-events-auto w-full max-w-xl ${POP_BORDER}`}
      >
        <CardHeader
          className="flex flex-row items-start justify-between pb-2 cursor-move"
          onMouseDown={handleDragStart}
        >
          <CardTitle className="text-3xl font-bold text-foreground">{QUEST_TITLE}</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setMinimizedPersisted(true)} title="Minimize">
              <Minus className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={dismissQuest} title="Dismiss">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            We highly recommend you finish this quest to get started! Nice side-effect: it will{' '}
            <strong className="text-foreground">double your access to all pro features</strong>.
          </p>
          {checklist}
        </CardContent>
      </Card>
    </div>
  )
}

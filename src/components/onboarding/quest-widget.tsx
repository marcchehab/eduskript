/**
 * Floating onboarding checklist for new teachers. Mounted once at the app
 * root (via OnboardingQuestGate in providers.tsx) so it persists across the
 * dashboard and the teacher's own public site alike.
 *
 * State lives server-side in UserData (adapter: 'onboarding-quest', itemId:
 * 'global') — read once here via the generic GET route, updated by
 * useQuestStep()'s POSTs (fired from this widget for route-detectable steps,
 * and from scattered dashboard/public call sites for action-detectable
 * ones). Docked bottom-left at the sidebar's width, not a backdrop-blocking
 * overlay — the teacher keeps interacting with the page while this stays
 * visible.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Check,
  Minus,
  MoveDiagonal2,
  PartyPopper,
  Plus,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchQuestState,
  refreshQuestState,
  subscribeQuestUpdates,
  useQuestStep,
} from "@/lib/onboarding-quest/use-quest-step";
import {
  QUEST_STEPS,
  type QuestState,
  type QuestStep,
} from "@/lib/onboarding-quest/types";

// Same dynamic-import pattern as MuxVideo (src/components/markdown/mux-video.tsx)
// — mux-player is a custom element and needs client-only rendering.
const MuxPlayer = dynamic(
  () => import("@mux/mux-player-react").then((mod) => mod.default),
  { ssr: false },
);

type StepVideo = { playbackId: string; poster?: string; aspectRatio?: number };

const QUEST_TITLE = "How to start";

// Wider than the sidebar (dashboard/sidebar.tsx w-64) since step
// descriptions were cramped at w-64; clamped to the viewport on resize and
// via maxWidth so it still fits small viewports / high OS zoom.
const DEFAULT_WIDTH = 448; // 28rem
const MIN_WIDTH = 256;
// Minimized/expanded is a per-device UI preference, not quest progress.
const MINIMIZED_FLAG = "eduskript:quest-minimized";
// User-resized size (via the top-right corner gizmo), in px.
// Height defaults to half the viewport height on first load.
const HEIGHT_KEY = "eduskript:quest-height";
const WIDTH_KEY = "eduskript:quest-width";
// Horizontal-only drag offset from the docked left-4 position, in px.
const X_OFFSET_KEY = "eduskript:quest-x-offset";

function loadMinimizedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MINIMIZED_FLAG) === "1";
  } catch {
    return false;
  }
}

function loadXOffsetPreference(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(X_OFFSET_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    // ignore
  }
  return 0;
}

function loadWidthPreference(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_WIDTH) return n;
  } catch {
    // ignore
  }
  return DEFAULT_WIDTH;
}

function loadHeightPreference(): number {
  if (typeof window === "undefined") return 400;
  try {
    const raw = window.localStorage.getItem(HEIGHT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // ignore
  }
  return window.innerHeight / 2;
}

const STEP_LABELS: Record<QuestStep, string> = {
  place_skript: "Place your first skript",
  visit_public_page: "Visit your public page",
  return_to_builder: "Go back to your page builder",
  open_page_editor: "Open a skript to edit its pages",
  rename_skript: "Rename your skript",
  view_pages: "View other pages",
  edit_page_content: "Edit a page",
  view_via_eye_icon: "Preview a page with the eye icon",
  return_via_edit_link: "Return to page editor",
  use_ai_edit: "Use AI edit to add a page",
};

// Shown only for the active (next-incomplete) step.
const STEP_DESCRIPTIONS: Record<QuestStep, React.ReactNode> = {
  place_skript:
    "This is your page builder. We added a first skript to your library on the right. Drag it onto your page so it appears on your public eduskript website.",
  visit_public_page:
    "Great, now let's look at your public page to see if the skript appeared.",
  return_to_builder:
    "You're now on your public eduskript website. The skript you just placed is visible in the sidebar. Let's continue building your site by going back to the page builder. Click on your profile icon to go back to the dashboard.",
  open_page_editor:
    "Click on the skript name (edit icon) to get to the editor.",
  rename_skript:
    "Here you can edit a skript and its pages. Begin by renaming this skript however you like.",
  view_pages:
    "A skript normally contains multiple pages. Click on Pages to view them and select a page you want to edit.",
  edit_page_content:
    'Now edit this page however you like and press "Save" when you\'re done.',
  view_via_eye_icon:
    "To directly view your page on your public page, you can use the eye icon.",
  return_via_edit_link:
    "You can directly edit this page, by clicking on this edit button.",
  use_ai_edit:
    'Now use "AI Edit" to tell the AI to add a new page for you. Request whatever you like — push the limits!',
};

// Blue accent so the widget pops against the dashboard's neutral chrome.
const POP_BORDER =
  "border-2 border-blue-400/70 dark:border-blue-500/60 shadow-xl shadow-blue-500/20";

function detectRouteStep(
  pathname: string,
  pageSlug: string | null | undefined,
): QuestStep | null {
  // The profile-icon link on a teacher's own public page (auth-button.tsx)
  // sends them to the site- or org-scoped page-builder route, not the bare
  // /dashboard/page-builder — only the /dashboard fallback (no known site/org
  // id) redirects through the bare route.
  if (
    /^\/dashboard\/(?:page-builder|site\/[^/]+\/page-builder|org\/[^/]+\/page-builder)(\/|$)/.test(
      pathname,
    )
  ) {
    return "return_to_builder";
  }
  // Note: NOT /dashboard/skripts/[slug] bare — that route always
  // server-redirects to the first page's /pages/[slug]/edit before the
  // browser ever shows it, so a check for the bare path can never match.
  // view_pages instead fires from the "Pages" tab click itself (editor-with-media.tsx).
  if (/^\/dashboard\/skripts\/[^/]+\/pages\/[^/]+\/edit(\/|$)/.test(pathname))
    return "open_page_editor";

  // Public-page visit. Only matches the eduskript.org / org path-based
  // routes (segment compared against the teacher's own pageSlug) — a
  // custom-domain visit isn't detected here, since confirming domain
  // ownership client-side would need an extra fetch. Acceptable: new
  // teachers doing onboarding essentially never have a custom domain set
  // up yet.
  if (pageSlug) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === pageSlug) return "visit_public_page";
    if (segments[0] === "org" && segments[2] === pageSlug)
      return "visit_public_page";
  }
  return null;
}

export function OnboardingQuestWidget() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { completeStep, dismissQuest, jumpToStep } = useQuestStep();
  const [state, setState] = useState<QuestState | null>(null);
  const [justGrantedBanner, setJustGrantedBanner] = useState(false);
  const [stepVideos, setStepVideos] = useState<
    Partial<Record<QuestStep, StepVideo>>
  >({});
  const [minimized, setMinimized] = useState(loadMinimizedPreference);
  const [height, setHeight] = useState(loadHeightPreference);
  const [width, setWidth] = useState(loadWidthPreference);
  const [xOffset, setXOffset] = useState(loadXOffsetPreference);
  const [isDragging, setIsDragging] = useState(false);
  const draggedRef = useRef(false);

  const setMinimizedPersisted = (value: boolean) => {
    setMinimized(value);
    try {
      window.localStorage.setItem(MINIMIZED_FLAG, value ? "1" : "0");
    } catch {
      // ignore
    }
  };

  // Two-dimensional resize from the top-right corner gizmo. The card's
  // bottom edge is pinned to the viewport bottom and its left edge is
  // anchored (left-4 + translateX), so dragging UP grows the height and
  // dragging RIGHT grows the width — unlike a native bottom-right handle.
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startHeight = height;
    const startWidth = width;
    const maxHeight = window.innerHeight;
    const maxWidth = window.innerWidth - 32;

    const compute = (ev: MouseEvent) => ({
      h: Math.min(
        maxHeight,
        Math.max(120, startHeight + (startMouseY - ev.clientY)),
      ),
      w: Math.min(
        maxWidth,
        Math.max(MIN_WIDTH, startWidth + (ev.clientX - startMouseX)),
      ),
    });

    const onMove = (ev: MouseEvent) => {
      const { h, w } = compute(ev);
      setHeight(h);
      setWidth(w);
    };
    const onUp = (ev: MouseEvent) => {
      const { h, w } = compute(ev);
      try {
        window.localStorage.setItem(HEIGHT_KEY, String(h));
        window.localStorage.setItem(WIDTH_KEY, String(w));
      } catch {
        // ignore
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Horizontal-only: the widget stays docked to bottom-left, but a teacher
  // may want it out of the way of content underneath — clamped so it can't
  // be dragged past the right edge of the viewport.
  const handleXDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    // Without this, dragging over the title/description text selects it
    // instead of moving the card.
    e.preventDefault();
    const startMouseX = e.clientX;
    const startOffset = xOffset;
    const cardWidth =
      (e.currentTarget as HTMLElement)
        .closest(".card-drag-root")
        ?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
    const maxOffset = Math.max(0, window.innerWidth - cardWidth - 16);
    draggedRef.current = false;

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startMouseX) > 3 && !draggedRef.current) {
        draggedRef.current = true;
        // A body-level cursor override doesn't win over other elements' own
        // cursor styles (incl. our own cursor-grab classes, text, buttons) —
        // render a full-viewport overlay instead so the grabbing cursor
        // always shows. Deferred until real movement so a plain click (e.g.
        // to expand the minimized pill) doesn't get eaten by the overlay.
        setIsDragging(true);
      }
      const next = Math.min(
        maxOffset,
        Math.max(0, startOffset + (ev.clientX - startMouseX)),
      );
      setXOffset(next);
    };
    const onUp = (ev: MouseEvent) => {
      const next = Math.min(
        maxOffset,
        Math.max(0, startOffset + (ev.clientX - startMouseX)),
      );
      try {
        window.localStorage.setItem(X_OFFSET_KEY, String(next));
      } catch {
        // ignore
      }
      setIsDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    let cancelled = false;
    fetchQuestState().then((result) => {
      if (!cancelled && result) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding-quest/step-videos")
      .then((res) => (res.ok ? res.json() : {}))
      .then((body) => {
        if (!cancelled) setStepVideos(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser back/forward into a bfcache-restored page resumes the frozen
  // React tree without re-running the mount effect above — this widget's
  // `state` would otherwise stay stale (e.g. a step completed on the public
  // page before navigating back doesn't show as checked until a hard
  // refresh). Re-fetch on the same triggers AnnotationLayer already uses for
  // its own staleness reconciliation.
  useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === "visible") refreshQuestState();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshQuestState();
    };
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    return subscribeQuestUpdates((update) => {
      setState(update.state);
      if (update.justGranted) setJustGrantedBanner(true);
    });
  }, []);

  // "Come back to the page builder" et al. describe a RETURN — matching them
  // to any visit of that route (including the very first, before earlier
  // steps are done) marks them complete before the user has done anything.
  // Only auto-complete a route-detected step when it's actually next in the
  // sequence, so route detection can't complete steps out of order.
  const activeStep = state
    ? (QUEST_STEPS.find((step) => !state.completedSteps[step]) ?? null)
    : null;

  useEffect(() => {
    if (!pathname || state?.dismissed || !activeStep) return;
    const step = detectRouteStep(pathname, session?.user?.pageSlug);
    if (step === activeStep) completeStep(step);
  }, [pathname, session?.user?.pageSlug, state, activeStep, completeStep]);

  if (!state || state.dismissed) return null;

  // Don't appear before the teacher reaches the page builder: right after
  // OAuth signup the user is still on /auth/complete-profile, and the widget
  // rendered on top of that (providers.tsx mounts it on every route). Until
  // the quest has actually started (first step completed sets startedAt),
  // only show inside the dashboard. Once started, keep showing everywhere —
  // the visit_public_page/return steps happen outside /dashboard.
  const questStarted =
    state.startedAt > 0 || Object.keys(state.completedSteps).length > 0;
  if (!questStarted && !pathname?.startsWith("/dashboard")) return null;

  if (justGrantedBanner) {
    return (
      <Card className={`fixed bottom-4 right-4 z-50 w-80 ${POP_BORDER}`}>
        <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
          <PartyPopper className="w-8 h-8 text-primary" />
          <p className="font-medium text-sm">
            Congratulations! You now understand the basic idea of Eduskript and
            we doubled your trial time.
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
              setJustGrantedBanner(false);
              dismissQuest();
            }}
          >
            Nice
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.rewardGranted) return null;

  const dragOverlay = isDragging && (
    <div className="fixed inset-0 z-[60] cursor-grabbing" />
  );

  if (minimized) {
    return (
      <>
        {dragOverlay}
        <Card
          style={{
            width: `${width}px`,
            maxWidth: "calc(100vw - 2rem)",
            transform: `translateX(${xOffset}px)`,
          }}
          className={`card-drag-root fixed bottom-0 left-4 z-50 rounded-b-none cursor-grab active:cursor-grabbing hover:opacity-90 ${POP_BORDER}`}
          onMouseDown={handleXDragStart}
          onClick={() => {
            if (draggedRef.current) return;
            setMinimizedPersisted(false);
          }}
          title="Drag to move"
        >
          <CardContent className="py-2 pl-3 pr-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-foreground select-none">
              {QUEST_TITLE}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => setMinimizedPersisted(false)}
              title="Expand"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const checklist = (
    <ul className="space-y-1.5">
      {QUEST_STEPS.map((step, index) => {
        const done = Boolean(state.completedSteps[step]);
        const active = step === activeStep;
        return (
          <li
            key={step}
            className={`flex flex-col gap-0.5 ${active ? "my-2.5" : ""}`}
          >
            <div
              className="flex items-start gap-2 text-xs cursor-pointer hover:opacity-80"
              onClick={() => jumpToStep(step)}
              title="Jump to this step"
            >
              {done ? (
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              ) : (
                <span
                  className={
                    active
                      ? "w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-[10px] font-bold text-white rounded-full bg-blue-500"
                      : "w-4 h-4 mt-0.5 shrink-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground rounded-full border border-muted-foreground/40"
                  }
                >
                  {index + 1}
                </span>
              )}
              <span
                className={
                  done
                    ? "text-muted-foreground line-through"
                    : active
                      ? "font-bold text-blue-600 dark:text-blue-400"
                      : ""
                }
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {active && (
              <>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {STEP_DESCRIPTIONS[step]}
                </p>
                {stepVideos[step] && (
                  <div className="mt-1.5">
                    <MuxPlayer
                      playbackId={stepVideos[step]!.playbackId}
                      poster={stepVideos[step]!.poster}
                      style={{
                        aspectRatio: stepVideos[step]!.aspectRatio ?? 16 / 9,
                        // mux-player's own CSS var — hides the whole control bar, same as
                        // the markdown <muxvideo gif /> treatment (mux-video.tsx).
                        "--controls": "none",
                        pointerEvents: "none" as const,
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
        );
      })}
    </ul>
  );

  return (
    <>
      {dragOverlay}
      <Card
        style={{
          height: `${height}px`,
          minHeight: "120px",
          maxHeight: "100vh",
          width: `${width}px`,
          maxWidth: "calc(100vw - 2rem)",
          transform: `translateX(${xOffset}px)`,
        }}
        // No overflow-hidden here (the corner gizmo hangs outside the card);
        // CardContent below does its own overflow-y-auto scrolling.
        className={`card-drag-root fixed bottom-0 left-4 z-50 rounded-b-none flex flex-col ${POP_BORDER}`}
      >
        <CardHeader
          className="group/header relative flex flex-row items-start justify-between py-2 px-3 shrink-0 cursor-grab active:cursor-grabbing"
          onMouseDown={handleXDragStart}
        >
          <CardTitle className="text-sm font-bold text-foreground leading-tight select-none">
            {QUEST_TITLE}
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setMinimizedPersisted(true)}
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={dismissQuest}
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          {/* Resize gizmo: child of the header so hovering it keeps the
              header's :hover (it's only visible while hovering the draggable
              top area). Positioned against the header, which sits flush with
              the card's top-right corner. */}
          <button
            type="button"
            className="absolute -top-3 -right-3 z-10 w-7 h-7 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center cursor-nesw-resize opacity-0 group-hover/header:opacity-100 transition-opacity duration-200"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          >
            <MoveDiagonal2 className="w-4 h-4 rotate-90" />
          </button>
        </CardHeader>
        <CardContent className="px-3 pb-3 overflow-y-auto flex-1">
          <p
            className="text-xs text-muted-foreground mb-3 select-none cursor-grab active:cursor-grabbing"
            onMouseDown={handleXDragStart}
          >
            This quick intro explains how to get started and{" "}
            <strong className="text-foreground">doubles your trial time</strong>
            .
          </p>
          {checklist}
        </CardContent>
      </Card>
    </>
  );
}

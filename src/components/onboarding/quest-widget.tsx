/**
 * Floating onboarding checklist for new teachers. Mounted once at the app
 * root (via OnboardingQuestGate in providers.tsx) so it persists across the
 * dashboard and the teacher's own public site alike.
 *
 * State lives server-side in UserData (adapter: 'onboarding-quest', itemId:
 * 'global') — read once here via the generic GET route, updated by
 * useQuestStep()'s POSTs (fired from this widget for route-detectable steps,
 * and from scattered dashboard/public call sites for action-detectable
 * ones). Docked bottom-left via DockedPanel (src/components/docked-panel.tsx),
 * not a backdrop-blocking overlay — the teacher keeps interacting with the
 * page while this stays visible.
 */
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DockedPanel, DOCKED_PANEL_BORDER } from "@/components/docked-panel";
import { UiLocaleSwitcher, useUiLocale } from "@/lib/i18n/client";
import type { UiLocale } from "@/lib/i18n/locale";
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

// Bilingual (German default, flag switcher in the header) — one of the few
// UI surfaces that is; see src/lib/i18n/locale.ts. Button names the steps
// refer to ("Pages", "Save", "AI Edit") stay English because the rest of the
// dashboard is English.
const COPY = {
  de: {
    title: "So geht's los",
    intro: "Diese kurze Einführung zeigt dir die ersten Schritte und",
    introStrong: "verdoppelt deine Testzeit",
    dismiss: "Schliessen",
    congrats:
      "Gratuliere! Du kennst jetzt das Grundprinzip von Eduskript, und wir haben deine Testzeit verdoppelt.",
    manual: "Mehr erfahren? Zum Benutzerhandbuch",
    manualUrl: "https://eduskript.org/c/erste-schritte",
    nice: "Super",
    jump: "Zu diesem Schritt springen",
  },
  en: {
    title: "How to start",
    intro: "This quick intro explains how to get started and",
    introStrong: "doubles your trial time",
    dismiss: "Dismiss",
    congrats:
      "Congratulations! You now understand the basic idea of Eduskript and we doubled your trial time.",
    manual: "Want to go deeper? Read the User Manual",
    manualUrl: "https://eduskript.org/en/first-steps",
    nice: "Nice",
    jump: "Jump to this step",
  },
} as const;

const STEP_LABELS: Record<UiLocale, Record<QuestStep, string>> = {
  de: {
    place_skript: "Platziere dein erstes Skript",
    visit_public_page: "Besuche deine öffentliche Seite",
    return_to_builder: "Zurück zum Page Builder",
    open_page_editor: "Öffne ein Skript, um seine Seiten zu bearbeiten",
    rename_skript: "Benenne dein Skript um",
    view_pages: "Sieh dir die anderen Seiten an",
    edit_page_content: "Bearbeite eine Seite",
    view_via_eye_icon: "Seite mit dem Augen-Symbol ansehen",
    return_via_edit_link: "Zurück zum Seiten-Editor",
    use_ai_edit: "Mit AI Edit eine Seite hinzufügen",
  },
  en: {
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
  },
};

// Shown only for the active (next-incomplete) step.
const STEP_DESCRIPTIONS: Record<UiLocale, Record<QuestStep, React.ReactNode>> = {
  de: {
    place_skript:
      "Das ist dein Page Builder. Rechts in deiner Bibliothek liegt bereits ein erstes Skript. Zieh es auf deine Seite, damit es auf deiner öffentlichen Eduskript-Website erscheint.",
    visit_public_page:
      "Super. Schau dir jetzt deine öffentliche Seite an und prüfe, ob das Skript erscheint.",
    return_to_builder:
      "Du bist jetzt auf deiner öffentlichen Eduskript-Website. Das eben platzierte Skript siehst du in der Seitenleiste. Klick auf dein Profilbild, um zurück ins Dashboard zu kommen und deine Seite weiter auszubauen.",
    open_page_editor:
      "Klick auf den Namen des Skripts (Stift-Symbol), um zum Editor zu gelangen.",
    rename_skript:
      "Hier bearbeitest du ein Skript und seine Seiten. Gib diesem Skript zuerst einen Namen deiner Wahl.",
    view_pages:
      'Ein Skript besteht meist aus mehreren Seiten. Klick auf "Pages", um sie zu sehen, und wähle eine Seite zum Bearbeiten.',
    edit_page_content:
      'Bearbeite diese Seite nach Belieben und klick auf "Save", wenn du fertig bist.',
    view_via_eye_icon:
      "Mit dem Augen-Symbol siehst du die Seite direkt so, wie sie auf deiner öffentlichen Website erscheint.",
    return_via_edit_link:
      "Mit diesem Bearbeiten-Knopf kommst du direkt zurück in den Editor dieser Seite.",
    use_ai_edit:
      'Lass jetzt mit "AI Edit" die KI eine neue Seite für dich hinzufügen. Wünsch dir, was du willst, und teste die Grenzen!',
  },
  en: {
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
  },
};

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
  const locale = useUiLocale();
  const t = COPY[locale];
  const [state, setState] = useState<QuestState | null>(null);
  const [justGrantedBanner, setJustGrantedBanner] = useState(false);
  const [stepVideos, setStepVideos] = useState<
    Partial<Record<QuestStep, StepVideo>>
  >({});
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
      <Card className={`fixed bottom-4 right-4 z-50 w-80 ${DOCKED_PANEL_BORDER}`}>
        <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
          <PartyPopper className="w-8 h-8 text-primary" />
          <p className="font-medium text-sm">
            {t.congrats}
          </p>
          <a
            href={t.manualUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t.manual}
          </a>
          <Button
            size="sm"
            onClick={() => {
              setJustGrantedBanner(false);
              dismissQuest();
            }}
          >
            {t.nice}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.rewardGranted) return null;

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
              title={t.jump}
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
                {STEP_LABELS[locale][step]}
              </span>
            </div>
            {active && (
              <>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  {STEP_DESCRIPTIONS[locale][step]}
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
    <DockedPanel
      storagePrefix="quest"
      side="left"
      title={t.title}
      onClose={dismissQuest}
      closeTitle={t.dismiss}
      headerExtra={<UiLocaleSwitcher />}
    >
      <p className="text-xs text-muted-foreground mb-3 select-none">
        {t.intro}{" "}
        <strong className="text-foreground">{t.introStrong}</strong>.
      </p>
      {checklist}
    </DockedPanel>
  );
}

/**
 * "How do I …?" link that opens a contextual help clip in the docked
 * HelpVideoWidget. Used directly in dashboard UI and, via the <helpvideo>
 * markdown tag, in page content:
 *
 *   <HelpVideoLink topic="create-skript" />
 *   <helpvideo topic="create-skript">Wie erstelle ich ein neues Skript?</helpvideo>
 *
 * The label is the children, else HELP_TOPIC_TITLES[topic]; it doubles as
 * the panel title. See src/lib/help-videos/store.ts.
 */
"use client";

import type { ReactNode } from "react";
import { CirclePlay } from "lucide-react";
import { HELP_TOPIC_TITLES, openHelpVideo } from "@/lib/help-videos/store";
import { cn } from "@/lib/utils";

interface HelpVideoLinkProps {
  topic: string;
  children?: ReactNode;
  className?: string;
}

export function HelpVideoLink({ topic, children, className }: HelpVideoLinkProps) {
  const fallback = HELP_TOPIC_TITLES[topic] ?? topic;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Panel title: the link's visible text (children may be markdown
        // elements, so read it from the DOM rather than from the props).
        openHelpVideo(topic, e.currentTarget.textContent?.trim() || fallback);
      }}
      className={cn(
        "inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline cursor-pointer",
        className,
      )}
    >
      <CirclePlay className="w-[1em] h-[1em] shrink-0" aria-hidden />
      <span>{children ?? fallback}</span>
    </button>
  );
}

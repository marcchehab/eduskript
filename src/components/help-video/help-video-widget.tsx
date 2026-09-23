/**
 * Docked bottom-right panel playing the contextual help clip the viewer
 * opened via a HelpVideoLink (dashboard) or a <helpvideo> tag (page
 * markdown). Mounted once at the app root (providers.tsx), for every visitor;
 * renders nothing until a topic is open. Stays open across navigation until
 * closed with X — state in src/lib/help-videos/store.ts.
 */
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { DockedPanel } from "@/components/docked-panel";
import {
  closeHelpVideo,
  getOpenHelpVideo,
  getServerHelpVideo,
  subscribeHelpVideo,
} from "@/lib/help-videos/store";

// Same dynamic-import pattern as MuxVideo (src/components/markdown/mux-video.tsx).
const MuxPlayer = dynamic(
  () => import("@mux/mux-player-react").then((mod) => mod.default),
  { ssr: false },
);

type Clip = { playbackId: string; poster?: string; aspectRatio?: number };
type Load =
  | { topic: string; status: "ready"; clip: Clip }
  | { topic: string; status: "missing" };

export function HelpVideoWidget() {
  const open = useSyncExternalStore(subscribeHelpVideo, getOpenHelpVideo, getServerHelpVideo);
  const [load, setLoad] = useState<Load | null>(null);
  const topic = open?.topic;

  useEffect(() => {
    if (!topic) return;
    let cancelled = false;
    fetch(`/api/help-videos/${topic}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((clip: Clip | null) => {
        if (cancelled) return;
        setLoad(clip ? { topic, status: "ready", clip } : { topic, status: "missing" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ topic, status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [topic]);

  if (!open) return null;
  // Ignore a result that belongs to the previously open topic.
  const current = load?.topic === open.topic ? load : null;

  return (
    <DockedPanel
      storagePrefix="help-video"
      side="right"
      title={open.title}
      onClose={closeHelpVideo}
      // Sized for a 16:9 clip plus header rather than half the viewport.
      defaultHeight={() => Math.min(window.innerHeight, 340)}
      defaultWidth={480}
    >
      {!current && <p className="text-xs text-muted-foreground">Loading…</p>}
      {current?.status === "missing" && (
        <p className="text-xs text-muted-foreground">This video isn&apos;t available yet.</p>
      )}
      {current?.status === "ready" && (
        <MuxPlayer
          // Re-mount per topic so switching clips restarts playback cleanly.
          key={open.topic}
          playbackId={current.clip.playbackId}
          poster={current.clip.poster}
          style={{ aspectRatio: current.clip.aspectRatio ?? 16 / 9 }}
          className="w-full rounded-lg overflow-hidden"
          autoPlay="muted"
          muted
          playsInline
          disableTracking
        />
      )}
    </DockedPanel>
  );
}

/**
 * A floating card docked to the bottom edge of the viewport, shared by the
 * onboarding quest (bottom-left) and the contextual help-video panel
 * (bottom-right). Not a backdrop-blocking overlay — the page stays usable
 * underneath.
 *
 * The viewer can minimize it to a pill, drag it horizontally away from its
 * docked side, and resize it from the corner gizmo on the inner top corner
 * (top-right when docked left, top-left when docked right). Size, offset and
 * minimized state are per-device UI preferences in localStorage under
 * `eduskript:<storagePrefix>-*`. Closing (X) is the caller's business.
 */
"use client";

import { useRef, useState, type ReactNode } from "react";
import { Minus, MoveDiagonal2, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const DEFAULT_WIDTH = 448; // 28rem
const MIN_WIDTH = 256;

// Blue accent so the panel pops against the dashboard's neutral chrome.
export const DOCKED_PANEL_BORDER =
  "border-2 border-blue-400/70 dark:border-blue-500/60 shadow-xl shadow-blue-500/20";

function loadNumber(key: string, fallback: number, min: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= min) return n;
  } catch {
    // ignore
  }
  return fallback;
}

function save(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

interface DockedPanelProps {
  storagePrefix: string;
  side: "left" | "right";
  title: ReactNode;
  onClose: () => void;
  closeTitle?: string;
  // Extra controls in the header, left of minimize/close (e.g. a language switcher).
  headerExtra?: ReactNode;
  // Initial height before the viewer resizes; defaults to half the viewport.
  defaultHeight?: () => number;
  defaultWidth?: number;
  children: ReactNode;
}

export function DockedPanel({
  storagePrefix,
  side,
  title,
  onClose,
  closeTitle = "Close",
  headerExtra,
  defaultHeight = () => window.innerHeight / 2,
  defaultWidth = DEFAULT_WIDTH,
  children,
}: DockedPanelProps) {
  const keys = {
    minimized: `eduskript:${storagePrefix}-minimized`,
    height: `eduskript:${storagePrefix}-height`,
    width: `eduskript:${storagePrefix}-width`,
    xOffset: `eduskript:${storagePrefix}-x-offset`,
  };
  const [minimized, setMinimized] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(keys.minimized) === "1";
    } catch {
      return false;
    }
  });
  const [height, setHeight] = useState(() =>
    loadNumber(keys.height, typeof window === "undefined" ? 400 : defaultHeight(), 1),
  );
  const [width, setWidth] = useState(() => loadNumber(keys.width, defaultWidth, MIN_WIDTH));
  // Distance from the docked edge, in px, always >= 0.
  const [xOffset, setXOffset] = useState(() => loadNumber(keys.xOffset, 0, 0));
  const [isDragging, setIsDragging] = useState(false);
  const draggedRef = useRef(false);
  // +1 when moving the mouse right pushes the card away from its docked edge.
  const dir = side === "left" ? 1 : -1;

  const setMinimizedPersisted = (value: boolean) => {
    setMinimized(value);
    save(keys.minimized, value ? "1" : "0");
  };

  // Two-dimensional resize from the inner top corner gizmo. The bottom edge
  // is pinned to the viewport and the docked edge is anchored, so dragging UP
  // grows the height and dragging away from the docked side grows the width.
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
      h: Math.min(maxHeight, Math.max(120, startHeight + (startMouseY - ev.clientY))),
      w: Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + dir * (ev.clientX - startMouseX))),
    });

    const onMove = (ev: MouseEvent) => {
      const { h, w } = compute(ev);
      setHeight(h);
      setWidth(w);
    };
    const onUp = (ev: MouseEvent) => {
      const { h, w } = compute(ev);
      save(keys.height, String(h));
      save(keys.width, String(w));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Horizontal-only drag, clamped so the card can't leave the viewport.
  const handleXDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    // Without this, dragging over the title text selects it instead.
    e.preventDefault();
    const startMouseX = e.clientX;
    const startOffset = xOffset;
    const cardWidth =
      (e.currentTarget as HTMLElement).closest(".card-drag-root")?.getBoundingClientRect().width ??
      DEFAULT_WIDTH;
    const maxOffset = Math.max(0, window.innerWidth - cardWidth - 16);
    draggedRef.current = false;

    const offsetAt = (ev: MouseEvent) =>
      Math.min(maxOffset, Math.max(0, startOffset + dir * (ev.clientX - startMouseX)));

    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startMouseX) > 3 && !draggedRef.current) {
        draggedRef.current = true;
        // A body-level cursor override loses to elements' own cursor styles —
        // a full-viewport overlay guarantees the grabbing cursor. Deferred
        // until real movement so a plain click (e.g. expanding the minimized
        // pill) doesn't get eaten by the overlay.
        setIsDragging(true);
      }
      setXOffset(offsetAt(ev));
    };
    const onUp = (ev: MouseEvent) => {
      save(keys.xOffset, String(offsetAt(ev)));
      setIsDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const dragOverlay = isDragging && <div className="fixed inset-0 z-[60] cursor-grabbing" />;
  const dockClass = side === "left" ? "left-4" : "right-4";
  const transform = `translateX(${dir * xOffset}px)`;

  if (minimized) {
    return (
      <>
        {dragOverlay}
        <Card
          style={{ width: `${width}px`, maxWidth: "calc(100vw - 2rem)", transform }}
          className={`card-drag-root fixed bottom-0 ${dockClass} z-50 rounded-b-none cursor-grab active:cursor-grabbing hover:opacity-90 ${DOCKED_PANEL_BORDER}`}
          onMouseDown={handleXDragStart}
          onClick={() => {
            if (draggedRef.current) return;
            setMinimizedPersisted(false);
          }}
          title="Drag to move"
        >
          <CardContent className="py-2 pl-3 pr-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-foreground select-none truncate">{title}</span>
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
          transform,
        }}
        // No overflow-hidden here (the corner gizmo hangs outside the card);
        // CardContent below does its own overflow-y-auto scrolling.
        className={`card-drag-root fixed bottom-0 ${dockClass} z-50 rounded-b-none flex flex-col ${DOCKED_PANEL_BORDER}`}
      >
        <CardHeader
          className="group/header relative flex flex-row items-start justify-between gap-2 py-2 px-3 shrink-0 cursor-grab active:cursor-grabbing"
          onMouseDown={handleXDragStart}
        >
          <CardTitle className="text-sm font-bold text-foreground leading-tight select-none">
            {title}
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {headerExtra}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setMinimizedPersisted(true)}
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} title={closeTitle}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          {/* Resize gizmo: child of the header so hovering it keeps the
              header's :hover (only visible while hovering the top area). */}
          <button
            type="button"
            className={`absolute -top-3 ${side === "left" ? "-right-3 cursor-nesw-resize" : "-left-3 cursor-nwse-resize"} z-10 w-7 h-7 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center opacity-0 group-hover/header:opacity-100 transition-opacity duration-200`}
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          >
            <MoveDiagonal2 className={`w-4 h-4 ${side === "left" ? "rotate-90" : ""}`} />
          </button>
        </CardHeader>
        <CardContent className="px-3 pb-3 overflow-y-auto flex-1">{children}</CardContent>
      </Card>
    </>
  );
}

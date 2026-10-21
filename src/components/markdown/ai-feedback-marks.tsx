'use client'

/**
 * The image sent to the AI with its marks on top: a coloured dot per mark
 * (✓ correct, ✗ wrong, ~ vague) just right of the writing it refers to, and
 * the comment as a speech bubble below it (beside it would cover the next
 * column of work). Bubbles are hidden until the dot is hovered (or focused):
 * shown faintly all at once, they overlapped on dense work and covered it.
 *
 * @see src/lib/ai/feedback-marks.ts
 */

import type { FeedbackMark } from '@/lib/ai/feedback-marks'

const STYLE: Record<FeedbackMark['kind'], { symbol: string; dot: string; label: string }> = {
  correct: { symbol: '✓', dot: 'bg-green-600 text-white', label: 'Correct' },
  wrong: { symbol: '✗', dot: 'bg-red-600 text-white', label: 'Wrong' },
  vague: { symbol: '~', dot: 'bg-amber-500 text-black', label: 'Vague' },
}

export function AIFeedbackMarks({ image, marks }: { image: string; marks: FeedbackMark[] }) {
  return (
    <div className="relative mb-3 inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
      <img
        src={image}
        alt="Your work as sent to the AI"
        className="block max-h-[32rem] min-w-48 max-w-full rounded border border-border bg-white"
      />
      {marks.map((m, i) => {
        const s = STYLE[m.kind]
        // Dot right of the writing; near the right edge left of it; if the
        // writing spans (almost) the full width, inside its right end.
        const side = m.x2 < 0.9 ? 'right' : m.x1 > 0.1 ? 'left' : 'inside'
        const anchorX = side === 'left' ? m.x1 : m.x2
        // Bubble grows towards the larger free part of the image, so it stays
        // inside: leftwards in the right half, upwards in the bottom part.
        const bubbleLeft = anchorX > 0.5
        const bubbleUp = m.y2 > 0.75
        const y = (m.y1 + m.y2) / 2
        return (
          <div
            key={i}
            tabIndex={0}
            className={`group absolute z-10 -translate-y-1/2 outline-none hover:z-20 focus:z-20 ${side === 'right' ? 'pl-1' : '-translate-x-full pr-1'}`}
            style={{ left: `${anchorX * 100}%`, top: `${y * 100}%` }}
          >
            <span
              aria-label={s.label}
              className={`grid h-6 w-6 place-items-center rounded-full text-sm font-bold shadow ring-2 ring-white ${s.dot}`}
            >
              {s.symbol}
            </span>
            {m.text && (
              <span
                className={`absolute w-max max-w-[min(14rem,60vw)] rounded-md bg-neutral-900 px-2 py-1 text-xs leading-snug text-white pointer-events-none opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${bubbleUp ? 'bottom-7' : 'top-7'} ${bubbleLeft ? 'right-0' : 'left-0'}`}
              >
                {m.text}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

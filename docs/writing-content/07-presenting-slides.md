# Presenting a Page as Slides

Any page can double as a **slide deck** — no separate file, no special format. You write a normal page; Eduskript can project it full-screen, one slide at a time. The page source is the single source of truth: the same content reads as a scrolling page *or* presents as slides depending on how it's opened.

---

## Starting a presentation

Open a published page and click the **Present** button (the projector icon, next to the annotation toolbar at the bottom of the screen). The page goes full-screen and shows one slide at a time.

By default the Present button is shown to **teachers only** — presenting is a teaching action. To let students (and any visitor) present the page too, turn on **"Let anyone present this page as slides"** in the page editor (see [Making a presentation public](#making-a-presentation-public)).

The deck **opens on the slide you were scrolled to** — scroll to the section you want to start from, then hit Present.

Navigate with:

| Action | Keys | On-screen |
|--------|------|-----------|
| Next slide | `→` · `Space` · `Page Down` | chevron (right edge) |
| Previous slide | `←` · `Page Up` | chevron (right edge) |
| Exit | `Esc` | ✕ (top-right) |

Interactive components keep working inside a slide — code editors run, quizzes answer, videos play. Typing in an embedded code editor won't flip the slide.

---

## How slides are split

Slides are delimited by the markdown you already write — there's nothing new to learn for the basics:

| Marker | What it does | Shows on the page? |
|--------|--------------|--------------------|
| `# Heading` / `## Heading` | Starts a new slide (the heading leads the slide) | yes — a normal heading |
| `---` | Starts a new slide | yes — a horizontal rule |
| `---/` | Starts a new slide | **no** — invisible divider |
| `---x` | Ends the slide and **drops the following content from the deck** until the next break | no — the text still shows on the page |

So a page with `##` sections already presents sensibly with zero extra work. Reach for the others when you want finer control:

- **`---/`** — split into two slides *without* drawing a horizontal rule on the scrolling page.
- **`---x`** — keep long background prose on the page but leave it *off* the slides, so the deck stays tight. The excluded text reappears on the page (and resumes being deck-eligible) at the next `---`, `---/`, or heading.

> [!tip] Example
> ```markdown
> ## Photosynthesis
> The headline reaction…
>
> ---/
>
> ## Two stages
> - Light reactions
> - Calvin cycle
>
> ---x
>
> ### Teacher notes
> Long background reading that students read on the page but that
> shouldn't clutter the projected slides.
>
> ---
>
> ## Recap
> ```
> This is **four** slides (Photosynthesis · Two stages · Recap, plus anything before the first heading). The *Teacher notes* block is on the page but skipped in the deck.

Blank slides are never produced — a divider sitting right before a heading, or two dividers in a row, collapses away.

---

## Drawing on a slide

While presenting, use the **pen toolbar** at the bottom (same pens, colours, sizes, and eraser as the page annotation toolbar):

- Click a pen to draw; click it again to stop (so you can click through to the slide).
- Hover a pen for its **colour and size** popover.
- The eraser removes strokes; the trash icon clears the current slide.

Slide drawings are **local and temporary** — they live only for the duration of the presentation, are kept **per slide** (switch away and back and they're still there), and are **never saved**. They are completely separate from the page's annotation system.

---

## Zooming

The **zoom** control sits below the navigation chevrons on the right edge. Hover the magnifier icon to reveal a slider, then drag to enlarge or shrink the current slide — handy for making a diagram or code snippet readable from the back of the room.

---

## Making a presentation public

In the page editor, tick **"Let anyone present this page as slides"**. With it on, the Present button appears for every visitor, not just logged-in teachers. Leave it off (the default) to keep presenting a teacher-only action while the page itself stays publicly readable.

Exam pages don't offer presentation.

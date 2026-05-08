# Scrollenquiry — CSS `zoom` Experiment Page

This page exists to stress-test the CSS `zoom` swap on the `scrollenquiry` branch. The hypothesis is that with paper width fixed at 1280px, zoom-induced reflow either won't rewrap lines at all, or will only rewrap at certain fractional zoom levels in ways we can mitigate.

Read the protocol at the end before you start. Then come back up here and start zooming.

## What changed under the hood

The annotation layer used to apply `transform: scale()` on `<main>` and inject an invisible spacer div sibling to feed scrollable dimensions to the scroll container. That worked but felt non-native: scroll behavior was driven by the spacer, not by the content. We tried CSS `zoom` once (commit `6296d0e`) and reverted it (commit `9894d40`) because lines rewrapped mid-gesture and annotations went wiggly.

This branch retries `zoom` with paper width hard-locked at **1280px**. The question: does the rewrap still happen, or was it a perception artifact of an earlier paper-width state?

## Wide-range prose to flush out rewrap

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.

### Edge-case lines

The next paragraphs are deliberately constructed so a small width perturbation will visibly nudge a word onto the next line. Watch for this during zoom gestures.

A short sentence ending right around the right margin width like this one. Followed by another short sentence ending right around the right margin width like this one. And another short sentence ending right around the right margin width like this one.

Supercalifragilisticexpialidocious antidisestablishmentarianism pneumonoultramicroscopicsilicovolcanoconiosis floccinaucinihilipilification — long words near margins are the canaries.

## Headings, sub-sections, list density

### A subsection
- Bullet one with a moderate amount of text to fill a line and bleed slightly past it just to see the wrap point clearly.
- Bullet two, similar idea, watch its tail.
- Bullet three.
- Bullet four with a longer tail that should wrap onto two lines so we can verify list-marker alignment under zoom.

### Another subsection
1. Numbered item with a fair amount of text to set up a clear right-margin endpoint.
2. Second item — shorter.
3. Third item with enough text again to see right-margin behavior under zoom.

## Code block (no editor)

```python
def fibonacci(n: int) -> list[int]:
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]

print(fibonacci(15))
```

## Math block

The Gaussian integral, just to give KaTeX something to render:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

And inline math: $f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(0)}{n!} x^n$.

## Table

| Zoom | Expected behaviour | Watch for |
|------|--------------------|-----------|
| 1.00 | Identical to baseline | Nothing |
| 1.25 | Slight enlargement | Subpixel line shift |
| 1.50 | Comfortable reading | Annotation drift |
| 2.00 | Doubled | Native scroll feel |
| 0.75 | Compressed | Wrap at narrower width? |

## More prose to give vertical scroll room

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi.

Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.

Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.

---

# Testing Protocol

Run through the steps in order. Don't skip — earlier steps establish baselines for later ones.

## Setup
1. Hard-refresh the page in the browser to make sure you're on the new build (Ctrl+Shift+R).
2. Open DevTools → Performance tab in the background, but don't record yet — just be ready.
3. Resize the browser to **wider than 1280px** so the responsive `transform: scale()` rule on `.paper-responsive` doesn't engage. We want to isolate the zoom-gesture mechanism.

## Step 1 — Sanity at zoom 1.0
- Scroll the page top-to-bottom with the wheel. **Expectation:** smooth, native-feeling scroll. No jitter at top/bottom edges. Notice scroll position persists exactly as expected.
- Scroll back up. Verify line breaks haven't moved.
- ✅ Pass criterion: indistinguishable from any normal web page.

## Step 2 — Reflow detection (the critical test)
- Pick a paragraph in the **"Edge-case lines"** subsection above. Note exactly which word ends each line.
- Hold **Ctrl** and slowly scroll the wheel forward — zoom up gradually to ~1.5×. Watch the paragraph.
- ❓ **Question:** do words slide between lines mid-gesture? Even a single word jumping is a positive (the bug repro'd).
- Repeat zooming back down to 0.75×, then up to 3×. Same paragraph.
- ✅ Pass criterion: line breaks stay put across the entire zoom range.
- ⚠️ Failure criterion: any visible rewrap. If this happens, note **at which zoom value** the jump occurred (look at the zoom indicator if shown, or estimate).

## Step 3 — Native scroll under zoom
- Zoom to ~2.0×.
- Scroll vertically with the wheel (no Ctrl). **Expectation:** the page scrolls naturally; horizontal overflow scroll is also available if the paper exceeds viewport width.
- Try shift+wheel for horizontal scroll.
- ✅ Pass criterion: scrolling feels exactly like a normal long page. No translate jumps, no spacer behaviour.

## Step 4 — Annotation stability (the second critical test)
- Reset zoom to 1.0×.
- Switch to **draw mode** and draw a clear horizontal line under the heading **"Wide-range prose to flush out rewrap"**.
- Zoom to 1.25× via Ctrl+wheel. **Watch the drawn stroke.**
- ❓ Does it stay attached to the heading? Drift up/down? Wiggle while you zoom?
- Zoom to 0.75×, then 2.0×, then back to 1.0×.
- ✅ Pass criterion: stroke stays anchored under the heading, no visible drift, no per-frame wiggle.
- ⚠️ Failure criterion: stroke moves relative to the heading at any zoom step.

## Step 5 — Pinch zoom (touchscreen / trackpad)
- If you have a trackpad: pinch to zoom in and out. Watch for the same rewrap and annotation drift behaviours.
- If you have a touchscreen device: open the page there too and pinch.
- ✅ Pass criterion: same as steps 2 & 4, but with a continuous gesture instead of discrete wheel ticks.

## Step 6 — Focal point correctness
- Zoom 1.0×. Place cursor over a specific word (e.g., "fibonacci" in the code block).
- Ctrl+wheel zoom in. **Expectation:** that word stays roughly under the cursor.
- ✅ Pass criterion: focal point math is preserved (this matches the old behaviour — would only break if I miscopied the algebra).

## Step 7 — Reset
- Click the zoom-reset button (or whatever surfaces resetZoom).
- ✅ Pass criterion: snaps to 1.0× and scrolls to top. No leftover zoom state on `<main>`.

## Step 8 — Annotation regression sweep
- Draw three strokes at 1.0×: one near the top, one middle, one near the bottom.
- Zoom to 1.5×, scroll the page, draw a fourth stroke.
- Zoom back to 1.0×. All four strokes should be in their drawn positions relative to the page content.

---

## Reporting back

After running the protocol, tell me:
1. Step 2 result — did line breaks stay put?
2. Step 4 result — did annotations drift?
3. Anything else that felt worse than the current `transform: scale()` setup.

If steps 2 and 4 both pass, we have a winner and can clean up the experiment marker. If either fails, we move to the next idea (anchor annotations to paper-space and accept rewrap, or hybrid scale-during-gesture commit-on-end).


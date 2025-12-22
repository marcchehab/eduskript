# Cross-Device Annotation Positioning Research

## Problem Statement

Annotations drawn on one device may not align correctly on another device because:
- Text reflows differently at different viewport widths
- Line breaks occur at different word boundaries
- Current repositioning only handles Y-axis (section-based) and padding changes, not horizontal text reflow

**Goal**: Make annotations match horizontally across devices, regardless of viewport size.

---

## Current Implementation

### Architecture Overview
- Paper element: `#paper.paper-responsive` with responsive padding
- Canvas: Portaled with `position: absolute; inset: 0`
- Transform: `<main>` has `scale(zoom) translate(panX, panY)`
- See: [POSITIONING.md](../POSITIONING.md) for full details

### Current Responsive Behavior
```css
.paper-responsive {
  max-width: 1280px;
  @apply px-48;  /* 192px padding at large screens */
}

@media (max-width: 1280px) { @apply px-32; } /* 128px */
@media (max-width: 1024px) { @apply px-16; } /* 64px */
@media (max-width: 768px)  { @apply px-8; }  /* 32px */
```

**Result**: Text width varies from ~640px (mobile) to ~1088px (desktop)

### Current Repositioning Algorithm (`reposition-strokes.ts`)
- **Y-axis**: Section-based anchoring with `sectionId` + `sectionOffsetY`
- **X-axis**: Only adjusts for padding differences: `deltaX = currentPaddingLeft - oldPaddingLeft`
- **Limitation**: Doesn't handle text reflow within a section

---

## Research Findings

### Approach 1: Fixed Width + Scale Transform

**Concept**: Render content at a fixed width (e.g., 800px), then scale the entire paper element to fit the viewport. This ensures identical line breaks on all devices.

**Implementation**:
```css
#paper {
  width: 800px;  /* Fixed width */
  transform: scale(var(--paper-scale));
  transform-origin: top center;
}
```

```javascript
// Calculate scale factor
const paperScale = Math.min(1, viewportWidth / 800);
document.documentElement.style.setProperty('--paper-scale', paperScale);
```

**Visual**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Desktop (1200px viewport)                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Paper (800px × 1.0 scale = 800px)                              │    │
│  │  Text wraps at exactly the same positions                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────┐
│  Mobile (400px viewport)              │
│  ┌─────────────────────────────┐      │
│  │  Paper (800px × 0.5 scale)  │      │
│  │  Same text, scaled down     │      │
│  └─────────────────────────────┘      │
└───────────────────────────────────────┘
```

**Pros**:
- ✅ **Identical line breaks** on all devices
- ✅ Annotations always align with content
- ✅ Simple to implement (CSS transform only)
- ✅ Already have zoom/pan infrastructure

**Cons**:
- ❌ Text becomes small on mobile (800px content in 400px viewport = 50% scale)
- ❌ May need pinch-to-zoom to read on phones
- ❌ Loss of responsive typography benefits
- ❌ Feels like "zoomed out" rather than "mobile-friendly"

**Mitigation**: Could allow user to toggle between "annotation mode" (fixed width, scaled) and "reading mode" (responsive). Or use a smaller fixed width (e.g., 600px) that scales better.

---

### Approach 2: Responsive Font Sizes Per Device Class

**Concept**: Define "sane default font sizes" for different screen size buckets, assuming most users at each size use similar devices.

**Implementation**:
```css
:root {
  --base-font-size: 19px;
  --content-width: 800px;  /* Target line width in characters */
}

/* Desktop: larger viewport, keep normal size */
@media (min-width: 1024px) {
  --base-font-size: 19px;
  --content-max-width: 880px;  /* ~70-80 chars per line */
}

/* Tablet: medium viewport */
@media (min-width: 768px) and (max-width: 1023px) {
  --base-font-size: 17px;
  --content-max-width: 700px;  /* Adjust to match character count */
}

/* Mobile: narrow viewport */
@media (max-width: 767px) {
  --base-font-size: 15px;
  --content-max-width: 360px;  /* Full width minus padding */
}
```

**Problem**: Even with "sane defaults", line breaks still vary because:
- Same font renders differently on iOS vs Android vs Windows
- Browser text rendering engines differ
- User zoom settings affect layout
- System font substitution changes metrics

**Verdict**: ❌ Doesn't solve the core problem - line breaks will still differ across devices.

---

### Approach 3: Normalized Coordinates (PDF.js Style)

**Concept**: Store annotation coordinates as percentages of content dimensions, not absolute pixels.

**How PDF.js Does It**:
- PDFs have fixed page dimensions (e.g., 612×792 points for Letter)
- Annotations stored in PDF coordinate space
- Viewer scales everything proportionally
- Text layer aligned via CSS transforms

**For Eduskript**:
```typescript
interface NormalizedStroke {
  points: Array<{
    xRatio: number  // 0-1, percentage of content width
    yRatio: number  // 0-1, percentage of section height
  }>
  sectionId: string
}

// On save
const xRatio = point.x / contentWidth
const yRatio = (point.y - sectionTop) / sectionHeight

// On render
const x = xRatio * currentContentWidth
const y = sectionTop + (yRatio * currentSectionHeight)
```

**Problem**: This works for PDFs because content dimensions are fixed. For reflowing HTML content:
- Section heights change when text wraps differently
- Normalizing Y within a section doesn't help if the section is taller/shorter
- X normalization only works if content width is consistent

**Verdict**: ⚠️ Partial solution - helps with padding changes but not text reflow.

---

### Approach 4: Character-Based Anchoring

**Concept**: Instead of pixel coordinates, anchor annotations to specific text ranges (like comments in Google Docs).

**Implementation**:
```typescript
interface TextAnchoredAnnotation {
  startOffset: number    // Character offset from section start
  endOffset: number      // Character offset for end
  drawing: StrokeData[]  // The actual strokes, relative to anchor
  anchorY: 'top' | 'center' | 'bottom'  // Vertical alignment to text
}
```

**How it would work**:
1. When user draws near text, find the closest text node
2. Calculate character offset within that text node
3. Store annotation relative to that text anchor
4. On render: find text node → get bounding rect → position strokes

**Pros**:
- ✅ Annotations follow text regardless of reflow
- ✅ Works like Google Docs comments

**Cons**:
- ❌ Major architectural change (strokes become text-anchored)
- ❌ Doesn't work for freeform annotations away from text
- ❌ Complex hit detection for what text an annotation belongs to
- ❌ Non-trivial to implement reliably

**Verdict**: ⚠️ Good for text highlights, overkill for freeform drawing.

---

### Approach 5: Fixed Content Width with User Zoom (Recommended Hybrid)

**Concept**: Use a fixed content width for annotation consistency, but let users zoom to their preferred reading size.

**Implementation**:

1. **Fixed paper width** (not scaled, just fixed):
```css
#paper {
  width: 800px;  /* Fixed width - annotations always match */
  margin: 0 auto;
  overflow-x: auto;  /* Allow horizontal scroll on small screens */
}
```

2. **User-controlled zoom** (already implemented):
- Users can pinch-zoom to read comfortably
- Annotations scale with content
- Zoom is saved per user preference

3. **Viewport-aware initial zoom**:
```javascript
// On page load, set zoom based on viewport
const optimalZoom = Math.min(1, (viewportWidth - padding) / 800);
setInitialZoom(optimalZoom);
```

4. **"Reading mode" toggle** (optional):
- Reading mode: Responsive width, better for consumption
- Annotation mode: Fixed width, perfect annotation alignment
- Toggle in toolbar

**Pros**:
- ✅ Annotations always match (fixed width)
- ✅ Users can zoom to comfortable size
- ✅ Leverages existing zoom infrastructure
- ✅ Progressive enhancement (reading mode optional)

**Cons**:
- ⚠️ Horizontal scroll on narrow viewports at 100% zoom
- ⚠️ May feel less "native" on mobile
- ⚠️ Reading mode toggle adds complexity

---

## Comparison: PDF.js vs Figma/Miro

| Aspect | PDF.js | Figma/Miro | Eduskript |
|--------|--------|------------|-----------|
| Content | Fixed PDF dimensions | Infinite canvas | Reflowing HTML |
| Rendering | Canvas + CSS layers | WebGL/WASM | HTML + Canvas overlay |
| Coordinates | PDF points (fixed) | Logical canvas units | Pixels (variable) |
| Cross-device | Scale everything | Scale everything | Section-based reposition |

**Key insight**: Tools with perfect cross-device alignment (PDF viewers, Figma) all use **fixed coordinate spaces** that scale. They don't try to reposition annotations across different layouts.

---

## Recommendation: Tablet-First Fixed Paper Width

### Core Insight
Assume minimum device for annotation is a **tablet (~768px)**. Use this as the reference "paper width" that all devices scale to.

### Implementation Strategy

**1. Fixed Paper Width (No Responsive Padding)**
```css
.paper-responsive {
  width: 768px;  /* Fixed - matches tablet viewport */
  max-width: 768px;
  padding: 48px;  /* Fixed padding, same on all devices */
  margin: 0 auto;
}

/* Remove all @media breakpoints for paper padding */
```

**2. Device Behavior**
| Device | Viewport | Paper Behavior |
|--------|----------|----------------|
| Phone (<768px) | ~400px | Paper scaled down via pinch-zoom or CSS scale. Annotation use case is rare. |
| Tablet (768px-1024px) | ~768px | Paper at 100%, fills viewport. Primary annotation device. |
| Desktop (>1024px) | ~1200px+ | Paper at 768px, centered. Sidebar floats/fixed on left. |

**3. Sidebar Behavior (Existing)**
- **Collapsed**: Sidebar ~64px, floating over content
- **Expanded**: Sidebar ~320px, pushes content (but paper stays 768px)
- On tablets: Sidebar collapses by default
- On desktop: Sidebar can expand without affecting paper width

**4. Why NOT Store as Percentages**
- Percentage coordinates require conversion on every render
- Y-axis percentages don't help (section heights still vary)
- Existing pixel coordinates + section-based repositioning works
- Fixed paper width means **no horizontal conversion needed**

**5. What Changes**
- Remove responsive padding breakpoints from `.paper-responsive`
- Set fixed width: 768px (or 800px for rounder number)
- Keep existing Y-axis repositioning (`sectionId` + `sectionOffsetY`)
- Keep existing padding-based X repositioning (now simpler - padding is fixed)

**6. What Stays the Same**
- Annotation coordinates stored as absolute pixels
- Section-based Y repositioning algorithm
- Pinch-zoom for users who want larger text
- Font size preference (affects section heights, repositioning handles it)

### Trade-offs Accepted
- ✅ Annotations align horizontally on all devices (fixed paper width)
- ✅ Simple implementation (mostly CSS changes)
- ✅ Leverages existing repositioning for Y-axis
- ⚠️ Phones see scaled-down content (acceptable - who annotates on phones?)
- ⚠️ Desktop has "wasted" space (but sidebar uses it)

### Future Enhancement: Reading Mode Toggle
If users want responsive text on desktop for better reading:
- Add toggle: "Annotation mode" (fixed 768px) vs "Reading mode" (responsive)
- Reading mode hides teacher annotations or shows warning about alignment

---

## Files to Modify (if implementing fixed width)

1. **`src/app/globals.css`**
   - Change `.paper-responsive` from responsive to fixed width
   - Remove media query breakpoints for paper padding

2. **`src/components/annotations/annotation-layer.tsx`**
   - Calculate initial zoom based on viewport width
   - Apply viewport-based zoom on mount

3. **`POSITIONING.md`**
   - Update documentation to reflect fixed-width architecture

4. **`CLAUDE_ROADMAP.md`**
   - Document the decision and rationale

---

## Open Questions

1. What fixed width would work best? Options:
   - **800px**: Good balance, ~50% scale on 400px mobile
   - **600px**: Better mobile experience, may feel cramped on desktop
   - **1000px**: Better desktop experience, very small on mobile

2. Should we implement a "reading mode" toggle, or just use fixed width everywhere?

3. Is horizontal scroll acceptable on narrow viewports at 100% zoom?

---

## Sources

- [CSS-Tricks: Scaled/Proportional Content](https://css-tricks.com/scaled-proportional-blocks-with-css-and-javascript/)
- [HackerNoon: Viewport Units for Fixed Layouts](https://hackernoon.com/using-viewport-units-to-scale-fixed-layouts-869638bb91f9)
- [PDF.js Layer Architecture](https://blog.react-pdf-dev/understanding-pdfjs-layers-and-how-to-use-them-in-reactjs)
- [MDN: CSS Transform Scale](https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/scale)
- [Normalize.css for Cross-Browser Consistency](https://www.geeksforgeeks.org/css/normalize-css/)

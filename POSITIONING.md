# Positioning & Coordinate Systems in Eduskript

This document explains how positioning and coordinate transformations work in the Eduskript annotation system, particularly with zoom and pan transforms.

## Overview

The annotation layer uses CSS transforms for zoom and pan, which creates multiple coordinate spaces that need careful handling. Understanding these coordinate spaces is crucial for implementing features that interact with the page.

## The Main Transform

The `<main>` element (containing the page content) has a CSS transform applied:

```typescript
mainRef.current.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`
mainRef.current.style.transformOrigin = 'top center'
```

This transform affects **everything** inside the main element, including:
- The paper/content
- The annotation canvas
- Overlays (even with `position: fixed`)
- Snaps and other absolutely positioned elements

## Critical CSS Quirk: Fixed Positioning in Transformed Containers

**Important:** When an element has `position: fixed` inside a parent with CSS transforms, it **does not** position relative to the viewport. Instead, it positions relative to the transformed ancestor.

This means an overlay with `position: fixed; inset: 0` inside a scaled element:
- Will NOT cover the entire viewport
- Will be affected by the parent's transform
- Needs special coordinate handling

## Coordinate Spaces

### 1. Viewport Coordinates
- What you get from mouse events: `e.clientX`, `e.clientY`
- Relative to the browser viewport
- Not affected by CSS transforms

### 2. Screen/Transformed Coordinates
- What `getBoundingClientRect()` returns on transformed elements
- Includes the zoom transform
- If zoom is 1.5x, a 100px element has `rect.width = 150`

### 3. Logical Coordinates
- The "natural" size before transforms
- For canvas: the internal width/height
- For overlays: coordinates divided by zoom

## How the Annotation Canvas Handles Zoom

The annotation canvas uses a two-tier coordinate system:

```typescript
// Canvas has fixed logical size
const width = 800  // logical pixels
const height = 1200

// But displayed size changes with zoom
const rect = canvas.getBoundingClientRect()
// When zoomed 1.5x: rect.width = 1200, rect.height = 1800

// Convert viewport coordinates to logical coordinates
const x = (e.clientX - rect.left) * (width / rect.width)
const y = (e.clientY - rect.top) * (height / rect.height)
```

The scaling factor `(width / rect.width)` accounts for zoom:
- No zoom (1.0): `(800 / 800) = 1.0` - no scaling needed
- Zoomed 1.5x: `(800 / 1200) = 0.667` - scale down by 1/zoom
- Zoomed 0.5x: `(800 / 400) = 2.0` - scale up by 1/zoom

## How the Snap Overlay Handles Zoom

The snap overlay is `position: fixed; inset: 0` but is inside the transformed main element, so it needs special handling:

### Mouse Event Handling

```typescript
const handleMouseDown = useCallback((e: React.MouseEvent) => {
  const rect = overlayRef.current?.getBoundingClientRect()

  // Divide by zoom to get logical coordinates
  setStartPos({
    x: (e.clientX - rect.left) / zoom,
    y: (e.clientY - rect.top) / zoom
  })
}, [zoom])
```

**Why divide by zoom?**
- Mouse events give viewport coordinates
- The overlay is inside a scaled container
- We want logical positions that will be automatically scaled by the browser's transform

### Drawing the Selection Rectangle

The selection rectangle uses the logical coordinates directly:

```typescript
<div
  style={{
    left: selectionRect.left,  // logical coordinates
    top: selectionRect.top,
    width: selectionRect.width,
    height: selectionRect.height
  }}
/>
```

The browser's transform will automatically scale this to appear at the correct screen position.

### Converting for Screenshot Capture

When capturing a screenshot, we need **screen coordinates** (not logical):

```typescript
// Convert to screen coordinates for screenshot
const selectionLeft = (left * zoom) + overlayRect.left - paperRect.left
const selectionTop = (top * zoom) + overlayRect.top - paperRect.top
const screenWidth = width * zoom
const screenHeight = height * zoom

// Use these for cropping the canvas
ctx.drawImage(
  canvas,
  selectionLeft * scale,
  selectionTop * scale,
  screenWidth * scale,
  screenHeight * scale,
  ...
)
```

### Converting for Snap Positioning

When positioning the snap, we need **logical coordinates** because snaps are inside the zoomed container:

```typescript
// For snap positioning: use logical coordinates
const logicalTop = top + (overlayRect.top - paperRect.top) / zoom
const logicalCenterY = logicalTop + (height / 2)

const snap: Snap = {
  id: Date.now().toString(),
  name: `snap${nextSnapNumber}`,
  imageUrl,
  top: logicalCenterY,  // logical position
  width,
  height
}
```

**Why logical coordinates?**
- Snaps are absolutely positioned inside the main element
- The main element is transformed with `scale(zoom)`
- Logical coordinates will be automatically scaled by the browser

## Summary Rules

### When to use LOGICAL coordinates (divide by zoom):
- ✅ Positioning elements inside the zoomed container (snaps, overlays)
- ✅ Storing coordinates from mouse events on transformed elements
- ✅ Drawing on the selection overlay

### When to use SCREEN coordinates (multiply by zoom):
- ✅ Capturing screenshots (working with rendered pixels)
- ✅ Converting between overlay and paper for pixel-level operations
- ✅ Calculating bounding boxes for rendering

### General Pattern

```typescript
// Getting mouse input - convert to logical
const logicalX = (e.clientX - rect.left) / zoom
const logicalY = (e.clientY - rect.top) / zoom

// Positioning inside zoomed container - use logical directly
element.style.top = `${logicalY}px`

// Screenshot operations - convert to screen
const screenX = logicalX * zoom
const screenY = logicalY * zoom
```

## Testing Zoom Behavior

When implementing features that interact with the page:

1. **Test at zoom 1.0** - should work normally
2. **Test at zoom 1.5** - should align correctly when zoomed in
3. **Test at zoom 0.5** - should align correctly when zoomed out
4. **Test with pan** - should work correctly when content is panned

If coordinates are offset when zoomed, you're likely mixing logical and screen coordinates incorrectly.

## Common Pitfalls

❌ **Using screen coordinates for positioning inside zoomed container**
```typescript
// Wrong - this will be offset at zoom != 1.0
snap.top = (mouseY * zoom) + offset
```

✅ **Using logical coordinates**
```typescript
// Correct - browser will apply zoom transform
snap.top = mouseY + offset / zoom
```

❌ **Forgetting to account for zoom in getBoundingClientRect()**
```typescript
// Wrong - rect already includes zoom
const pos = rect.top
```

✅ **Converting rect coordinates properly**
```typescript
// Correct - divide by zoom to get logical position
const logicalPos = rect.top / zoom
```

## Related Files

- `src/components/annotations/annotation-layer.tsx` - Main zoom/pan transform (line 921)
- `src/components/annotations/simple-canvas.tsx` - Canvas coordinate scaling (lines 350-351, 395-396)
- `src/components/annotations/snap-overlay.tsx` - Snap overlay coordinate handling (lines 38-43, 55-56, 116-124)
- `src/components/annotations/snaps-display.tsx` - Snap positioning (line 114)

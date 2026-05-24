# Pin test — multiple &lt;stickme&gt; + content types

Scroll down slowly. Only **one** element should be pinned to the right margin at
a time — each later one takes over the slot from the previous, and scrolling
back up hands it back.

## 1) YouTube — coupled + pinned

The video pauses at 0:05 until you answer the question, and pins to the margin.

<youtube id="dQw4w9WgXcQ" coupled="true" pin="true" />

<question id="q1" type="single" gate-at="0:05">
<answer correct="true">HyperText Markup Language</answer>
<answer correct="false">Hot Mango Tea Latte</answer>
</question>

Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.

## 2) Image in &lt;stickme&gt;

When this image's top reaches the viewport top it pins — and the YouTube video
above should un-pin (hand-off).

<stickme id="image">
![A thumbnail image](https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg)
</stickme>

Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.

## 3) Generic content (callout) in &lt;stickme&gt;

This generic callout takes over the pinned slot from the image.

<stickme id="card">
> [!info] Pinned reference card
> Plain markdown — a callout — pinned to the margin and resizable.
</stickme>

Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.

## 4) Mux video — non-16:9 (≈square)

Tests that the pin handles a non-16:9 aspect (handle stays at the real corner).

<muxvideo src="demo.mp4" alt="Mux (non-16:9)" pin="true" />

Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.

## 5) Mux video — 16:9

<muxvideo src="wide.mp4" alt="Mux (16:9)" pin="true" />

Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.
Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler. Filler.

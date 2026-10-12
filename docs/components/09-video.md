# Video

Video without the YouTube tax — no ads, no recommendation rabbit hole, no "your video is unavailable in your region." Eduskript encodes and hosts your videos itself, on servers in Switzerland: adaptive streaming on every device, auto-generated subtitles, and students' browsers only talk to Swiss servers when they watch.

---

## Upload and embed

Drop an `.mp4` or `.mov` file into your skript's **Videos** drawer. It is encoded for adaptive streaming — the videos list shows "queued" and then the progress in percent until it is ready (roughly a fifth of the video's length for a 1080p source, longer when other videos are ahead in the queue). If processing fails, the list shows the reason and a **Retry** button.

**Limits:** up to 1080p (1920×1080, portrait or landscape), 2 GB per file, 2 hours. Bigger videos are refused before uploading — export them at 1080p first. Phone videos (HEVC, rotated, variable frame rate) are fine.

Once ready, embed it in markdown like an image:

```markdown
![A short caption](my-lecture.mp4)
```

The video player gets:
- Poster (preview frame)
- Play / pause / scrubber with preview thumbnails when you hover or drag
- Volume
- Captions toggle (auto-generated subtitles)
- Settings: quality (Auto, 1080p, 720p, 480p) and playback speed
- Fullscreen
- Keyboard: space/K play, ←/→ seek 5 s, F fullscreen, M mute, C captions

All automatically. No configuration needed for any of it.

---

## Custom thumbnails (posters)

By default, the poster is the very first frame of the video — which is often a black frame or a logo. Pick a better one by adding a markdown image-title:

```markdown
![](lecture.mp4 "thumbnail.jpg")
```

The poster value can be:
- A **filename** of an image you've uploaded to the same skript (resolved like any other image)
- An **absolute URL** (`https://...`) — used as-is

The same thing in HTML:

```markdown
<muxvideo src="lecture.mp4" poster="thumbnail.jpg" />
```

Both syntaxes converge on the same player. If you don't specify a poster, the auto-generated thumbnail is used as a fallback.

---

## Auto-generated subtitles

Every uploaded video is transcribed automatically while it is encoded (Whisper, run by Infomaniak in Switzerland; the spoken language is detected, e.g. German or English). Students toggle them on with the captions button on the player. Videos without speech get no subtitles.

---

## Inline playback flags

Two flags in the alt text change playback behavior:

```markdown
![autoplay loop](background-video.mp4 "preview.jpg")
```

- `autoplay` — start playing on page load (muted, browser policy)
- `loop` — restart automatically when finished

Useful for short demo loops in the page background, intro animations, or visual hooks at the top of a lesson.

---

## Adaptive streaming, every device

Each upload is encoded into quality renditions 1080p (for 1080p sources), 720p and 480p (fewer if the source is smaller). The player picks the right one based on the student's connection and the player size; students can also pick one in the settings menu. The download in the skript export is the 720p version.

---

## When to use video, when not to

> [!tip] Video shines for
> - Step-by-step walkthroughs of complex procedures
> - Lab demonstrations that can't be replicated digitally
> - Instructor introductions for online/hybrid courses
> - Anything that's genuinely a sequence of motions you need to *see*

> [!warning] Video doesn't shine for
> - Static "talking head explains a concept" — text + diagrams + an interactive demo are usually more engaging *and* easier to update later
> - Code walkthroughs — a live `python editor` (where the student can pause, edit, run) beats watching someone type
> - Anything you might need to fix later — editing video takes 100x longer than editing markdown

---

## Cost and storage

Video hosting is included in paid plans. Importing a video from another skript (the **Import** button in the Videos drawer) reuses the stored video instead of uploading it again.

---

## Video cheat sheet

| Goal | Syntax |
|------|--------|
| Embed an uploaded video | `![Caption](filename.mp4)` |
| Custom poster from skript files | `![](filename.mp4 "thumbnail.jpg")` |
| Custom poster from URL | `![](filename.mp4 "https://example.com/thumb.jpg")` |
| Autoplay + loop (silent background) | `![autoplay loop](bg.mp4 "preview.jpg")` |
| Direct HTML form | `<muxvideo src="x.mp4" poster="thumb.jpg" />` |

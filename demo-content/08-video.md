# Video

Video without the YouTube tax — no ads, no recommendation rabbit hole, no regional blocks. Hosted via [Mux](https://mux.com): adaptive streaming on every device, auto-generated English subtitles.

---

## Upload and embed

Drop an `.mp4` or `.mov` into your skript's **Videos** drawer. Mux processes it (~1-2 min). Once ready, embed like an image:

```markdown
![A short caption](my-lecture.mp4)
```

You get: poster, play/pause, scrubber, volume, captions toggle, fullscreen, adaptive quality selection. All automatic.

---

## Custom posters

Default poster = first frame (usually black). Pick a better one via the markdown image-title:

```markdown
![](lecture.mp4 "thumbnail.jpg")
```

Or direct HTML:

```markdown
<muxvideo src="lecture.mp4" poster="thumbnail.jpg" />
```

The poster value can be a filename from your skript's files, or an absolute URL.

---

## Playback flags

```markdown
![autoplay loop](background.mp4 "preview.jpg")
```

`autoplay` → start on page load (muted, browser policy). `loop` → restart on end. Useful for short demo loops.

---

## When to use video

> [!tip] Good for
> Step-by-step walkthroughs. Lab demonstrations that can't be replicated digitally. Instructor intros for online/hybrid courses.

> [!warning] Skip video for
> Talking-head explanations (text + diagrams + interactive demo usually wins). Code walkthroughs (a `python editor` beats watching someone type). Anything you'll need to edit later.

---

## Cheat sheet

| Goal | Syntax |
|------|--------|
| Embed | `![Caption](file.mp4)` |
| Custom poster from skript files | `![](file.mp4 "thumbnail.jpg")` |
| Autoplay loop (silent background) | `![autoplay loop](bg.mp4 "preview.jpg")` |
| HTML form | `<muxvideo src="x.mp4" poster="thumb.jpg" />` |

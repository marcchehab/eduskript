# Publish and Share

Three states control who can see content: **draft**, **published**, and **unlisted**. The state lives at the page and skript level (collections are just organizers — they don't have a publish state of their own). Most of the time you'll just toggle Publish and move on — but here's the full picture for when you need it.

---

## The three states

| State | Visible to | Listed in navigation | Use case |
|-------|-----------|---------------------|----------|
| **Draft** | Only you (and collaborators with edit rights) | No | Work in progress |
| **Published** | Everyone | Yes | Ready for students |
| **Unlisted** | Anyone with the link | No | Hidden practice exercises, easter eggs, links from a class chat |

Drafts are completely private. Published pages show up in your skript's table of contents, in your collection's index, and on your front page. Unlisted pages skip all of that — you have to know the URL.

> [!example] When unlisted shines
> - A second-attempt practice exercise that should only be reachable from a "try harder" link
> - A skript you're field-testing with a small group before unveiling it
> - "Solution" pages that you only link to from the question page
> - A draft you want a colleague to review without making it public

---

## Publishing at two levels

Publishing happens at the **page** and **skript** level — independently. Collections are purely organizational containers; they don't have their own publish state.

```
Collection (organizational only — no publish state)
 ├── Skript A (published)
 │    ├── Page 1 (published)  ← visible
 │    ├── Page 2 (draft)      ← invisible
 │    └── Page 3 (unlisted)   ← invisible in nav, visible by URL
 │
 └── Skript B (draft)         ← entire skript invisible regardless of pages
```

A page is only publicly visible if **the page** AND **its skript** are both published. You can take a whole skript offline temporarily by toggling its publish status, without touching any individual page.

> [!warning] Common gotcha
> A published page inside a draft skript is **not** visible. Students get a 404. When launching new content, publish from the bottom up: pages first, then the skript. To take content offline, flip the skript to draft — every page inside disappears at once.

---

## How to publish

Three places to toggle the state:

1. **Top toolbar of the page editor** — the Publish dropdown
2. **Page list in the manage drawer** — quick toggle next to each page
3. **Page builder dashboard** — bulk view, drag-and-drop reorder, batch toggles

For skripts, use the skript editor or the dashboard.

In the page list, the state is shown as `(draft)` or `(unlisted)` after the title. Published pages show no marker — they're the default expectation.

---

## Sharing with students

URLs are stable and shareable. Once you've got a published page at `eduskript.org/<slug>/<col>/<skript>/<page>`, share that URL anywhere:

- **Email** — paste the link
- **LMS** (Canvas, Moodle, Schoology, etc.) — add as an external link
- **Class chat** (Discord, Slack, Teams) — paste, get a preview card with title + description
- **Printed handout** — generate a QR code from any free service

The **share icon** in the page toolbar copies the URL to your clipboard. You can also click any heading in the rendered page to copy a link directly to that heading.

---

## Anchor links

Every heading has an automatic ID derived from the heading text. Click a heading in your published page → URL gets a `#anchor-name` fragment.

```
eduskript.org/marie/intro-stats/descriptive/measures#mean-and-median
                                                    ↑ anchor link
```

When you change a heading's text, its anchor changes too. Old anchor links still land on the page (no 404), but they don't auto-scroll to the right place. So if you rename a heading after sharing the link, students get the page but not the section.

> [!tip] Stable anchors for important sections
> If you know you'll link to a specific section repeatedly (e.g. from a syllabus), pin the heading text early and don't change it.

---

## OG previews when shared on social

Eduskript generates Open Graph metadata automatically:

- **Title** — your page title
- **Description** — your page description, or auto-extracted excerpt
- **Image** — your page's OG image (set in page settings) or your default front-page OG image

So when someone pastes your link into Slack, Discord, Twitter, etc., they get a preview card. Same for messaging apps that respect OG.

---

## Updating published content

Save and the changes are live — no need to re-publish. Eduskript doesn't have a "stage" environment for published content; the published version IS the live version.

If you want a sandbox to work in before going live, do one of:

1. **Keep it as a draft** until ready, then toggle to published in one go
2. **Use a separate "drafts" skript** for in-progress work, move pages into the live skript when done
3. **Fork your own skript** as a sandbox copy, edit there, then copy changes back

Most teachers find option 1 sufficient.

---

## Taking content offline

Toggle published → draft. The page disappears immediately. Students hitting the URL see "Page not found." If you want to leave a redirect or a "this content has been retired" message, use a published page with that note instead of fully unpublishing.

---

## Publishing cheat sheet

| Goal | Where |
|------|-------|
| Toggle a page draft/published | Top toolbar of page editor → Publish dropdown |
| Mark a page as unlisted | Same dropdown → Unlisted |
| Bulk-toggle pages in a skript | Page editor's Manage → page list |
| Publish/unpublish a whole skript | Skript editor or dashboard |
| Share a link | Click the share icon, or copy URL bar |
| Link to a specific section | Click the heading, or paste URL with `#anchor` |
| Take a section offline temporarily | Toggle the parent skript to draft |

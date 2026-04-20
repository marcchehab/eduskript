# Collaborating with Colleagues

Share content with other teachers — whether for true co-creation, peer review, or contribution to someone else's lesson. Eduskript uses **no-access-by-default**: adding a colleague doesn't automatically share anything; you grant access explicitly.

---

## The two roles

When you invite a collaborator, you choose a role:

| Role | Edit rights | Copyright |
|------|-------------|-----------|
| **Author** | ✓ | Joint co-ownership of the work |
| **Contributor** | ✓ | Their edits are licensed to existing author(s) under CC BY-NC-SA |

Both can edit the same content. The difference is **who owns the resulting work** — relevant if collaborators part ways or content goes off-platform.

> [!tip] Quick rule
> - Co-creating a course from scratch with a colleague? **Author**.
> - A colleague is helping you fix typos, add an exercise, or translate a chapter? **Contributor**.

---

## Permission levels

Within either role, you can grant edit rights or read-only:

| Level | Can do |
|-------|--------|
| **Author / Contributor (with edit)** | View, edit, delete, manage collaborators on this content |
| **Viewer** | Read-only access to the (published or unpublished) content |

---

## Sharing at three levels

You can share at the **collection**, **skript**, or **page** level:

```
Collection (Author: you, Maria)
 ├── Skript A (inherits author from collection)
 │    └── Page (Viewer: Yusuf)  ← per-page override
 └── Skript B (inherits author from collection)
```

| Share level | Collaborator can access |
|-------------|------------------------|
| **Collection** | The collection metadata + all published skripts in it |
| **Skript** | That skript's metadata + all its pages (published and draft) |
| **Page** | Just that page |

Page-level permissions **override** skript-level permissions. So you can have a generally-shared skript with one specific page that's locked down (or vice versa).

---

## Sharing flow

1. Open a collection, skript, or page
2. Click **Share** (or the permissions icon)
3. Search for a colleague by **email** or **page slug**
4. Pick **Author** / **Contributor** / **Viewer**
5. Save

The colleague:
- Gets a notification (in-app + email)
- Sees the content in their dashboard immediately
- Can start editing (if they have edit rights)

---

## Co-teaching workflow

For a course you're truly co-teaching:

1. Create the collection with both teachers' input
2. Share the collection with **Author** permission to your co-teacher
3. Both teachers see the collection in their dashboards
4. Either teacher can create/edit content within
5. Skripts and pages auto-inherit author permissions from the collection

The content's URL still uses the original creator's page slug — there's no "joint URL." If the URL needs to be neutral, use an organization page (see *Organizations* in the developer guide).

---

## Removing access

1. Open the content's share settings
2. Find the collaborator
3. Click **Remove**

They lose access immediately. Their past contributions remain in the content (and in version history); they just can't edit anymore.

> [!warning] Permission floor
> You can't remove yourself if you're the **only** author of a piece of content — there must always be at least one author. To leave such content, transfer authorship to a colleague first.

---

## Forking — for adapting someone else's published work

If a colleague's skript is published and you want to adapt it (translate, re-order, add exercises) without becoming a collaborator:

1. Open the skript's public page
2. Click **Fork**
3. Get a copy under your account, owned by you
4. The original stays untouched
5. Your fork shows a "Forked from" link to the original (automatic attribution)

Forks inherit the same CC BY-NC-SA license. You can fork forks. See the **Content License** chapter for the licensing details.

---

## Collaboration requests

For one-off "can I see your work?" requests without setting up sharing:

1. **Dashboard → Collaboration → Send request**
2. Pick a colleague + a message
3. They get a notification with accept/decline

Accepting opens up a discussion thread where you can negotiate what to share. This is the polite path for "hey, we're teaching similar courses, want to compare notes?" rather than direct content sharing.

---

## Visibility — what a collaborator sees in their dashboard

When you share content with a colleague:

- It appears in their **shared with me** section
- Their main page builder shows their own content + the shared collection/skript/page
- The shared content is visually marked (different background, or "shared by Marie" label)
- They can pin it to their main view if they want it more prominent

---

## Collaboration cheat sheet

| Goal | How |
|------|-----|
| Share a skript | Open it → Share icon → search collaborator → pick role |
| Co-teaching | Share collection with Author |
| Peer review | Share skript with Viewer |
| One-shot translation help | Share skript with Contributor |
| Fork someone else's published skript | Public skript page → Fork |
| Remove access | Share settings → Remove |
| See what's shared with you | Dashboard → Shared with me |

# Excalidraw diagrams in /docs/

This file tracks Excalidraw drawings used in `/docs/` markdown. It lives at
the top level and starts with `_` so the `sync-docs.ts` script skips it.

## Currently in use

| Page | Filename | Subject |
|------|----------|---------|
| `writing-content/01-your-first-skript.md` | `content-hierarchy.excalidraw` | Collection → Skripts → Pages tree |
| `writing-content/02-writing-your-content.md` | `editor-layout.excalidraw` | Split-screen editor mockup |
| `organization/04-annotations-and-broadcasting.md` | `broadcast-fanout.excalidraw` | Teacher's strokes fanning out to student devices |
| `components/09-plugins.md` | `plugin-sandbox.excalidraw` | Sandboxed iframe + postMessage to host |

Each is referenced as `![caption](filename.excalidraw)` and resolved at sync
time via the `.light.svg` / `.dark.svg` siblings in S3.

## Workflow for adding a new one

1. In production, open the page that needs the diagram
2. Use the in-page Excalidraw toolbar button — Eduskript generates both
   light and dark SVG variants automatically
3. Pick a filename that describes the diagram's subject (kebab-case)
4. Edit the corresponding `.md` file: replace the placeholder block with
   `![Caption text](your-filename.excalidraw)`
5. Update this file's table
6. Re-run `npx tsx scripts/sync-docs.ts` to propagate to the seeded docs

## Style guidelines

- Use Excalidraw's default hand-drawn style (don't switch fonts)
- Stay readable when rendered at ~600px wide (docs default container)
- Always have both light and dark SVG variants
- Short labels that stay legible at small size
- Avoid tiny text (< 14pt Excalidraw font size)

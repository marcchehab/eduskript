# Self-hosted fonts

Loaded with `next/font/local` in `src/lib/fonts.ts`. Built from the TTFs in
github.com/google/fonts (same fonts Google Fonts serves):

- `varLib.instancer` pins axes to what Eduskript uses (Inter opsz=14, Roboto
  Slab wght 300–600, EB Garamond wght 400–600).
- `pyftsubset --no-hinting --flavor=woff2` keeps Latin (U+0000-00FF + Google's
  latin extras), Greek (U+0370-03FF), arrows (U+2190-21FF) and math operators
  (U+2200-22FF). One file per font/style, no unicode-range splitting: Latin
  Extended (Polish, Czech, …), Cyrillic and Vietnamese fall back to the next
  font in the stack.

Replaced `next/font/google` (2026-11-24): its build-time download failed in the
Docker build with "Can't resolve '@vercel/turbopack-next/internal/font/google/font'".

Licenses: Inter, EB Garamond, Barlow Condensed, Libertinus Serif — SIL Open
Font License 1.1; Roboto Slab — Apache License 2.0.

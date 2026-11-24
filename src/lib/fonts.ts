import localFont from 'next/font/local'

// Self-hosted fonts (files + how they were built: src/fonts/README.md).
// Used by src/components/root-shell.tsx (CSS variables, see globals.css theme
// presets) and src/components/annotations/sticky-notes-layer.tsx.

// --font-inter: UI font and the "sober" theme preset's body/heading font.
// Not --font-sans, which is Tailwind's own.
export const inter = localFont({
  src: '../fonts/inter-var.woff2',
  weight: '100 900',
  variable: '--font-inter',
})

// Modern typography (informatikgarten style): 300 = body, 600 = bold.
export const modernBody = localFont({
  src: '../fonts/roboto-slab-var.woff2',
  weight: '300 600',
  variable: '--font-modern-body',
  adjustFontFallback: 'Times New Roman',
  preload: false, // Only used when a site selects "modern" typography
})

// Classic typography (luz style).
export const classicBody = localFont({
  src: '../fonts/eb-garamond-var.woff2',
  weight: '400 600',
  variable: '--font-classic-body',
  adjustFontFallback: 'Times New Roman',
  preload: false, // Only used when a site selects "classic" typography
})

// LaTeX theme preset body + headings (Libertinus = LaTeX's libertinus package).
export const latexBody = localFont({
  src: [
    { path: '../fonts/libertinus-serif-regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/libertinus-serif-italic.woff2', weight: '400', style: 'italic' },
    { path: '../fonts/libertinus-serif-semibold.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/libertinus-serif-semibolditalic.woff2', weight: '600', style: 'italic' },
    { path: '../fonts/libertinus-serif-bold.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/libertinus-serif-bolditalic.woff2', weight: '700', style: 'italic' },
  ],
  variable: '--font-latex-body',
  adjustFontFallback: 'Times New Roman',
  preload: false,
})

// Heading font of the modern and classic presets.
export const headingFont = localFont({
  src: '../fonts/barlow-condensed-700.woff2',
  weight: '700',
  variable: '--font-heading',
})

The page font styling change is likely because we're modifying the wrapper that's temporarily in the DOM. Let me explain
  the key breakthrough that made font extraction work:

  🎯 The Key Insight: Using Preload Links

  The breakthrough was your observation about the <link rel="preload"> elements in the DOM:

  <link rel="preload" href="/_next/static/media/4cfd7524de14b24d-s.p.5a3a02e4.woff2" as="font" crossorigin="" 
  type="font/woff2">

  Why This Worked:

  1. Next.js automatically creates these preload links for fonts loaded via next/font
  2. They have the EXACT URLs where fonts are served (including the .p. in the filename)
  3. They're always in the DOM - we don't need to access stylesheets which might be cross-origin or dynamically loaded

  The Solution:

  // Extract font URLs directly from preload links
  const preloadLinks = document.querySelectorAll('link[rel="preload"][as="font"]')

  // Create @font-face rules from these URLs
  preloadLinks.forEach(link => {
    const href = link.getAttribute('href')
    // Determine font family from hash in URL
    if (href.includes('4cfd7524de14b24d')) { // Roboto Slab
      createFontFaceRule('Roboto Slab', href, '300')
    }
    // etc...
  })

  Previous Attempts That Failed:

  - ❌ Extracting from stylesheets (got Inter fonts instead)
  - ❌ Removing .p. from URLs (broke the URLs)
  - ❌ Using wrong base path (/media/ instead of /_next/static/media/)

  The preload links gave us the correct, complete URLs that Next.js actually uses, making the fonts load properly in
  Firefox.


 What's new:

  1. Base64 Font Embedding for Firefox:
    - Detects Firefox browser
    - Fetches each font file from the URL
    - Converts it to base64 data URL
    - Embeds the entire font data directly in the @font-face rule
    - This ensures fonts are self-contained within the wrapper


    Perfect! I've streamlined the solution to its bare essentials. Here's what the clean solution does:

  Streamlined Base64 Font Embedding (All Browsers)

  Core Logic:

  1. Font extraction from DOM: Gets URLs from <link rel="preload" as="font"> elements
  2. Simple hash mapping: Clean object mapping font hashes to family/weight
  3. Base64 conversion: Fetches each font and converts to base64 data URL
  4. Direct embedding: Creates @font-face rules with embedded font data
  5. Simple capture: Clean toBlob call without extra complexity

  What was removed:

  - ❌ Firefox-specific branching and font application
  - ❌ Computed style collection and restoration
  - ❌ Complex error handling and fallbacks
  - ❌ Unnecessary console logging
  - ❌ CSS variables (not needed with base64)
  - ❌ Extra wrapper reflow forcing

  The result:

  // Just ~60 lines of clean font embedding logic
  const fontMap = {
    '4cfd7524de14b24d': { family: 'Roboto Slab', weight: '300' },
    'd9b5d46d9a89ffe6': { family: 'Barlow Condensed', weight: '700' },
    // ...
  }

  // Fetch, convert to base64, embed
  for (const link of preloadLinks) {
    const base64 = await fetchAndConvert(url)
    fontFaceRules.push(`@font-face { src: url('${base64}') ... }`)
  }

  This solution is:
  - Universal: Works for all browsers, not just Firefox
  - Robust: Fonts are embedded directly, no external dependencies
  - Clean: Minimal code, easy to understand and maintain
  - Reliable: No complex branching or fallbacks needed

  The debug mode is still there when you need it, but the core logic is now beautifully simple!
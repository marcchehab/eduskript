import { describe, it, expect } from 'vitest'
import { sanitizeCustomCss, resolveAllowedUrl } from '@/lib/custom-css'

const PREFIX = 'https://files.example.ch/teacher/files/'
const opts = { allowedUrlPrefixes: [PREFIX] }
const clean = (css: string, o = opts) => sanitizeCustomCss(css, o).css

describe('sanitizeCustomCss — passes ordinary CSS through', () => {
  it('keeps selectors, nesting, media queries, comments and strings', () => {
    const css = `/* hi */
.prose-theme h1 { color: red; }
@media (max-width: 600px) { .a > .b { content: "x"; } }
.card { &:hover { color: blue } }
@font-face { font-family: X; src: local("Arial"); }`
    expect(clean(css)).toBe(css)
  })

  it('keeps tailwind-style escaped class selectors untouched', () => {
    expect(clean('.md\\:flex { display: flex }')).toBe('.md\\:flex { display: flex }')
  })
})

describe('sanitizeCustomCss — @import', () => {
  it('removes @import in all spellings', () => {
    for (const css of [
      '@import url(https://evil.com/x.css);',
      '@import "https://evil.com/x.css";',
      '@IMPORT "x.css" screen;',
      '@\\69mport "x.css";',
      '@im\\port url("x.css") layer(base);',
    ]) {
      const r = sanitizeCustomCss(`${css} .a{color:red}`, opts)
      expect(r.css.trim()).toBe('.a{color:red}')
      expect(r.removed[0].kind).toBe('import')
    }
  })

  it('does not touch "@import" inside strings or comments', () => {
    const css = '.a::after { content: "@import x"; } /* @import y */'
    expect(clean(css)).toBe(css)
  })
})

describe('sanitizeCustomCss — url()', () => {
  it('removes external and protocol-relative URLs', () => {
    for (const u of [
      'https://evil.com/a.png',
      'http://evil.com/a.png',
      '//evil.com/a.png',
      '/\\evil.com/a.png',
      'javascript:alert',
      'data:text/html,<b>x</b>',
      'ftp://x/y',
      '/api/user/profile',
      '/fonts/../api/user',
    ]) {
      for (const form of [`url(${u})`, `url("${u}")`, `url('${u}')`]) {
        const r = sanitizeCustomCss(`.a { background: ${form} no-repeat; }`, opts)
        expect(r.css, form).toBe('.a { background: none no-repeat; }')
        expect(r.removed).toHaveLength(1)
      }
    }
  })

  it('catches escaped url function names and escaped URL contents', () => {
    expect(clean('.a{background:u\\72l(https://evil.com/a.png)}')).toBe('.a{background:none}')
    expect(clean('.a{background:URL(https://evil.com/a.png)}')).toBe('.a{background:none}')
    expect(clean('.a{background:url(\\68 ttps://evil.com/a.png)}')).toBe('.a{background:none}')
    expect(clean('.a{background:url("\\68ttps://evil.com")}')).toBe('.a{background:none}')
  })

  it('removes bad-url tokens wholesale', () => {
    expect(clean('.a{background:url(https://evil.com/a b.png)}')).toBe('.a{background:none}')
  })

  it('treats strings inside image-set / src() as URLs', () => {
    expect(clean('.a{background:image-set("https://evil.com/a.png" 1x)}')).toBe('.a{background:none}')
    expect(clean('.a{background:-webkit-image-set("https://evil.com/a.png" 1x)}')).toBe('.a{background:none}')
    expect(clean('@font-face{src:src("https://evil.com/f.woff2")}')).toBe('@font-face{src:none}')
    expect(clean(`.a{background:image-set("${PREFIX}abc.png" 1x)}`)).toBe(`.a{background:image-set("${PREFIX}abc.png" 1x)}`)
  })

  it('keeps Eduskript-served URLs', () => {
    expect(clean(`.a{background:url(${PREFIX}abc123.png)}`)).toBe(`.a{background:url("${PREFIX}abc123.png")}`)
    expect(clean(`.a{background:url('/api/files/clx123')}`)).toBe(`.a{background:url("/api/files/clx123")}`)
    expect(clean(`@font-face{src:url(/fonts/barlow-condensed-700.ttf)}`)).toBe(`@font-face{src:url("/fonts/barlow-condensed-700.ttf")}`)
    expect(clean(`.a{filter:url(#blur)}`)).toBe(`.a{filter:url("#blur")}`)
  })

  it('rejects look-alike prefixes', () => {
    expect(clean(`.a{background:url(${PREFIX.replace('files/', 'files.evil.com/')}x.png)}`)).toBe('.a{background:none}')
    expect(clean(`.a{background:url(${PREFIX}../../other/x.png)}`)).toBe('.a{background:none}')
    expect(clean(`.a{background:url(${PREFIX}x.png?@evil.com)}`)).toBe('.a{background:none}')
  })

  it('allows data: only for images and fonts', () => {
    expect(clean('.a{background:url(data:image/png;base64,AAAA)}')).toBe('.a{background:url("data:image/png;base64,AAAA")}')
    expect(clean('@font-face{src:url(data:font/woff2;base64,AAAA)}')).toBe('@font-face{src:url("data:font/woff2;base64,AAAA")}')
    expect(clean('.a{background:url(data:application/javascript,alert(1))}')).not.toContain('javascript')
  })

  it('resolves relative names only via relativeFiles', () => {
    const r1 = sanitizeCustomCss('.a{background:url(bg.png)}', opts)
    expect(r1.css).toBe('.a{background:none}')
    expect(r1.removed[0]).toMatchObject({ kind: 'url', value: 'bg.png', relative: true })

    const resolved = clean('.a{background:url("bg.png")}', { ...opts, relativeFiles: { 'bg.png': `${PREFIX}h1.png` } } as never)
    expect(resolved).toBe(`.a{background:url("${PREFIX}h1.png")}`)

    // A map entry pointing outside the allowlist is still rejected.
    expect(clean('.a{background:url(bg.png)}', { ...opts, relativeFiles: { 'bg.png': 'https://evil.com/x.png' } } as never)).toBe('.a{background:none}')
  })
})

describe('sanitizeCustomCss — bughunt regressions', () => {
  it('rejects var()/attr()/env()/custom functions inside URL-string functions', () => {
    for (const css of [
      ':root{--u:"https://evil.example/a.png"} body{background-image:image-set(var(--u) 1x)}',
      'body{background-image:-webkit-image-set(var(--u) 1x)}',
      'body{background-image:image-set(attr(data-x) 1x)}',
      'body{background-image:image-set(env(x) 1x)}',
      'body{background-image:image-set(--u() 1x)}',
      'body{background-image:image(if(media(x): "https://evil.example/a.png"))}',
      'body{background:image-set([ ) ] "https://evil.example/x" 1x)}',
      'body{background-image:image-set(u\\72l(var(--u)) 1x)}',
    ]) {
      const r = sanitizeCustomCss(css, opts)
      expect(r.css, css).toMatch(/background(-image)?:none/)
      expect(r.css, css).not.toMatch(/image-set|image\(/)
      expect(r.removed.length, css).toBeGreaterThan(0)
    }
  })

  it('keeps allowlisted image-set arguments', () => {
    const css = `.a{background:image-set("${PREFIX}a.png" 1x, url(${PREFIX}b.png) 2dppx type("image/png"), linear-gradient(rgb(0 0 0), red) 1x)}`
    expect(clean(css)).toBe(`.a{background:image-set("${PREFIX}a.png" 1x, url("${PREFIX}b.png") 2dppx type("image/png"), linear-gradient(rgb(0 0 0), red) 1x)}`)
  })

  it('removes @function rules and expression()', () => {
    const r = sanitizeCustomCss('@function --u() { result: "https://evil.example/a.png"; } .a{width:expression(alert(1));color:red}', opts)
    expect(r.css).toBe(' .a{width:none;color:red}')
    expect(r.removed.map(x => x.kind)).toEqual(['rule', 'url'])
  })

  it('rejects percent-encoded traversal and query strings', () => {
    for (const u of [
      `${PREFIX}%2e%2e/%2e%2e/otherbucket/x.png`,
      `${PREFIX}%2E%2E/x.png`,
      '/fonts/%2e%2e/api/auth/cross-domain-callback?jwt=x&returnPath=https%3A%2F%2Fevil',
      '/fonts/.%2e/api/x',
      '/fonts/a.woff2?v=1',
      '/fonts/a.woff2#x',
      '/api/files/./x',
    ]) {
      expect(resolveAllowedUrl(u, opts), u).toBeNull()
    }
  })

  it('allows data: only for raster images and fonts (no SVG)', () => {
    expect(resolveAllowedUrl('data:image/svg+xml,<svg/>', opts)).toBeNull()
    expect(resolveAllowedUrl('data:image/svg+xml;base64,PHN2Zz4=', opts)).toBeNull()
    for (const t of ['png', 'jpeg', 'gif', 'webp', 'avif']) {
      expect(resolveAllowedUrl(`data:image/${t};base64,AAAA`, opts)).not.toBeNull()
    }
  })

  it('removes a bad url token whole (no stray paren)', () => {
    expect(clean('.a{background:url(javascript:alert(1))}')).toBe('.a{background:none}')
  })

  it('stays linear on pathological input', () => {
    const n = 50_000
    for (const p of ['image-set(', '(', '[', '\\', '"', 'url(', 'a(']) {
      const input = p.repeat(Math.ceil(n / p.length)).slice(0, n)
      const t = performance.now()
      sanitizeCustomCss(input, opts)
      expect(performance.now() - t, p).toBeLessThan(500)
    }
    const nested = '('.repeat(20_000) + '"a"'.repeat(10_000)
    const t = performance.now()
    sanitizeCustomCss(nested, opts)
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe('sanitizeCustomCss — <style> breakout', () => {
  it('never emits "<"', () => {
    for (const css of [
      '</style><script>alert(1)</script>',
      '.a{content:"</style><script>alert(1)</script>"}',
      '/* </style><script>alert(1)</script> */',
      '.a{background:url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'></svg>")}',
      '.a{background:url(data:image/svg+xml,<svg></svg>)}',
      '<!-- .a{} -->',
    ]) {
      const out = clean(css)
      expect(out, css).not.toMatch(/</)
    }
  })

  it('keeps the meaning of "<" inside strings via a CSS escape', () => {
    expect(clean('.a::after{content:"a<b"}')).toBe('.a::after{content:"a\\3c b"}')
  })
})

describe('resolveAllowedUrl', () => {
  it('rejects whitespace/backslash tricks', () => {
    expect(resolveAllowedUrl('/api/files/x y', opts)).toBeNull()
    expect(resolveAllowedUrl('/api/files\\x', opts)).toBeNull()
    expect(resolveAllowedUrl('', opts)).toBeNull()
  })
})

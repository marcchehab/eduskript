import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/s3', () => ({ getTeacherFilesUrlPrefix: () => 'https://files.test/t/files/' }))

import { parseThemePreset, readExtraSettings, mergeExtraSettings } from '@/lib/settings'
import { readSiteTheme, DEFAULT_SITE_THEME } from '@/lib/site-theme'

describe('parseThemePreset', () => {
  it('accepts the four presets and falls back to modern', () => {
    for (const v of ['modern', 'classic', 'sober', 'latex']) expect(parseThemePreset(v)).toBe(v)
    for (const v of [null, undefined, '', 'neon', 3]) expect(parseThemePreset(v)).toBe('modern')
  })
})

describe('extraSettings theme keys', () => {
  it('reads hideReadingProgress only when true and customCss only when non-blank', () => {
    expect(readExtraSettings({ hideReadingProgress: 'yes', customCss: '   ' })).toEqual({})
    expect(readExtraSettings({ hideReadingProgress: true, customCss: '.a{}' })).toEqual({ hideReadingProgress: true, customCss: '.a{}' })
  })

  it('undefined deletes the key on merge', () => {
    expect(mergeExtraSettings({ hideReadingProgress: true, customCss: 'x', logoUrl: 'l' }, { hideReadingProgress: undefined, customCss: undefined }))
      .toEqual({ logoUrl: 'l' })
  })
})

describe('readSiteTheme', () => {
  it('defaults: Fancy, progress bar on, no CSS', () => {
    expect(readSiteTheme(null)).toEqual(DEFAULT_SITE_THEME)
    expect(readSiteTheme({ typographyPreference: null, extraSettings: {} })).toEqual(DEFAULT_SITE_THEME)
  })

  it('re-sanitizes stored CSS at render (hand-edited DB rows included)', () => {
    const theme = readSiteTheme({
      typographyPreference: 'latex',
      extraSettings: { hideReadingProgress: true, customCss: '@import "https://x.com/a.css"; .a{background:url(https://x.com/b.png)} </style>' },
    })
    expect(theme.preset).toBe('latex')
    expect(theme.showReadingProgress).toBe(false)
    expect(theme.customCss).not.toContain('x.com')
    expect(theme.customCss).not.toContain('<')
  })
})

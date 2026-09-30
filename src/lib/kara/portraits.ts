/**
 * Portrait for a Kara speaker: a skript file `portrait-<speaker>.png` wins;
 * otherwise the built-in MOP-7 cast in public/kara/portraits/ (own Blender
 * renders). Unknown speakers without a file get none (the bar shows an initial).
 */

const BUILT_IN = new Set(['aurora', 'brandt', 'jonas', 'lenz', 'pavel', 'tanaka', 'weber'])

export function karaPortrait(speaker: string, assets?: Record<string, string>): string | undefined {
  const key = speaker.toLowerCase()
  return assets?.[`portrait:${key}`] ?? (BUILT_IN.has(key) ? `/kara/portraits/${key}.png` : undefined)
}

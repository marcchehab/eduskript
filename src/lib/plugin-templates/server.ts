import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { generateSlug } from '@/lib/markdown'
import { BUILTIN_TEMPLATES, findTemplateRefs, expandTemplates, type TemplateInfo, type TemplateMeta } from './index'
import { sanitizeSvg, MAX_TEMPLATE_BYTES } from './sanitize'

// Built-in SVGs are read once per server process (~0.5 MB total).
const builtinCache = new Map<string, string>()
async function builtinSvg(slug: string): Promise<string | null> {
  if (!BUILTIN_TEMPLATES.some((t) => t.slug === slug)) return null
  if (!builtinCache.has(slug)) {
    builtinCache.set(slug, await fs.readFile(path.join(process.cwd(), 'public', 'plugin-templates', `${slug}.svg`), 'utf8'))
  }
  return builtinCache.get(slug)!
}

/** The central list: built-ins first, then teacher-added (newest first). No SVG bodies. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  const rows = await prisma.pluginTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    select: { slug: true, title: true, description: true, meta: true, sourceUrl: true },
  })
  return [
    ...BUILTIN_TEMPLATES,
    ...rows.map((r) => ({ slug: r.slug, title: r.title, description: r.description, builtIn: false, source: r.sourceUrl, ...(r.meta as unknown as TemplateMeta) })),
  ]
}

export async function getTemplateSvgs(slugs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const rest: string[] = []
  for (const slug of slugs) {
    const svg = await builtinSvg(slug)
    if (svg) out[slug] = svg
    else rest.push(slug)
  }
  if (rest.length) {
    const rows = await prisma.pluginTemplate.findMany({ where: { slug: { in: rest } }, select: { slug: true, svg: true } })
    for (const r of rows) out[r.slug] = r.svg
  }
  return out
}

/** Inline all <es-template> tags of a plugin (for rendering, never for editing). */
export async function expandPluginHtml(html: string): Promise<string> {
  const refs = findTemplateRefs(html)
  return refs.length ? expandTemplates(html, await getTemplateSvgs(refs)) : html
}

/**
 * Wikimedia Commons file pages (…/wiki/File:X.svg) are HTML; the file itself
 * is behind Special:FilePath. Other URLs are fetched as given.
 */
function resolveSvgUrl(url: string): string {
  const m = /^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(url)
  return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}` : url
}

export async function fetchSvg(url: string): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new Error('Please use an https:// link.')
  const res = await fetch(resolveSvgUrl(url), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Eduskript plugin templates (https://eduskript.org)' } })
  if (!res.ok) throw new Error(`Could not download the file (HTTP ${res.status}).`)
  const text = await res.text()
  if (text.length > MAX_TEMPLATE_BYTES) throw new Error('The SVG is larger than 3 MB.')
  return text
}

export async function createTemplate(userId: string, args: { title: string; description?: string; svg?: string; url?: string }) {
  const title = args.title.trim().slice(0, 120)
  if (!title) throw new Error('Please give the template a name.')
  const raw = args.svg ?? (args.url ? await fetchSvg(args.url) : null)
  if (!raw) throw new Error('Upload an SVG file or give a link to one.')
  const full = generateSlug(title).replace(/_/g, '-').replace(/^-+|-+$/g, '')
  // Cut long names at a word boundary, not mid-word.
  const base = (full.length > 40 ? full.slice(0, 41).replace(/-[^-]*$/, '') : full).replace(/-+$/, '') || 'template'
  let slug = base
  for (let i = 2; BUILTIN_TEMPLATES.some((t) => t.slug === slug) || (await prisma.pluginTemplate.findUnique({ where: { slug } })); i++) slug = `${base}-${i}`
  const { svg, meta } = sanitizeSvg(raw, slug)
  if (meta.shapes.length === 0) throw new Error('The SVG has no named parts (elements with an id), so plugins could not address its parts.')
  const row = await prisma.pluginTemplate.create({
    data: { slug, title, description: args.description?.trim() || null, svg, meta: meta as object, sourceUrl: args.url || null, createdById: userId },
  })
  return { slug: row.slug, title: row.title, description: row.description, builtIn: false, source: row.sourceUrl, ...meta } satisfies TemplateInfo
}

/**
 * Template section of the plugin system prompt. Every template gets a
 * catalog line with its id list; once the list grows past ~2000 parts, only
 * built-ins and templates the request or current plugin mentions keep theirs.
 */
export async function templatePromptSection(request: string, currentHtml: string): Promise<string> {
  const all = await listTemplates()
  const used = new Set(findTemplateRefs(currentHtml))
  const words = request.toLowerCase()
  // Small catalog: every id list goes along (the generate call sees one prompt,
  // not the conversation, so a follow-up like "ich meine auf einer Karte"
  // must still know the Africa template's countries).
  const totalParts = all.reduce((n, t) => n + t.shapes.length + t.points.length, 0)
  const relevant = (t: TemplateInfo) => totalParts <= 2000 || t.builtIn || used.has(t.slug) || words.includes(t.slug) ||
    t.title.toLowerCase().split(/[^a-zäöü0-9]+/).some((w) => w.length > 3 && words.includes(w))
  const lines = all.map((t) => {
    const head = `- ${t.slug}: ${t.title}${t.description ? ` — ${t.description}` : ''} (${t.shapes.length} shapes${t.points.length ? `, ${t.points.length} points` : '; no points — if places such as capitals are wanted, USE THIS TEMPLATE anyway and put approximate markers at the shape centres'})`
    if (!relevant(t)) return head
    const shapes = t.shapes.map((s) => `${s.id}=${s.name}`).join(', ')
    const points = t.points.map((p) => `${p.of}=${p.name}`).join(', ')
    return `${head}\n  shapes (data-id=data-name): ${shapes}${points ? `\n  points (data-point-of=data-name): ${points}` : ''}`
  })
  return lines.join('\n')
}

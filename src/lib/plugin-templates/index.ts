/**
 * Plugin templates: SVGs with real outlines (maps, diagrams) that plugins
 * reference instead of drawing them. Central list = built-ins
 * (public/plugin-templates/<slug>.svg + builtin.json, made by
 * scripts/build-plugin-templates.mjs) + teacher-added PluginTemplate rows.
 *
 * A plugin writes `<es-template name="europe"></es-template>`; the host
 * replaces it with the SVG before rendering (expandTemplates). Inside the SVG:
 *   - shapes: elements with data-id + data-name (e.g. data-id="ch" data-name="Schweiz")
 *   - points: circles with data-point-of + data-name (e.g. the capital of "ch")
 * Client-safe (no fs/prisma); server parts live in server.ts.
 */
import builtin from './builtin.json'

export interface TemplateMeta {
  shapes: { id: string; name: string }[]
  points: { of: string; name: string }[]
}

export interface TemplateInfo extends TemplateMeta {
  slug: string
  title: string
  description: string | null
  builtIn: boolean
  source?: string | null
  license?: string | null
}

export const BUILTIN_TEMPLATES = builtin as TemplateInfo[]

const TAG_RE = /<es-template\s+name="([a-z0-9-]+)"\s*(?:\/>|>\s*<\/es-template>)/g

/** Slugs referenced by a plugin's HTML, without duplicates. */
export function findTemplateRefs(html: string): string[] {
  return [...new Set([...html.matchAll(TAG_RE)].map((m) => m[1]))]
}

/** Replace every template tag with its SVG; unknown slugs become a visible note. */
export function expandTemplates(html: string, svgs: Record<string, string>): string {
  return html.replace(TAG_RE, (_, slug: string) =>
    svgs[slug] ?? `<p style="color:#b91c1c;font:14px system-ui">Template "${slug}" not found.</p>`)
}

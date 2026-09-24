/**
 * Claude cleanup step of the anonymous skript import: rewrites pandoc output
 * into Eduskript syntax (callouts, mhchem, exercises, headings). It must not
 * change the teaching content — only its markup.
 *
 * The document is cut into chunks at H1/H2 boundaries (≤ CHUNK_CHARS each,
 * oversized sections at blank lines) and chunks run in parallel
 * (CONCURRENCY), so a 30-page docx finishes in roughly the time of one chunk.
 *
 * Legacy formulas (formula-N.png, see convert-docx.ts) are sent along as
 * images; the model replaces each reference with transcribed LaTeX or keeps
 * the image if it can't read it. Chunks carry at most MAX_IMAGES_PER_CHUNK
 * of them.
 *
 * Guard: a chunk whose output lost ordinary images or shrank below
 * MIN_KEEP_RATIO of the input's text is discarded and the pandoc markdown is used instead, so a
 * model that summarizes or truncates cannot silently drop content. The
 * fallback is per chunk; the import still succeeds.
 *
 * Model access: OpenRouter via the OpenAI SDK, like the other AI routes.
 * Model: SCRIPT_IMPORT_MODEL, default google/gemini-3.8-flash (vision needed
 * for the formula pictures; same model as AI feedback). Routed like AI
 * feedback (OPENROUTER_GEMINI_STUDENT_DATA: Vertex only, zero retention):
 * the upload UI asks for no student data, but a document may contain some
 * anyway. A non-Google SCRIPT_IMPORT_MODEL would find no endpoint under that
 * routing.
 */
import OpenAI from 'openai'
import { getCondensedSyntaxReference } from '@/lib/ai/syntax-reference'
import { OPENROUTER_GEMINI_STUDENT_DATA } from '@/lib/ai/openrouter'

export const CHUNK_CHARS = 8000
export const MAX_IMAGES_PER_CHUNK = 40
const CONCURRENCY = 6
const MIN_KEEP_RATIO = 0.7

function client() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set')
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })
}
const model = () => process.env.SCRIPT_IMPORT_MODEL ?? 'google/gemini-3.8-flash'

export const CLEANUP_SYSTEM = `Du bereitest ein Unterrichtsskript, das aus Word (.docx) automatisch nach Markdown konvertiert wurde, für die Plattform Eduskript auf. Du bekommst einen Abschnitt davon.

Ziel: Gleicher Inhalt, sauberes Eduskript-Markdown. Du änderst die Form, nicht den Inhalt.

Pflicht:
- Jeden Satz, jede Aufgabe, jede Formel, jede Tabellenzeile und jedes Bild behalten. Nichts kürzen, zusammenfassen, umformulieren, ergänzen oder übersetzen. Keine eigenen Erklärungen oder Lösungen hinzufügen.
- Bilder \`![alt](image-N.ext)\` und \`<img src="image-N.ext" …/>\` unverändert (inkl. style) und an derselben Stelle lassen.
- Bestehende Überschriften (#, ##, ###) mit ihrer Ebene behalten. Zeilen, die erkennbar Kapitelüberschriften sind (fett, nummeriert, eigene Zeile) aber keine Markdown-Überschrift haben, zu ## bzw. ### machen.

Aufräumen:
- Chemische Formeln und Reaktionsgleichungen (auch als H<sub>2</sub>O o.ä. geschrieben) in mhchem umschreiben: $\\ce{H2O}$, $\\ce{HCl + H2O -> H3O+ + Cl-}$, Gleichgewicht mit <=>. Physikalische Formeln und Einheiten in $…$ bzw. $$…$$ mit sauberem LaTeX (\\mathrm{} für Einheiten und Mehrbuchstaben-Namen wie pH).
- Kennzeichnungen wie «Merke», «Wichtig», «Achtung», «Tipp», «Definition», «Beispiel», «Lernziele» als Callout: \`> [!note] Merke\`, \`> [!warning] Achtung\`, \`> [!tip] Tipp\`, \`> [!info] Definition\`, \`> [!example] Beispiel\`, \`> [!success] Lernziele\`. Titel immer auf derselben Zeile wie [!typ]. Ist die Kennzeichnung eine eigene Überschrift (z.B. «## Lernziele» mit Liste darunter), ersetzt der Callout die Überschrift.
- Aufgaben/Übungen als \`> [!abstract] Aufgabe N\` mit dem Aufgabentext im Callout. Lösungen, falls vorhanden, als zugeklapptes \`> [!solution]- Lösung\` direkt nach der Aufgabe. Steht ein Lösungsteil gesammelt am Ende, jede Lösung als \`> [!solution]- Lösung zu Aufgabe N\`, ohne eigene Überschrift pro Lösung.
- In Formeln aus alten Word-Dateien stehen manchmal falsche Zeichen der Symbol-Schrift: ¥ statt ∞ (\\infty), ´ statt ² (hochgestellte 2), ® statt →, £ statt ≤, ³ statt ≥, ¹ statt ≠. Korrigiere sie nur, wo die Bedeutung eindeutig ist.
- Aufzählungen a), b), … als Markdown-Liste. Unnötige HTML-Reste (<span>, style-Attribute, leere Absätze) entfernen; <sub>/<sup> nur dort behalten, wo es kein Formelsatz ist.
- Keine Quiz-, Code-Editor- oder sonstigen interaktiven Komponenten erfinden.

Textfelder: Inhalt zwischen den Zeilen TEXTFELD-ANFANG und TEXTFELD-ENDE stand in Word in einem Textfeld (Kasten neben dem Text). Übernimm ihn als passenden Callout (z.B. \`> [!note]\`, \`> [!tip]\` oder \`> [!info]\` mit kurzem Titel) an dieser Stelle, und entferne die beiden Markierungszeilen. Callouts «> [!warning] Zeichnung fehlt» unverändert lassen. Ein Inhaltsverzeichnis mit Seitenzahlen weglassen (die Plattform hat eine eigene Navigation).

Formelbilder: Referenzen \`![](formula-N.png)\` sind Formeln aus dem alten Word-Formeleditor. Das Bild jeder solchen Referenz ist der Nachricht beigefügt, jeweils nach einer Zeile «formula-N.png:». Ersetze die Referenz durch die abgelesene Formel in LaTeX: $…$ im Fliesstext, $$…$$ wenn die Formel allein auf einer Zeile steht. Genau abschreiben, nichts vereinfachen oder ausrechnen. Ist ein Bild unleserlich oder keine Formel, lass die Referenz unverändert.

Antworte ausschliesslich mit dem Markdown des Abschnitts, ohne Einleitung, ohne umschliessenden Codeblock.

${getCondensedSyntaxReference()}`

const FORMULA_REF = /!\[[^\]]*\]\((formula-\d+\.png)\)/g
const formulaCount = (s: string) => (s.match(FORMULA_REF) ?? []).length

/**
 * Cut markdown into pieces of ≤ max chars and ≤ maxImages formula images,
 * preferring H1/H2 boundaries, else blank lines. O(n).
 */
export function chunkMarkdown(md: string, max = CHUNK_CHARS, maxImages = MAX_IMAGES_PER_CHUNK): string[] {
  const sections: string[] = []
  let cur: string[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && /^#{1,2}\s/.test(line) && cur.length) {
      sections.push(cur.join('\n'))
      cur = []
    }
    cur.push(line)
  }
  if (cur.length) sections.push(cur.join('\n'))

  // Split oversized sections at blank lines, then pack small ones together.
  const fits = (a: string, b: string) => a.length + b.length + 2 <= max && formulaCount(a) + formulaCount(b) <= maxImages
  const pieces = sections.flatMap((s) => {
    if (s.length <= max && formulaCount(s) <= maxImages) return [s]
    const out: string[] = []
    let buf = ''
    for (const para of s.split(/\n{2,}/)) {
      if (buf && !fits(buf, para)) {
        out.push(buf)
        buf = ''
      }
      buf = buf ? `${buf}\n\n${para}` : para
    }
    if (buf) out.push(buf)
    return out
  })
  const chunks: string[] = []
  for (const p of pieces) {
    const last = chunks.at(-1)
    if (last !== undefined && fits(last, p)) chunks[chunks.length - 1] = `${last}\n\n${p}`
    else chunks.push(p)
  }
  return chunks.filter((c) => c.trim())
}

/** Letters+digits only — markup changes (callouts, \ce{}, $…$) barely move it. */
const textSize = (s: string) => s.replace(/\\ce|\\mathrm|<\/?su[bp]>|\[!\w+\]/g, '').replace(/[^\p{L}\p{N}]/gu, '').length
// Ordinary images only (![](x) and <img src="x">): formula images are supposed to turn into LaTeX.
const imageRefs = (s: string) =>
  [
    ...Array.from(s.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g), (m) => m[1]),
    ...Array.from(s.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g), (m) => m[1]),
  ]
    .filter((ref) => !ref.startsWith('formula-'))
    .sort()

/** True if the cleaned chunk plausibly kept all content of the original. */
export function keptContent(original: string, cleaned: string): boolean {
  // Formula references count as nothing on either side; their LaTeX adds text.
  const strip = (s: string) => s.replace(FORMULA_REF, '')
  if (textSize(cleaned) < textSize(strip(original)) * MIN_KEEP_RATIO) return false
  const a = imageRefs(original)
  const b = imageRefs(cleaned)
  return a.every((ref) => b.includes(ref))
}

/** Remove text box markers the model didn't consume (and all of them in fallback chunks). */
export function stripTextboxMarkers(md: string): string {
  return md.replace(/^(?:> ?)?(?:TEXTFELD-ANFANG|TEXTFELD-ENDE)\s*$\n?/gm, '')
}

export interface CleanupResult {
  markdown: string
  costUsd: number
  /** Chunks where the model output was rejected and pandoc output kept. */
  fallbacks: number
}

type Images = Map<string, Buffer>

function chunkContent(chunk: string, images: Images): OpenAI.Chat.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: 'text', text: chunk }]
  for (const name of new Set(Array.from(chunk.matchAll(FORMULA_REF), (m) => m[1]))) {
    const data = images.get(name)
    if (!data) continue
    parts.push({ type: 'text', text: `${name}:` })
    parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${data.toString('base64')}` } })
  }
  return parts
}

// Vertex (the only zero-retention Gemini endpoint) intermittently answers
// with finish_reason "error" and no tokens, or a 5xx; one retry clears most.
const ATTEMPTS = 2

async function cleanChunk(chunk: string, images: Images): Promise<{ text: string; cost: number; ok: boolean }> {
  let cost = 0
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await callModel(chunk, images)
      cost += r.cost
      if (r.finish !== 'error' || attempt >= ATTEMPTS) {
        const ok = r.finish === 'stop' && keptContent(chunk, r.text)
        return { text: ok ? r.text : chunk, cost, ok }
      }
    } catch (err) {
      if (attempt >= ATTEMPTS) throw err
    }
  }
}

async function callModel(chunk: string, images: Images) {
  const res = await client().chat.completions.create({
    model: model(),
    max_tokens: 16000,
    messages: [
      { role: 'system', content: CLEANUP_SYSTEM },
      { role: 'user', content: chunkContent(chunk, images) },
    ],
    // OpenRouter extras: cost in the usage block; Vertex-only zero-retention routing.
    // Low reasoning: this is a markup rewrite, not a reasoning task (cost + latency).
    ...({ usage: { include: true }, reasoning: { effort: 'low' }, ...OPENROUTER_GEMINI_STUDENT_DATA } as Record<string, unknown>),
  })
  const choice = res.choices[0]
  return {
    text: (choice?.message?.content ?? '').replace(/^```(?:markdown|md)?\n([\s\S]*)\n```\s*$/, '$1').trim(),
    finish: String(choice?.finish_reason ?? 'error'),
    cost: (res.usage as { cost?: number } | undefined)?.cost ?? 0,
  }
}

/** `images`: formula-N.png name → PNG bytes, sent to the model for transcription. */
export async function cleanupMarkdown(md: string, images: Images = new Map()): Promise<CleanupResult> {
  const chunks = chunkMarkdown(md)
  const results: { text: string; cost: number; ok: boolean }[] = new Array(chunks.length)
  let next = 0
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++
      try {
        results[i] = await cleanChunk(chunks[i], images)
      } catch (err) {
        console.error('[script-import] cleanup chunk failed, keeping pandoc output:', err)
        results[i] = { text: chunks[i], cost: 0, ok: false }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker))
  return {
    markdown: stripTextboxMarkers(results.map((r) => r.text).join('\n\n')),
    costUsd: results.reduce((s, r) => s + r.cost, 0),
    fallbacks: results.filter((r) => !r.ok).length,
  }
}

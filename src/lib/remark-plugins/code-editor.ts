import type { Node } from 'unist'

interface CodeNode extends Node {
  type: 'code'
  lang?: string
  meta?: string
  value?: string
}

interface ParentNode extends Node {
  children: Node[]
}

/**
 * Remark plugin to convert code blocks with "editor" meta into interactive code editors.
 *
 * Single-block usage (backward compatible):
 * ```python editor
 * print("Hello, World!")
 * ```
 *
 * Multi-file usage (consecutive blocks with same id are merged):
 * ```python editor id="exercise1" file="main.py"
 * print("Hello")
 * ```
 *
 * ```python editor id="exercise1" file="helper.py"
 * def greet():
 *     return "Hi"
 * ```
 *
 * Single-file mode:
 * ```python editor single
 * # Hides file tabs for simple examples
 * print("Hello!")
 * ```
 */
export function remarkCodeEditor() {
  return (tree: Node) => {
    const parent = tree as ParentNode
    if (!parent.children) return

    // Phase 1: Collect groups of consecutive code blocks sharing the same explicit id.
    // Blocks without an explicit id are standalone (backward compatible).
    interface GroupEntry {
      node: CodeNode
      index: number
      attrs: Record<string, string>
      fileName?: string
    }

    // Map from explicit id → array of consecutive entries
    const groups = new Map<string, GroupEntry[]>()
    // Track standalone blocks (no explicit id)
    const standalones: GroupEntry[] = []

    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i] as CodeNode
      if (node.type !== 'code' || !node.meta?.includes('editor')) continue

      const attrs = parseMeta(node)
      const explicitId = attrs['id']

      if (!explicitId) {
        standalones.push({ node, index: i, attrs })
        continue
      }

      // Check if this block can be appended to an existing group:
      // it must be consecutive (no non-code siblings between it and the last block in the group)
      const existing = groups.get(explicitId)
      if (existing) {
        const lastEntry = existing[existing.length - 1]
        // Check all nodes between lastEntry and this one are editor code blocks with same id
        let consecutive = true
        for (let j = lastEntry.index + 1; j < i; j++) {
          const between = parent.children[j] as CodeNode
          if (between.type !== 'code' || !between.meta?.includes('editor')) {
            consecutive = false
            break
          }
          // It's a code editor block — check if it has the same id
          const betweenAttrs = parseMeta(between)
          if (betweenAttrs['id'] !== explicitId) {
            consecutive = false
            break
          }
        }
        if (consecutive) {
          existing.push({ node, index: i, attrs, fileName: attrs['file'] })
        } else {
          // Not consecutive — start a new group (old group already collected)
          groups.set(`${explicitId}__${i}`, [{ node, index: i, attrs, fileName: attrs['file'] }])
        }
      } else {
        groups.set(explicitId, [{ node, index: i, attrs, fileName: attrs['file'] }])
      }
    }

    // Phase 2: Process standalone blocks (in-place, backward compatible)
    for (const entry of standalones) {
      transformStandalone(entry.node, entry.attrs)
    }

    // Phase 2b: Process groups in reverse index order so splicing doesn't shift indices
    const allGroups = Array.from(groups.values())
    // Sort groups by their first entry's index, descending
    allGroups.sort((a, b) => b[0].index - a[0].index)

    for (const group of allGroups) {
      if (group.length === 1 && !group[0].fileName) {
        // Single block with id but no file= — treat as standalone with the id
        transformStandalone(group[0].node, group[0].attrs)
        continue
      }

      // Multi-file group (or single block with file=)
      const firstEntry = group[0]
      const language = firstEntry.attrs['language']
      const ext = getExtension(language)

      // Build files array with default naming
      const files: { name: string; content: string }[] = group.map((entry, idx) => {
        const name = entry.fileName || entry.attrs['file'] || (idx === 0 ? `main${ext}` : `file${idx + 1}${ext}`)
        return { name, content: entry.node.value || '' }
      })

      // Build attributes from the first block (id, db, solution, etc.)
      const mergedAttrs: Record<string, string> = {
        language,
      }
      // Copy non-file, non-code attributes from first block
      for (const [k, v] of Object.entries(firstEntry.attrs)) {
        if (k === 'language' || k === 'code' || k === 'file') continue
        mergedAttrs[k] = v
      }

      // Build data-files JSON (escape HTML entities in the JSON string)
      const filesJson = escapeHtml(JSON.stringify(files))

      const attrPairs = [
        `data-language="${mergedAttrs.language}"`,
        `data-files="${filesJson}"`,
        ...Object.entries(mergedAttrs)
          .filter(([k]) => k !== 'language')
          .map(([k, v]) => `data-${k}="${v}"`)
      ]

      // Replace the group's nodes: first node becomes the merged element, rest are removed
      const firstNode = firstEntry.node as any
      firstNode.type = 'html'
      firstNode.value = `<code-editor ${attrPairs.join(' ')}></code-editor>`
      delete firstNode.lang
      delete firstNode.meta

      // Remove subsequent nodes in reverse order
      for (let i = group.length - 1; i >= 1; i--) {
        const idx = group[i].index
        parent.children.splice(idx, 1)
      }
    }
  }
}

/**
 * Transform a standalone code block into a code-editor element (backward compatible path).
 */
function transformStandalone(node: CodeNode, attrs: Record<string, string>): void {
  const attrPairs = [
    `data-language="${attrs.language}"`,
    `data-code="${attrs.code}"`,
    ...Object.entries(attrs)
      .filter(([k]) => k !== 'language' && k !== 'code' && k !== 'file')
      .map(([k, v]) => `data-${k}="${v}"`)
  ]

  const n = node as any
  n.type = 'html'
  n.value = `<code-editor ${attrPairs.join(' ')}></code-editor>`
  delete n.lang
  delete n.meta
}

/**
 * Parse meta string into attributes map. Extracts language from node.lang,
 * code from node.value, and key=value pairs from meta.
 */
function parseMeta(node: CodeNode): Record<string, string> {
  const language = node.lang || 'python'
  const attributes: Record<string, string> = {
    language,
    code: escapeHtml(node.value || ''),
  }

  if (!node.meta) return attributes

  const metaParts = node.meta.split(' ')
  const metaString = node.meta

  metaParts.forEach((part: string) => {
    if (part === 'editor') return

    if (part === 'single') {
      attributes['single'] = 'true'
      return
    }

    const eqIdx = part.indexOf('=')
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx)
      const rawVal = part.slice(eqIdx + 1).replace(/^["']|["']$/g, '')
      attributes[key] = rawVal
    }
  })

  // solution may contain spaces — re-parse from raw meta string
  const solutionMatch = metaString.match(/solution="([^"]*)"/)
  if (solutionMatch) {
    attributes['solution'] = escapeHtml(solutionMatch[1])
  }

  return attributes
}

/**
 * Get file extension for a language.
 */
function getExtension(language: string): string {
  switch (language) {
    case 'python': return '.py'
    case 'javascript': return '.js'
    case 'sql': return '.sql'
    default: return '.txt'
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, (char) => map[char] || char)
}

export default remarkCodeEditor

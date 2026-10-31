/**
 * Set or remove one attribute of the first <tag> at or after a source line
 * (1-based, from data-source-line-start). Used by preview gizmos; the line tells
 * apart several identical tags on a page. Returns null when no tag is found.
 *
 * Limitation: `value` is written unescaped, so callers pass validated values,
 * and a ">" inside another attribute's value ends the match early.
 */
export function setTagAttribute(
  content: string,
  tag: string,
  line: number,
  attr: string,
  value: string | null,
): string | null {
  const lines = content.split('\n')
  if (line < 1 || line > lines.length) return null
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'g')
  pattern.lastIndex = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0)
  const match = pattern.exec(content)
  if (!match) return null
  const stripped = match[0].replace(new RegExp(`\\s+${attr}=("[^"]*"|'[^']*')`), '')
  const next = value === null
    ? stripped
    : stripped.replace(/\s*(\/?>)$/, (_, end: string) => ` ${attr}="${value}"${end === '/>' ? ' />' : '>'}`)
  return content.slice(0, match.index) + next + content.slice(match.index + match[0].length)
}

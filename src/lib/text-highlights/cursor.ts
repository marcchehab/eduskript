/**
 * A highlighter-marker mouse cursor tinted with the active pen colour, as a
 * data-URI SVG. Shared by the prose HighlightLayer and the code editor so the
 * cursor is identical wherever the toolbar highlighter is active.
 */
export function highlighterCursor(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M4 20h16' stroke='${color}' stroke-width='3' stroke-linecap='round'/><path d='M5 16.5l8.5-8.5 3 3-8.5 8.5H5z' fill='${color}' stroke='rgba(0,0,0,.6)' stroke-width='1' stroke-linejoin='round'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 20, crosshair`
}

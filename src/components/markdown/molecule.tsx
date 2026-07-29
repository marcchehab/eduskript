/**
 * `<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />`
 *
 * Renders a structural formula as an `<img>` pointing at
 * /api/render/molecule.svg. The drawing library stays on the server (1.1 MB),
 * the page carries a short URL instead of an inline SVG, and the browser caches
 * each molecule — the same `O` on twenty pages is fetched once.
 *
 * An `<img>` (rather than an iframe plugin) is also what makes the drawing
 * usable in tasks: `<ai-feedback>` composites the section's images into what it
 * sends to the vision model, and the pens draw on top of it.
 */

interface MoleculeProps {
  smiles: string
  /** Caption under the drawing — usually the trivial name. */
  name?: string
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 420
const DEFAULT_HEIGHT = 300

function url(smiles: string, width: number, height: number, theme: 'light' | 'dark'): string {
  const params = new URLSearchParams({
    smiles,
    w: String(width),
    h: String(height),
    theme,
  })
  return `/api/render/molecule.svg?${params.toString()}`
}

export function MoleculeDiagram({ smiles, name, width, height }: MoleculeProps) {
  const w = Number.isFinite(width) && width ? width : DEFAULT_WIDTH
  const h = Number.isFinite(height) && height ? height : DEFAULT_HEIGHT

  if (!smiles.trim()) {
    return (
      <span className="my-4 block rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        &lt;molecule&gt; needs a smiles attribute, for example smiles=&quot;CCO&quot;
      </span>
    )
  }

  return (
    <span className="my-4 block">
      {/* Theme switch via .molecule-light / .molecule-dark in globals.css, for
          the same reason the plot uses classes: prose image rules outrank the
          `dark:hidden` utilities and would show both variants stacked. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG from our own route; nothing for the optimizer to do */}
      <img
        src={url(smiles, w, h, 'light')}
        alt={name ? `Strukturformel von ${name}` : `Strukturformel (SMILES ${smiles})`}
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
        className="molecule-light mx-auto h-auto max-w-full"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url(smiles, w, h, 'dark')}
        alt={name ? `Strukturformel von ${name}` : `Strukturformel (SMILES ${smiles})`}
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
        className="molecule-dark mx-auto h-auto max-w-full"
      />
      {name && (
        <span className="mt-2 block text-center text-sm italic text-muted-foreground">{name}</span>
      )}
    </span>
  )
}

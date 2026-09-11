# Chemistry: Molecules & Equations

Two components for chemistry content: `<molecule>` draws a structural formula from a SMILES string, and `\ce{...}` (mhchem, part of KaTeX) typesets a balanced chemical equation. Both are just markup — no chemistry data behind them, so accuracy is on you.

---

## Structural formulas: SMILES

SMILES (Simplified Molecular Input Line Entry System) is the standard text notation for molecules. `<molecule>` renders one as a structural formula image:

```html
<molecule smiles="O" name="Wasser" />
```

<molecule smiles="O" name="Wasser" />

**Attributes:** `smiles` (required), `name` (caption under the drawing), `width` / `height` in px (default 420×300).

### More examples

Caffeine:

```html
<molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Koffein" width="360" height="280" />
```

Aspirin (acetylsalicylic acid):

```html
<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />
```

You don't have to write SMILES from memory: PubChem lists a SMILES string for every substance on its pages, and most structure editors (e.g. ChemDraw, MolView) export it directly. A few to know by heart: `O` is water, `CCO` is ethanol, `c1ccccc1` is benzene (lowercase = aromatic ring atoms).

### Layout, images, annotation

Layout works like an image: drag the handle in the editor preview to resize, or use the alignment buttons to align left/centre/right or wrap text around it — that writes `display-width`, `align`, and `wrap` back into the tag.

The drawing is a normal image, so students can annotate it with the pens, and an `<ai-feedback>` tag in the same section picks it up — the way to build "circle the functional group" or "label the polar bonds" tasks (see **Code Editors & Scoring** for `<ai-feedback>`).

> [!note] Why it looks slightly different from your textbook
> The layout is generated, not drawn: bond angles and where a chain bends are the renderer's choice. Element colours follow the usual convention (O red, N blue), and in dark mode only the black ink is lightened. Broken SMILES don't break the page — the image itself shows what the parser objected to.

---

## Chemical equations: mhchem

For equations, prefer KaTeX's mhchem extension (`\ce{...}`) over hand-rolled `\mathrm{}` — it knows chemistry-specific spacing, subscripts, and arrow types.

**Combustion of methane:**

```latex
$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$
```

$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$

**A reversible reaction (Haber process), with state symbols:**

```latex
$$\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$$
```

$$\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$$

**Acid dissociation, with charges:**

```latex
$$\ce{CH3COOH <=> CH3COO- + H+}$$
```

$$\ce{CH3COOH <=> CH3COO- + H+}$$

`\ce{}` handles the common notation automatically: numbers after an element become subscripts (`H2O`), `+`/`-` after a species become charges, `->` and `<=>` become the right arrow style, and `(g)`/`(l)`/`(s)`/`(aq)` state symbols space correctly. It works inline (`$\ce{H2O}$`) or in a block (`$$\ce{...}$$`) exactly like any other KaTeX expression — see **Math and Graph Plotter** for the general inline/block rules.

---

## Chemistry cheat sheet

| Goal | Syntax |
|------|--------|
| Structural formula from SMILES | `<molecule smiles="CCO" name="Ethanol" />` |
| Sized structural formula | `<molecule smiles="..." width="360" height="280" />` |
| Balanced equation | `$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$` |
| Reversible reaction | `\ce{A <=> B}` |
| State symbols | `\ce{N2(g) + 3H2(g) <=> 2NH3(g)}` |
| Ion charge | `\ce{H+}`, `\ce{CH3COO-}` |

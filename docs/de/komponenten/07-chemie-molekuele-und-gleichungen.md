# Chemie: Moleküle und Gleichungen

Zwei Komponenten für Chemie-Inhalte: `<molecule>` zeichnet eine Strukturformel aus einem SMILES-String, und `\ce{...}` (mhchem, Teil von KaTeX) setzt eine ausgeglichene Reaktionsgleichung. Beides ist nur Markup — dahinter stecken keine Chemiedaten, für die Richtigkeit bist also du zuständig.

---

## Strukturformeln: SMILES

SMILES (Simplified Molecular Input Line Entry System) ist die Standard-Textnotation für Moleküle. `<molecule>` rendert einen SMILES-String als Strukturformel-Bild:

```html
<molecule smiles="O" name="Wasser" />
```

<molecule smiles="O" name="Wasser" />

**Attribute:** `smiles` (erforderlich), `name` (Beschriftung unter der Zeichnung), `width` / `height` in px (Standard 420×300).

### Weitere Beispiele

Koffein:

```html
<molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Koffein" width="360" height="280" />
```

Aspirin (Acetylsalicylsäure):

```html
<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />
```

Du musst SMILES nicht auswendig schreiben: PubChem listet auf seinen Seiten für jede Substanz einen SMILES-String, und die meisten Struktureditoren (z.B. ChemDraw, MolView) exportieren ihn direkt. Ein paar, die man kennen sollte: `O` ist Wasser, `CCO` ist Ethanol, `c1ccccc1` ist Benzol (Kleinbuchstaben = aromatische Ringatome).

### Layout, Bilder, Annotation

Das Layout funktioniert wie bei einem Bild: Ziehe den Griff in der Editor-Vorschau, um die Grösse zu ändern, oder verwende die Ausrichtungs-Buttons, um links/mittig/rechts auszurichten oder Text umfliessen zu lassen — das schreibt `display-width`, `align` und `wrap` zurück in den Tag.

Die Zeichnung ist ein normales Bild, also können Schülerinnen und Schüler sie mit den Stiften annotieren, und ein `<ai-feedback>`-Tag im selben Abschnitt greift sie auf — so baust du Aufgaben wie «Kreise die funktionelle Gruppe ein» oder «Beschrifte die polaren Bindungen» (siehe **Code-Editoren und Bewertung** für `<ai-feedback>`).

> [!note] Warum es etwas anders aussieht als in deinem Lehrbuch
> Das Layout wird generiert, nicht gezeichnet: Bindungswinkel und wo eine Kette knickt, entscheidet der Renderer. Die Elementfarben folgen der üblichen Konvention (O rot, N blau), und im Dark Mode wird nur die schwarze Tinte aufgehellt. Fehlerhafte SMILES machen die Seite nicht kaputt — das Bild selbst zeigt, was der Parser beanstandet hat.

---

## Reaktionsgleichungen: mhchem

Für Gleichungen verwende lieber die mhchem-Erweiterung von KaTeX (`\ce{...}`) statt handgebautem `\mathrm{}` — sie kennt chemiespezifische Abstände, Indizes und Pfeiltypen.

**Verbrennung von Methan:**

```latex
$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$
```

$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$

**Eine reversible Reaktion (Haber-Bosch-Verfahren), mit Aggregatzustandssymbolen:**

```latex
$$\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$$
```

$$\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$$

**Säuredissoziation, mit Ladungen:**

```latex
$$\ce{CH3COOH <=> CH3COO- + H+}$$
```

$$\ce{CH3COOH <=> CH3COO- + H+}$$

`\ce{}` behandelt die übliche Notation automatisch: Zahlen nach einem Element werden zu Indizes (`H2O`), `+`/`-` nach einer Spezies werden zu Ladungen, `->` und `<=>` werden zum richtigen Pfeilstil, und die Zustandssymbole `(g)`/`(l)`/`(s)`/`(aq)` erhalten den korrekten Abstand. Es funktioniert inline (`$\ce{H2O}$`) oder als Block (`$$\ce{...}$$`) genau wie jeder andere KaTeX-Ausdruck — siehe **Mathematik und Funktionsplotter** für die allgemeinen Inline-/Block-Regeln.

---

## Chemie-Spickzettel

| Ziel | Syntax |
|------|--------|
| Strukturformel aus SMILES | `<molecule smiles="CCO" name="Ethanol" />` |
| Strukturformel mit Grössenangabe | `<molecule smiles="..." width="360" height="280" />` |
| Ausgeglichene Gleichung | `$$\ce{CH4 + 2O2 -> CO2 + 2H2O}$$` |
| Reversible Reaktion | `\ce{A <=> B}` |
| Aggregatzustandssymbole | `\ce{N2(g) + 3H2(g) <=> 2NH3(g)}` |
| Ionenladung | `\ce{H+}`, `\ce{CH3COO-}` |

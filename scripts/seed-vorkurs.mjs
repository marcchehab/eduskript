#!/usr/bin/env node
// Seeds the "Vorkurs Mathematik" collection + first skript ("Terme &
// Gleichungen") with a flagship page ("Termumformungen") on the LOCAL dev site,
// as a style/scope calibration unit before building all 5 topic skripts.
// Original examples (not copied from the UZH PDFs), Swiss Hochdeutsch,
// output-only matplotlib + checkered spacers + ai-feedback.
import pg from 'pg'
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'

config()

const TEACHER_EMAIL = 'demo@eduskript.org'
const COLLECTION_TITLE = 'Vorkurs Mathematik'
const SKRIPT_SLUG = 'terme-und-gleichungen'
const SKRIPT_TITLE = 'Terme & Gleichungen'

const parabolaPlot = `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 5, 400)
y = x**2 - 5*x + 6
plt.axhline(0, color='gray', lw=0.8)
plt.plot(x, y)
plt.plot([2, 3], [0, 0], 'o')          # die Nullstellen
plt.annotate('x = 2', (2, 0), textcoords='offset points', xytext=(-5, 10))
plt.annotate('x = 3', (3, 0), textcoords='offset points', xytext=(-5, 10))
plt.title(r'$x^2 - 5x + 6 = (x-2)(x-3)$')
plt.grid(True, alpha=0.3)
plt.show()`

const termumformungen = `# Termumformungen

Bevor wir Gleichungen lösen, Kurven diskutieren oder integrieren, brauchen wir
ein Handwerk: einen Term geschickt **umschreiben**, ohne seinen Wert zu ändern.
Das ist keine Fleissübung, sondern die Sprache, in der später alles andere
geschrieben ist. Wer hier flüssig wird, spart sich in jedem folgenden Kapitel
das Stolpern.

> [!tip] So liest du dieses Kapitel
> Rechne jedes Musterbeispiel **zuerst selbst** auf dem karierten Feld, bevor du
> weiterliest. Verstehen entsteht beim Tun, nicht beim Zuschauen.

## Klammern auflösen

Zwei Werkzeuge genügen fast immer:

- **Distributivgesetz:** $a\\,(b + c) = ab + ac$ — jeder Summand in der Klammer
  wird einzeln multipliziert.
- **Minusklammer:** Ein Minus vor der Klammer **dreht jedes Vorzeichen** darin um:
  $-(b - c) = -b + c$.

Genau diese Minusklammer ist die häufigste Fehlerquelle überhaupt — nicht weil
sie schwierig ist, sondern weil man sie im Eifer übersieht.

**Musterbeispiel.** $(3a - 2)(a + 4)$

Jeder Summand der ersten Klammer mal jeder der zweiten:

$$(3a - 2)(a + 4) = 3a^2 + 12a - 2a - 8 = 3a^2 + 10a - 8$$

**Musterbeispiel (Minusklammer).** $5x - (2x - 7) = 5x - 2x + 7 = 3x + 7$

### Übung 1

Multipliziere aus und fasse zusammen:

a) $2(3x - 4) - (x - 5)$

b) $(x + 2)(x - 5)$

c) $(2a - b)(a + 3b)$

<spacer pattern="checkered" height="260" />

<ai-feedback prompt="Die Schülerin löst Klammer-Aufgaben von Hand. Korrekte Resultate: a) 5x-3, b) x^2-3x-10, c) 2a^2+5ab-3b^2. Prüfe jeden Schritt, achte besonders auf Vorzeichenfehler bei der Minusklammer in a). Benenne den ersten Fehler und die Ursache, verrate aber die Endlösung eines falschen Teils nicht. Kurz, ermutigend, auf Deutsch (Schweizer Hochdeutsch, ss statt ß). Formeln in LaTeX." label="Meine Lösung prüfen" />

## Binomische Formeln

Drei Muster, die du sofort erkennen solltest — vorwärts (ausmultiplizieren) und
**rückwärts** (faktorisieren):

$$(a + b)^2 = a^2 + 2ab + b^2 \\qquad (a - b)^2 = a^2 - 2ab + b^2 \\qquad (a+b)(a-b) = a^2 - b^2$$

Der Trick ist nicht das Vorwärts-Rechnen, sondern das **Wiedererkennen**: Wer in
$9x^2 - 24x + 16$ sofort $(3x - 4)^2$ sieht, spart sich später die Lösungsformel.

**Musterbeispiel (vorwärts).** $(2x + 3)^2 = (2x)^2 + 2\\cdot 2x \\cdot 3 + 3^2 = 4x^2 + 12x + 9$

**Musterbeispiel (rückwärts).** $9x^2 - 24x + 16$: Sind $9x^2 = (3x)^2$ und
$16 = 4^2$ Quadrate, und passt das Mittelglied $2\\cdot 3x\\cdot 4 = 24x$? Ja —
also $9x^2 - 24x + 16 = (3x - 4)^2$.

### Übung 2

a) $(3x - 2)^2$ ausmultiplizieren

b) $(x + 7)(x - 7)$ ausmultiplizieren

c) $25x^2 + 20x + 4$ faktorisieren

d) $16 - 9y^2$ faktorisieren

<spacer pattern="checkered" height="260" />

<ai-feedback prompt="Binomische Formeln von Hand. Korrekte Resultate: a) 9x^2-12x+4, b) x^2-49, c) (5x+2)^2, d) (4-3y)(4+3y). Prüfe bei c) und d), ob die Schülerin die Quadrate und das Mittelglied korrekt erkannt hat. Benenne den ersten Fehler, ohne die Lösung eines falschen Teils zu verraten. Kurz, ermutigend, Schweizer Hochdeutsch (ss statt ß), Formeln in LaTeX." label="Meine Lösung prüfen" />

## Faktorisieren

Faktorisieren heisst: eine Summe als **Produkt** schreiben. Das ist der Schlüssel
zu Nullstellen (ein Produkt ist null, sobald ein Faktor null ist) und zum Kürzen
von Brüchen. Vier Methoden, in dieser Reihenfolge durchprobieren:

1. **Gemeinsamen Faktor ausklammern** — immer zuerst.
   $$12x^3 - 8x^2 = 4x^2(3x - 2)$$
2. **Gruppieren** (bei vier Termen):
   $$x^3 + 2x^2 + 3x + 6 = x^2(x + 2) + 3(x + 2) = (x + 2)(x^2 + 3)$$
3. **Zwei-Klammer-Ansatz** bei $x^2 + px + q$: suche zwei Zahlen mit Produkt $q$
   und Summe $p$.
   $$x^2 - 5x + 6 = (x - 2)(x - 3) \\quad (\\text{denn } (-2)\\cdot(-3)=6,\\ (-2)+(-3)=-5)$$
4. **Quadratische Ergänzung**, wenn nichts davon greift:
   $$x^2 + 6x + 5 = (x + 3)^2 - 4$$

Warum lohnt sich das? Ein faktorisierter Term **zeigt seine Nullstellen direkt**.
$x^2 - 5x + 6 = (x-2)(x-3)$ wird genau bei $x = 2$ und $x = 3$ null — und genau
dort schneidet die Parabel die $x$-Achse:

\`\`\`python editor output-only height="340"
${parabolaPlot}
\`\`\`

### Übung 3

Faktorisiere so weit wie möglich:

a) $12x^3 - 8x^2$

b) $x^2 - 7x + 12$

c) $2x^2 + 7x + 3$

d) $x^3 - x^2 - 6x$

<spacer pattern="checkered" height="300" />

<ai-feedback prompt="Faktorisieren von Hand. Korrekte Resultate: a) 4x^2(3x-2), b) (x-3)(x-4), c) (2x+1)(x+3), d) x(x-3)(x+2). Prüfe bei d), ob zuerst x ausgeklammert und dann der Rest faktorisiert wurde. Benenne den ersten Fehler und welche Methode gepasst hätte, ohne die Lösung eines falschen Teils zu verraten. Kurz, ermutigend, Schweizer Hochdeutsch (ss statt ß), Formeln in LaTeX." label="Meine Lösung prüfen" />

> [!success] Das nimmst du mit
> - Minus vor der Klammer dreht **jedes** Vorzeichen.
> - Binomische Formeln vorwärts *und* rückwärts erkennen.
> - Beim Faktorisieren immer zuerst den gemeinsamen Faktor ausklammern.
> - Ein faktorisierter Term verrät seine Nullstellen gratis.
`

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: u } = await client.query('SELECT id FROM users WHERE email=$1', [TEACHER_EMAIL])
  if (!u.length) throw new Error(`User ${TEACHER_EMAIL} not found`)
  const userId = u[0].id
  const { rows: s } = await client.query('SELECT id, slug FROM sites WHERE user_id=$1', [userId])
  if (!s.length) throw new Error('No site')
  const siteId = s[0].id, siteSlug = s[0].slug

  // Idempotent: drop a prior run of this skript.
  const { rows: prior } = await client.query(
    `SELECT sk.id FROM skripts sk JOIN skript_authors sa ON sa."skriptId"=sk.id AND sa."userId"=$1 WHERE sk.slug=$2`,
    [userId, SKRIPT_SLUG]
  )
  for (const p of prior) await client.query('DELETE FROM skripts WHERE id=$1', [p.id])

  // Reuse an existing "Vorkurs Mathematik" collection or create one.
  let collectionId
  const { rows: col } = await client.query(
    `SELECT id FROM collections WHERE site_id=$1 AND title=$2`, [siteId, COLLECTION_TITLE]
  )
  if (col.length) {
    collectionId = col[0].id
  } else {
    collectionId = randomUUID()
    await client.query(
      `INSERT INTO collections (id, title, site_id, "createdAt", "updatedAt") VALUES ($1,$2,$3,NOW(),NOW())`,
      [collectionId, COLLECTION_TITLE, siteId]
    )
  }

  const skriptId = randomUUID()
  await client.query(
    `INSERT INTO skripts (id, title, description, slug, skript_type, "isPublished", "isUnlisted", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'normal',true,false,NOW(),NOW())`,
    [skriptId, SKRIPT_TITLE, 'Zahlenmengen, Termumformungen, Wurzeln & Potenzen, Gleichungen & Ungleichungen.', SKRIPT_SLUG]
  )
  await client.query(
    `INSERT INTO skript_authors (id, "skriptId", "userId", permission, "createdAt") VALUES ($1,$2,$3,'author',NOW())`,
    [randomUUID(), skriptId, userId]
  )
  const { rows: maxOrd } = await client.query(
    `SELECT COALESCE(MAX("order"),-1) AS m FROM collection_skripts WHERE "collectionId"=$1`, [collectionId]
  )
  await client.query(
    `INSERT INTO collection_skripts (id, "collectionId", "skriptId", "order", "createdAt") VALUES ($1,$2,$3,$4,NOW())`,
    [randomUUID(), collectionId, skriptId, maxOrd[0].m + 1]
  )

  const pageId = randomUUID()
  await client.query(
    `INSERT INTO pages (id, title, slug, content, "order", "isPublished", page_type, "skriptId", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,0,true,'normal',$5,NOW(),NOW())`,
    [pageId, 'Termumformungen', 'termumformungen', termumformungen, skriptId]
  )
  await client.query(
    `INSERT INTO page_authors (id, "pageId", "userId", permission, "createdAt") VALUES ($1,$2,$3,'author',NOW())`,
    [randomUUID(), pageId, userId]
  )

  // Ensure the collection is in the sidebar layout.
  const layout = await client.query(
    `INSERT INTO page_layouts (id, site_id, created_at, updated_at) VALUES ($1,$2,NOW(),NOW())
     ON CONFLICT (site_id) DO UPDATE SET updated_at=NOW() RETURNING id`,
    [randomUUID(), siteId]
  )
  const layoutId = layout.rows[0].id
  const exists = await client.query(
    `SELECT 1 FROM page_layout_items WHERE page_layout_id=$1 AND content_id=$2 AND type='collection'`,
    [layoutId, collectionId]
  )
  if (!exists.rows.length) {
    const { rows: mx } = await client.query(
      `SELECT COALESCE(MAX("order"),-1) AS m FROM page_layout_items WHERE page_layout_id=$1`, [layoutId]
    )
    await client.query(
      `INSERT INTO page_layout_items (id, page_layout_id, type, content_id, "order", created_at) VALUES ($1,$2,'collection',$3,$4,NOW())`,
      [randomUUID(), layoutId, collectionId, mx[0].m + 1]
    )
  }

  await client.query('COMMIT')
  console.log('public:', `http://localhost:3000/${siteSlug}/${SKRIPT_SLUG}/termumformungen`)
} catch (e) {
  await client.query('ROLLBACK'); console.error(e); process.exitCode = 1
} finally {
  await client.end()
}

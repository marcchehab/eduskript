# Übungen: Vektoren als Pfeile

> [!info] So arbeiten Sie hier
> Zeichnen und rechnen Sie direkt mit dem Stift in die Abbildungen und karierten Felder. Ein Häuschen hat die Länge $1$. Aufgaben mit ⭐ sind anspruchsvoller.

## 1 Pfeile vergleichen

> [!abstract] Aufgabe 1
> Betrachten Sie die acht Pfeile.
>
> a) Welche Pfeile stellen denselben Vektor dar wie ①? &emsp; b) Welcher Pfeil stellt den Gegenvektor von ① dar?
>
> c) Wie hängen ⑤ und ⑧ zusammen? &emsp; d) Vergleichen Sie ⑦ mit ①: Richtung? Länge?
>
> e) Berechnen Sie den Betrag von ① und von ⑤. Geben Sie das Resultat exakt an (Wurzel stehen lassen) und gerundet auf zwei Dezimalen.

<excali src="pfeile-sortieren" alt="Acht Pfeile auf Karopapier" />

<spacer pattern="checkered" height="200" />

<solution title="Lösung 1">

**Vorgehen:** Zählen Sie bei jedem Pfeil vom Schaft zur Spitze, wie viele Häuschen er nach rechts/links und nach oben/unten geht. Zwei Pfeile stellen genau dann denselben Vektor dar, wenn beide Zahlen übereinstimmen. Wo der Pfeil liegt, spielt keine Rolle.

① geht 3 nach rechts und 2 nach oben.

a) ② und ⑥ gehen ebenfalls je 3 nach rechts und 2 nach oben, also derselbe Vektor wie ①.

b) Der Gegenvektor hat dieselbe Länge, zeigt aber genau in die Gegenrichtung: 3 nach links, 2 nach unten. Das ist ③.

c) ⑤ und ⑧ sind gleich lang (je 3 Häuschen) und liegen parallel, zeigen aber in entgegengesetzte Richtungen. Sie sind also Gegenvektoren: ⑧ $= -$⑤.

d) ⑦ geht 6 nach rechts und 4 nach oben: Jede Zahl ist doppelt so gross wie bei ①. Also gleiche Richtung, doppelte Länge. Vorgriff: ⑦ $= 2\cdot$①.

e) Der Pfeil ① ist die Hypotenuse eines rechtwinkligen Dreiecks mit den Katheten 3 und 2. Mit Pythagoras:

$$|①| = \sqrt{3^2 + 2^2} = \sqrt{9 + 4} = \sqrt{13} \approx 3{,}61$$

⑤ verläuft waagrecht (bzw. senkrecht), die Länge lässt sich direkt abzählen: $|⑤| = 3$.

Zum Nachdenken: ④ (2 nach rechts, 3 nach oben) ist mit $\sqrt{2^2 + 3^2} = \sqrt{13}$ gleich lang wie ①, hat aber eine andere Richtung. Darum ist ④ **nicht** derselbe Vektor.

</solution>

> [!abstract] Aufgabe 2
> Zeichnen Sie in die Abbildung:
>
> a) $\vec{u}$ mit Schaft in $P$ &emsp; b) $-\vec{v}$ mit Schaft in $Q$
>
> c) $\vec{w}$ mit Schaft in $R$ &emsp; d) $-\vec{u}$ mit Schaft in $S$

<excali src="uvw" alt="Die Vektoren u, v, w und vier Startpunkte" />

<solution title="Lösung 2">

<excali src="uvw-loesung" alt="Lösung: u ab P, −v ab Q, w ab R, −u ab S" />

**Vorgehen:** Lesen Sie zuerst ab, wie viele Häuschen $\vec{u}$, $\vec{v}$ und $\vec{w}$ gehen:

- $\vec{u}$: 3 nach rechts, 1 nach oben
- $\vec{v}$: 2 nach rechts, 2 nach unten
- $\vec{w}$: 1 nach links, 2 nach unten

Dann tragen Sie dieselben Schritte vom neuen Startpunkt aus ab. Beim Gegenvektor kehren Sie beide Richtungen um (rechts ↔ links, oben ↔ unten).

a) Ab $P$: 3 nach rechts, 1 nach oben (einfach $\vec{u}$ verschieben).

b) $-\vec{v}$: aus «2 rechts, 2 unten» wird «2 links, 2 oben». Ab $Q$ abtragen.

c) Ab $R$: 1 nach links, 2 nach unten.

d) $-\vec{u}$: aus «3 rechts, 1 oben» wird «3 links, 1 unten». Ab $S$ abtragen.

</solution>

> [!abstract] Aufgabe 3
> Richtig oder falsch? Begründen Sie kurz.
>
> a) Zwei gleich lange Pfeile stellen immer denselben Vektor dar.
>
> b) Für alle Punkte $A$ und $B$ gilt $\vec{AB} = -\vec{BA}$.
>
> c) Ein Vektor und sein Gegenvektor haben denselben Betrag.
>
> d) Wenn $\vec{AB} = \vec{CD}$ gilt, dann ist $A = C$.

<spacer pattern="checkered" height="200" />

<solution title="Lösung 3">

**Vorgehen:** Ein Vektor ist durch **Länge und Richtung** festgelegt, nicht durch seinen Ort. Prüfen Sie jede Aussage daran, und suchen Sie bei «falsch» ein Gegenbeispiel.

a) **Falsch.** Gleiche Länge reicht nicht, auch die Richtung muss stimmen. Gegenbeispiel: ① und ④ aus Aufgabe 1 sind beide $\sqrt{13}$ lang, zeigen aber verschieden.

b) **Richtig.** $\vec{BA}$ ist derselbe Pfeil wie $\vec{AB}$, nur mit vertauschtem Schaft und Spitze. Er hat also dieselbe Länge und die entgegengesetzte Richtung, ist also der Gegenvektor: $\vec{BA} = -\vec{AB}$, und damit auch $\vec{AB} = -\vec{BA}$.

c) **Richtig.** Der Gegenvektor ändert nur die Richtung, nicht die Länge: $|-\vec{a}| = |\vec{a}|$.

d) **Falsch.** Gleiche Vektoren dürfen an verschiedenen Orten beginnen. Gegenbeispiel: Bei einem Parallelogramm $ABCD$ gilt $\vec{AB} = \vec{DC}$, obwohl $A \neq D$.

</solution>

## 2 Addieren und subtrahieren

> [!abstract] Aufgabe 4
> Zeichnen Sie in die Abbildung. Zeichnen Sie jeweils zuerst die Einzelpfeile der Reihe nach Spitze an Schaft und dann das Ergebnis in einer anderen Farbe.
>
> a) $\vec{u} + \vec{v}$ ab $P$ &emsp; b) $\vec{v} - \vec{w}$ ab $Q$
>
> c) $\vec{u} + \vec{v} + \vec{w}$ ab $R$ &emsp; d) $\vec{u} - \vec{v}$ ab $S$
>
> e) Wie viele Häuschen geht jeder Ergebnispfeil nach rechts oder links und wie viele nach oben oder unten?

<excali src="uvw" alt="Die Vektoren u, v, w und vier Startpunkte" />

<solution title="Lösung 4">

<excali src="uvw-loesung-4" alt="Lösung: Einzelpfeile Spitze an Schaft, Ergebnis violett: a) u+v ab P, b) v−w ab Q, c) u+v+w ab R, d) u−v ab S" />

**Vorgehen:** Hängen Sie die Pfeile hintereinander: Der nächste Pfeil beginnt dort, wo der vorherige endet (Spitze an Schaft). Der Ergebnispfeil geht vom allerersten Schaft zur allerletzten Spitze. Eine Subtraktion schreiben Sie als Addition des Gegenvektors: $\vec{v} - \vec{w} = \vec{v} + (-\vec{w})$.

Zur Erinnerung: $\vec{u}$ = 3 rechts, 1 oben; $\vec{v}$ = 2 rechts, 2 unten; $\vec{w}$ = 1 links, 2 unten.

a) $\vec{u} + \vec{v}$: Ab $P$ zuerst 3 rechts, 1 oben, dann 2 rechts, 2 unten.
Waagrecht: $3 + 2 = 5$ nach rechts. Senkrecht: 1 hoch, 2 runter, also 1 nach unten.
**Ergebnis: 5 nach rechts, 1 nach unten.**

b) $\vec{v} - \vec{w} = \vec{v} + (-\vec{w})$, wobei $-\vec{w}$ = 1 rechts, 2 oben.
Ab $Q$: 2 rechts, 2 unten, dann 1 rechts, 2 oben.
Waagrecht: $2 + 1 = 3$ nach rechts. Senkrecht: 2 runter, 2 hoch, also 0.
**Ergebnis: 3 nach rechts, weder hoch noch runter.**

c) $\vec{u} + \vec{v} + \vec{w}$: Ab $R$ alle drei Pfeile hintereinander.
Waagrecht: 3 rechts + 2 rechts + 1 links = 4 nach rechts. Senkrecht: 1 hoch, 2 runter, 2 runter = 3 nach unten.
**Ergebnis: 4 nach rechts, 3 nach unten.**

d) $\vec{u} - \vec{v} = \vec{u} + (-\vec{v})$, wobei $-\vec{v}$ = 2 links, 2 oben.
Ab $S$: 3 rechts, 1 oben, dann 2 links, 2 oben.
Waagrecht: 3 rechts, 2 links = 1 nach rechts. Senkrecht: 1 + 2 = 3 nach oben.
**Ergebnis: 1 nach rechts, 3 nach oben.**

e) Siehe die fett gedruckten Ergebnisse. Beobachtung: Man muss gar nicht zeichnen, die Häuschenzahlen addieren (bzw. subtrahieren) sich einfach. Das ist der Vorgriff auf das Rechnen mit Koordinaten.

</solution>

> [!abstract] Aufgabe 5
> $ABCD$ ist ein Parallelogramm mit $\vec{a} = \vec{AB}$ und $\vec{b} = \vec{AD}$. Drücken Sie durch $\vec{a}$ und $\vec{b}$ aus:
>
> a) $\vec{DC}$ &emsp; b) $\vec{CB}$ &emsp; c) $\vec{BA}$ &emsp; d) $\vec{AC}$ &emsp; e) $\vec{BD}$ &emsp; f) $\vec{CA}$

<excali src="parallelogramm" alt="Parallelogramm ABCD mit a = AB und b = AD, Diagonalen schneiden sich in M" />

<spacer pattern="checkered" height="200" />

<solution title="Lösung 5">

**Vorgehen:** Im Parallelogramm sind gegenüberliegende Seiten gleich lang und parallel. Darum gilt $\vec{DC} = \vec{AB} = \vec{a}$ und $\vec{BC} = \vec{AD} = \vec{b}$. Für alle anderen Pfeile suchen Sie einen Weg entlang der Seiten vom Start- zum Endpunkt (Vektorzug) und addieren die Seitenvektoren. Gehen Sie eine Seite «gegen den Pfeil», bekommt sie ein Minus.

a) $DC$ ist parallel und gleich gerichtet wie $AB$: $\vec{DC} = \vec{a}$.

b) $CB$ ist die Seite $BC$ rückwärts durchlaufen: $\vec{CB} = -\vec{BC} = -\vec{b}$.

c) $\vec{BA} = -\vec{AB} = -\vec{a}$.

d) Weg von $A$ nach $C$ über $B$: $\vec{AC} = \vec{AB} + \vec{BC} = \vec{a} + \vec{b}$.

e) Weg von $B$ nach $D$ über $A$: $\vec{BD} = \vec{BA} + \vec{AD} = -\vec{a} + \vec{b} = \vec{b} - \vec{a}$.
Merkhilfe: $\vec{b} - \vec{a}$ zeigt von der Spitze von $\vec{a}$ zur Spitze von $\vec{b}$ («Ziel minus Start»).

f) $\vec{CA}$ ist $\vec{AC}$ rückwärts: $\vec{CA} = -(\vec{a} + \vec{b}) = -\vec{a} - \vec{b}$.

</solution>

> [!abstract] Aufgabe 6
> Vereinfachen Sie so weit wie möglich.
>
> a) $\vec{AB} + \vec{BC} + \vec{CD}$ &emsp; b) $\vec{AB} - \vec{CB}$ &emsp; c) $\vec{PQ} + \vec{RP}$
>
> d) $\vec{MA} - \vec{MB}$ &emsp; e) $\vec{AB} - \vec{AC} + \vec{BC}$

<spacer pattern="checkered" height="200" />

<solution title="Lösung 6">

**Vorgehen:** Zwei Werkzeuge genügen:

1. **Minus umdrehen:** $-\vec{XY} = \vec{YX}$ (Schaft und Spitze tauschen).
2. **Kette schliessen:** $\vec{XY} + \vec{YZ} = \vec{XZ}$, wenn die Spitze des ersten Pfeils der Schaft des zweiten ist. Dazu darf man die Summanden vertauschen.

a) Die Pfeile bilden schon eine Kette $A \to B \to C \to D$:
$\vec{AB} + \vec{BC} + \vec{CD} = \vec{AD}$

b) Minus umdrehen, dann Kette:
$\vec{AB} - \vec{CB} = \vec{AB} + \vec{BC} = \vec{AC}$

c) Reihenfolge tauschen, damit eine Kette entsteht ($R \to P \to Q$):
$\vec{PQ} + \vec{RP} = \vec{RP} + \vec{PQ} = \vec{RQ}$

d) Minus umdrehen, tauschen, Kette ($B \to M \to A$):
$\vec{MA} - \vec{MB} = \vec{MA} + \vec{BM} = \vec{BM} + \vec{MA} = \vec{BA}$

e) Minus umdrehen, dann so ordnen, dass eine Kette $C \to A \to B \to C$ entsteht:
$\vec{AB} - \vec{AC} + \vec{BC} = \vec{AB} + \vec{CA} + \vec{BC} = \vec{CA} + \vec{AB} + \vec{BC} = \vec{CC} = \vec{0}$
Man landet wieder am Startpunkt, also ist das Ergebnis der **Nullvektor** $\vec{0}$ (nicht die Zahl $0$).

</solution>

<ai-feedback prompt="Abschnitt 2 (Addieren und subtrahieren, ohne Koordinaten). Aufgabe 4: u = 3 rechts/1 oben, v = 2 rechts/2 unten, w = 1 links/2 unten. Ergebnisse: a) u+v = 5 rechts, 1 unten; b) v−w = 3 rechts, 0; c) u+v+w = 4 rechts, 3 unten; d) u−v = 1 rechts, 3 oben. Aufgabe 5 (Parallelogramm ABCD, a = AB, b = AD): DC = a, CB = −b, BA = −a, AC = a+b, BD = b−a, CA = −a−b. Aufgabe 6: a) AD, b) AC, c) RQ, d) BA, e) Nullvektor. Typische Fehler: Pfeile nicht Spitze an Schaft gehängt; bei a−b die Richtung vertauscht (BD = a−b statt b−a); Minus vor einem Pfeil nicht als Vertauschen von Schaft und Spitze gelesen; bei e) 0 statt Nullvektor geschrieben (kleiner Hinweis genügt). Gib ermutigendes, konkretes Feedback in der Höflichkeitsform (Sie) auf Schweizer Hochdeutsch, ohne vollständige Lösungen vorzusagen." label="Meine Lösung prüfen lassen" />

## 3 Vielfache und Rechenregeln

> [!abstract] Aufgabe 7
> Zeichnen Sie ins karierte Feld einen Pfeil $\vec{a}$ (3 Häuschen nach rechts, 1 nach oben) und einen Pfeil $\vec{b}$ (1 nach rechts, 2 nach unten). Zeichnen Sie dann, jeweils von einem neuen Startpunkt aus:
>
> a) $2\vec{a}$ &emsp; b) $-1{,}5\,\vec{b}$ &emsp; c) $2\vec{a} + \vec{b}$ &emsp; d) $\vec{a} - 2\vec{b}$ &emsp; e) $\frac{1}{2}(\vec{a} + \vec{b})$

<spacer pattern="checkered" height="300" />

<solution title="Lösung 7">

**Vorgehen:** $k \cdot \vec{a}$ heisst: beide Häuschenzahlen mit $k$ multiplizieren. Ist $k$ negativ, kehrt sich zusätzlich die Richtung um. Bei Summen zuerst die Vielfachen bilden, dann Spitze an Schaft hängen (oder einfach die Häuschenzahlen addieren).

Notation: «rechts» und «oben» positiv, «links» und «unten» negativ. Also $\vec{a}$: rechts $3$, oben $1$; $\vec{b}$: rechts $1$, oben $-2$.

a) $2\vec{a}$: $2 \cdot 3 = 6$ rechts, $2 \cdot 1 = 2$ oben. **6 rechts, 2 oben.**

b) $-1{,}5\,\vec{b}$: $-1{,}5 \cdot 1 = -1{,}5$ (also links), $-1{,}5 \cdot (-2) = 3$ (also oben). **1,5 links, 3 oben.** Der Pfeil ist anderthalbmal so lang wie $\vec{b}$ und zeigt in die Gegenrichtung.

c) $2\vec{a} + \vec{b}$: $2\vec{a}$ = 6 rechts, 2 oben; dazu $\vec{b}$ = 1 rechts, 2 unten.
Waagrecht $6 + 1 = 7$, senkrecht $2 - 2 = 0$. **7 rechts, weder hoch noch runter.**

d) $\vec{a} - 2\vec{b} = \vec{a} + (-2\vec{b})$, wobei $-2\vec{b}$ = 2 links, 4 oben.
Waagrecht $3 - 2 = 1$, senkrecht $1 + 4 = 5$. **1 rechts, 5 oben.**

e) Zuerst die Klammer: $\vec{a} + \vec{b}$ = 4 rechts, 1 unten. Dann halbieren: **2 rechts, 0,5 unten.**

</solution>

> [!abstract] Aufgabe 8
> Vereinfachen Sie so weit wie möglich.
>
> a) $3\vec{a} + 2\vec{b} - \vec{a} + 4\vec{b}$ &emsp; b) $2(\vec{a} - 3\vec{b}) - 3(\vec{a} - 2\vec{b})$
>
> c) $\frac{1}{2}(4\vec{a} + 2\vec{b}) - (\vec{a} - \vec{b})$ &emsp; d) $-(\vec{b} - \vec{a}) + 2\vec{b}$

<spacer pattern="checkered" height="200" />

<solution title="Lösung 8">

**Vorgehen:** Rechnen Sie wie in der Algebra mit $3x + 2y - x + 4y$: Klammern ausmultiplizieren (Vorzeichen beachten!), dann gleichartige Terme zusammenfassen, also alle $\vec{a}$ zusammen und alle $\vec{b}$ zusammen.

a) Nur zusammenfassen:
$$3\vec{a} - \vec{a} + 2\vec{b} + 4\vec{b} = 2\vec{a} + 6\vec{b}$$

b) Ausmultiplizieren. Achtung: $-3 \cdot (-2\vec{b}) = +6\vec{b}$.
$$2\vec{a} - 6\vec{b} - 3\vec{a} + 6\vec{b} = (2 - 3)\vec{a} + (-6 + 6)\vec{b} = -\vec{a}$$

c) Ausmultiplizieren. Das Minus vor der Klammer dreht beide Vorzeichen um.
$$2\vec{a} + \vec{b} - \vec{a} + \vec{b} = \vec{a} + 2\vec{b}$$

d) Minus vor der Klammer: $-(\vec{b} - \vec{a}) = -\vec{b} + \vec{a}$.
$$\vec{a} - \vec{b} + 2\vec{b} = \vec{a} + \vec{b}$$

</solution>

> [!abstract] Aufgabe 9
> Lösen Sie die Gleichungen nach dem Vektor $\vec{x}$ auf. Gehen Sie vor wie bei einer Gleichung mit Zahlen.
>
> a) $\vec{a} + \vec{x} = \vec{b}$ &emsp; b) $2\vec{x} - \vec{a} = \vec{b}$ &emsp; c) $3(\vec{x} - \vec{a}) = \vec{x} + \vec{b}$

<spacer pattern="checkered" height="200" />

<solution title="Lösung 9">

**Vorgehen:** Wie bei $a + x = b$: Auf beiden Seiten dasselbe addieren oder subtrahieren, bis $\vec{x}$ allein steht. Zum Schluss mit einer **Zahl** multiplizieren (z.B. $\cdot\frac{1}{2}$). Durch einen Vektor teilen ist dagegen nicht erlaubt.

a)
$$\begin{aligned} \vec{a} + \vec{x} &= \vec{b} && \mid -\vec{a} \\ \vec{x} &= \vec{b} - \vec{a} \end{aligned}$$

Kontrolle mit dem Bild: $\vec{x}$ ist der Pfeil, den man an $\vec{a}$ hängen muss, um bei $\vec{b}$ zu landen, also von der Spitze von $\vec{a}$ zur Spitze von $\vec{b}$.

b)
$$\begin{aligned} 2\vec{x} - \vec{a} &= \vec{b} && \mid +\vec{a} \\ 2\vec{x} &= \vec{a} + \vec{b} && \mid \cdot \tfrac{1}{2} \\ \vec{x} &= \tfrac{1}{2}(\vec{a} + \vec{b}) \end{aligned}$$

c)
$$\begin{aligned} 3(\vec{x} - \vec{a}) &= \vec{x} + \vec{b} && \text{Klammer auflösen} \\ 3\vec{x} - 3\vec{a} &= \vec{x} + \vec{b} && \mid -\vec{x} \\ 2\vec{x} - 3\vec{a} &= \vec{b} && \mid +3\vec{a} \\ 2\vec{x} &= 3\vec{a} + \vec{b} && \mid \cdot \tfrac{1}{2} \\ \vec{x} &= 1{,}5\,\vec{a} + 0{,}5\,\vec{b} \end{aligned}$$

Probe (zu c): Links $3(1{,}5\,\vec{a} + 0{,}5\,\vec{b} - \vec{a}) = 3(0{,}5\,\vec{a} + 0{,}5\,\vec{b}) = 1{,}5\,\vec{a} + 1{,}5\,\vec{b}$. Rechts $1{,}5\,\vec{a} + 0{,}5\,\vec{b} + \vec{b} = 1{,}5\,\vec{a} + 1{,}5\,\vec{b}$. ✓

</solution>

## 4 Vektorzüge in Figuren

> [!abstract] Aufgabe 10
> Im Parallelogramm schneiden sich die Diagonalen im Punkt $M$, und $M$ halbiert beide Diagonalen. Drücken Sie durch $\vec{a}$ und $\vec{b}$ aus:
>
> a) $\vec{AM}$ &emsp; b) $\vec{MB}$ &emsp; c) $\vec{MD}$ &emsp; d) $\vec{CM}$
>
> e) $K$ ist der Mittelpunkt der Seite $BC$. Zeichnen Sie $K$ in die Abbildung ein und drücken Sie $\vec{AK}$ und $\vec{DK}$ durch $\vec{a}$ und $\vec{b}$ aus.

<excali src="parallelogramm" alt="Parallelogramm ABCD mit a = AB und b = AD, Diagonalen schneiden sich in M" />

<spacer pattern="checkered" height="250" />

<solution title="Lösung 10">

**Vorgehen:** Aus Aufgabe 5 kennen Sie die Diagonalen: $\vec{AC} = \vec{a} + \vec{b}$ und $\vec{BD} = \vec{b} - \vec{a}$. Da $M$ beide Diagonalen halbiert, ist jedes Teilstück die **Hälfte** einer Diagonale. Für Punkte, die nicht auf einer Diagonale liegen, gehen Sie einen Umweg über bekannte Pfeile (Vektorzug).

a) $M$ liegt in der Mitte von $AC$:
$$\vec{AM} = \tfrac{1}{2}\vec{AC} = \tfrac{1}{2}(\vec{a} + \vec{b})$$

b) $M$ liegt auch in der Mitte von $BD$, also ist $\vec{MB}$ die halbe Diagonale von $D$ nach $B$:
$$\vec{MB} = \tfrac{1}{2}\vec{DB} = \tfrac{1}{2}(\vec{a} - \vec{b})$$
Alternativ als Vektorzug über $A$: $\vec{MB} = \vec{MA} + \vec{AB} = -\tfrac{1}{2}(\vec{a} + \vec{b}) + \vec{a} = \tfrac{1}{2}\vec{a} - \tfrac{1}{2}\vec{b}$. Gleiches Ergebnis.

c) $\vec{MD}$ ist die andere Hälfte von $\vec{BD}$:
$$\vec{MD} = \tfrac{1}{2}\vec{BD} = \tfrac{1}{2}(\vec{b} - \vec{a})$$
(Das ist genau $-\vec{MB}$, passt also zu b.)

d) $\vec{CM}$ ist die hintere Hälfte von $\vec{AC}$, aber rückwärts durchlaufen:
$$\vec{CM} = -\vec{AM} = -\tfrac{1}{2}(\vec{a} + \vec{b})$$

e) $K$ halbiert die Seite $BC$, und $\vec{BC} = \vec{b}$. Also $\vec{BK} = \frac{1}{2}\vec{b}$ und $\vec{CK} = -\frac{1}{2}\vec{b}$.

Weg von $A$ über $B$ nach $K$:
$$\vec{AK} = \vec{AB} + \vec{BK} = \vec{a} + \tfrac{1}{2}\vec{b}$$

Weg von $D$ über $C$ nach $K$:
$$\vec{DK} = \vec{DC} + \vec{CK} = \vec{a} - \tfrac{1}{2}\vec{b}$$

</solution>

> [!abstract] Aufgabe 11 ⭐
> Das Sechseck $ABCDEF$ ist regelmässig, $M$ ist sein Mittelpunkt, $\vec{u} = \vec{MA}$ und $\vec{v} = \vec{MB}$. Tipp: Das Sechseck besteht aus sechs gleichseitigen Dreiecken, deshalb ist zum Beispiel $MABC$ ein Parallelogramm (eine Raute).
>
> Drücken Sie durch $\vec{u}$ und $\vec{v}$ aus:
>
> a) $\vec{MD}$ &emsp; b) $\vec{ME}$ &emsp; c) $\vec{MC}$ &emsp; d) $\vec{MF}$
>
> e) $\vec{AB}$ &emsp; f) $\vec{AD}$ &emsp; g) $\vec{AC}$ &emsp; h) $\vec{EC}$

<excali src="sechseck" alt="Regelmässiges Sechseck ABCDEF mit Mittelpunkt M, u = MA und v = MB" />

<spacer pattern="checkered" height="300" />

<solution title="Lösung 11">

**Vorgehen:** Drei Beobachtungen tragen die ganze Aufgabe:

1. **Gegenüberliegende Ecken:** $M$ ist die Mitte jeder langen Diagonale. $D$ liegt $A$ gegenüber, $E$ liegt $B$ gegenüber, $F$ liegt $C$ gegenüber. Darum ist z.B. $\vec{MD} = -\vec{MA}$.
2. **Raute $MABC$:** Gegenüberliegende Seiten sind parallel und gleich lang, also $\vec{MC} = \vec{AB}$ (und $\vec{BC} = \vec{MD}$).
3. **Vektorzug über $M$:** Jeden Pfeil $\vec{XY}$ kann man als $\vec{XM} + \vec{MY}$ schreiben. Die Pfeile von $M$ zu den Ecken kennt man nach a) bis d).

a) $D$ liegt $A$ gegenüber: $\vec{MD} = -\vec{MA} = -\vec{u}$.

b) $E$ liegt $B$ gegenüber: $\vec{ME} = -\vec{MB} = -\vec{v}$.

e) (zuerst, weil c) es braucht) Weg von $A$ über $M$ nach $B$:
$$\vec{AB} = \vec{AM} + \vec{MB} = -\vec{u} + \vec{v} = \vec{v} - \vec{u}$$

c) In der Raute $MABC$ ist $MC$ parallel und gleich lang wie $AB$:
$$\vec{MC} = \vec{AB} = \vec{v} - \vec{u}$$

d) $F$ liegt $C$ gegenüber:
$$\vec{MF} = -\vec{MC} = -(\vec{v} - \vec{u}) = \vec{u} - \vec{v}$$

f) $AD$ ist die lange Diagonale durch $M$, also zweimal $\vec{AM}$:
$$\vec{AD} = \vec{AM} + \vec{MD} = -\vec{u} + (-\vec{u}) = -2\vec{u}$$

g) Weg über $M$:
$$\vec{AC} = \vec{AM} + \vec{MC} = -\vec{u} + (\vec{v} - \vec{u}) = \vec{v} - 2\vec{u}$$

h) Weg über $M$, mit $\vec{EM} = -\vec{ME} = \vec{v}$:
$$\vec{EC} = \vec{EM} + \vec{MC} = \vec{v} + (\vec{v} - \vec{u}) = 2\vec{v} - \vec{u}$$

Kontrolle: Alle Ergebnisse sind mit den Koordinaten eines regelmässigen Sechsecks nachgerechnet.

</solution>

<ai-feedback prompt="Abschnitte 3 und 4 (Vielfache, Rechenregeln, Vektorzüge). Aufgabe 7 mit a = 3 rechts/1 oben, b = 1 rechts/2 unten: 2a = 6 rechts/2 oben; −1,5b = 1,5 links/3 oben; 2a+b = 7 rechts/0; a−2b = 1 rechts/5 oben; ½(a+b) = 2 rechts/0,5 unten. Aufgabe 8: a) 2a+6b, b) −a, c) a+2b, d) a+b. Aufgabe 9: a) x = b−a, b) x = ½(a+b), c) x = 1,5a + 0,5b. Aufgabe 10 (Parallelogramm ABCD, a = AB, b = AD, M Diagonalenschnittpunkt, K Mitte von BC): AM = ½(a+b), MB = ½(a−b), MD = ½(b−a), CM = −½(a+b), AK = a + ½b, DK = a − ½b. Aufgabe 11 (regelmässiges Sechseck, u = MA, v = MB): MD = −u, ME = −v, MC = v−u, MF = u−v, AB = v−u, AD = −2u, AC = v−2u, EC = 2v−u. Typische Fehler: Vorzeichen beim Ausmultiplizieren (−3·(−2b) = +6b); bei Gleichungen durch einen Vektor geteilt; Richtung bei Differenzen vertauscht. Lobe kurze Begründungen mit Vektorzügen. Gib ermutigendes, konkretes Feedback in der Höflichkeitsform (Sie) auf Schweizer Hochdeutsch, ohne vollständige Lösungen vorzusagen." label="Meine Lösung prüfen lassen" />

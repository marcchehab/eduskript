# Rechnen mit Pfeilen

> [!lernziele] Lernziele
> - Sie können zwei Vektoren zeichnerisch addieren und subtrahieren.
> - Sie können Vielfache eines Vektors zeichnen.
> - Sie können Vektorzüge vereinfachen, zum Beispiel $\vec{AB} + \vec{BC} = \vec{AC}$.

Auf dieser Seite rechnen wir nur mit Pfeilen, ganz ohne Koordinaten.

## Addition: zwei Verschiebungen nacheinander

Verschieben Sie einen Punkt zuerst um $\textcolor{orange}{\vec{a}}$ und danach um $\textcolor{dodgerblue}{\vec{b}}$. Insgesamt haben Sie ihn um eine einzige Verschiebung bewegt. Diese Gesamtverschiebung heisst **Summe** $\textcolor{mediumseagreen}{\vec{a} + \vec{b}}$.

<excali src="addition" alt="Links: b wird an die Spitze von a gehängt. Rechts: Beide Wege um das Parallelogramm führen zum selben Punkt." />

> [!info] Addition von Vektoren
> **Spitze an Schaft:** Zeichnen Sie $\textcolor{orange}{\vec{a}}$. Hängen Sie den Schaft von $\textcolor{dodgerblue}{\vec{b}}$ an die Spitze von $\textcolor{orange}{\vec{a}}$. Der Pfeil vom Schaft von $\textcolor{orange}{\vec{a}}$ zur Spitze von $\textcolor{dodgerblue}{\vec{b}}$ ist $\textcolor{mediumseagreen}{\vec{a} + \vec{b}}$.
>
> **Parallelogramm:** Zeichnen Sie $\textcolor{orange}{\vec{a}}$ und $\textcolor{dodgerblue}{\vec{b}}$ vom selben Punkt aus. Die Diagonale des Parallelogramms ist $\textcolor{mediumseagreen}{\vec{a} + \vec{b}}$.

Das Parallelogramm zeigt auch: Ob Sie zuerst $\textcolor{orange}{\vec{a}}$ und dann $\textcolor{dodgerblue}{\vec{b}}$ gehen oder umgekehrt, Sie landen am selben Punkt. Es gilt also:

$$
\textcolor{orange}{\vec{a}} + \textcolor{dodgerblue}{\vec{b}} = \textcolor{dodgerblue}{\vec{b}} + \textcolor{orange}{\vec{a}}
$$

Ziehen Sie an den Spitzen der Pfeile. Schalten Sie auch das Parallelogramm ein.

<plugin src="informatikgarten/vektor-labor" views="summe" axes="false" />

## Subtraktion: den Gegenvektor addieren

Bei Zahlen gilt $5 - 3 = 5 + (-3)$. Bei Vektoren definieren wir die Subtraktion genau so:

$$
\textcolor{orange}{\vec{a}} - \textcolor{dodgerblue}{\vec{b}} = \textcolor{orange}{\vec{a}} + \left(-\textcolor{dodgerblue}{\vec{b}}\right)
$$

Es gibt zwei Wege, sich das vorzustellen: 
- Zeichnen Sie $\textcolor{orange}{\vec{a}}$ und $\textcolor{dodgerblue}{\vec{b}}$ vom selben Punkt aus. Dann zeigt $\textcolor{mediumseagreen}{\vec{a} - \vec{b}}$ von der Spitze von $\textcolor{dodgerblue}{\vec{b}}$ zur Spitze von $\textcolor{orange}{\vec{a}}$.
- Sie hängen den **Gegenvektor** von $\textcolor{dodgerblue}{\vec{b}}$ an die Spitze von $\textcolor{orange}{\vec{a}}$.

<excali src="subtraktion" alt="Links: a − b zeigt von der Spitze von b zur Spitze von a. Rechts: dasselbe als a + (−b)." />



> [!warning] Richtung beachten
> $\vec{a} - \vec{b}$ zeigt **zur Spitze von $\vec{a}$**, also zum Vektor, von dem abgezogen wird. $\vec{b} - \vec{a}$ ist der Gegenvektor davon.

<plugin src="informatikgarten/vektor-labor" view="differenz" axes="false" />

## Vielfache: strecken und umdrehen

$3\vec{a}$ bedeutet $\vec{a} + \vec{a} + \vec{a}$: dreimal dieselbe Verschiebung, also ein dreimal so langer Pfeil in derselben Richtung. Das lässt sich auf alle reellen Zahlen $k$ verallgemeinern.

> [!info] Vielfaches eines Vektors
> Für eine Zahl $k$ ist $k\,\vec{a}$ der Vektor mit
>
> - der Länge $|k| \cdot |\vec{a}|$,
> - derselben Richtung wie $\vec{a}$, falls $k > 0$,
> - der entgegengesetzten Richtung, falls $k < 0$.
>
> Für $k = 0$ erhalten Sie den Nullvektor: $0 \cdot \vec{a} = \vec{0}$.

<excali src="vielfache" alt="Vielfache von a: Alle Pfeile sind parallel zu a, negative Faktoren drehen die Richtung um." />

Zum Beispiel ist $0{,}5\,\vec{a}$ halb so lang wie $\vec{a}$, und $-1{,}5\,\vec{a}$ ist anderthalb mal so lang, zeigt aber in die Gegenrichtung. Der Gegenvektor ist der Spezialfall $k = -1$:

$$
-\vec{a} = (-1) \cdot \vec{a}
$$

Verändern Sie $k$ mit dem Schieberegler. Was passiert bei $k = 0$? Und bei negativem $k$?

<plugin src="informatikgarten/vektor-labor" view="vielfaches" axes="false" />

## Rechenregeln

Mit Vektoren rechnen Sie fast wie mit Variablen in der Algebra. Diese Regeln dürfen Sie verwenden:

$$
\begin{aligned}
\vec{a} + \vec{b} &= \vec{b} + \vec{a} \\[8pt]
(\vec{a} + \vec{b}) + \vec{c} &= \vec{a} + (\vec{b} + \vec{c}) \\[8pt]
\textcolor{orange}{k}\,(\vec{a} + \vec{b}) &= \textcolor{orange}{k}\,\vec{a} + \textcolor{orange}{k}\,\vec{b} \\[8pt]
(\textcolor{orange}{k} + \textcolor{dodgerblue}{m})\,\vec{a} &= \textcolor{orange}{k}\,\vec{a} + \textcolor{dodgerblue}{m}\,\vec{a} \\[8pt]
\textcolor{orange}{k}\,(\textcolor{dodgerblue}{m}\,\vec{a}) &= (\textcolor{orange}{k}\textcolor{dodgerblue}{m})\,\vec{a} \\[8pt]
\vec{a} + (-\vec{a}) &= \vec{0}
\end{aligned}
$$

**Beispiel:** Vereinfachen Sie $2(\vec{a} - 3\vec{b}) + 4\vec{b}$.

Zuerst ausmultiplizieren:

$$
2(\vec{a} - 3\vec{b}) + 4\vec{b} = 2\vec{a} - 6\vec{b} + 4\vec{b}
$$

Dann die Vielfachen von $\vec{b}$ zusammenfassen: $-6\vec{b} + 4\vec{b} = -2\vec{b}$. Also:

$$
2(\vec{a} - 3\vec{b}) + 4\vec{b} = 2\vec{a} - 2\vec{b}
$$

**Beispiel:** Lösen Sie $2\vec{x} - \vec{a} = \vec{b}$ nach $\vec{x}$ auf.

Wie bei einer Gleichung mit Zahlen addieren wir zuerst $\vec a$ auf beiden Seiten:

$$
2\vec{x} = \vec{a} + \vec{b}
$$

Dann multiplizieren wir beide Seiten mit $\frac12$. Das ist erlaubt, denn $\frac12$ ist eine Zahl:

$$
\vec{x} = \tfrac12(\vec{a} + \vec{b})
$$

> [!warning] Nicht erlaubt
> Durch eine **Zahl** dürfen Sie teilen: Teilen durch $k$ heisst mit $\frac1k$ multiplizieren. Durch einen **Vektor** kann man nicht dividieren, und zwei Vektoren miteinander multiplizieren können Sie bisher auch nicht. Ausdrücke wie $\vec{a} \cdot \vec{b}$ oder $\frac{\vec{a}}{\vec{b}}$ kommen hier nicht vor.

## Vektorzüge

Wer von $A$ nach $B$ und dann von $B$ nach $C$ geht, ist insgesamt von $A$ nach $C$ gegangen:

$$
\vec{A\textcolor{orange}{B}} + \vec{\textcolor{orange}{B}C} = \vec{AC}
$$

Die Spitze des ersten Pfeils ist der Schaft des zweiten. Der «innere» Punkt $\textcolor{orange}{B}$ fällt weg. Das funktioniert auch mit mehr Pfeilen:

$$
\vec{AB} + \vec{BC} + \vec{CD} = \vec{AD}
$$

Und wer wieder am Startpunkt ankommt, hat sich insgesamt nicht bewegt:

$$
\vec{AB} + \vec{BC} + \vec{CA} = \vec{AA} = \vec{0}
$$

**Beispiel:** Vereinfachen Sie $\vec{AB} - \vec{CB}$.

Ein Minus vor einem Pfeil vertauscht Schaft und Spitze: $-\vec{CB} = \vec{BC}$. Dann steht ein Vektorzug da:

$$
\vec{AB} - \vec{CB} = \vec{AB} + \vec{BC} = \vec{AC}
$$

Passen die Pfeile nicht Spitze an Schaft zusammen, dürfen Sie die Summanden zuerst vertauschen, denn $\vec a+\vec b=\vec b+\vec a$.

> [!question] Kurz geprüft
> <question id="q-vektorzug" type="single">
> Was ergibt $\vec{PQ} + \vec{RP}$?
> <answer feedback="Die Spitze von $\vec{PQ}$ ist $Q$, aber $\vec{RP}$ beginnt bei $R$. Vertauschen Sie die Summanden.">$\vec{PR}$</answer>
> <answer correct="true" feedback="Genau: $\vec{RP} + \vec{PQ} = \vec{RQ}$. Die Reihenfolge darf man vertauschen.">$\vec{RQ}$</answer>
> <answer feedback="Das wäre der Gegenvektor. Gehen Sie von $R$ über $P$ nach $Q$.">$\vec{QR}$</answer>
> </question>

> [!tip] Weiter
> Üben Sie auf der Seite «Übungen: Vektoren als Pfeile», Abschnitte 2 bis 4.

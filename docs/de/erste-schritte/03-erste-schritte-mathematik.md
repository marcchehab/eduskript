# Erste Schritte: Mathematik

Formeln und Funktionsplots, Antworten mit Toleranz bewertet, handschriftliche Herleitungen von der KI geprüft, GeoGebra-Applets und Berechnungen in Python. Probiere jedes Beispiel aus. Der Quelltext ist unter jedem Beispiel einen Klick entfernt.

## Formel und Graph zusammen

$$f(x) = \frac{1}{3}x^3 - x$$

```plot
x: -4..4
y: -3..3
grid
f(x) = 1/3x^3 - x
A = (-1, 2/3), label="H"
B = (1, -2/3), label="L"
```

> [!code]- Quelltext anzeigen
> ````markdown
> $$f(x) = \frac{1}{3}x^3 - x$$
>
> ```plot
> x: -4..4
> y: -3..3
> grid
> f(x) = 1/3x^3 - x
> A = (-1, 2/3), label="H"
> B = (1, -2/3), label="L"
> ```
> ````

Mathematik ist LaTeX, im Fliesstext mit `$...$` oder auf eigener Zeile mit `$$...$$`. Der Plot wird so geschrieben, wie du ihn auf Papier schreiben würdest, und er wird als Bild gerendert, sodass Schülerinnen und Schüler mit dem Stift darauf zeichnen können.

## Eine Schätzung, mit Toleranz bewertet

Drei Versuche. Ein falscher Check gibt einen Hinweis, die Antwort bleibt verborgen.

<question id="maximum" type="number" points="2" attempts="3" minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">
Bei welchem $x$ hat $f(x) = \frac{1}{3}x^3 - x$ sein lokales Maximum?
<answer from="1" feedback="Richtig. $f'(x) = x^2 - 1 = 0$ ergibt $x = \pm 1$, und $f''(-1) < 0$."></answer>
<answer from="0.7" feedback="Knapp daneben. Setze $f'(x) = x^2 - 1$ gleich null."></answer>
<answer feedback="Noch nicht. Zuerst ableiten, dann $f'(x) = 0$ lösen."></answer>
</question>

> [!code]- Quelltext anzeigen
> ```html
> <question id="maximum" type="number" points="2" attempts="3" minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">
> Bei welchem $x$ hat $f(x) = \frac{1}{3}x^3 - x$ sein lokales Maximum?
> <answer from="1" feedback="Richtig. $f'(x) = x^2 - 1 = 0$ ergibt $x = \pm 1$, und $f''(-1) < 0$."></answer>
> <answer from="0.7" feedback="Knapp daneben. Setze $f'(x) = x^2 - 1$ gleich null."></answer>
> <answer feedback="Noch nicht. Zuerst ableiten, dann $f'(x) = 0$ lösen."></answer>
> </question>
> ```

Je näher an `expected`, desto mehr Punkte. Die `from`-Bänder wählen das Feedback nach Abstand aus. `attempts` legt fest, wie oft der Schüler Check drücken darf, bevor die Frage gesperrt wird; Standard ist einmal.

## Die Tangente zeichnen, von der KI geprüft

Zeichne die Tangente an $g(x) = x^2$ bei $x = 1$ mit dem Stift direkt in den Graphen und drücke dann den Button. Die KI sieht deine Zeichnung zusammen mit dem Aufgabentext.

```plot
x: -3..3
y: -1..5
grid
g(x) = x^2
P = (1, 1), label="P"
```

<ai-feedback label="Meine Tangente prüfen" prompt="Der Schüler soll die Tangente an g(x) = x^2 im Punkt P = (1, 1) zeichnen. Die korrekte Tangente hat die Steigung 2 und verläuft durch (1, 1) und (0, -1). Prüfe, ob die gezeichnete Gerade die Parabel in P berührt und ungefähr die richtige Steigung hat. Verrate die Gleichung der Tangente nicht." />

> [!code]- Quelltext anzeigen
> ````markdown
> ```plot
> x: -3..3
> y: -1..5
> grid
> g(x) = x^2
> P = (1, 1), label="P"
> ```
>
> <ai-feedback label="Meine Tangente prüfen" prompt="Der Schüler soll die Tangente an g(x) = x^2 in P = (1, 1) zeichnen. Prüfe, ob die gezeichnete Gerade die Parabel in P berührt und ungefähr die Steigung 2 hat. Verrate die Gleichung nicht." />
> ````

## Eine handschriftliche Herleitung, von der KI geprüft

Löse $x^2 - 5x + 6 = 0$ von Hand im Bereich unten und drücke dann den Button.

<spacer id="quadratic-work" pattern="checkered" height="240" />

<ai-feedback label="Meine Lösung prüfen" prompt="Der Schüler löst x^2 - 5x + 6 = 0 von Hand. Die Lösungen sind x = 2 und x = 3. Prüfe jeden Schritt. Weise auf den ersten Fehler hin, falls es einen gibt, ohne die Lösung zu verraten." />

> [!code]- Quelltext anzeigen
> ```html
> <spacer pattern="checkered" height="240" />
>
> <ai-feedback label="Meine Lösung prüfen" prompt="Der Schüler löst x^2 - 5x + 6 = 0 von Hand. Die Lösungen sind x = 2 und x = 3. Prüfe jeden Schritt. Weise auf den ersten Fehler hin, falls es einen gibt, ohne die Lösung zu verraten." />
> ```

Der Prompt gehört dir. Die Schüler sehen ihn nie, nur das Feedback.

## GeoGebra

Öffentliche GeoGebra-Konstruktionen lassen sich direkt einbetten. Diese stammt von [Laura Hochreiter](https://www.geogebra.org/u/laura.hochreither).

<geogebra material-id="yTAzVxRG" />

> [!code]- Quelltext anzeigen
> ```html
> <geogebra material-id="yTAzVxRG" />
> ```

Die `material-id` ist der Code am Ende jedes geogebra.org-Share-Links. Füge `correct-when="name"` mit einem Boolean aus deiner Konstruktion hinzu, und Eduskript hält pro Schüler fest, ob die Konstruktion richtig ist.

## Berechnungen in Python

Numerische Arbeit, die sich selbst prüft. Vervollständige die Funktion, sodass sie $\int_0^1 x^2 \, dx$ mit der Mittelpunktsregel annähert, und drücke dann **Run** und **Check**.

```python editor id="midpoint"
def integral(f, a, b, n=1000):
    # Mittelpunktsregel: Summe von f(Mittelpunkt) * Breite über n Streifen
    pass

print(integral(lambda x: x**2, 0, 1))
```

```python-check for="midpoint" points="5"
assert abs(integral(lambda x: x**2, 0, 1) - 1/3) < 1e-3, "Integral von x^2 von 0 bis 1 sollte etwa 0.333 sein"
assert abs(integral(lambda x: x, 0, 2) - 2) < 1e-3, "Integral von x von 0 bis 2 sollte etwa 2 sein"
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```python editor id="midpoint"
> def integral(f, a, b, n=1000):
>     pass
> ```
>
> ```python-check for="midpoint" points="5"
> assert abs(integral(lambda x: x**2, 0, 1) - 1/3) < 1e-3, "Integral von x^2 von 0 bis 1 sollte etwa 0.333 sein"
> assert abs(integral(lambda x: x, 0, 2) - 2) < 1e-3, "Integral von x von 0 bis 2 sollte etwa 2 sein"
> ```
> ````

## Quizfragen mit Mathematik

<question id="derivative-sin" type="single" points="1">
Was ist die Ableitung von $\sin(x)$?
<answer correct="true">$\cos(x)$</answer>
<answer feedback="Das ist die Ableitung von $\cos(x)$, bis auf das Vorzeichen.">$-\sin(x)$</answer>
<answer feedback="Ableiten, nicht integrieren.">$-\cos(x)$</answer>
</question>

> [!code]- Quelltext anzeigen
> ```html
> <question id="derivative-sin" type="single" points="1">
> Was ist die Ableitung von $\sin(x)$?
> <answer correct="true">$\cos(x)$</answer>
> <answer feedback="Das ist die Ableitung von $\cos(x)$, bis auf das Vorzeichen.">$-\sin(x)$</answer>
> <answer feedback="Ableiten, nicht integrieren.">$-\cos(x)$</answer>
> </question>
> ```

Standardmässig ein Versuch: Der Schüler wählt aus, drückt Check, sieht das Ergebnis, und die Frage wird gesperrt. Auf einer Prüfungsseite gibt es keinen Check-Button; die Antworten werden mit der Prüfung abgegeben und bei der Rückgabe bewertet.

## Weiter

Die vollständige Liste der Komponenten findest du in der [Komponenten-Übersicht](https://eduskript.org/c/komponenten/uebersicht). Oder schau dir die anderen Fächer an: [Informatik](https://eduskript.org/c/erste-schritte/erste-schritte-informatik), [Chemie](https://eduskript.org/c/erste-schritte/erste-schritte-chemie).

<cta href="/auth/signup">Gratis Konto erstellen</cta>

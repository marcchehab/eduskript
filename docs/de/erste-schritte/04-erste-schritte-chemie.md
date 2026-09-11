# Erste Schritte: Chemie

Strukturformeln aus SMILES, Reaktionsgleichungen, von Hand skizzierte Mechanismen, die die KI prüft, Quizfragen, Kurven und Berechnungen in Python. Probiere jedes Beispiel aus. Der Quelltext ist unter jedem Beispiel einen Klick entfernt.

## Strukturformeln

<molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Koffein" />

> [!code]- Quelltext anzeigen
> ```html
> <molecule smiles="CN1C=NC2=C1C(=O)N(C(=O)N2C)C" name="Koffein" />
> ```

Kopiere den SMILES-String aus PubChem oder ChemDraw. Das Ergebnis ist ein einfaches Bild, sodass Schülerinnen und Schüler mit dem Stift darauf zeichnen können.

## Reaktionsgleichungen

$$\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}$$

$$\ce{2 H2O(l) <=> H3O+ + OH-}$$

> [!code]- Quelltext anzeigen
> ```markdown
> $$\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}$$
>
> $$\ce{2 H2O(l) <=> H3O+ + OH-}$$
> ```

Pfeile, Aggregatzustände, Ladungen, alles innerhalb von `\ce{}`. Normale Mathematik funktioniert genauso: im Fliesstext wie pH $= -\log_{10}[\text{H}^+]$ oder auf eigener Zeile:

$$c = \frac{n}{V}$$

## Eine Strukturformel beschriften, von der KI geprüft

**Markiere die Carbonsäure- und die Estergruppe** am Aspirin-Molekül mit dem Stift und drücke dann den Button. Die KI sieht deine Zeichnung zusammen mit dem Aufgabentext.

<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />

<ai-feedback label="Meine Markierungen prüfen" prompt="Prüfe, ob die Carbonsäure- und die Estergruppe auf dieser Strukturformel von Aspirin korrekt markiert sind. Weise darauf hin, was falsch ist, ohne die Gruppen selbst zu markieren." />

> [!code]- Quelltext anzeigen
> ```html
> <molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />
>
> <ai-feedback label="Meine Markierungen prüfen" prompt="Prüfe, ob die Carbonsäure- und die Estergruppe auf dieser Strukturformel von Aspirin korrekt markiert sind. Weise darauf hin, was falsch ist, ohne die Gruppen selbst zu markieren." />
> ```

## Einen Reaktionsmechanismus skizzieren, von der KI geprüft

**Skizziere den SN2-Mechanismus** für die Reaktion von Bromethan mit Hydroxid-Ionen im Bereich unten und drücke dann den Button.

<spacer id="sn2-work" pattern="checkered" height="240" />

<ai-feedback label="Meinen Mechanismus prüfen" prompt="Prüfe, ob die Elektronenpfeile für die SN2-Reaktion von Bromethan mit Hydroxid-Ionen korrekt sind und ob der Mechanismus zu Ethanol als Produkt führt. Weise auf den ersten Fehler hin, ohne den Mechanismus selbst zu zeichnen." />

> [!code]- Quelltext anzeigen
> ```html
> <spacer pattern="checkered" height="240" />
>
> <ai-feedback label="Meinen Mechanismus prüfen" prompt="Prüfe, ob die Elektronenpfeile für die SN2-Reaktion von Bromethan mit Hydroxid-Ionen korrekt sind und ob der Mechanismus zu Ethanol als Produkt führt." />
> ```

Der Prompt gehört dir. Die Schüler sehen ihn nie, nur das Feedback.

## Quizfragen

<question id="caffeine-n" type="single" points="1">
Wie viele Stickstoffatome enthält Koffein?
<answer feedback="Zähle die N-Atome im Ringsystem noch einmal.">2</answer>
<answer correct="true">4</answer>
<answer feedback="Das sind mehr, als die Struktur hat.">6</answer>
</question>

> [!code]- Quelltext anzeigen
> ```html
> <question id="caffeine-n" type="single" points="1">
> Wie viele Stickstoffatome enthält Koffein?
> <answer feedback="Zähle die N-Atome im Ringsystem noch einmal.">2</answer>
> <answer correct="true">4</answer>
> <answer feedback="Das sind mehr, als die Struktur hat.">6</answer>
> </question>
> ```

Der Schüler wählt aus, drückt Check, sieht das Ergebnis, und die Frage wird gesperrt. Füge `attempts="3"` für drei Versuche hinzu. Auf einer Prüfungsseite gibt es keinen Check-Button; die Antworten werden mit der Prüfung abgegeben und bei der Rückgabe bewertet.

## Eine Zahl, mit Toleranz bewertet

<question id="ph-hcl" type="number" points="2" attempts="2" minValue="0" maxValue="14" step="0.1" expected="2" tolerance="0.2">
Welchen pH-Wert hat eine Salzsäurelösung mit 0.01 mol/l?
<answer from="1" feedback="Richtig. HCl ist eine starke Säure, also $[\text{H}^+] = 0.01$ und pH $= -\log_{10}(0.01) = 2$."></answer>
<answer from="0.6" feedback="Knapp daneben. HCl dissoziiert vollständig, also $[\text{H}^+] = 0.01$ mol/l."></answer>
<answer feedback="Noch nicht. pH $= -\log_{10}[\text{H}^+]$, und HCl dissoziiert vollständig."></answer>
</question>

> [!code]- Quelltext anzeigen
> ```html
> <question id="ph-hcl" type="number" points="2" attempts="2" minValue="0" maxValue="14" step="0.1" expected="2" tolerance="0.2">
> Welchen pH-Wert hat eine Salzsäurelösung mit 0.01 mol/l?
> <answer from="1" feedback="Richtig. HCl ist eine starke Säure, also $[\text{H}^+] = 0.01$ und pH $= -\log_{10}(0.01) = 2$."></answer>
> <answer from="0.6" feedback="Knapp daneben. HCl dissoziiert vollständig, also $[\text{H}^+] = 0.01$ mol/l."></answer>
> <answer feedback="Noch nicht. pH $= -\log_{10}[\text{H}^+]$, und HCl dissoziiert vollständig."></answer>
> </question>
> ```

## Kurven

Titrationskurven, Reaktionsgeschwindigkeiten, Zerfallskurven. Geschrieben, wie du sie auf Papier schreiben würdest.

```plot
f(x) = 14 - 14/(1+e^(-(x-25)))
x: 0..50
y: 0..14
caption: Titrationskurve, starke Säure mit starker Base
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```plot
> f(x) = 14 - 14/(1+e^(-(x-25)))
> x: 0..50
> y: 0..14
> caption: Titrationskurve, starke Säure mit starker Base
> ```
> ````

## Berechnungen in Python

Stöchiometrie, die sich selbst prüft. Vervollständige die Funktion und drücke dann **Run** und **Check**.

```python editor id="molar-mass"
def molar_mass_water():
    # H2O: 2 x H (1.008) + 1 x O (15.999)
    pass

print(molar_mass_water())
```

```python-check for="molar-mass" points="5"
assert abs(molar_mass_water() - 18.015) < 0.01, "Molare Masse von Wasser sollte etwa 18.015 g/mol sein"
```

> [!code]- Quelltext anzeigen
> ````markdown
> ```python editor id="molar-mass"
> def molar_mass_water():
>     pass
> ```
>
> ```python-check for="molar-mass" points="5"
> assert abs(molar_mass_water() - 18.015) < 0.01, "Molare Masse von Wasser sollte etwa 18.015 g/mol sein"
> ```
> ````

## Weiter

Die vollständige Liste der Komponenten findest du in der [Komponenten-Übersicht](https://eduskript.org/c/komponenten/uebersicht). Oder schau dir die anderen Fächer an: [Informatik](https://eduskript.org/c/erste-schritte/erste-schritte-informatik), [Mathematik](https://eduskript.org/c/erste-schritte/erste-schritte-mathematik).

<cta href="/auth/signup">Gratis Konto erstellen</cta>

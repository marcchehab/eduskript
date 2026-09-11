# Dein Unterrichtsmaterial - <nobr>online und interaktiv</nobr>

<center>

Eine Plattform für Lehrpersonen. Bring dein Unterrichtsmaterial auf **deine eigene Website**: Aufgaben bewerten sich selbst, Schülerinnen und Schüler schreiben auf die Seite, du siehst, wer wo steht. Jedes Fach. <nobr>Mach dir das Leben leichter.</nobr>

</center>

<cta href="/auth/signup">Gratis Konto erstellen</cta>

## Probier es selbst

Dies ist ein Beispiel für eine Aufgabe, die du für deine Schülerinnen und Schüler erstellen könntest. 

### Kreise das Sauerstoffatom ein

Das ist Ethanol, der Alkohol in Bier und Wein. **Öffne die Stift-Werkzeugleiste am unteren Bildschirmrand, wähle einen Stift und kreise das Sauerstoffatom ein.** Drücke dann **Meine Zeichnung prüfen**.

<molecule smiles="CCO" name="Ethanol" width="320" height="200" />

<ai-feedback label="Meine Zeichnung prüfen" prompt="Dies ist die Strukturformel von Ethanol (CCO). Der Schüler soll das Sauerstoffatom einkreisen, das als OH am rechten Ende der Kette gezeichnet ist. Sag, ob der Kreis um den Sauerstoff liegt. Wenn er um einen Kohlenstoff oder anderswo liegt, sag das freundlich und beschreibe, wo der Sauerstoff ist. Ein oder zwei Sätze." />

In diesem Beispiel ist es ein Molekül. Es könnte aber genauso gut eine Karte sein, auf der sie einen Fluss markieren (Geografie), ein Satz, in dem sie das Verb unterstreichen (Sprachen), ein Schaltplan (Informatik), ein Graph (Mathematik), ein Gemälde (Geschichte). 

**Jedes Bild, jedes Fach**, deine Anweisungen an die KI.

### Die Klammern ausmultiplizieren

Dasselbe funktioniert mit gewöhnlicher Handschrift. Schreibe das Ausmultiplizieren von $(x + 3)(x - 2)$ von Hand mit dem Stift in das Feld unten. Drücke dann **Meine Arbeit prüfen**. Die KI liest deine Handschrift, prüft jeden Schritt und weist auf den ersten Fehler hin, ohne die Antwort zu verraten.

<spacer id="landing-expand" pattern="lines" height="200" />

<ai-feedback label="Meine Arbeit prüfen" prompt="Der Schüler multipliziert (x + 3)(x - 2) von Hand aus. Das korrekte Ergebnis ist x^2 + x - 6. Prüfe jeden Schritt. Wenn alles richtig ist, sag das in einem Satz. Wenn es einen Fehler gibt, weise auf den ersten hin und sag, welche Art von Fehler es ist, ohne das Endergebnis zu verraten." />

### Ein Quiz, das sich selbst bewertet

<question id="landing-prime" type="single">
Welche dieser Zahlen ist eine Primzahl?
<answer feedback="21 = 3 · 7">21</answer>
<answer correct="true">23</answer>
<answer feedback="25 = 5 · 5">25</answer>
</question>

### Eine Schätzung mit Toleranz

Drei Versuche. Nach einem falschen bekommst du einen Hinweis, nicht die Antwort.

<question id="landing-shower" type="number" attempts="3" minValue="0" maxValue="30" step="1" expected="10" tolerance="3" minLabel="0 Liter" maxLabel="30 Liter">
Wie viele Liter Wasser verbraucht eine Dusche pro Minute?
<answer from="1" feedback="Richtig. Ein normaler Duschkopf verbraucht etwa 10 Liter pro Minute."></answer>
<answer from="0.6" feedback="Knapp daneben. Stell dir einen 10-Liter-Eimer vor: Wie lange braucht die Dusche, um ihn zu füllen?"></answer>
<answer feedback="Weiter daneben. Stell dir einen 10-Liter-Eimer vor: Wie lange braucht die Dusche, um ihn zu füllen?"></answer>
</question>

<fullwidth class="px-4 py-16">

<flex>
<flex-item width="32%">

## Formeln

Mathematik, Chemie, Physik. Sauber gesetzt, im Satz oder auf eigener Zeile.

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

$$
\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}
$$

</flex-item>
<flex-item width="32%">

## Skizzen

Handgezeichnete Diagramme mit dem eingebauten Skizzenwerkzeug. Hell- und Dunkelmodus inklusive.

<excali src="demo" width="66%" />

</flex-item>
<flex-item width="32%">

## Annotationen

Du kannst <span class="es-bg-yellow">markieren</span>, klar. Aber Schülerinnen und Schüler **schreiben auch mit dem Stift auf jede Seite**, und eine KI kann prüfen, was sie von Hand geschrieben haben.

</flex-item>
</flex>

<flex class="mt-16">
<flex-item width="32%">

## Automatische Prüfung

Quiz, Schieberegler, vorhergesagte Ausgaben, Code, GeoGebra-Konstruktionen. Sofortiges Feedback für die Schüler, eine Klassenübersicht für dich.

</flex-item>
<flex-item width="32%">

## Prüfungen

Dieselbe Seite im Prüfungsmodus: stille Bewertung, Etappen, die die Schüler nacheinander abgeben, Punkte, die du vor der Rückgabe anpassen kannst.

</flex-item>
<flex-item width="32%">

## Folien

Jede Seite ist auch eine Präsentation. Projiziere sie im Unterricht, verteile danach dieselbe Seite.

</flex-item>
</flex>

</fullwidth>

## Sieh es für dein Fach

Eduskript ist kein Programmierwerkzeug. Chemie, Mathematik, Sprachen, Geschichte, Sporttheorie: jedes Fach mit Stoff zum Erklären und Aufgaben zum Prüfen.

<flex>
<flex-item>

### Informatik

Python und SQL im Browser, automatisch bewertet. Turtle-Grafik, Live-HTML, interaktive Plugins.

<cta href="https://eduskript.org/c/erste-schritte/erste-schritte-informatik" size="default">Informatik</cta>

</flex-item>
<flex-item>

### Mathematik

Formeln und Funktionsplots, Schieberegler mit Toleranz, handschriftliche Herleitungen von der KI geprüft, GeoGebra.

<cta href="https://eduskript.org/c/erste-schritte/erste-schritte-mathematik" size="default">Mathematik</cta>

</flex-item>
<flex-item>

### Chemie

Strukturformeln aus SMILES, Reaktionsgleichungen, von Hand skizzierte Mechanismen, die die KI prüft.

<cta href="https://eduskript.org/c/erste-schritte/erste-schritte-chemie" size="default">Chemie</cta>

</flex-item>
</flex>

## Wie funktioniert das? Du schreibst einfach.

Eine Lektion ist ein Textdokument, und du bist die Lehrperson, nicht der Webdesigner. Keine Block-Menüs, keine Formulare, kein Zurechtklicken. Eine Überschrift, eine Liste, eine Formel, ein Quiz: Du tippst es, und die Seite wird beim Tippen gerendert. Wenn du in Word schon Überschriftenformate benutzt hast, weisst du genug, um anzufangen.

**Bearbeite die linke Seite und schau rechts zu.**

<demoeditor />

<fullwidth class="px-4 py-16">

<flex>
<flex-item width="32%">

## Schreiben mit KI

Die KI kann **deine Inhalte erstellen, bearbeiten und anpassen**. Oder nutze dein bestehendes Claude- oder ChatGPT-Abo via MCP.

</flex-item>
<flex-item width="32%">

## Zusammenarbeit

Lehrpersonen können **Skripts gemeinsam verfassen** oder **das veröffentlichte Material anderer forken**, unter CC-BY-SA (Autor nennen, unter gleichen Bedingungen weitergeben).

</flex-item>
<flex-item width="32%">

## Datenschutz

Du siehst den Fortschritt und die Prüfungen deiner Schüler. Unsere Server speichern nur **anonymisierte IDs**. Die echten Namen werden nur auf deinem Computer zugeordnet.

</flex-item>
</flex>

</fullwidth>

## Sieh es in Aktion

**[informatikgarten.ch](https://informatikgarten.ch)** ist ein vollständiger Informatik-Lehrgang, den eine Lehrperson auf Eduskript aufgebaut hat: Programmieren mit Python und Turtle, Barcodes, SQL-Datenbanken, Netzwerke, Kryptografie und mehr.

<cta href="/auth/signup">Gratis Konto erstellen</cta>

<center>

:flag-en-gb: [English version](https://eduskript.org/en)

</center>

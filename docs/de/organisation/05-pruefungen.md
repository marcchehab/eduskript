# Prüfungen

Führe echte digitale Prüfungen im Browser durch, mit echter Abschottung über den Safe Exam Browser. Derselbe Editor, dieselbe Darstellung, dieselben automatisch bewerteten Übungen — nur mit zusätzlicher Kontrolle über Status, Zeit und Abgabeverfolgung.

---

## Prüfungsseiten — was eine Seite zur Prüfung macht

Jede Seite kann als **Prüfungsseite** markiert werden. Wähle im Page Editor «Exam» im Seitentyp-Auswahlfeld neben dem Titel. Prüfungsseiten erhalten:

- **Prüfungseinstellungen** — Status, Zeitlimit, SEB-Pflicht
- **Statusanzeige** im Dashboard — Closed / Lobby / Open
- **Abgabeverfolgung** — der Versuch jedes Schülers wird als Snapshot gespeichert
- **Bewertungsoberfläche** — Abgaben durchsehen, Feedback hinterlassen

Der Inhalt einer Prüfungsseite ist derselbe wie bei jeder anderen Seite — Markdown mit Code-Editoren, `python-check`-Blöcken, Mathematik, Callouts. Nur die umgebende Maschinerie ist anders.

---

## Die drei Prüfungsstatus

Eine Seite im Prüfungsmodus befindet sich in einem von drei Status:

> [!abstract] Closed
> Die Seite ist nicht zugänglich — Schüler sehen «this exam isn't open yet». Standardstatus.

> [!abstract] Lobby
> Schüler können sich mit der Seite verbinden (Authentifizierung wird geprüft, SEB startet falls erforderlich), aber der eigentliche Inhalt ist hinter einem «waiting for instructor»-Bildschirm verborgen. Nutze das, um alle zu verbinden, bevor der Timer startet.

> [!abstract] Open
> Die Prüfung läuft. Die Uhr startet (falls du ein Zeitlimit gesetzt hast). Schüler können Code schreiben, Antworten abgeben und mit `python-check`-Blöcken arbeiten.

Du wechselst den Status in den Prüfungseinstellungen des Page Editors oder in der Prüfungsübersicht des Klassen-Dashboards. Nach Ablauf der Zeit zurück auf «Closed» zu schalten sperrt weitere Abgaben.

---

## Status pro Klasse

Verschiedene Klassen können für dieselbe Prüfungsseite **unterschiedliche Status** haben. Führe die Morgengruppe um 9 Uhr und die Nachmittagsgruppe um 14 Uhr mit exakt derselben Prüfung durch, indem du den Status pro Klasse umschaltest.

Das ermöglicht auch das Muster «nur für Klasse X freischalten» — die Prüfung bleibt für alle Closed, ausser für die Klasse, die sie gerade schreibt.

```
Exam: "Midterm on Loops"
  ├── CS101 Section A → Open (9:00-10:30)
  ├── CS101 Section B → Closed
  └── CS101 Section C → Lobby (preparing for 11:00 start)
```

---

## Safe Exam Browser (SEB)

Für Prüfungen mit hohem Einsatz bindest du den [Safe Exam Browser](https://safeexambrowser.org) ein — einen abgeschotteten Browser, der Schüler daran hindert, auf andere Anwendungen oder Websites zuzugreifen oder auch nur von aussen etwas per Copy-Paste einzufügen.

- **Token-basierte Authentifizierung** — die Prüfungsseite öffnet sich nur im SEB mit dem richtigen Konfigurations-Token. Die URL in Chrome einzufügen funktioniert nicht.
- **Kein Copy-Paste von aussen** — Schüler können weder Fragen an einen Freund weiterreichen noch vorbereitete Antworten einfügen.
- **Kein App-Wechsel** — SEB übernimmt den Bildschirm; Alt-Tab ist auf Betriebssystemebene deaktiviert.
- **Vollbild verpflichtend** — Schüler können das Fenster weder verkleinern noch minimieren.

Aktiviere SEB pro Seite über die Prüfungseinstellungen. Eduskript erzeugt den SEB-Konfigurationslink automatisch — teile ihn vor der Prüfung mit den Schülern. Sie installieren SEB einmal und verwenden ihn dann für jede Prüfung.

> [!info] SEB ist optional
> Für Beurteilungen mit geringem Einsatz (Quiz im Unterricht, Übungstests) kannst du SEB ganz weglassen. Die Option `max-checks` bei `python-check` bietet auch ohne SEB einen gewissen Schutz gegen Durchprobieren.

---

## Abgaben und Bewertung

Jeder Prüfungsversuch eines Schülers erzeugt eine **Abgabe** — einen Snapshot von:

- Seinem Code in jedem Editor
- Seinem `python-check`-Status (bestanden/nicht bestanden)
- Seinen `<question>`-Antworten
- Jedem interaktiven Zustand auf der Seite (Quizantworten, Plugin-Zustand)

Snapshots werden im Moment der Abgabe erstellt (oder wenn die Zeit abläuft, je nachdem, was zuerst eintritt).

### Die Bewertungsoberfläche

Unter **Dashboard → Classes → [Klasse] → Submissions**:

- Abgaben pro Seite, pro Klasse durchsehen
- Den Code jedes Schülers im selben Editor sehen, den er benutzt hat, mit seinem letzten Stand
- Seinen Code selbst ausführen, um das Verhalten zu prüfen
- Eine **numerische Punktzahl** hinzufügen (überschreibt oder ergänzt die automatisch vergebenen Punkte)
- **Rich-Text-Feedback** hinzufügen (pro Abgabe)
- **Einzelne Code-Blöcke kommentieren** für feingranulares Feedback

Automatisch bewertete `python-check`-Ergebnisse werden neben deiner manuellen Bewertung angezeigt — so siehst du schnell, wer alle Checks bestanden hat und wer genauer angeschaut werden muss.

---

## Code-Übungen in Prüfungen

Alles aus dem normalen Code-Editor — Python, JavaScript, SQL, Multi-File-Editoren, automatische Bewertung mit `python-check` — funktioniert auch auf Prüfungsseiten. Kombiniert mit `max-checks` (begrenzt, wie oft ein Schüler einen Check ausführen darf) baust du Prüfungen, die echte Programmierfähigkeit testen, ohne zur Rate-und-Prüf-Übung zu werden:

````markdown
```python editor id="exam-q1"
def solution(n):
    # Deine Implementierung hier
    pass
```

```python-check for="exam-q1" max-checks="3" points="15"
assert solution(5) == 25, "solution(5) sollte 25 zurückgeben."
assert solution(0) == 0, "solution(0) sollte 0 zurückgeben."
assert solution(-3) == 9, "solution(-3) sollte 9 zurückgeben."
```
````

Drei Check-Versuche, bevor der Button gesperrt wird. Die Schüler müssen nachdenken, nicht nur raten.

---

## Typischer Prüfungsablauf

1. **Prüfung erstellen** — ein Skript anlegen (oder ein bestehendes wiederverwenden), die relevanten Seiten als Prüfungstyp markieren, deine `python-check`-Blöcke schreiben
2. **SEB-Konfiguration einrichten** — pro Seite aktivieren, den Konfigurationslink vorab mit den Schülern teilen
3. **Selbst testen** — die Prüfung in deinem eigenen SEB öffnen, um sicherzustellen, dass alles funktioniert
4. **5 Minuten vorher** — alle Prüfungsseiten für die richtige Klasse in den Status **Lobby** schalten
5. **Zur Startzeit** — auf **Open** schalten; die Schüler sehen den Prüfungsinhalt und die Uhr startet
6. **Zur Endzeit** — zurück auf **Closed** schalten, um weitere Abgaben zu sperren
7. **Bewertung** — die Abgaben in der Submissions-Oberfläche durchsehen und bewerten

---

## Zeitlimits

Setze ein Zeitlimit in den Prüfungseinstellungen:

- Startet, wenn ein Schüler die Prüfung im Status **Open** öffnet
- Countdown-Timer pro Schüler, sichtbar in der Seitenkopfzeile
- Abgaben werden automatisch abgeschlossen, wenn die Zeit abläuft
- Kulanzfrist optional (z.B. 2 zusätzliche Minuten vor der harten Sperre)

Für Schüler mit Nachteilsausgleich (Zeitverlängerung) setzt du individuelle Verlängerungen pro Schüler in der Klassenliste.

---

## Funktionen für akademische Integrität

Über SEB hinaus:

- **`max-checks` bei automatisch bewerteten Übungen** — begrenzt Durchprobieren
- **Randomisierung pro Schüler** — wenn du Fragewerte aus Vorlagen verwendest (über ein Plugin), kann jeder Schüler leicht andere Zahlen sehen
- **Abgabe-Snapshots** — du hast exakt den Code, den der Schüler geschrieben hat, und wann er ihn geschrieben hat
- **Zeitdaten** — sieh, wann jeder Schüler begonnen und abgegeben hat
- **Abgleich mit der Anwesenheit** — «Ich habe vergessen abzugeben» im Nachhinein aufdecken

Nichts davon ist narrensicher. Für Prüfungen mit wirklich hohem Einsatz kombiniere SEB + Proctoring + Aufsicht vor Ort.

---

## Prüfungen-Spickzettel

| Ziel | Wo |
|------|-------|
| Eine Seite als Prüfung markieren | Page Editor → Seitentyp-Dropdown → Exam |
| Prüfungsstatus pro Klasse | Prüfungseinstellungen → Status pro Klasse |
| Safe Exam Browser verlangen | Prüfungseinstellungen → Require SEB → Konfigurationslink holen |
| Ein Zeitlimit setzen | Prüfungseinstellungen → Time limit |
| Individuelle Zeitverlängerung | Klassenliste → Schüler → Nachteilsausgleich |
| Versuche bei automatisch bewertetem Code begrenzen | `max-checks="3"` am `python-check`-Block |
| Abgaben durchsehen | Dashboard → Classes → [Klasse] → Submissions |
| Bewerten + kommentieren | Submissions-Oberfläche → Detail pro Schüler |

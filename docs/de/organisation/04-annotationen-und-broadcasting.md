# Annotationen und Broadcasting

Zeichne, markiere und schreibe Notizen auf jede beliebige Seite — wie beim Anstreichen eines gedruckten Handouts, nur dass deine Schülerinnen und Schüler es live auf ihren eigenen Geräten sehen können. Der wichtigste Anwendungsfall: Statt mit unzuverlässiger Klassenzimmer-Technik zu kämpfen, überträgst du deine Annotationen direkt auf jeden Schülerbildschirm (Broadcasting).

---

## Auf einer Seite zeichnen

Wähle das **Stift-Werkzeug** in der Seiten-Toolbar und zeichne. Deine Striche:

- **Werden automatisch gespeichert** — kein «Habe ich meine Vorbereitung nach der Pause verloren?»
- **Wandern mit dem Seitenlayout mit** — wenn du den zugrunde liegenden Inhalt bearbeitest, bleiben deine Annotationen an den richtigen Absätzen verankert
- **Gibt es in mehreren Farben und Grössen** — in der Toolbar wählst du Strichbreite und Farbe
- **Lassen sich präzise löschen** — das Radierer-Werkzeug entfernt einzelne Striche (nicht Pixel)

Standardmässig sind Annotationen **persönlich** — nur du siehst sie. Ideal für die Unterrichtsvorbereitung, zum Anstreichen deiner eigenen Kopie der Inhalte einer Kollegin oder um eine schwierige Aufgabe durchzuarbeiten, bevor du sie den Schülern zeigst.

---

## Haftnotizen

Setze eine Haftnotiz an eine beliebige Stelle einer Seite:
- Zum Positionieren ziehen
- An der Ecke die Grösse ändern
- Farblich kennzeichnen (gelb, pink, blau, grün)
- Zu einem kleinen Badge minimieren, wenn sie im Weg ist
- Zum erneuten Aufklappen klicken

Nützlich für:
- Stellen markieren, die überarbeitet werden müssen
- Fragen für Mitarbeitende hinterlassen
- Erinnerungen an dich selbst («dieses Video vor dem nächsten Semester neu aufnehmen»)

---

## Snaps — fokussierte Annotationen auf einem Ausschnitt

Ein «Snap» ist ein Schnappschuss eines bestimmten Seitenausschnitts, den du separat annotieren kannst. Klicke auf das Snap-Werkzeug, ziehe ein Rechteck um den gewünschten Bereich und zeichne dann darin.

Snaps liegen in ihrer eigenen Galerie — erreichbar über die Seite **My Snaps** in deinem Dashboard, chronologisch geordnet mit Vorschaubildern.

Nützlich für:
- Ein kleines Diagramm aus dem Kontext herauslösen, um es anderswo zu erklären
- Vorher/Nachher eines Code-Refactorings vergleichen
- Eine annotierte Schritt-für-Schritt-Erklärung eines bestimmten Konzepts aufbauen
- Einen Frage/Antwort-Screenshot speichern, um ihn später zu besprechen

Die Originalseite bleibt unberührt — der Snap ist eine separate annotierte Ebene.

---

## Live-Broadcasting — die wichtigste Funktion

Hier wird es für das Klassenzimmer interessant.

![Deine Striche werden in Echtzeit an die Geräte aller Schüler verteilt](broadcast-fanout.excalidraw)

Schalte deine Annotationen während des Unterrichts in den **Broadcast-Modus**. Jeder Strich, den du zeichnest, erscheint in Echtzeit auf dem Gerät jedes Schülers — kein Beamer nötig, kein «Kann die hintere Reihe das sehen?». Die Schüler behalten deine Annotationen nach dem Unterricht zum Nachlesen.

### Drei Broadcast-Reichweiten

> [!abstract] Klassen-Broadcast
> Deine Annotationen werden an jeden Schüler der gewählten Klasse gestreamt. Wie Zeichnen auf einem gemeinsamen Whiteboard. Ideal für gemeinsames Lösen von Aufgaben, bei dem du eine Herleitung durchgehst, während alle auf dem eigenen Bildschirm mitverfolgen.

> [!abstract] Individuelles Feedback
> Sende Annotationen an einen einzelnen Schüler — perfekt für persönliches Feedback zu seiner Arbeit. Sitz während einer Laborstunde an deinem Pult, zeichne Korrekturen in die Abgabe jedes Schülers, und er sieht sie sofort.

> [!abstract] Öffentliche Annotationen
> Sichtbar für alle, die die Seite besuchen, auch nicht angemeldete Besucher. Nützlich, um Errata, Hinweise oder «Siehe auch»-Notizen zu öffentlichen Lektionen hinzuzufügen.

---

## Wie schnell ist Live-Broadcasting?

- Latenzziel: unter 100 ms bei guten Netzwerkbedingungen
- Striche werden per Server-Sent Events (SSE) gestreamt — an die Schüler gepusht, kein Polling
- Später beitretende Schüler laden bestehende Annotationen aus der Datenbank und beginnen dann mit dem Streaming
- Funktioniert bei unzuverlässigem WLAN (sauberes Wiederverbinden, keine verlorenen Striche)

Die Glättung pro Strich reduziert visuelles Zittern — der laufende Strich wird vor dem Senden mit einem gleitenden Durchschnitt geglättet.

---

## Ablauf im Klassenzimmer

Ein typischer Ablauf einer Live-Lektion:

1. **Vor dem Unterricht** — öffne die Lektionsseite und markiere vorab, was du besprechen willst (z.B. Schlüsselbegriffe unterstreichen)
2. **Zu Beginn des Unterrichts** — wechsle für die richtige Klasse in den Modus **Klassen-Broadcast**
3. **Während des Unterrichts** — zeichne, markiere, kreise ein, während du sprichst; wechsle Werkzeuge / Farben nach Bedarf
4. **Die Schüler folgen mit** — auf ihrem eigenen Gerät (Handy, Tablet, Laptop, was auch immer sie dabeihaben)
5. **Nach dem Unterricht** — die Schüler sehen deine Annotationen weiterhin, wenn sie die Seite erneut aufrufen

Dieselbe Lektion kann im nächsten Semester mit frischen Annotationen wiederverwendet werden — deine alten Annotationen sind pro Lehrperson und Sitzung getrennt, sie gelangen also nicht in die neue Klasse.

> [!tip] Kein Beamer? Kein Problem.
> Wenn die Technik in einem Klassenzimmer unzuverlässig ist, ist der Broadcast-Modus eine klare Verbesserung: Die Schüler sehen deine Arbeit direkt auf ihrem Gerät, in ihrem bevorzugten Theme, in ihrer bevorzugten Zoomstufe. Besonders angenehm für Schüler in den hinteren Reihen, Schüler mit Sehbeeinträchtigungen und Teilnehmende, die per Videoanruf zugeschaltet sind.

---

## Lebenszyklus einer Annotation

| Zustand | Was passiert |
|-------|--------------|
| **Persönlich** | Nur du siehst sie; in deinem Konto gespeichert |
| **Klassen-Broadcast** | An eine bestimmte Klasse gestreamt; pro Klasse gespeichert |
| **Individuell** | An einen Schüler gesendet; pro Schüler gespeichert |
| **Öffentlich** | Für alle Besucher sichtbar; als Metadaten auf Seitenebene gespeichert |

Du kannst eine persönliche Annotation auf Broadcast umschalten (oder umgekehrt) — die Striche bleiben, die Sichtbarkeit ändert sich.

Um Annotationen zu löschen, verwende die Option **Clear** in der Toolbar (mit Bestätigung). Gelöschte Striche sind weg — sie sind nicht in der Versionsgeschichte.

---

## Annotationen-Spickzettel

| Ziel | Wo |
|------|-------|
| Auf einer Seite zeichnen | Stift-Werkzeug in der Seiten-Toolbar |
| Eine Haftnotiz hinzufügen | Haftnotiz-Werkzeug in der Seiten-Toolbar |
| Einen Ausschnitt erfassen und annotieren | Snap-Werkzeug in der Seiten-Toolbar |
| In den Broadcast-Modus wechseln | Annotationsmenü → Reichweite wählen (Klasse / individuell / öffentlich) |
| Annotationen an einen Schüler senden | Broadcast-Reichweite: Individuell → Schüler wählen |
| Striche löschen | Radierer-Werkzeug |
| Alle Annotationen einer Seite löschen | Annotationsmenü → Clear |
| Alle deine Snaps durchsehen | Dashboard → My Snaps |

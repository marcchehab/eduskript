# KI-Bearbeitung

Eduskript bringt einen KI-Assistenten mit, der dein Skript in- und auswendig kennt — nicht weil er auf deinen Inhalten trainiert wurde, sondern weil er bei jeder Anfrage deinen vollständigen Skript-Kontext sieht. Er kann eine einzelne Seite umschreiben, Änderungen über mehrere Seiten vorschlagen oder dir einfach einen sauberen Export deiner Inhalte liefern, den du in einen externen Chatbot wie ChatGPT oder Claude.ai einfügst.

---

## AI Edit im Editor

In der Symbolleiste des Page Editors öffnet der **Zauberstab-Button (✨)** AI Edit. Tippe, was geändert werden soll:

> «Füge oben ein Callout mit den Lernzielen hinzu.»
>
> «Übersetze diese Seite auf Französisch und lass alle Code-Blöcke unverändert.»
>
> «Schreibe den ersten Abschnitt in einem lockereren Ton um.»
>
> «Füge der FizzBuzz-Übung einen `python-check` hinzu, der die Ausgaben für n=15, 30 und 100 testet.»

Klicke auf **Generate Changes**. Die KI plant, welche Seiten sie ändern will, und erzeugt dann jede einzeln. Jede vorgeschlagene Änderung öffnet sich in einem **Diff-Editor**, der Vorher und Nachher nebeneinander zeigt.

> [!info] Wie weit reicht der Fokus?
> Wenn du AI Edit auf einer einzelnen Seite öffnest, konzentriert sich die KI darauf, hat aber Zugriff auf das ganze Skript als Kontext — Querverweise bleiben so konsistent. Wenn du es aus dem Frontpage-Editor öffnest, arbeitet es nur auf diesem Dokument.

---

## KI-Vorschläge prüfen

Der Diff-Editor ist **Opt-out**: Standardmässig wird jeder KI-Vorschlag **übernommen**. Du musst nur eingreifen, wenn du etwas zurücknehmen willst.

- **Einzelnen Abschnitt zurücknehmen** — klicke auf den Button am Rand neben dieser Änderung
- **Revert all to original** — obere Symbolleiste des Diffs
- **Apply** — der Button unten im Dialog übernimmt die behaltenen Änderungen in die Seite(n)

Dieser letzte Button ist mit «Apply to page» / «Apply to N pages» beschriftet, damit du genau siehst, was gleich passiert.

> [!tip] Frontpages speichern nicht automatisch
> Wenn du AI Edit auf einer Frontpage verwendest, landet der neue Inhalt mit «Apply» **im Editor**, wird aber nicht in der Datenbank gespeichert. Prüfe ihn und drücke selbst `Ctrl+S`. So vermeidest du, dass die KI versehentlich Änderungen an deiner öffentlichen Startseite veröffentlicht.

---

## Copy context — bring deine eigene KI mit

Du willst die KI von Eduskript nicht verwenden? Klicke im AI-Edit-Dialog auf **Copy context**. Das kopiert den gesamten Skript-Inhalt (alle Seiten, die fokussierte markiert) als sauberen Text in deine Zwischenablage. Füge ihn in ChatGPT, Claude.ai, Gemini oder etwas anderes ein, und du hast den vollen Kontext für jede Frage, die du stellen willst.

Der Export enthält:
- Titel und Beschreibung des Skripts
- Titel, Slug, Status und vollständigen Markdown-Inhalt jeder Seite
- Eine Liste der am Skript angehängten Dateien

Er enthält NICHT den internen Prompt für das Bearbeitungsformat von Eduskript — die externe KI wird also nicht versuchen, in unserem speziellen JSON-Format zu antworten. Du bringst deinen eigenen Prompt mit.

---

## Zweistufige Generierungs-Pipeline

Unter der Haube ist AI Edit ein zweistufiger Prozess:

1. **Plan** — aus deiner Anweisung und dem Skript-Kontext liefert die KI einen JSON-Plan, der auflistet, welche Seiten sie ändern will. Du siehst den Plan als Fortschrittsbalken der ausstehenden Änderungen.
2. **Generate** — für jede geplante Seite erzeugt ein separater KI-Aufruf den neuen Inhalt. Du siehst die Änderungen eine nach der anderen eintreffen.

Lange Generierungsaufträge sind absturzsicher — schliesse den Tab, komm später zurück, der Auftrag läuft weiter. Du siehst denselben Vorschlag, den du sonst gesehen hättest.

---

## Persönliche und organisationsweite System-Prompts

Unter **Account settings → AI system prompt** legst du eine persönliche Stimme für die KI fest. Beispiele:

- «Schreibe immer auf Deutsch (Sie-Form für Schüler).»
- «Verwende das Muster ‹Vorhersagen, dann prüfen›, wo immer es passt.»
- «Bevorzuge knappe Erklärungen statt langer Einleitungen.»

Diese werden jedem deiner KI-Aufrufe vorangestellt. Einmal setzen, gilt überall.

Organisationsinhaber können unter **Organization settings → AI system prompt** einen **organisationsweiten System-Prompt** setzen — nützlich, um eine einheitliche Stimme über alle Lehrpersonen der Organisation durchzusetzen.

---

## Wann AI Edit nützlich ist

> [!example] Echte Anwendungsfälle
> - «Füge oben auf jeder Seite dieses Skripts, die noch keines hat, ein *Lernziele*-Callout hinzu.»
> - «Ich habe gerade `quicksort_pivot` in `partition` umbenannt — aktualisiere alle Verweise in den Code-Blöcken.»
> - «Schreibe die Seite ‹Funktionen› so um, dass sie dasselbe Muster ‹Vorhersagen, dann prüfen› verwendet wie die Seite ‹Schleifen›.»
> - «Füge jeder bestehenden Übung, die noch keinen hat, einen `python-check` hinzu.»
> - «Übersetze dieses ganze Skript auf Englisch.»

> [!warning] Wann du AI Edit auslassen solltest
> - **Einfaches Suchen und Ersetzen** — Suchen und Ersetzen im normalen Page Editor ist schneller und berechenbarer.
> - **Stark subjektive Textänderungen** — der Prüfaufwand übersteigt manchmal den Aufwand, es selbst zu schreiben.
> - **Inhalte, bei denen du noch nicht weisst, was du willst** — tippe deinen Entwurf zuerst selbst, dann lass die KI polieren.

---

## Spickzettel KI

| Ziel | Wo |
|------|-------|
| AI Edit öffnen | Zauberstab-Button (✨) in der Symbolleiste des Page Editors |
| Einzelne Seite bearbeiten (mit Skript-Kontext) | AI Edit aus einem Page Editor öffnen |
| Nur eine Frontpage bearbeiten | AI Edit aus dem Frontpage-Editor öffnen |
| Ein anderes KI-Werkzeug verwenden | «Copy context» im AI-Edit-Dialog, anderswo einfügen |
| Persönliche Stimme/Stil festlegen | Account settings → AI system prompt |
| Organisationsweite KI-Stimme festlegen | Organization settings → AI system prompt |
| KI-Änderungen übernehmen | «Apply to page» / «Apply to N pages» unten im Diff-Dialog |
| Einzelne Änderung ablehnen | Button am Rand neben diesem Diff-Abschnitt anklicken |
| Alle Änderungen ablehnen | «Revert all to original» oben im Diff |

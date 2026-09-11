# Klassen

Fasse deine Schülerinnen und Schüler in Klassen zusammen. Mit Klassen gibst du verschiedenen Gruppen unterschiedlichen Zugang zu denselben Inhalten, führst Prüfungen zu verschiedenen Zeiten durch, überträgst Annotationen live und verfolgst die Arbeit pro Schüler — und schützt dabei standardmässig die Privatsphäre der Schüler.

---

## Eine Klasse erstellen

1. **Dashboard → Classes**
2. Klicke auf **+ New class**
3. Gib ihr einen Namen (z.B. «CS101 Herbst 2026, Gruppe A»)
4. Du erhältst einen **Einladungscode** und eine **Beitritts-URL**

Das war's. Die Klasse ist aktiv; Schüler können beitreten.

---

## Wie Schüler beitreten

Teile den Einladungscode oder die Beitritts-URL. Die Schülerinnen und Schüler:

1. Öffnen die Beitritts-URL (oder fügen den Code in ihrem Dashboard ein)
2. Melden sich an (Google, GitHub, Microsoft oder E-Mail)
3. Sind eingeschrieben

Die Schüler erscheinen innert Sekunden in deiner Klassenliste.

> [!tip] Codes funktionieren auch vor Ort
> Der 6-stellige Code lässt sich auf einer Folie («Beitreten mit Code XYZAB1»), im Hörsaal, in einem Slack-Kanal oder auf einem gedruckten Handout weitergeben. Er ist kein Geheimnis — er muss nur kommuniziert werden.

---

## Klasseneinstellungen

| Einstellung | Was sie bewirkt |
|---------|--------------|
| **Name** | Anzeigename der Klasse |
| **Invite code** | Eindeutiger 6-stelliger Code zum Beitreten (neu generierbar) |
| **Join URL** | Direktlink, der den Code automatisch ausfüllt |
| **Allow anonymous** | Nicht angemeldeten Besuchern Zugang zu Klasseninhalten geben (sparsam einsetzen) |
| **Pre-authorized roster** | Schüler per Pseudonym massenweise importieren (für institutionelle Integrationen) |

**Generiere den Einladungscode neu**, wenn er durchsickert (ein ehemaliger Schüler teilt ihn nach dem Austritt, die URL landet auf Reddit usw.). Der alte Code funktioniert sofort nicht mehr.

---

## Privatsphäre der Schüler — Datenschutz als Standard

Eduskript ist für den Einsatz in regulierten Bildungsumgebungen gebaut (insbesondere unter deutschem Datenschutzrecht). Die Privatsphäre der Schülerinnen und Schüler ist der Standard, kein nachträglicher Gedanke:

- **Keine E-Mail von Schülern nötig** — sie melden sich per OAuth an, keine E-Mail oder andere personenbezogene Daten werden gespeichert
- **Standardmässig pseudonym** — Schüler erscheinen unter einem hash-basierten Pseudonym (z.B. `student_a4b8c2d1`)
- **Identitätsfreigabe** — Schüler stimmen explizit zu, wenn ihr echter Name für dich sichtbar sein soll
- **Kein Tracking über Lehrpersonen hinweg** — ein Schüler in deiner Klasse ist für eine andere Lehrperson nicht sichtbar, es sei denn, er ist auch in *deren* Klasse

Was du standardmässig siehst (ohne Identitätsfreigabe):
- Das Pseudonym des Schülers
- Ob er jede Seite besucht hat
- Seinen Code in Editoren, pro Pseudonym gespeichert
- Seine Annotationen (falls er welche sichtbar gemacht hat)

Was du ohne Freigabe NICHT siehst:
- Echter Name
- E-Mail
- Andere Klassen, in denen er ist
- Aktivität ausserhalb deiner Klasse

Wenn ein Schüler die Identitätsfreigabe erteilt, siehst du seinen echten Namen in der Klassenliste, neben dem Pseudonym.

---

## Anonymer Modus (ganze Klasse)

Für sensible Themen, bei denen Schüler teilnehmen sollen, ohne *voreinander* identifizierbar zu sein:

- **Allow anonymous** in den Klasseneinstellungen — Schüler können ganz ohne Anmeldung beitreten
- Sie erhalten ein Pseudonym pro Sitzung (z.B. `anonymous_3f8a`)
- Nützlich für: anonyme Umfragen, sensible Diskussionsthemen, Demos ohne Einschreibung

Ihre Arbeit wird pro Sitzung über Cookies gespeichert; beim Schliessen des Tabs geht sie verloren. Für bewertete Arbeit sollten sich Schüler anmelden.

---

## Vorautorisierte Schüler (Massenimport)

Für institutionelle Umgebungen, in denen du die Klassenliste im Voraus hast:

1. **Class settings → Pre-authorized roster → Upload CSV**
2. CSV-Format: eine Spalte `pseudonym` (welche ID auch immer deine Institution verwendet)
3. Wenn sich ein Schüler mit passendem Pseudonym anmeldet, wird er automatisch eingeschrieben

Nützlich für institutionelle SSO-Integrationen, bei denen Schüler über eine institutionelle ID statt über einen selbst gewählten Benutzernamen identifiziert werden.

---

## Was du pro Schüler siehst

Für eingeschriebene Schüler zeigt das Klassen-Dashboard:

- **Pseudonym** (und echter Name, falls freigegeben)
- **Last seen** — Zeitstempel der letzten Aktivität
- **Pages visited** — welche Seiten er geöffnet hat
- **Code work** — was er in Editoren geschrieben hat (letzter Stand)
- **Annotations** — was er gezeichnet hat (falls er etwas sichtbar gemacht hat)
- **Quiz / exercise results** — automatisch vergebene Punkte aus `python-check` und `<question>`
- **Submissions** — Prüfungsversuche mit Code-Snapshots

Klicke auf einen Schüler, um seine Arbeit pro Seite im Detail zu sehen.

---

## Mehrere Klassen für denselben Schüler

Ein Schüler kann gleichzeitig in **mehreren Klassen** sein. Dieselbe Lektionsseite verhält sich in jedem Kontext korrekt — Annotationen, Prüfungsstatus und Freischaltungen pro Klasse sind je Klasse getrennt.

Das bedeutet:
- Dasselbe Skript kann in der Morgen- und der Nachmittagsgruppe verwendet werden
- Eine Prüfung kann pro Klasse unterschiedlich offen/geschlossen sein
- Eine Lehrperson kann einen Kurs und eine Nachhilfegruppe mit denselben Inhalten und getrennten Klassenlisten führen

---

## Klassen archivieren

Archiviere eine Klasse am Semesterende, um:
- Sie aus der Hauptliste deines Dashboards zu entfernen
- Historische Daten (Pseudonyme, Abgaben, Arbeiten) zum Nachschlagen zu behalten
- Keine neuen Beitritte über den Einladungscode mehr zuzulassen

Archivierte Klassen sind schreibgeschützt — Schüler können ihre Arbeit weiterhin ansehen, aber neue Abgaben sind blockiert.

Um eine Klasse (samt aller Schülerarbeiten) vollständig zu löschen, verwende **Class settings → Delete** — unwiderruflich.

---

## Klassen-Spickzettel

| Ziel | Wo |
|------|-------|
| Eine Klasse erstellen | Dashboard → Classes → New |
| Einladungscode / Beitritts-URL erhalten | Klassendetail → obere Toolbar |
| Klassenliste sehen | Klassendetail → Tab Students |
| Anonymen Zugang aktivieren | Class settings → Allow anonymous |
| Klassenliste massenweise importieren | Class settings → Pre-authorized roster |
| Die Arbeit eines Schülers sehen | Auf den Schüler in der Klassenliste klicken |
| Den Code neu generieren | Class settings → Regenerate invite code |
| Am Semesterende archivieren | Class settings → Archive |

# Datenschutz

Eduskript ist für den Einsatz in Schulen gebaut, wo die verarbeiteten Daten Lehrpersonen und — vor allem — Minderjährigen gehören. Datenschutz ist deshalb eine Designvorgabe, kein nachträglicher Gedanke. Diese Seite dokumentiert, welche Daten Eduskript speichert, wo sie gespeichert werden und wer sie verarbeitet.

> **Kurz gesagt**: E-Mail-Adressen von Schülern werden nie gespeichert. Datenbank, Dateien und verschlüsselte Sicherungen liegen in der Schweiz. KI-Anfragen mit Schülerdaten bleiben in der Schweiz und enthalten keine Identifikationsmerkmale. Keine Drittanbieter-Analytics, kein Werbe-Tracking.
>
> Die verbindliche Fassung ist die [Datenschutzerklärung](https://eduskript.org/datenschutz). Für Schulleitung und ICT gibt es eine [Übersicht](07-fuer-schulleitung-und-ict.md) und eine [Vorlage für den Auftragsbearbeitungsvertrag](08-avv-vorlage.md).

## Rechtlicher Rahmen

Eduskript wird unter dem **Schweizer Bundesgesetz über den Datenschutz (revDSG)** betrieben. Die Verarbeitung ist zudem an der **EU-Datenschutz-Grundverordnung (DSGVO)** ausgerichtet.

Anwendung, Datenbank und hochgeladene Dateien liegen bei Infomaniak in der Schweiz (Schweizer Unternehmen, nicht dem US CLOUD Act unterstellt). Sicherungen liegen ebenfalls bei Infomaniak:

- Datenbank: eine kurzfristige Sicherung auf dem Server selbst (rund 14 Tage, nicht zusätzlich verschlüsselt) und eine mit AES-256 verschlüsselte Sicherung in einem anderen Rechenzentrum (Winterthur) als der Server (Genf), höchstens 6 Monate aufbewahrt.
- Dateien (hochgeladene Dateien, Bilder, Videos): jede Nacht verschlüsselt nach Winterthur gesichert. Gelöschte oder ersetzte Dateien bleiben dort höchstens 30 Tage und sind danach endgültig gelöscht.

## Wo Daten gespeichert werden

Datenbank, hochgeladene Dateien und verschlüsselte Sicherungen liegen in der Schweiz.

| Auftragsverarbeiter | Zweck | Standort | Unternehmen |
|---------------|---------|----------|---------|
| Infomaniak | Server für Anwendung und PostgreSQL-Datenbank, Objektspeicher (hochgeladene Dateien, Bilder), verschlüsselte Sicherungen von Datenbank und Dateien, E-Mail-Versand an Lehrpersonen (SMTP) | Schweiz | Infomaniak Network SA (Schweiz) |
| CloudMailin | Empfang weitergeleiteter E-Mails (Mail-Hooks, z. B. Login-Codes) und von Entwürfen für Produkt-Updates | USA/EU | Dynamic Edge Software Ltd (Grossbritannien) |

Die vollständige Liste inklusive Zahlungsabwicklung und KI-Anbietern steht in der [Datenschutzerklärung](https://eduskript.org/datenschutz#unterauftragsbearbeiter).

E-Mails an Lehrpersonen (Verifizierung, Benachrichtigungen, Produkt-Updates) gehen per SMTP über Infomaniak in der Schweiz, ohne Öffnungs- oder Klick-Tracking. Produkt-Updates erhalten Lehrpersonen, die eingewilligt haben (bei der Registrierung, in den Kontoeinstellungen oder per Link), sowie Lehrpersonen, die sich vor dem 30. Oktober 2026 registriert haben, bis sie sich abmelden. Jede Mail enthält einen Abmeldelink. Besucherinnen und Besucher ohne Konto können Produkt-Updates mit ihrer E-Mail-Adresse abonnieren (Double-Opt-in: Updates erst nach Klick auf den Bestätigungslink). Gespeichert werden E-Mail-Adresse, Sprache sowie Zeitpunkt von Anmeldung und Bestätigung; beim Abmelden wird der Eintrag gelöscht, unbestätigte Anmeldungen nach 7 Tagen.

*Oktober 2026: Brevo entfernt. E-Mails an Lehrpersonen gehen per SMTP über Infomaniak in der Schweiz, ohne Öffnungs- oder Klick-Tracking. Produkt-Updates für neue Lehrpersonen nur mit Einwilligung; bestehende können sich jederzeit abmelden. Besucherinnen und Besucher ohne Konto können Produkt-Updates mit Bestätigung per Mail abonnieren.*

## Welche Daten gespeichert werden

Eduskript unterscheidet zwei Kontotypen mit bewusst unterschiedlichen Datenmodellen.

### Lehrpersonen

Lehrpersonen erstellen und besitzen Inhalte, deshalb wird eine normale Identität gespeichert:

- E-Mail-Adresse
- Anzeigename und optionale Profilfelder (Titel, Bio)
- Gehashtes Passwort (bcrypt) — nur bei E-Mail/Passwort-Konten
- Die von ihnen erstellten Inhalte (Skripts, Seiten, Dateien)

### Schülerinnen und Schüler

Schülerkonten sind **von Grund auf pseudonym**. Folgendes wird **nie** gespeichert:

- ❌ E-Mail-Adressen von Schülern
- ❌ Echte Namen von Schülern (es sei denn, ein Schüler gibt selbst einen ein)

Stattdessen wird ein Schüler identifiziert durch:

- Ein **Einweg-Pseudonym** — ein nicht umkehrbarer HMAC-Wert (SHA-256 mit geheimem Schlüssel), abgeleitet aus seiner Anmeldeidentität. Die ursprüngliche E-Mail lässt sich daraus nicht wiederherstellen.
- Einen zufällig erzeugten, stabilen Anzeige-Nickname.
- Die Kennung des OAuth-Anbieters, um wiederkehrende Anmeldungen zu erkennen.

So kann eine Lehrperson einen Schüler einer Klassenliste zuordnen (indem sie dieselbe E-Mail vorautorisiert, was denselben Hash ergibt), **ohne dass Eduskript je die E-Mail des Schülers speichert**. Profilbilder von OAuth-Anbietern werden zur Anzeige durchgereicht, aber nicht gespeichert.

> Wie das Eigentum an erstellten Inhalten geregelt ist, steht auf der Seite [Inhaltslizenz](03-inhaltslizenz.md).

## Anmeldung und Drittanbieter-Identität

Eduskript unterstützt die Anmeldung über externe Identitätsanbieter. Einige davon werden von US-Unternehmen betrieben (Microsoft). Wichtige Grenzen:

- Diese Anbieter werden **nur verwendet, wenn ein Nutzer sie aktiv wählt**. Die Anmeldung per E-Mail/Passwort bezieht sie nie ein.
- Eduskript erhält nur die minimalen Profildaten, die zum Erstellen des Kontos nötig sind (und bei Schülern werden selbst diese wie oben beschrieben auf ein Pseudonym reduziert).
- Für Schweizer Schulen sind souveräne Identitätsföderationen der bevorzugte Weg. Eine Anbindung an **Edulog** (die Föderation der Identitätsdienste für den Schweizer Bildungsraum, betrieben von Educa im Auftrag der EDK) ist geplant, aber noch nicht umgesetzt; sie würde pseudonymisierten Zugang ohne US-Anbieter in der Kette bieten.

## KI-Funktionen

KI-Feedback und KI-Bewertung schicken nur Aufgabentext, Lösung und gegebenenfalls Musterlösung bzw. Bewertungsraster an den KI-Anbieter — keine Namen, Pseudonyme, E-Mail-Adressen, Konto-IDs oder Klassen. Die Anfrage kommt vom Server, nicht vom Gerät des Schülers. Verarbeitet werden diese Anfragen von Infomaniak in der Schweiz, ohne Speicherung und ohne Training. Schreibt ein Schüler den eigenen Namen in die Lösung, geht er mit.

## Sitzungen

Die Authentifizierung verwendet **zustandslose JWT-Sitzungen**. Es gibt keinen serverseitigen Sitzungsspeicher; das Sitzungs-Token liegt in einem HTTP-only, sicheren Cookie. Eduskript verwendet keine Sitzungsdienste von Drittanbietern; die Anmeldung über Microsoft ist optional (siehe oben).

## Was Eduskript *nicht* tut

- Keine Web-Analytics von Drittanbietern (kein Google Analytics, Plausible, PostHog usw.).
- Keine Werbung, kein Verhaltens-Tracking.
- Kein Verkauf oder Weitergabe personenbezogener Daten an Werbetreibende.
- Keine Speicherung von E-Mail-Adressen von Schülern.

## Rechte der betroffenen Personen

Nach revDSG und DSGVO können Nutzer Auskunft über ihre personenbezogenen Daten sowie deren Berichtigung oder Löschung verlangen. Da Schülerkonten nur ein Pseudonym und keine E-Mail enthalten, ist der Datenbestand bei Schülern konstruktionsbedingt minimal.

Das Löschen eines Kontos entfernt die zugehörigen personenbezogenen Daten. In den Sicherungen bleiben sie noch bis zum Ablauf der oben genannten Fristen (Dateien 30 Tage, Datenbank höchstens 6 Monate). Von Lehrpersonen erstellte Inhalte unterliegen der [Inhaltslizenz](03-inhaltslizenz.md) und den Regeln der Zusammenarbeit.

## Kontakt

Für Fragen oder Anfragen zum Datenschutz: Luz Media GmbH, [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch). Wer Eduskript selbst betreibt, ist für die eigene Instanz selbst verantwortlich.

## Zusammenfassung

Eduskript speichert das Minimum an personenbezogenen Daten, das für den Betrieb nötig ist. Identitäten von Lehrpersonen sind konventionell; Identitäten von Schülern sind pseudonymisiert und enthalten keine E-Mail. Die Kerndaten liegen in der Schweiz (Infomaniak); ebenso die verschlüsselten Sicherungen und der E-Mail-Versand. KI-Anfragen enthalten keine Identifikationsmerkmale. US-Identitätsanbieter sind optional und werden vom Nutzer selbst gewählt; Analytics oder Tracking werden nicht eingesetzt.

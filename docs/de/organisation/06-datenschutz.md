# Datenschutz

Eduskript ist für den Einsatz in Schulen gebaut, wo die verarbeiteten Daten Lehrpersonen und — vor allem — Minderjährigen gehören. Datenschutz ist deshalb eine Designvorgabe, kein nachträglicher Gedanke. Diese Seite dokumentiert, welche Daten Eduskript speichert, wo sie gespeichert werden und wer sie verarbeitet.

> **Kurz gesagt**: E-Mail-Adressen von Schülern werden nie gespeichert. Datenbank und Dateien liegen in der EU (Frankfurt, Paris). KI-Anfragen enthalten keine Identifikationsmerkmale. Keine Drittanbieter-Analytics, kein Werbe-Tracking.
>
> Die verbindliche Fassung ist die [Datenschutzerklärung](https://eduskript.org/datenschutz). Für Schulleitung und ICT gibt es eine [Übersicht](07-fuer-schulleitung-und-ict.md) und eine [Vorlage für den Auftragsbearbeitungsvertrag](08-avv-vorlage.md).

## Rechtlicher Rahmen

Eduskript wird unter dem **Schweizer Bundesgesetz über den Datenschutz (revDSG)** betrieben. Da alle Primärdaten innerhalb der EU gehostet werden, ist die Verarbeitung auch an der **EU-Datenschutz-Grundverordnung (DSGVO)** ausgerichtet.

Die EU gilt nach Schweizer Recht als Staat mit angemessenem Datenschutz. Die Datenbank läuft allerdings auf Infrastruktur von US-Unternehmen (Neon, AWS) in Frankfurt; diese unterliegen grundsätzlich dem US CLOUD Act.

## Wo Daten gespeichert werden

Alle Primärdaten — die Datenbank und hochgeladene Dateien — liegen in der EU.

| Auftragsverarbeiter | Zweck | Standort | Unternehmen |
|---------------|---------|----------|---------|
| Koyeb | Anwendungs-Hosting + verwaltete PostgreSQL-Datenbank (betrieben über Neon auf AWS) | Frankfurt (`fra`) | Koyeb SAS (Frankreich) |
| Scaleway | Objektspeicher (hochgeladene Dateien, Bilder) | Paris (`fr-par`) | Scaleway SAS (Frankreich) |
| Brevo | Transaktions-E-Mails (Verifizierung, Benachrichtigungen) | EU | Sendinblue SAS / Brevo (Frankreich) |

Die vollständige Liste inklusive Zahlungsabwicklung, Video-Hosting und KI-Anbietern steht in der [Datenschutzerklärung](https://eduskript.org/datenschutz#unterauftragsbearbeiter).

Transaktions-E-Mails werden mit deaktiviertem Tracking versendet.

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
- Für Schweizer Schulen sind souveräne Identitätsföderationen der bevorzugte Weg. Die Unterstützung von **Edulog** (die Föderation der Identitätsdienste für den Schweizer Bildungsraum, betrieben von Educa im Auftrag der EDK) ist der empfohlene Weg; sie bietet pseudonymisierten Zugang ohne US-Anbieter in der Kette.

## KI-Funktionen

KI-Feedback und KI-Bewertung schicken nur Aufgabentext, Lösung und gegebenenfalls Musterlösung bzw. Bewertungsraster an den KI-Anbieter — keine Namen, Pseudonyme, E-Mail-Adressen, Konto-IDs oder Klassen. Die Anfrage kommt vom Server, nicht vom Gerät des Schülers. Diese Anfragen gehen nur an Endpunkte ohne Datenspeicherung (Zero Data Retention), die nicht zum Training verwenden. Schreibt ein Schüler den eigenen Namen in die Lösung, geht er mit.

## Sitzungen

Die Authentifizierung verwendet **zustandslose JWT-Sitzungen**. Es gibt keinen serverseitigen Sitzungsspeicher; das Sitzungs-Token liegt in einem HTTP-only, sicheren Cookie. Eduskript verwendet keine Sitzungs- oder Login-Dienste von Drittanbietern.

## Was Eduskript *nicht* tut

- Keine Web-Analytics von Drittanbietern (kein Google Analytics, Plausible, PostHog usw.).
- Keine Werbung, kein Verhaltens-Tracking.
- Kein Verkauf oder Weitergabe personenbezogener Daten an Werbetreibende.
- Keine Speicherung von E-Mail-Adressen von Schülern.

## Rechte der betroffenen Personen

Nach revDSG und DSGVO können Nutzer Auskunft über ihre personenbezogenen Daten sowie deren Berichtigung oder Löschung verlangen. Da Schülerkonten nur ein Pseudonym und keine E-Mail enthalten, ist der Datenbestand bei Schülern konstruktionsbedingt minimal.

Das Löschen eines Kontos entfernt die zugehörigen personenbezogenen Daten. Von Lehrpersonen erstellte Inhalte unterliegen der [Inhaltslizenz](03-inhaltslizenz.md) und den Regeln der Zusammenarbeit.

## Kontakt

Für Fragen oder Anfragen zum Datenschutz: Luz Media GmbH, [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch). Wer Eduskript selbst betreibt, ist für die eigene Instanz selbst verantwortlich.

## Zusammenfassung

Eduskript speichert das Minimum an personenbezogenen Daten, das für den Betrieb nötig ist. Identitäten von Lehrpersonen sind konventionell; Identitäten von Schülern sind pseudonymisiert und enthalten keine E-Mail. Alle Kerndaten liegen in der EU (Koyeb in Frankfurt, Scaleway in Paris, Brevo). KI-Anfragen enthalten keine Identifikationsmerkmale. US-Identitätsanbieter sind optional und werden vom Nutzer selbst gewählt; Analytics oder Tracking werden nicht eingesetzt.

# Für Schulleitung und ICT

Diese Seite fasst auf einer Seite zusammen, was Schulleitung, ICT-Verantwortliche und Datenschutzverantwortliche vor dem Einsatz von Eduskript wissen müssen. Sie lässt sich ausdrucken und weitergeben.

> [!success] Kurz gesagt
> - Schülerinnen und Schüler sind **pseudonym**. Eduskript speichert keine E-Mail-Adressen von Schülerinnen und Schülern.
> - Datenbank, Dateien und E-Mail-Versand liegen in der **EU** (Frankreich).
> - Die KI erhält **nur die Lösung**, ohne Namen, Pseudonym, Konto-ID, Klasse oder IP-Adresse. Die KI-Anbieter dürfen die Inhalte weder speichern noch zum Training verwenden.
> - Kein Tracking, keine Analyse-Dienste, keine Werbung.
> - Quellcode öffentlich (AGPL v3), Sicherheitsprüfung durch Dritte möglich.
> - Wir unterzeichnen einen **Auftragsbearbeitungsvertrag**: unsere [Vorlage](08-avv-vorlage.md) oder das Muster Ihres Kantons.

## Wer ist wofür verantwortlich

Eduskript wird von der Luz Media GmbH (Winterthur) betrieben. Setzt eine Lehrperson Eduskript mit einer Klasse ein, bearbeitet Eduskript die Daten der Schülerinnen und Schüler **im Auftrag der Schule**. Die Schule bleibt Verantwortliche nach kantonalem Datenschutzrecht. Deshalb braucht es einen schriftlichen Vertrag zwischen Schule und Eduskript, nicht zwischen Lehrperson und Eduskript.

Was ohne Vertrag geht: Lehrpersonen können gratis Skripts schreiben und veröffentlichen. Dabei fallen keine Schülerdaten an, solange sich Schülerinnen und Schüler nicht anmelden.

## Welche Daten anfallen

| Betroffene | Daten |
|---|---|
| Lehrpersonen | Name, E-Mail, Inhalte, Einstellungen, Abo-Status |
| Schülerinnen und Schüler | Pseudonym, Spitzname, Klassenzugehörigkeit, Antworten, Code, Quiz-Ergebnisse, Fortschritt, Zeichnungen, Prüfungsantworten, Punkte, Rückmeldungen |

Keine besonders schützenswerten Personendaten vorgesehen.

## Wie die Pseudonymisierung funktioniert

1. Die Schülerin oder der Schüler meldet sich über den Anmeldedienst der Schule an (z. B. Microsoft 365).
2. Eduskript berechnet aus der übermittelten E-Mail-Adresse ein nicht umkehrbares Pseudonym (HMAC) und verwirft die E-Mail-Adresse.
3. Die Lehrperson gibt für ihre Klassenliste die E-Mail-Adressen ein. Eduskript berechnet daraus dasselbe Pseudonym, ohne die E-Mail-Adresse zu speichern. So findet die Lehrperson ihre Schülerinnen und Schüler. Die Liste mit den E-Mail-Adressen bleibt nur im Browser der Lehrperson.

Wer die Datenbank von Eduskript einsieht, findet keine E-Mail-Adressen von Schülerinnen und Schülern, nur Pseudonyme und Spitznamen.

## KI-Funktionen

KI wird für drei Dinge eingesetzt: Feedback auf handschriftliche Lösungen, Vorschläge zur Bewertung von Prüfungsantworten und Unterstützung der Lehrperson beim Schreiben. Die KI schlägt vor, die Lehrperson entscheidet.

An den KI-Anbieter gehen nur:

- der Aufgabentext der Lehrperson,
- die Lösung (Bild der Handschrift, Antworttext oder Code),
- gegebenenfalls Musterlösung und Bewertungsraster.

Die Anfrage kommt vom Server von Eduskript, nicht vom Gerät der Schülerin oder des Schülers. Bilder werden aus den Stiftstrichen neu gezeichnet, Fotos verlieren beim Neukodieren ihre Metadaten (z. B. Standort). Schreibt jemand den eigenen Namen in die Lösung, geht er mit; darauf weist Eduskript beim Beitritt zur Klasse hin.

## Unterauftragsbearbeiter

Die verbindliche, datierte Liste mit Zweck und Standort steht in der [Datenschutzerklärung](https://eduskript.org/datenschutz#unterauftragsbearbeiter). Über neue Anbieter informieren wir Schulen mit Vertrag mindestens 30 Tage im Voraus.

## Unterlagen

- [Datenschutzerklärung](https://eduskript.org/datenschutz)
- [Vorlage Auftragsbearbeitungsvertrag](08-avv-vorlage.md)
- [Nutzungsbedingungen](https://eduskript.org/terms)
- [Quellcode](https://github.com/marcchehab/eduskript)

## Kontakt

Luz Media GmbH, [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch). Wir beantworten Fragebögen der Schul-ICT und unterzeichnen kantonale Muster.

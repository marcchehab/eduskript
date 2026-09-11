# Datenschutz

Eduskript ist für den Einsatz in Schulen gebaut, wo die verarbeiteten Daten Lehrpersonen und — vor allem — Minderjährigen gehören. Datenschutz ist deshalb eine Designvorgabe, kein nachträglicher Gedanke. Diese Seite dokumentiert, welche Daten Eduskript speichert, wo sie gespeichert werden und wer sie verarbeitet.

> **Kurz gesagt**: E-Mail-Adressen von Schülern werden nie gespeichert. Alle Kerndaten liegen auf europäischer Infrastruktur (Frankreich). Keine Drittanbieter-Analytics, kein Werbe-Tracking. Die Anmeldung über US-Identitätsanbieter erfolgt nur, wenn ein Nutzer das selbst wählt.

## Rechtlicher Rahmen

Eduskript wird unter dem **Schweizer Bundesgesetz über den Datenschutz (revDSG)** betrieben. Da alle Primärdaten innerhalb der EU gehostet werden, ist die Verarbeitung auch an der **EU-Datenschutz-Grundverordnung (DSGVO)** ausgerichtet.

Die Schweiz verfügt über einen Angemessenheitsbeschluss der EU, und die unten aufgeführten Hosting-Anbieter unterliegen Schweizer und EU-Recht — nicht dem US CLOUD Act.

## Wo Daten gespeichert werden

Alle Primärdaten — die Datenbank und hochgeladene Dateien — werden auf **europäischer Infrastruktur französischer Unternehmen** gehostet. Für Speicherung und Rechenleistung wird kein US-Hyperscaler (AWS, Google Cloud, Azure) verwendet.

| Auftragsverarbeiter | Zweck | Standort | Unternehmen |
|---------------|---------|----------|---------|
| Koyeb | Anwendungs-Hosting + verwaltete PostgreSQL-Datenbank | EU-Region | Koyeb SAS (Frankreich) |
| Scaleway | Objektspeicher (hochgeladene Dateien, Bilder) | Paris (`fr-par`) | Scaleway SAS (Frankreich) |
| Brevo | Transaktions-E-Mails (Verifizierung, Benachrichtigungen) | EU | Sendinblue SAS / Brevo (Frankreich) |

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

- Ein **Einweg-Pseudonym** — ein nicht umkehrbarer SHA-256-Hash, abgeleitet aus seiner Anmeldeidentität. Die ursprüngliche E-Mail lässt sich daraus nicht wiederherstellen.
- Einen zufällig erzeugten, stabilen Anzeige-Nickname.
- Die Kennung des OAuth-Anbieters, um wiederkehrende Anmeldungen zu erkennen.

So kann eine Lehrperson einen Schüler einer Klassenliste zuordnen (indem sie dieselbe E-Mail vorautorisiert, was denselben Hash ergibt), **ohne dass Eduskript je die E-Mail des Schülers speichert**. Profilbilder von OAuth-Anbietern werden zur Anzeige durchgereicht, aber nicht gespeichert.

> Wie das Eigentum an erstellten Inhalten geregelt ist, steht auf der Seite [Inhaltslizenz](03-inhaltslizenz.md).

## Anmeldung und Drittanbieter-Identität

Eduskript unterstützt die Anmeldung über externe Identitätsanbieter. Einige davon werden von US-Unternehmen betrieben (Microsoft, Google, GitHub). Wichtige Grenzen:

- Diese Anbieter werden **nur verwendet, wenn ein Nutzer sie aktiv wählt**. Die Anmeldung per E-Mail/Passwort bezieht sie nie ein.
- Eduskript erhält nur die minimalen Profildaten, die zum Erstellen des Kontos nötig sind (und bei Schülern werden selbst diese wie oben beschrieben auf ein Pseudonym reduziert).
- Für Schweizer Schulen sind souveräne Identitätsföderationen der bevorzugte Weg. Die Unterstützung von **Edulog** (die Föderation der Identitätsdienste für den Schweizer Bildungsraum, betrieben von Educa im Auftrag der EDK) ist der empfohlene Weg; sie bietet pseudonymisierten Zugang ohne US-Anbieter in der Kette.

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

Für Fragen oder Anfragen zum Datenschutz wende dich an den Betreiber der Instanz. Für die öffentliche Instanz auf eduskript.org ist das der im Impressum der Website genannte Betreiber der Plattform.

## Zusammenfassung

Eduskript speichert das Minimum an personenbezogenen Daten, das für den Betrieb nötig ist. Identitäten von Lehrpersonen sind konventionell; Identitäten von Schülern sind pseudonymisiert und enthalten keine E-Mail. Alle Kerndaten werden auf französischer/EU-Infrastruktur (Koyeb, Scaleway, Brevo) unter Schweizer und EU-Datenschutzrecht gehostet. US-Identitätsanbieter sind optional und werden vom Nutzer selbst gewählt; Analytics oder Tracking werden nicht eingesetzt.

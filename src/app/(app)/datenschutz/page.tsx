import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalFooter } from '@/components/legal-footer'

export const metadata: Metadata = {
  title: 'Datenschutzerklärung – Eduskript',
  description:
    'Welche Daten Eduskript bearbeitet, wo sie liegen, welche Anbieter beteiligt sind und wie die KI-Funktionen mit Schülerdaten umgehen.',
}

/**
 * Privacy policy (German only; /privacy redirects here).
 *
 * The sub-processor table below is the canonical, dated list that the AVV
 * template and the manual page "Für Schulleitung und ICT" link to
 * (#unterauftragsbearbeiter). When a provider changes: update SUBPROCESSORS,
 * add a CHANGELOG entry, bump TERMS_DATE in legal-footer.tsx. The AVV promises
 * schools 30 days' notice before a new sub-processor goes live.
 *
 * The "KI-Funktionen" claims are backed by: src/lib/ai/scoring.ts (prompt =
 * exercise + rubric + submission text, no ids), src/lib/scoring/submissions.ts
 * (studentId never leaves the server), src/app/api/ai/feedback/route.ts (image
 * redrawn from strokes / re-encoded photo, no EXIF), src/lib/ai/openrouter.ts
 * (data_collection: 'deny' on every request). Re-check them before changing
 * this section.
 */

// Sources (checked 2026-09-23): Koyeb API (app fra1, DB service type
// neon_postgres in region fra, host *.eu-central-1.pg.koyeb.app), src/lib/s3.ts
// (fr-par), OpenRouter provider list (retention/training flags). AI providers
// must match DEEPSEEK_V4_FLASH_PROVIDERS / zdr routing in src/lib/ai/openrouter.ts.
const SUBPROCESSORS: { name: string; purpose: string; location: string; studentData: string }[] = [
  { name: 'Koyeb SAS (Frankreich)', purpose: 'Hosting der Anwendung und der PostgreSQL-Datenbank', location: 'Frankfurt, Deutschland', studentData: 'ja' },
  { name: 'Neon, Inc. und Amazon Web Services (USA), im Auftrag von Koyeb', purpose: 'Infrastruktur der Datenbank (verschlüsselt gespeichert)', location: 'Frankfurt, Deutschland', studentData: 'ja' },
  { name: 'Scaleway SAS (Frankreich)', purpose: 'Dateispeicher (hochgeladene Dateien, Bilder)', location: 'Paris, Frankreich', studentData: 'ja (Uploads)' },
  { name: 'Brevo / Sendinblue SAS (Frankreich)', purpose: 'E-Mail-Versand an Lehrpersonen (Bestätigung, Benachrichtigungen)', location: 'EU', studentData: 'nein' },
  { name: 'Payrexx AG (Schweiz)', purpose: 'Zahlungsabwicklung', location: 'Schweiz', studentData: 'nein' },
  { name: 'Mux, Inc. (USA)', purpose: 'Video-Hosting für von Lehrpersonen hochgeladene Videos', location: 'USA', studentData: 'nein' },
  { name: 'OpenRouter, Inc. (USA)', purpose: 'Vermittlung der KI-Anfragen an die Modellanbieter', location: 'USA', studentData: 'nur Lösungen, ohne Identifikationsmerkmale' },
  { name: 'Google LLC (USA), Vertex AI', purpose: 'KI-Feedback auf Handschrift und Zeichnungen (Gemini)', location: 'von Google gewählt (global)', studentData: 'wie OpenRouter' },
  { name: 'DigitalOcean, LLC (USA)', purpose: 'KI-Bewertung von Prüfungsantworten (DeepSeek V4 Flash, offene Gewichte)', location: 'USA', studentData: 'wie OpenRouter' },
  { name: 'Weitere Modellanbieter über OpenRouter', purpose: 'KI-Unterstützung der Lehrperson beim Schreiben (Chat, KI-Bearbeitung, Diagramme)', location: 'USA u. a.', studentData: 'nein' },
]

const CHANGELOG: { date: string; change: string }[] = [
  { date: 'September 2026', change: 'Erste veröffentlichte Liste.' },
  { date: 'September 2026', change: 'DeepInfra entfernt; KI-Bewertung nur noch über DigitalOcean.' },
]

const h2 = 'text-xl font-semibold mt-6 mb-2'
const h3 = 'text-lg font-medium mt-4 mb-1'

export default function DatenschutzPage() {
  return (
    <div lang="de" className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Zurück
        </Link>

        <h1 className="text-3xl font-bold mb-2">Datenschutzerklärung</h1>
        <p className="text-muted-foreground mb-8">Eduskript — Luz Media GmbH</p>

        <div className="prose prose-neutral dark:prose-invert space-y-6 [&_p]:mt-4">
          <section className="rounded-lg border bg-muted/40 p-4 not-prose text-sm space-y-2">
            <p className="font-semibold">Das Wichtigste in Kürze</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Schülerinnen und Schüler sind <strong>pseudonym</strong>: Ihre
                E-Mail-Adresse wird nie gespeichert. Die Zuordnung zu echten
                E-Mail-Adressen liegt nur im Browser der Lehrperson.
              </li>
              <li>
                Datenbank und Dateien liegen in der <strong>EU</strong>
                (Frankfurt und Paris).
              </li>
              <li>
                KI-Anfragen enthalten <strong>keine Namen, Pseudonyme,
                E-Mail-Adressen oder Konto-IDs</strong>. Anbieter, die
                Lösungen von Schülerinnen und Schülern erhalten, dürfen sie
                weder speichern noch zum Training verwenden.
              </li>
              <li>Kein Tracking, keine Analyse-Dienste, keine Werbung.</li>
              <li>
                Für Schulen gibt es eine{' '}
                <Link href="#schulen" className="underline">
                  Vorlage für einen Auftragsbearbeitungsvertrag
                </Link>
                .
              </li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>1. Verantwortliche Stelle</h2>
            <p>
              Luz Media GmbH, Untere Vogelsangstrasse 11, 8400 Winterthur,
              Schweiz, UID CHE-261.508.926 (weitere Angaben im{' '}
              <Link href="/impressum" className="underline">
                Impressum
              </Link>
              ). Kontakt für Datenschutzfragen:{' '}
              <a href="mailto:kontakt@luzmedia.ch" className="underline">
                kontakt@luzmedia.ch
              </a>
              .
            </p>
            <p>
              Für Konten von Lehrpersonen ist die Luz Media GmbH
              Verantwortliche. Setzt eine Schule oder eine Lehrperson Eduskript
              mit Schülerinnen und Schülern ein (Klassen, Prüfungen,
              KI-Feedback), bearbeitet die Luz Media GmbH deren Daten im
              Auftrag der Schule. Verantwortlich für diese Bearbeitung ist die
              Schule.
            </p>
            <p>
              Massgebend ist das Schweizer Datenschutzgesetz (DSG) bzw. für
              öffentliche Schulen das kantonale Datenschutzrecht.
            </p>
          </section>

          <section>
            <h2 className={h2}>2. Welche Daten wir bearbeiten</h2>

            <h3 className={h3}>Lehrpersonen</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Name, E-Mail-Adresse, optionale Profilangaben (Titel, Bio)</li>
              <li>Passwort als bcrypt-Hash (nur bei Anmeldung mit E-Mail und Passwort)</li>
              <li>Erstellte Inhalte (Skripts, Seiten, Dateien) und Einstellungen</li>
              <li>Abo-Status. Kartendaten liegen nur bei Payrexx, nicht bei uns.</li>
            </ul>

            <h3 className={h3}>Schülerinnen und Schüler</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Ein Pseudonym: ein nicht umkehrbarer HMAC-Wert, berechnet aus
                der E-Mail-Adresse, die der Anmeldedienst der Schule übermittelt.
                Die E-Mail-Adresse selbst wird <strong>nicht gespeichert</strong>.
              </li>
              <li>Ein zufällig erzeugter oder selbst gewählter Spitzname</li>
              <li>Die Kennung des Anmeldedienstes, um wiederkehrende Anmeldungen zu erkennen</li>
              <li>Klassenzugehörigkeit</li>
              <li>
                Arbeitsdaten: Antworten, Code, Quiz-Ergebnisse, Fortschritt,
                Annotationen und Zeichnungen, Prüfungsantworten, Punkte und
                Rückmeldungen (auch solche der KI)
              </li>
            </ul>
            <p>
              Eine Lehrperson kann eine Schülerin oder einen Schüler einer
              Klassenliste zuordnen, indem sie die E-Mail-Adresse eingibt:
              Daraus entsteht dasselbe Pseudonym. Die Liste der eingegebenen
              E-Mail-Adressen speichert nur der Browser der Lehrperson, nicht
              der Server. Schülerinnen und
              Schüler können einer Klasse ausserdem freiwillig erlauben, dass
              die Lehrperson sie identifiziert.
            </p>

            <h3 className={h3}>Technische Daten</h3>
            <p>
              IP-Adressen verwenden wir kurzzeitig im Arbeitsspeicher, um
              Missbrauch zu begrenzen (Rate-Limiting). Wir speichern sie nicht
              in der Datenbank. Die Zugriffsprotokolle des Hosting-Anbieters
              können IP-Adressen für kurze Zeit enthalten.
            </p>
          </section>

          <section>
            <h2 className={h2}>3. Zweck</h2>
            <p>
              Wir bearbeiten Personendaten ausschliesslich, um die Plattform zu
              betreiben und Zahlungen abzuwickeln. Wir verkaufen keine Daten,
              bilden keine Profile, zeigen keine Werbung und verwenden keine
              Inhalte zum Training von KI-Modellen.
            </p>
          </section>

          <section>
            <h2 className={h2}>4. KI-Funktionen</h2>
            <p>
              Eduskript setzt KI für drei Dinge ein: Feedback an Schülerinnen
              und Schüler auf handschriftliche oder gezeichnete Lösungen,
              KI-gestützte Bewertung von Prüfungsantworten nach einem
              Bewertungsraster der Lehrperson und Unterstützung der Lehrperson
              beim Erstellen von Inhalten. KI-Feedback ist nur dort aktiv, wo
              die Lehrperson es in eine Aufgabe einbaut. Die KI schlägt nur
              Punkte und Rückmeldungen vor; über die Bewertung entscheidet die
              Lehrperson.
            </p>

            <h3 className={h3}>Was übermittelt wird</h3>
            <p>
              Die Anfragen gehen vom Server von Eduskript aus, nicht vom Gerät
              der Schülerin oder des Schülers. Übermittelt werden nur:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>der Aufgabentext der Lehrperson,</li>
              <li>die Lösung (Bild der Handschrift bzw. Antworttext oder Code),</li>
              <li>ggf. die Musterlösung und das Bewertungsraster der Lehrperson.</li>
            </ul>
            <p>
              <strong>Nicht</strong> übermittelt werden Namen, Spitznamen,
              Pseudonyme, E-Mail-Adressen, Konto-IDs, Klassenbezeichnungen oder
              IP-Adressen der Schülerinnen und Schüler. Bilder der Handschrift
              werden aus den Stiftstrichen neu gezeichnet; Fotos werden neu
              kodiert, dabei fallen Metadaten wie Standort oder Kameramodell
              weg. Für den KI-Anbieter ist eine Anfrage damit keiner Person
              zuordenbar.
            </p>
            <p>
              Einschränkung: Schreibt eine Schülerin oder ein Schüler den
              eigenen Namen in die Lösung selbst (z. B. auf das fotografierte
              Blatt oder in einen Code-Kommentar), geht dieser mit. Wir weisen
              beim Beitritt zu einer Klasse darauf hin.
            </p>

            <h3 className={h3}>Kein Training, keine Speicherung</h3>
            <p>
              Alle KI-Anfragen laufen über OpenRouter. Anfragen mit Lösungen
              von Schülerinnen und Schülern (KI-Feedback, KI-Bewertung) gehen
              nur an die in Abschnitt 5 genannten Anbieter und nur an
              Endpunkte ohne Datenspeicherung (Zero Data Retention): Die
              Inhalte werden nur für die Antwort verarbeitet, nicht
              gespeichert und nicht zum Training verwendet. Ist keiner dieser
              Anbieter erreichbar, schlägt die Anfrage fehl, statt auf einen
              anderen Anbieter auszuweichen.
            </p>
            <p>
              Anfragen, mit denen Lehrpersonen ihre eigenen Inhalte bearbeiten,
              gehen nur an Anbieter, die Inhalte nicht zum Training
              verwenden.
            </p>
          </section>

          <section>
            <h2 id="unterauftragsbearbeiter" className={h2}>
              5. Unterauftragsbearbeiter und Standorte
            </h2>
            <p>
              Datenbank, Dateien und E-Mail-Versand liegen in der EU. Die EU
              gilt nach Schweizer Recht als Staat mit angemessenem
              Datenschutz. Die Datenbank läuft in Frankfurt auf Infrastruktur
              von US-Unternehmen (Neon, AWS). Für die KI-Funktionen und das
              Video-Hosting gehen Daten in die USA, bei der KI ohne
              Identifikationsmerkmale (siehe Abschnitt 4).
            </p>
            <div className="not-prose overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-3 font-semibold">Anbieter</th>
                    <th className="py-2 pr-3 font-semibold">Zweck</th>
                    <th className="py-2 pr-3 font-semibold">Standort</th>
                    <th className="py-2 font-semibold">Schülerdaten</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBPROCESSORS.map((s) => (
                    <tr key={s.name} className="border-b align-top">
                      <td className="py-2 pr-3">{s.name}</td>
                      <td className="py-2 pr-3">{s.purpose}</td>
                      <td className="py-2 pr-3">{s.location}</td>
                      <td className="py-2">{s.studentData}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Die Anmeldung über Microsoft findet bei Microsoft statt
              und nur, wenn man diesen Weg wählt.
            </p>
            <p className="text-sm text-muted-foreground">
              Änderungen dieser Liste:{' '}
              {CHANGELOG.map((c) => `${c.date}: ${c.change}`).join(' · ')}
            </p>
          </section>

          <section>
            <h2 className={h2}>6. Cookies und lokale Speicherung</h2>
            <p>
              Eduskript setzt ein Anmelde-Cookie (Sitzung) und kurzzeitig ein
              Cookie, das sich während der Anmeldung die gewählte Rolle merkt.
              Einstellungen wie Farbschema oder Fortschritt ohne Anmeldung
              speichert der Browser lokal. Es gibt keine Tracking- oder
              Werbe-Cookies.
            </p>
          </section>

          <section>
            <h2 className={h2}>7. Aufbewahrung und Löschung</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Konten und ihre Daten bleiben gespeichert, bis sie gelöscht
                werden. Konten lassen sich in den Einstellungen selbst löschen
                oder auf Anfrage.
              </li>
              <li>
                Löscht eine Schülerin oder ein Schüler das Konto, werden auch
                Antworten, Zeichnungen und abgegebene Prüfungen gelöscht; die
                Lehrperson sieht sie danach nicht mehr.
              </li>
              <li>
                Datensicherungen werden im regulären Zyklus überschrieben.
              </li>
              <li>
                Server-Protokolle enthalten keine Inhalte von Schülerinnen und
                Schülern. Für die Fehlersuche kann das Protokollieren von
                Inhalten gezielt und vorübergehend für einzelne Funktionen
                eingeschaltet werden; standardmässig ist es aus.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>8. Deine Rechte</h2>
            <p>
              Du kannst Auskunft über deine Daten verlangen und sie berichtigen
              oder löschen lassen und eine Kopie deiner Daten in einem
              maschinenlesbaren Format (JSON) erhalten. Export und Löschung
              findest du in den Einstellungen deines Kontos. Anfragen an{' '}
              <a href="mailto:kontakt@luzmedia.ch" className="underline">
                kontakt@luzmedia.ch
              </a>
              . Betreffen sie Daten, die wir im Auftrag einer Schule
              bearbeiten, leiten wir sie an die Schule weiter.
            </p>
          </section>

          <section>
            <h2 id="schulen" className={h2}>
              9. Für Schulen
            </h2>
            <p>
              Schulen, die Eduskript mit Schülerinnen und Schülern einsetzen,
              schliessen mit uns einen Auftragsbearbeitungsvertrag ab. Wir
              unterzeichnen unsere Vorlage oder das Muster Ihres Kantons.
              Vorlage, Übersicht für Schulleitung und ICT sowie technische
              Details stehen im{' '}
              <Link href="/c/organisation/fuer-schulleitung-und-ict" className="underline">
                Benutzerhandbuch
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className={h2}>10. Änderungen</h2>
            <p>
              Wir passen diese Erklärung an, wenn sich die Plattform oder die
              Anbieter ändern. Das Datum der aktuellen Fassung steht unten und
              in der Fusszeile jeder Seite.
            </p>
          </section>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}

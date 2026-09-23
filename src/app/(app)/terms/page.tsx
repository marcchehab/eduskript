import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalFooter } from '@/components/legal-footer'

export const metadata: Metadata = {
  title: 'Nutzungsbedingungen – Eduskript',
  description: 'Nutzungsbedingungen der Bildungsplattform Eduskript',
}

// Legal texts are German (the operator and its customers are Swiss schools);
// the app UI stays English. Bump TERMS_DATE in legal-footer.tsx on changes.
export default function TermsPage() {
  return (
    <div lang="de" className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Zurück
        </Link>

        <h1 className="text-3xl font-bold mb-2">Nutzungsbedingungen</h1>
        <p className="text-muted-foreground mb-8">Eduskript — Luz Media GmbH</p>

        <div className="prose prose-neutral dark:prose-invert space-y-6 [&_p]:mt-4">
          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">1. Geltungsbereich</h2>
            <p>
              Diese Nutzungsbedingungen regeln die Nutzung von Eduskript (die
              «Plattform»), betrieben von der Luz Media GmbH, Untere
              Vogelsangstrasse 11, 8400 Winterthur, Schweiz (die
              «Betreiberin»).
            </p>
            <p>
              Mit der Registrierung oder Nutzung der Plattform akzeptierst du
              diese Bedingungen.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">2. Die Plattform</h2>
            <p>
              Eduskript ist eine Open-Source-Bildungsplattform, auf der
              Lehrpersonen digitale Lernmaterialien erstellen, veröffentlichen
              und teilen. Schülerinnen und Schüler greifen über ihre
              Lehrpersonen auf diese Materialien zu.
            </p>
            <p>
              Der Quellcode der Plattform steht unter der{' '}
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GNU Affero General Public License v3
              </a>
              .
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">3. Rollen</h2>
            <p>Die Plattform unterscheidet zwei Arten von Nutzenden:</p>

            <h3 className="text-lg font-medium mt-4 mb-1">Lehrpersonen</h3>
            <p>
              Lehrpersonen registrieren sich mit einer E-Mail-Adresse oder über
              ihr Microsoft-Konto. Sie können
              Inhalte erstellen und veröffentlichen, mit anderen Lehrpersonen
              zusammenarbeiten, Klassen führen und kostenpflichtige Abos
              abschliessen.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">Schülerinnen und Schüler</h3>
            <p>
              Schülerinnen und Schüler melden sich über den Anmeldedienst ihrer
              Schule an. Sie müssen keine persönliche E-Mail-Adresse angeben.
              Schülerkonten werden über ein Pseudonym identifiziert, das aus den
              Anmeldedaten berechnet wird, nicht über den echten Namen oder die
              E-Mail-Adresse. Einen selbst gewählten Spitznamen speichert die
              Plattform im Klartext; er ist für die Lehrpersonen sichtbar.
            </p>
            <p>
              Schülerinnen und Schüler können veröffentlichte Inhalte ansehen,
              interaktive Aufgaben lösen und Arbeiten bei ihren Lehrpersonen
              abgeben. Sie veröffentlichen keine Inhalte und bezahlen nichts.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">4. Konten</h2>
            <p>
              Lehrpersonen machen bei der Registrierung korrekte Angaben und
              halten ihre Zugangsdaten geheim. Die Betreiberin kann Konten
              sperren oder löschen, die gegen diese Bedingungen verstossen.
            </p>
            <p>
              Schülerkonten laufen über den Anmeldedienst der Schule.
              Lehrpersonen können Schülerinnen und Schüler über das Pseudonym
              für eine Klasse vorab freischalten.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">5. Inhalte und Lizenz</h2>

            <h3 className="text-lg font-medium mt-4 mb-1">Urheberrecht</h3>
            <p>
              Lehrpersonen behalten das Urheberrecht an den Inhalten, die sie
              erstellen. Die Betreiberin beansprucht kein Eigentum an Inhalten
              der Nutzenden.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Inhaltslizenz — CC BY-NC-SA 4.0
            </h3>
            <p>
              Mit der Veröffentlichung auf der Plattform stellen Lehrpersonen
              ihre Inhalte unter die Lizenz{' '}
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.de"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Creative Commons Namensnennung – Nicht kommerziell – Weitergabe
                unter gleichen Bedingungen 4.0 International (CC BY-NC-SA 4.0)
              </a>
              . Veröffentlichte Inhalte sind öffentlich im Internet zugänglich
              und dürfen von allen unter diesen Bedingungen kopiert und
              bearbeitet werden:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Namensnennung</strong> — die ursprüngliche Autorin bzw.
                der ursprüngliche Autor muss genannt werden.
              </li>
              <li>
                <strong>Nicht kommerziell</strong> — keine Nutzung für
                kommerzielle Zwecke (bezahlte Kurse, kommerzielle Lehrmittel
                usw.).
              </li>
              <li>
                <strong>Weitergabe unter gleichen Bedingungen</strong> —
                Bearbeitungen müssen unter derselben Lizenz weitergegeben
                werden. Inhalte dürfen nicht zu einem geschlossenen,
                proprietären Produkt gemacht werden.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-1">Forken</h3>
            <p>
              Zusätzlich zur öffentlichen CC-Lizenz können Lehrpersonen anderen
              Lehrpersonen erlauben, ihre Inhalte direkt in Eduskript zu forken
              (kopieren und bearbeiten). Geforkte Inhalte übernehmen die Lizenz
              CC BY-NC-SA 4.0. Die Plattform setzt automatisch einen Verweis
              «Geforkt von» auf das Original und erfüllt damit die
              Namensnennung.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">Rollen bei der Zusammenarbeit</h3>
            <p>
              Beim Teilen mit anderen Lehrpersonen wählen Lehrpersonen zwischen
              zwei Rollen:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Autorin/Autor</strong> — Mitautorinnen und Mitautoren
                teilen das Urheberrecht am Werk gemeinsam.
              </li>
              <li>
                <strong>Mitwirkende</strong> — Mitwirkende dürfen das Werk
                bearbeiten, erwerben aber kein Urheberrecht. Ihre Beiträge
                lizenzieren sie den Autorinnen und Autoren unter CC BY-NC-SA
                4.0.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Lizenz an die Betreiberin zur Darstellung
            </h3>
            <p>
              Mit dem Hochladen von Inhalten erteilen Lehrpersonen der
              Betreiberin eine nicht exklusive, weltweite Lizenz, die Inhalte
              auf der Plattform zu speichern, darzustellen und auszuliefern.
              Diese Lizenz dient ausschliesslich dem Betrieb der Plattform und
              gibt der Betreiberin kein Eigentum und kein eigenes Nutzungsrecht
              an den Inhalten.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Verantwortung für veröffentlichte Inhalte
            </h3>
            <p>
              Lehrpersonen stellen sicher, dass sie alle hochgeladenen Inhalte
              veröffentlichen dürfen. Eine Veröffentlichung auf Eduskript macht
              Inhalte unter CC BY-NC-SA 4.0 öffentlich im Internet zugänglich —
              Lehrpersonen müssen die Rechte besitzen, diese Lizenz zu
              erteilen.
            </p>
            <p>
              Insbesondere gilt: Eine Quellenangabe gibt <em>nicht</em> das
              Recht, fremde Inhalte im Internet zu veröffentlichen.
              Urheberrechtlich geschütztes Material (z. B. Auszüge aus
              Lehrmitteln, Bilder, Artikel) darf nur hochgeladen werden, wenn
              eine ausdrückliche Erlaubnis der Rechteinhaber vorliegt oder das
              Material bereits unter einer kompatiblen offenen Lizenz steht.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">6. Gratis- und Bezahlangebote</h2>
            <p>
              Lehrpersonen können die Plattform gratis nutzen: Skripts und
              Seiten erstellen und veröffentlichen, den Seiten-Baukasten
              verwenden, Dateien hochladen und mit anderen Lehrpersonen
              zusammenarbeiten. Kostenpflichtig sind unter anderem Klassen,
              Prüfungen, die KI-Funktionen und der Export von Inhalten.
            </p>
            <p>
              Preise und Leistungen der einzelnen Angebote stehen auf der
              Plattform unter «Billing». Alle Preise verstehen sich in
              Schweizer Franken (CHF), inklusive allfälliger Mehrwertsteuer.
            </p>
            <p>
              Schülerinnen und Schüler bezahlen nichts. Ihr Zugang läuft über
              das Konto ihrer Lehrperson.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">7. Zahlung</h2>
            <p>
              Zahlungen wickelt die Payrexx AG ab. Mit dem Abschluss eines Abos
              ermächtigen Lehrpersonen die Betreiberin, den Betrag im gewählten
              Intervall (monatlich oder jährlich) wiederkehrend zu belasten.
            </p>
            <p>
              Abos verlängern sich automatisch, wenn sie nicht vor Ablauf der
              laufenden Periode gekündigt werden.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">8. Kündigung</h2>
            <p>
              Abos können jederzeit auf der Plattform unter «Billing» gekündigt
              werden. Die Kündigung wirkt auf das Ende der laufenden Periode.
              Für die Restlaufzeit gibt es keine Rückerstattung.
            </p>
            <p>
              Nach der Kündigung wechselt das Konto ins Gratisangebot.
              Veröffentlichte Inhalte bleiben öffentlich zugänglich.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">9. Verfügbarkeit</h2>
            <p>
              Die Betreiberin strebt eine hohe Verfügbarkeit an, kann aber keinen
              unterbrechungsfreien Zugang garantieren. Wartungsarbeiten und
              technische Probleme können vorübergehende Unterbrüche verursachen.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">10. Haftung</h2>
            <p>
              Die Haftung der Betreiberin ist ausgeschlossen, soweit das Gesetz
              es zulässt. Insbesondere haftet die Betreiberin nicht für:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Datenverlust oder -beschädigung</li>
              <li>Entgangenen Gewinn oder indirekte Schäden</li>
              <li>Schäden aus Inhalten der Nutzenden</li>
              <li>Ausfälle oder Unterbrüche der Plattform</li>
            </ul>
            <p>
              Die Haftung für vorsätzliches oder grobfahrlässiges Verhalten
              bleibt vorbehalten.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">11. Datenschutz</h2>
            <p>
              Wie die Plattform Personendaten bearbeitet, welche Anbieter
              beteiligt sind und wo die Daten liegen, steht in der{' '}
              <Link href="/datenschutz" className="underline">
                Datenschutzerklärung
              </Link>
              . Sie ist Bestandteil dieser Nutzungsbedingungen.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">12. Änderungen</h2>
            <p>
              Die Betreiberin kann diese Bedingungen jederzeit anpassen.
              Änderungen werden auf der Plattform mitgeteilt — das Datum der
              aktuellen Fassung steht in der Fusszeile jeder Seite. Wer die
              Plattform nach einer Änderung weiter nutzt, akzeptiert die neue
              Fassung.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">13. Anwendbares Recht und Gerichtsstand</h2>
            <p>
              Es gilt Schweizer Recht. Ausschliesslicher Gerichtsstand ist
              Zürich, Schweiz.
            </p>
          </section>
        </div>

        <LegalFooter />
      </div>
    </div>
  )
}

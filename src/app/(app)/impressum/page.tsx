import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";

export const metadata: Metadata = {
  title: "Impressum – Eduskript",
  description: "Impressum und Angaben zur Betreiberin von Eduskript",
};

export default function ImpressumPage() {
  return (
    <div lang="de" className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Zurück
        </Link>

        <h1 className="text-3xl font-bold mb-2">Impressum</h1>
        <p className="text-muted-foreground mb-8">
          Eduskript wird von der Luz Media GmbH mit Sitz in Winterthur,
          Schweiz, betrieben.
        </p>

        <div className="prose prose-neutral dark:prose-invert space-y-6 [&_p]:mt-4">
          <section>
            <p>
              Sitz:
              <br />
              Luz Media GmbH
              <br />
              Untere Vogelsangstrasse 11
              <br />
              8400 Winterthur, Schweiz
            </p>
            <p>
              Büro und Postadresse:
              <br />
              Luz Media GmbH
              <br />
              Altwiesenstrasse 63
              <br />
              8051 Zürich, Schweiz
            </p>
            <p>
              E-Mail:{" "}
              <a href="mailto:kontakt@luzmedia.ch" className="underline">
                kontakt@luzmedia.ch
              </a>
              <br />
              UID: CHE-261.508.926
              <br />
              Handelsregister: Kanton Zürich
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Haftungsausschluss</h2>
            <p>
              Die Inhalte dieser Website werden mit Sorgfalt erstellt. Die Luz
              Media GmbH übernimmt jedoch keine Gewähr für die Richtigkeit,
              Vollständigkeit und Aktualität der Informationen.
            </p>
            <p>
              Haftungsansprüche gegen die Luz Media GmbH wegen Schäden
              materieller oder immaterieller Art, die aus der Nutzung oder
              Nichtnutzung der Informationen entstehen, sind ausgeschlossen,
              sofern sie nicht auf vorsätzlichem oder grobfahrlässigem
              Verhalten beruhen.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Externe Links</h2>
            <p>
              Diese Website kann Links auf Websites Dritter enthalten. Auf deren
              Inhalte hat die Luz Media GmbH keinen Einfluss und übernimmt dafür
              keine Verantwortung. Der Zugriff auf diese Websites erfolgt auf
              eigene Gefahr.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Urheberrecht</h2>
            <p>
              Die Software der Plattform Eduskript steht unter der{" "}
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
            <p>
              Lehrpersonen behalten das Urheberrecht an ihren Inhalten. Mit der
              Veröffentlichung auf der Plattform stellen sie diese unter die
              Lizenz{" "}
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.de"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC BY-NC-SA 4.0
              </a>
              : Andere dürfen sie mit Namensnennung für nicht kommerzielle
              Zwecke kopieren und bearbeiten. Details stehen in den{" "}
              <Link href="/terms" className="underline">
                Nutzungsbedingungen
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Datenschutz</h2>
            <p>
              Wie wir Personendaten bearbeiten, steht in der{" "}
              <Link href="/datenschutz" className="underline">
                Datenschutzerklärung
              </Link>
              .
            </p>
          </section>
        </div>

        <LegalFooter />
      </div>
    </div>
  );
}

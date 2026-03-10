import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal Notice – Eduskript",
  description: "Legal notice and company information for Eduskript",
};

export default function ImpressumPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Legal Notice</h1>
        <p className="text-muted-foreground mb-8">
          Eduskript is operated by Luz Media GmbH, based in Winterthur,
          Switzerland.
        </p>

        <div className="prose prose-neutral dark:prose-invert space-y-6">
          <section>
            <p>
              Official company address:
              <br />
              Luz Media GmbH
              <br />
              Untere Vogelsangstrasse 11
              <br />
              8400 Winterthur, Switzerland
            </p>
            <p>
              Office and mail:
              <br />
              Luz Media GmbH
              <br />
              Altwiesenstrasse 63
              <br />
              8051 Zürich, Switzerland
            </p>
            <p>
              Email:{" "}
              <a href="mailto:kontakt@luzmedia.ch" className="underline">
                kontakt@luzmedia.ch
              </a>
              <br />
              UID: CHE-261.508.926
              <br />
              Commercial register: Canton of Zürich
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Disclaimer</h2>
            <p>
              The content on this website is prepared with care. However, Luz
              Media GmbH makes no warranty as to the accuracy, completeness, or
              timeliness of the information provided.
            </p>
            <p>
              Liability claims against Luz Media GmbH for damages of a material
              or immaterial nature arising from the use or non-use of the
              information provided are excluded, unless caused by intentional or
              grossly negligent conduct.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">External Links</h2>
            <p>
              This website may contain links to third-party websites. Luz Media
              GmbH has no control over and assumes no responsibility for the
              content of external sites. Access to and use of such websites is
              at the user&apos;s own risk.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Copyright</h2>
            <p>
              The Eduskript platform software is licensed under the{" "}
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
              Teachers retain copyright ownership of their content. By
              publishing on the Platform, they license it under{" "}
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC BY-NC-SA 4.0
              </a>
              , meaning others may copy and adapt it for non-commercial purposes
              with attribution. See our{" "}
              <Link href="/terms" className="underline">
                Terms of Service
              </Link>{" "}
              for details.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Data Protection</h2>
            <p>
              Information on how we handle personal data can be found in our{" "}
              <Link href="/terms" className="underline">
                Terms of Service
              </Link>
              , section Data Protection.
            </p>
          </section>
        </div>

        <p className="text-sm text-muted-foreground mt-12">
          Last updated: March 2026
        </p>

        <footer className="mt-16 pt-4 border-t text-center text-xs text-muted-foreground/50">
          <Link href="/impressum" className="hover:text-muted-foreground">
            Legal Notice
          </Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="hover:text-muted-foreground">
            Terms (Mar 2026)
          </Link>
        </footer>
      </div>
    </div>
  );
}

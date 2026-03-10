import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service – Eduskript',
  description: 'Terms of Service for the Eduskript education platform',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground mb-8 inline-block"
        >
          &larr; Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Eduskript — Luz Media GmbH</p>

        <div className="prose prose-neutral dark:prose-invert space-y-6">
          {/* 1 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">1. Scope</h2>
            <p>
              These Terms of Service govern the use of Eduskript (the
              &ldquo;Platform&rdquo;), operated by Luz Media GmbH,
              Untere Vogelsangstrasse 11, 8400 Winterthur, Switzerland (the
              &ldquo;Operator&rdquo;).
            </p>
            <p>
              By registering for or using the Platform, you agree to these
              terms.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              2. The Platform
            </h2>
            <p>
              Eduskript is an open-source education platform where teachers
              create, publish, and share digital learning materials. Students
              access these materials through their teachers.
            </p>
            <p>
              The platform source code is licensed under the{' '}
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
            <h2 className="text-xl font-semibold mt-6 mb-2">
              3. User Roles
            </h2>
            <p>
              The Platform distinguishes between two types of users:
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">Teachers</h3>
            <p>
              Teachers register with an email address or via an OAuth
              provider (GitHub, Google, Microsoft). Teachers can create and
              publish educational content, manage classes, collaborate with
              other teachers, and subscribe to paid plans.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">Students</h3>
            <p>
              Students access the Platform through their school&apos;s OAuth
              provider. Students do not need to provide a personal email
              address. Student accounts are identified by a hash-based
              pseudonym derived from their OAuth credentials, not by their
              real name or email. However, students may choose a nickname
              which is stored in clear text and visible to their teachers.
            </p>
            <p>
              Students can view published content, run interactive exercises,
              and submit work to their teachers. Students do not create
              published content and do not pay for the Platform.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              4. Accounts
            </h2>
            <p>
              Teachers must provide accurate registration information and
              keep their credentials confidential. The Operator may suspend
              or delete accounts that violate these terms.
            </p>
            <p>
              Student accounts are managed through their school&apos;s
              identity provider. Teachers may pre-authorise students via
              pseudonym for class access.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              5. Content and Licensing
            </h2>

            <h3 className="text-lg font-medium mt-4 mb-1">Ownership</h3>
            <p>
              Teachers retain copyright ownership of the content they
              create. The Operator does not claim ownership of any
              user-generated content.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Content License — CC BY-NC-SA 4.0
            </h3>
            <p>
              By publishing content on the Platform, teachers license it
              under{' '}
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Creative Commons Attribution-NonCommercial-ShareAlike 4.0
                International (CC BY-NC-SA 4.0)
              </a>
              . Published content is publicly accessible on the internet,
              and anyone may copy and adapt it under the terms of this
              license:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Attribution</strong> — others must credit the original
                author.
              </li>
              <li>
                <strong>Non-commercial</strong> — content may not be used for
                commercial purposes (paid courses, commercial textbooks, etc.).
              </li>
              <li>
                <strong>Share-alike</strong> — any derivative work must be
                shared under the same license. Content cannot be turned into
                a closed, proprietary product.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Forking
            </h3>
            <p>
              In addition to the public CC license, teachers may choose to
              let other teachers on the Platform fork (copy and adapt) their
              content directly within Eduskript. Forked content inherits the
              CC BY-NC-SA 4.0 license. The Platform automatically maintains
              a &ldquo;Forked from&rdquo; link to the original, satisfying
              the attribution requirement.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Collaboration Roles
            </h3>
            <p>
              When sharing content with collaborators, teachers choose
              between two roles:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Author</strong> — co-authors share joint copyright
                ownership of the work.
              </li>
              <li>
                <strong>Contributor</strong> — contributors may edit the work
                but do not gain copyright ownership. Their contributions are
                licensed to the author(s) under CC BY-NC-SA 4.0.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Platform License to Display Content
            </h3>
            <p>
              By uploading content, teachers grant the Operator a
              non-exclusive, worldwide license to host, display, and serve
              the content on the Platform. This license exists solely for
              operating the Platform and does not grant the Operator any
              ownership or independent right to use the content.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Responsibility for Published Content
            </h3>
            <p>
              Teachers are responsible for ensuring they have the legal
              right to publish all content they upload to the Platform.
              Publishing on Eduskript makes content publicly available on
              the internet under CC BY-NC-SA 4.0 — teachers must hold
              sufficient rights to grant this license.
            </p>
            <p>
              In particular: citing a source <em>does not</em> grant the right to
              republish that source&apos;s content on the internet. Teachers
              must not upload copyrighted material (e.g. textbook excerpts,
              images, articles) unless they have explicit permission from
              the rights holder or the material is already available under a
              compatible open license.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              6. Free and Paid Plans
            </h2>
            <p>
              Teachers may use the Platform on a free plan with limited
              features. Extended features such as the page builder,
              collaboration, and class management require a paid
              subscription.
            </p>
            <p>
              Prices and feature details for each plan are listed on the
              Platform under &ldquo;Billing&rdquo;. All prices are in Swiss
              Francs (CHF) and include VAT where applicable.
            </p>
            <p>
              Students do not pay for the Platform. Student access is
              provided through their teacher&apos;s account.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              7. Payment
            </h2>
            <p>
              Payments are processed by Payrexx AG. By subscribing to a paid
              plan, teachers authorise recurring charges at the selected
              interval (monthly or yearly).
            </p>
            <p>
              Subscriptions renew automatically unless cancelled before the
              end of the current billing period.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              8. Cancellation
            </h2>
            <p>
              Paid subscriptions can be cancelled at any time via the
              Platform under &ldquo;Billing&rdquo;. Cancellation takes effect
              at the end of the current billing period. No refunds are issued
              for the remaining period.
            </p>
            <p>
              After cancellation, the account reverts to the free plan.
              Published content remains publicly accessible.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              9. Availability
            </h2>
            <p>
              The Operator aims for high availability but cannot guarantee
              uninterrupted access. Maintenance and technical issues may
              cause temporary disruptions.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              10. Liability
            </h2>
            <p>
              The Operator&apos;s liability is excluded to the extent
              permitted by law. In particular, the Operator is not liable
              for:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Data loss or corruption</li>
              <li>Lost profits or indirect damages</li>
              <li>Damages arising from user-generated content</li>
              <li>Platform outages or disruptions</li>
            </ul>
            <p>
              Liability for intentional or grossly negligent conduct is
              reserved.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              11. Data Protection
            </h2>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Data Collected
            </h3>
            <p>
              The Platform processes personal data in accordance with Swiss
              data protection law (DSG).
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Teachers:</strong> name, email address, content,
                settings.
              </li>
              <li>
                <strong>Students:</strong> during authentication, the
                Platform receives the student&apos;s email address from their
                school&apos;s OAuth provider. This email is used solely to
                generate an irreversible hash-based pseudonym (HMAC) and is
                not stored. The Platform retains only the pseudonym and an
                optional nickname chosen by the student (stored in clear
                text, visible to teachers).
              </li>
              <li>
                <strong>Payment data:</strong> processed by Payrexx AG. The
                Operator does not store credit card details.
              </li>
              <li>
                <strong>Technical data:</strong> IP addresses are used
                transiently for rate limiting but are not stored
                persistently. No browser fingerprinting or device tracking
                is performed.
              </li>
            </ul>

            <h3 className="text-lg font-medium mt-4 mb-1">Purpose</h3>
            <p>
              Personal data is used exclusively for operating and improving
              the Platform and for processing payments. Data is not sold or
              shared with third parties beyond what is necessary for platform
              operation.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">
              Student Privacy
            </h3>
            <p>
              The Platform is designed with student privacy as a priority.
              Student identities are pseudonymised at the point of
              registration. Teachers may optionally allow students to
              consent to revealing their identity within a class context
              (identity consent). Anonymous class access is supported.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-1">Your Rights</h3>
            <p>
              You have the right to access, correct, and delete your
              personal data. Requests should be sent to{' '}
              <a href="mailto:kontakt@luzmedia.ch" className="underline">
                kontakt@luzmedia.ch
              </a>
              .
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              12. Changes to These Terms
            </h2>
            <p>
              The Operator may update these terms at any time. Changes
              are communicated through the Platform — the revision date is
              displayed in the footer of every page. Continued use of the
              Platform after an update constitutes acceptance of the revised
              terms.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              13. Governing Law and Jurisdiction
            </h2>
            <p>
              These terms are governed by Swiss law. The exclusive place of
              jurisdiction is Zürich, Switzerland.
            </p>
          </section>
        </div>

        <p className="text-sm text-muted-foreground mt-12">
          Last updated: March 2026
        </p>

        <footer className="mt-16 pt-4 border-t text-center text-xs text-muted-foreground/50">
          <Link href="/impressum" className="hover:text-muted-foreground">Legal Notice</Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="hover:text-muted-foreground">Terms (Mar 2026)</Link>
        </footer>
      </div>
    </div>
  )
}

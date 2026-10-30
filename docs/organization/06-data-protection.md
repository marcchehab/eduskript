# Data Protection

Eduskript is built for use in schools, where the data being handled belongs to teachers and — especially — to minors. Data protection is therefore a design constraint, not an afterthought. This page documents what data Eduskript stores, where it is stored, and who processes it.

> **In short**: Student emails are never stored. Database, files and encrypted backups are in Switzerland. No third-party analytics or ad tracking. Sign-in via US identity providers happens only if a user chooses it.

## Legal Framework

Eduskript is operated under the **Swiss Federal Act on Data Protection (revFADP / revDSG)**. Processing is also aligned with the **EU General Data Protection Regulation (GDPR)**.

Application, database and uploaded files are at Infomaniak in Switzerland (a Swiss company, not subject to the US CLOUD Act). Backups are also at Infomaniak:

- Database: a short-term backup on the server itself (about 14 days, not additionally encrypted) and an AES-256-encrypted backup in a different data centre (Winterthur) from the server (Geneva), kept for at most 6 months.
- Files (uploaded files, images, videos): backed up encrypted to Winterthur every night. Deleted or replaced files stay there for at most 30 days and are then gone for good.

> For school leadership and IT there is a [one-page overview](07-for-school-leadership-and-it.md) and a [data processing agreement template](08-dpa-template.md).

## Where Data Is Stored

The database, uploaded files and encrypted backups are stored in Switzerland. The authoritative, dated list of all sub-processors (including payments and AI providers) is in the [privacy policy](https://eduskript.org/datenschutz#unterauftragsbearbeiter) (German).

| Sub-processor | Purpose | Location | Company |
|---------------|---------|----------|---------|
| Infomaniak | Server for application and PostgreSQL database, object storage (uploaded files, images, snaps), encrypted backups of database and files, email delivery to teachers (SMTP) | Switzerland | Infomaniak Network SA (Switzerland) |
| CloudMailin | Receiving forwarded emails (mail hooks, e.g. login codes) and product-update drafts | USA/EU | Dynamic Edge Software Ltd (UK) |

Emails to teachers (verification, notifications, product updates) are sent via SMTP through Infomaniak in Switzerland, without open or click tracking. Product updates go to teachers who opted in (at sign-up, in account settings or via a link) and to teachers who registered before 30 October 2026, until they unsubscribe. Every one carries an unsubscribe link. Visitors without an account can subscribe to product updates with their email address (double opt-in: updates only after clicking the confirmation link). Stored: email address, language, and the time of sign-up and confirmation; the entry is deleted on unsubscribe, unconfirmed sign-ups after 7 days.

*October 2026: Brevo removed. Emails to teachers are sent via SMTP through Infomaniak in Switzerland, without open or click tracking. Product updates for new teachers only with consent; existing teachers can unsubscribe at any time. Visitors without an account can subscribe to product updates, confirmed by email.*

## What Data Is Stored

Eduskript distinguishes two account types with deliberately different data models.

### Teachers

Teachers create and own content, so a normal identity is stored:

- Email address
- Display name, and optional profile fields (title, bio)
- Hashed password (bcrypt) — only for email/password accounts
- The content they create (skripts, pages, files)

### Students

Student accounts are **pseudonymous by design**. The following is **never** stored:

- ❌ Student email addresses
- ❌ Student real names (unless a student chooses to enter one)

Instead, a student is identified by:

- A **one-way pseudonym** — an irreversible HMAC (SHA-256 with a secret key) derived from their sign-in identity. The original email cannot be recovered from it.
- A randomly generated, stable display nickname.
- The OAuth provider identifier used to recognise returning logins.

This lets a teacher match a student to a class roster (by pre-authorising the same email, which produces the same hash) **without Eduskript ever storing the student's email**. Profile images from OAuth providers are passed through for display but are not persisted.

> See the [content license](03-content-license.md) page for how ownership of created content is handled.

## Sign-In and Third-Party Identity

Eduskript supports signing in through external identity providers. Some of these are operated by US companies (Microsoft). Important boundaries:

- These providers are used **only when a user actively chooses them**. Email/password sign-in never involves them.
- Eduskript receives only the minimal profile data needed to create the account (and for students, even that is reduced to a pseudonym as described above).
- For Swiss schools, sovereign identity federations are the preferred route. A connection to **Edulog** (the federation of identity services for the Swiss educational space, operated by Educa on behalf of the EDK) is planned but not yet implemented; it would provide pseudonymised access without any US provider in the chain.

## Sessions

Authentication uses **stateless JWT sessions**. There is no server-side session store; the session token lives in an HTTP-only, secure cookie. Eduskript does not use third-party session services; signing in with Microsoft is optional (see above).

## What Eduskript Does *Not* Do

- No third-party web analytics (no Google Analytics, Plausible, PostHog, etc.).
- No advertising or behavioural tracking.
- No selling or sharing of personal data with advertisers.
- No storage of student email addresses.

## Data Subject Rights

Under the revFADP and GDPR, users may request access to, correction of, or deletion of their personal data. Because student accounts hold only a pseudonym and no email, the data footprint for students is minimal by construction.

Deleting an account removes the associated personal data. Backups keep it until the periods above expire (files 30 days, database at most 6 months). Content created by teachers is subject to the [content license](03-content-license.md) and collaboration rules.

## Contact

For data-protection questions or requests, contact the instance operator. For the public instance at eduskript.org, this is the platform maintainer listed in the site imprint.

## Summary

Eduskript stores the minimum personal data needed to function. Teacher identities are conventional; student identities are pseudonymised and contain no email. Core data is hosted in Switzerland (Infomaniak); so are the encrypted backups and email delivery. Third-party US identity providers are optional and user-initiated, and no analytics or tracking is used.

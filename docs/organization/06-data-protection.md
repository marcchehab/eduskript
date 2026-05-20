# Data Protection

Eduskript is built for use in schools, where the data being handled belongs to teachers and — especially — to minors. Data protection is therefore a design constraint, not an afterthought. This page documents what data Eduskript stores, where it is stored, and who processes it.

> **In short**: Student emails are never stored. All core data lives on European infrastructure (France). No third-party analytics or ad tracking. Sign-in via US identity providers happens only if a user chooses it.

## Legal Framework

Eduskript is operated under the **Swiss Federal Act on Data Protection (revFADP / revDSG)**. Because all primary data is hosted within the EU, processing is also aligned with the **EU General Data Protection Regulation (GDPR)**.

Switzerland holds an EU adequacy decision, and the hosting providers below are subject to Swiss and EU law — not the US CLOUD Act.

## Where Data Is Stored

All primary data — the database and uploaded files — is hosted on **European infrastructure operated by French companies**. No US hyperscaler (AWS, Google Cloud, Azure) is used for storage or compute.

| Sub-processor | Purpose | Location | Company |
|---------------|---------|----------|---------|
| Koyeb | Application hosting + managed PostgreSQL database | EU region | Koyeb SAS (France) |
| Scaleway | Object storage (uploaded files, images) | Paris (`fr-par`) | Scaleway SAS (France) |
| Brevo | Transactional email (verification, notifications) | EU | Sendinblue SAS / Brevo (France) |

Transactional emails are sent with tracking disabled.

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

- A **one-way pseudonym** — an irreversible SHA-256 hash derived from their sign-in identity. The original email cannot be recovered from it.
- A randomly generated, stable display nickname.
- The OAuth provider identifier used to recognise returning logins.

This lets a teacher match a student to a class roster (by pre-authorising the same email, which produces the same hash) **without Eduskript ever storing the student's email**. Profile images from OAuth providers are passed through for display but are not persisted.

> See the [content license](03-content-license.md) page for how ownership of created content is handled.

## Sign-In and Third-Party Identity

Eduskript supports signing in through external identity providers. Some of these are operated by US companies (Microsoft, Google, GitHub). Important boundaries:

- These providers are used **only when a user actively chooses them**. Email/password sign-in never involves them.
- Eduskript receives only the minimal profile data needed to create the account (and for students, even that is reduced to a pseudonym as described above).
- For Swiss schools, sovereign identity federations are the preferred route. Support for **Edulog** (the federation of identity services for the Swiss educational space, operated by Educa on behalf of the EDK) is the recommended path; it provides pseudonymised access without any US provider in the chain.

## Sessions

Authentication uses **stateless JWT sessions**. There is no server-side session store; the session token lives in an HTTP-only, secure cookie. Eduskript does not use third-party session or login services.

## What Eduskript Does *Not* Do

- No third-party web analytics (no Google Analytics, Plausible, PostHog, etc.).
- No advertising or behavioural tracking.
- No selling or sharing of personal data with advertisers.
- No storage of student email addresses.

## Data Subject Rights

Under the revFADP and GDPR, users may request access to, correction of, or deletion of their personal data. Because student accounts hold only a pseudonym and no email, the data footprint for students is minimal by construction.

Deleting an account removes the associated personal data. Content created by teachers is subject to the [content license](03-content-license.md) and collaboration rules.

## Contact

For data-protection questions or requests, contact the instance operator. For the public instance at eduskript.org, this is the platform maintainer listed in the site imprint.

## Summary

Eduskript stores the minimum personal data needed to function. Teacher identities are conventional; student identities are pseudonymised and contain no email. All core data is hosted on French/EU infrastructure (Koyeb, Scaleway, Brevo) under Swiss and EU data-protection law. Third-party US identity providers are optional and user-initiated, and no analytics or tracking is used.

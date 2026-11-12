# Email-code login (no Microsoft)

Status: implemented 2026-11-12 (uncommitted). Deviations from the plan below:

1. No `ROLE_REQUIRED` step: every sign-in form already knows the role
   (teacher page → student, org page has teacher/student columns,
   /auth/signup → teacher), passed as `context` (same values as the OAuth
   signup cookie, src/lib/signup-context.ts).
2. No separate send-invites route: `POST /api/classes/[id]/bulk-import` takes
   `sendInvites: true` (checkbox next to Add Students, and a "Send invite
   emails" button on Pending Invitations).
3. Session length unchanged (NextAuth default 30 days, rolling); per-user
   maxAge isn't supported by NextAuth JWT sessions.
4. Code tokenHash = sha256(pseudonym + code) so equal codes of two people
   don't collide on the unique column.
5. Expired tokens are deleted on each code request, no cron job.
6. Local dev has no SMTP; test with a local sink (SMTP_HOST/PORT/PASSWORD env).

## Goal

Everyone signs up and logs in with an email code, without a Microsoft/GitHub
OAuth app (school tenants often block third-party app consent). Teachers send
class-wide invites. Eduskript still never stores student email addresses.

Scope: **main sign-up/login for teachers and students** (first button on
`/auth/signin` and `/auth/signup`: "Continue with email"). Below it:
the existing options unchanged (Microsoft, GitHub, email + password). Only the
button order changes; nothing is removed.

## Core idea

For students, every flow receives the plaintext email in the request, uses it in memory
(HMAC + SMTP send), and discards it. The DB only ever sees
`generatePseudonym(email)` (`src/lib/privacy/pseudonym.ts`), the same hash that
`PreAuthorizedStudent.pseudonym` and `User.studentPseudonym` already use. A
student who signed up via Microsoft with the same address lands on the same
account.

## Flows

1. **Invite (teacher)**
   1. Class page → "Send invites" (whole class, or only "not joined yet").
   2. Client reads the emails for the class from the teacher's IndexedDB
      mapping (`src/lib/email-mapping-db.ts`: `getEmailMappingsForClass` +
      `getUnmappedEmailsForClass`) and POSTs them.
   3. Server: per email, `pseudonym = HMAC(email)`, upsert
      `PreAuthorizedStudent` (sending = pre-authorizing; the paste already
      pre-authorizes, so the teacher never sees a difference), skip hashes on
      the opt-out list, create an invite token, send the mail, set
      `PreAuthorizedStudent.invitedAt`.
   4. Abuse limits: paid teachers only; per-teacher rate limit set high
      (e.g. 1000 recipients / day), only meant to stop runaway abuse; fixed
      template with no teacher free text (no phishing payload); it names the
      teacher (`User.name`) and the class (`Class.name`), both HTML-escaped,
      length-capped, never turned into links; every mail has
      a "Don't send me invites" link → `InviteOptOut { pseudonym }`.
   5. Mapping missing (other device, cleared storage) → dialog asks the teacher
      to paste the list again (reuse the bulk-import textarea).
   6. The bulk-import dialog gets an "Add & send invites" checkbox (default on),
      the same call.
2. **Accept invite (student)**
   1. Mail link: `/auth/invite/<token>`. GET only renders the page ("Join
      class X as a student", button). It never consumes the token, because
      Safe Links/Defender pre-fetch links.
   2. Button POSTs → token checked (unused, not expired) → find or create the
      student user by pseudonym → `signIn` → redirect to the existing
      `/classes/join/<inviteCode>` flow, which already handles
      `PreAuthorizedStudent` → `ClassMembership` + identity consent.
3. **Log in / sign up (everyone)**
   1. One form: email → `POST /api/auth/email-code/request {email}` → 6-digit
      code to any address (rate-limited). Same response every time.
   2. Code page: email + code (+ role) → NextAuth credentials provider
      `email-code`. The client keeps the email in form state; the server
      never stores it before the role is known.
   3. Resolve the account after the code checks out, in this order:
      1. `User.email` match → teacher login.
      2. `User.studentPseudonym` match → student login.
      3. Neither: new account. Role from context: sign-up started on a
         teacher's site or from an invite → student, no question. Otherwise
         the provider answers `ROLE_REQUIRED` without consuming the code; the
         client shows "I'm a teacher / I'm a student" and resubmits with
         `role`.
         1. Teacher → normal teacher user with `email`, `emailVerified = now`,
            then the existing onboarding (complete-profile, Site, quest).
         2. Student → pseudonym-only user, `email: null`.
   4. The account is only created once a code is confirmed, so addresses
      that never confirm leave no account behind.
   5. Pending `PreAuthorizedStudent` rows for a student's pseudonym show up as
      class invitations (existing `my-classes` behaviour).
   6. The code row is keyed by `HMAC(email)` for everyone (teacher or not
      isn't known at request time), so `EmailLoginToken` is named
      `EmailLoginToken`.

## Schema

```prisma
model EmailLoginToken {
  id         String   @id @default(cuid())
  pseudonym  String                 // HMAC(email), never the email
  kind       String                 // "invite" | "code"
  tokenHash  String   @unique       // sha256 of link token / code
  classId    String?                // invite only
  attempts   Int      @default(0)   // code only, max 5
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime @default(now())
  @@index([pseudonym, kind])
}

// PreAuthorizedStudent: + invitedAt DateTime?

model InviteOptOut {
  pseudonym String   @id
  createdAt DateTime @default(now())
}
```

Invite: 32-byte random token, 14 days. Code: 6 digits, 10 min, 5 attempts, a
new request invalidates older codes. Expired rows are deleted by the existing
cron or on read.

Do not use NextAuth `EmailProvider`/`VerificationToken`: it stores the plain
email in `identifier`.

## Code

1. `src/lib/auth.ts`: second `CredentialsProvider` id `email-code`
   (`{email, code}` or `{inviteToken}`) → returns the student user. Session
   `maxAge` for students: 90 days (check the JWT callback; currently NextAuth
   default 30 d).
2. User creation: reuse the student branch of `src/lib/privacy-adapter.ts`
   (pseudonym, `getStableStudentNickname`, `email: null`). Extract it into a
   shared helper rather than duplicating it.
3. Routes:
   1. `POST /api/classes/[id]/send-invites` (teacher, class owner, paid like
      bulk-import).
   2. `POST /api/auth/email-code/request`.
   3. `POST /api/auth/invite/[token]` (consume + sign in), or done inside the
      credentials provider.
4. Pages: `/auth/invite/[token]`, the code step on `/auth/signin`.
5. Mail: `sendEmail` (`src/lib/email.ts`), English template (UI strings
   English). `tag` must not log the recipient: check `sendEmail` and
   `log-privacy.ts`.
6. Rate limits (`src/lib/rate-limit.ts`): code request per pseudonym
   (e.g. 5 / 15 min), per IP (e.g. 30 / h, generous: a class shares one school
   IP), global per day (protects mail quota); invites per teacher (high, e.g. 1000 / day); code
   verify per pseudonym.
8. `sendEmail` error log (`src/lib/email.ts`): strip email addresses from the
   SMTP error detail (a 550 reply can contain the recipient).
7. Class list: "invited <date>" / "not joined" per pre-authorized row.

## Privacy text (must ship with the feature)

1. `docs/de/organisation/06-datenschutz.md`: "E-Mail-Adressen von Schülern
   werden nie gespeichert" stays true. Add: addresses are processed briefly to
   send invites/login codes (Infomaniak SMTP, CH) and are not stored by
   Eduskript; Infomaniak mail-server logs keep them for <retention, check>.
   Update the Infomaniak row ("E-Mail-Versand an Lehrpersonen" → "und
   Schüler").
2. `privacy-adapter.ts` header point 3 ("No email verification for students")
   becomes partly wrong. Update it.
3. AVV (`08-avv-vorlage.md`): add the mail sending if the processing list
   names it.

## Also fix (existing promise violations)

1. `convert-to-student` keeps `user.email` → set it to `null` (+ drop
   `hashedPassword`?). Student then logs in via code.
2. `temp-user` stores a teacher-typed email → hash only, keep the generated
   `examtmp-…` address for credentials login, or switch temp users to a code.

## Tests

Pseudonym-only persistence (assert no table holds the email after each flow),
GET of invite page does not consume the token, code expiry/attempts/
invalidation, uniform response for unknown emails, rate limits, a Microsoft
student and a code student with the same address → same user.

## Open questions

1. Mail infrastructure (to investigate): Infomaniak recipient-log retention
   and whether it can be changed; Infomaniak Mail Starter caps at 200
   recipients / 24 h, which class invites + login codes will exceed. The goal
   is to change logging, not the Datenschutz text.

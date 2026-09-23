# For School Leadership and IT

This page summarises what school leadership, IT staff and data protection officers need to know before using Eduskript. It can be printed and passed on.

> [!info] Translation
> This is a translation for information. The [German version](https://eduskript.org/c/organisation/fuer-schulleitung-und-ict) is authoritative.

> [!success] In short
> - Students are **pseudonymous**. Eduskript does not store students' email addresses.
> - Database, files and email delivery are in the **EU** (database in Frankfurt, files in Paris).
> - The AI receives **only the answer**, without name, pseudonym, account ID, class or IP address. The AI providers may neither store the content nor use it for training.
> - No tracking, no analytics, no advertising.
> - Source code is public (AGPL v3), so third parties can review its security.
> - We sign a **data processing agreement**: our [template](08-dpa-template.md) or your canton's model contract.

## Who is responsible for what

Eduskript is operated by Luz Media GmbH (Winterthur, Switzerland). When a teacher uses Eduskript with a class, Eduskript processes the students' data **on behalf of the school**. The school remains the controller under cantonal data protection law. That is why a written agreement is needed between the school and Eduskript, not between the teacher and Eduskript.

What works without an agreement: teachers can write and publish skripts for free. No student data is involved as long as students do not sign in.

## What data is processed

| Data subjects | Data |
|---|---|
| Teachers | Name, email, content, settings, subscription status |
| Students | Pseudonym, nickname, class membership, answers, code, quiz results, progress, drawings, exam answers, points, feedback |

No sensitive personal data is intended.

## How pseudonymisation works

1. The student signs in with the school's identity provider (e.g. Microsoft 365).
2. Eduskript computes an irreversible pseudonym (HMAC) from the email address it receives and discards the address.
3. The teacher enters the email addresses for their class list. Eduskript computes the same pseudonym from them without storing the addresses. That is how the teacher finds their students. The list with the email addresses stays only in the teacher's browser.

Anyone looking into Eduskript's database finds no student email addresses, only pseudonyms and nicknames.

## AI features

AI is used for three things: feedback on handwritten solutions, suggested scores for exam answers, and helping teachers write content. The AI suggests, the teacher decides.

The AI provider receives only:

- the teacher's task text,
- the answer (image of the handwriting, answer text or code),
- where applicable, the model solution and the scoring rubric.

The request comes from Eduskript's server, not from the student's device. Images are redrawn from the pen strokes; photos lose their metadata (e.g. location) when re-encoded. If a student writes their own name into the answer, it is sent along; Eduskript points this out when a student joins a class.

## Sub-processors

The authoritative, dated list with purpose and location is in the [privacy policy](https://eduskript.org/datenschutz#unterauftragsbearbeiter) (German). Schools with an agreement are informed about new providers at least 30 days in advance.

## Documents

- [Privacy policy](https://eduskript.org/datenschutz) (German)
- [Data processing agreement template](08-dpa-template.md)
- [Terms of service](https://eduskript.org/terms) (German)
- [Source code](https://github.com/marcchehab/eduskript)

## Contact

Luz Media GmbH, [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch). We answer school IT questionnaires and sign cantonal model contracts.

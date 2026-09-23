# DPA Template

*Template for an agreement on the processing of personal data on behalf of a school (Swiss "Auftragsverarbeitungsvertrag", AVV), as of September 2026.*

> [!info] Translation
> This is a translation for information. Only the [German version](https://eduskript.org/c/organisation/avv-vorlage) is legally binding.

*This template follows, point by point, the Canton of Zurich's [AGB Auslagerung Informatikleistungen](https://www.zh.ch/content/dam/zhweb/bilder-dokumente/organisation/finanzdirektion/afi/agb_auslagerung_informatikleistungen.pdf) (general terms for outsourcing IT services) and the [guide «Bearbeiten im Auftrag»](https://docs.datenschutz.ch/u/d/publikationen/leitfaeden/leitfaden_bearbeiten_im_auftrag.pdf) of the Zurich Data Protection Commissioner. Where Eduskript does not meet one of these requirements, section 15 says so openly.*

*Many cantons have their own model contracts. The school can use this template or its cantonal model – Eduskript signs either. Contact: [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch).*
*`[…]` = to be filled in by the school.*

---

**between**

[Name of school], [Address]
represented by [Name, function]
— hereinafter **"School"** (controller)

**and**

Luz Media GmbH, Untere Vogelsangstrasse 11, 8400 Winterthur, Switzerland
UID CHE-261.508.926, operator of eduskript.org
— hereinafter **"Eduskript"** (processor)

---

## 1. Subject matter

1.1 The School or its teachers use eduskript.org to create and publish digital teaching materials and to work with classes (classes, progress overview, exams, AI feedback, AI-assisted scoring).

1.2 Insofar as personal data of the School's students or teachers is processed, Eduskript processes it exclusively on behalf of and on the instructions of the School.

1.3 The basis is the School's cantonal data protection law ([e.g. IDG ZH, KDSG AG …]) and, subsidiarily, the Swiss Federal Act on Data Protection (FADP/DSG). The eduskript.org terms of service apply in addition; in case of conflict, this agreement prevails.

1.4 The agreement applies for the duration of use by the School (school licence or use by individual teachers of the School) and ends automatically when that use ends.

## 2. Type of data, data subjects, purpose

2.1 See **Annex 1**. Eduskript processes the data only to operate the platform for the School. No processing for its own purposes (advertising, profiling, resale, training its own or third-party AI models) takes place. Further purposes require the School's written approval.

2.2 The School retains full control over its data. It can, at any time and without giving reasons, deny Eduskript access, demand the data free of charge (section 12) or demand its destruction.

## 3. Data minimisation and pseudonymisation

3.1 Students sign in via the School's identity provider (e.g. Microsoft 365). The email address transmitted in the process is used only to compute an irreversible pseudonym (HMAC) and is **not stored**.

3.2 Of students, Eduskript stores only the pseudonym, an optional self-chosen nickname and the work data listed in Annex 1. The list of email addresses a teacher uses to map their class stays only in the teacher's browser.

3.3 IP addresses are used only briefly to prevent abuse (rate limiting) and are not stored permanently. No analytics, tracking or advertising services are used.

## 4. Instructions

4.1 Eduskript processes the data only within the scope of this agreement and according to documented instructions of the School. Instructions are given by [school leadership / IT officer / data protection officer], by email to kontakt@luzmedia.ch.

4.2 If Eduskript considers an instruction unlawful, it informs the School without delay.

## 5. Confidentiality and disclosure

5.1 Eduskript, its employees and auxiliary persons are bound, during and after the contractual relationship, by a comprehensive duty of confidentiality equivalent to the School's official secrecy. Only those who strictly need access to personal data for operation or support are given it.

5.2 Eduskript discloses the School's data to third parties only within the scope of this agreement or with the School's written authorisation. If Eduskript is obliged by an official or court order to grant access to the School's data, it informs the School without delay, as far as legally permitted.

## 6. Data security

6.1 Eduskript takes the technical and organisational measures listed in **Annex 2** and adapts them to the state of the art. The level of protection must not decrease.

6.2 The School's data is logically separated from that of other schools and teachers (permission model, Annex 2).

6.3 Eduskript documents the technology it uses openly (source code, Annex 3) and informs the School about significant changes.

## 7. Sub-processors

7.1 The School approves the sub-processors listed in **Annex 3**.

7.2 Eduskript informs the School at least 30 days in advance about new or replaced sub-processors. The School may object for good cause; if no agreement is reached, it may terminate the agreement as of the date of the change.

7.3 Eduskript contractually binds sub-processors to an equivalent level of data protection. For large providers (hosting, AI), their standard data processing agreements apply; these cannot be negotiated individually.

## 8. Place of processing and transfer abroad

8.1 Primary data is stored in the EU: the database in Frankfurt (Germany), uploaded files in Paris (France); email delivery takes place in the EU. Under Annex 1 of the Swiss Data Protection Ordinance (DPO/DSV), the EU provides an adequate level of data protection. Koyeb runs the database on infrastructure of US companies (Neon, Amazon Web Services); the data remains in Frankfurt.

8.2 For AI features (section 9), content is transferred to providers in the USA, exclusively without identifying information as described in section 9.2. Google LLC and DigitalOcean are certified under the Swiss-U.S. Data Privacy Framework. For OpenRouter, which is not certified and only forwards the requests, the transfer relies on the content not being attributable to any person for this recipient.

8.3 By signing, the School approves processing at the locations listed in Annex 3. The current list of locations and providers is documented in the privacy policy.

## 9. AI features

9.1 **Which features.** AI is used for: (a) feedback to students on handwritten or drawn solutions, (b) AI-assisted scoring of exam answers according to a rubric set by the teacher, (c) AI support for teachers when creating and editing content. Feature (a) is only active where the teacher builds it into a task. The AI only suggests points and feedback; the teacher always decides on the assessment.

9.2 **What is transferred – and what is not.** Requests are sent from Eduskript's server, not from the student's device. Only the following is transferred:
- the teacher's task text,
- the student's answer (image of the handwriting or answer text),
- where applicable, the teacher's model solution.

Students' names, nicknames, pseudonyms, email addresses, account IDs, class names or IP addresses are **not** transferred. A request can therefore not be attributed to any person by the AI provider.

9.3 **No training, no storage.** Requests containing students' answers go only to the providers listed in Annex 3 and only to zero-data-retention endpoints that do not use content for training. If none of these endpoints is reachable, the request fails instead of falling back to another provider.

9.4 **Residual risk.** If a student writes their own name into the answer itself (e.g. on the photographed sheet or in a code comment), it is transferred along. Eduskript points this out when a student joins a class.

## 10. Support for the School

Eduskript reasonably supports the School with data subjects' requests for access, correction and deletion, with data protection impact assessments and with requests from the supervisory authority. Requests received directly by Eduskript are forwarded to the School without delay.

## 11. Data security breaches

Eduskript notifies the School of data security breaches (e.g. data loss, attack, unauthorised access) affecting the School's personal data without delay, at the latest within 48 hours of becoming aware, with the available information on nature, scope, consequences and measures taken. Contact person at Eduskript: Marc Chéhab, [kontakt@luzmedia.ch](mailto:kontakt@luzmedia.ch). Contact person at the School: [Name, email].

## 12. Return and deletion

12.1 Teachers can export their content at any time as Markdown files including attachments. An account's personal data can be downloaded in the settings as a JSON file. On termination, Eduskript transfers the School's data on request, free of charge and without delay, in these formats, even if there is a dispute between the parties.

12.2 After termination, Eduskript deletes the personal data of the School's students within 30 days, unless the School has requested its return beforehand. Backups are overwritten in the hosting provider's regular rotation cycle. Deletion is confirmed in writing on request; the School may verify it itself or have it verified by third parties.

12.3 Teaching materials published by teachers remain online in accordance with the terms of service until the teacher deletes them; they contain no student data.

## 13. Control and supervision

13.1 The School can verify compliance with this agreement primarily through Eduskript's published [source code](https://github.com/marcchehab/eduskript) or written information from Luz Media GmbH. On-site inspections are possible with prior notice; costs are borne as agreed.

13.2 For processing on behalf of the School, Eduskript is subject to the supervision of the data protection authority responsible for the School and supports it free of charge.

## 14. References

Eduskript names the School as a reference or in publications only with the School's written consent.

## 15. Deviations from the Zurich AGB

Eduskript is a small provider. It does not meet, or only partially meets, the following requirements of the AGB Auslagerung Informatikleistungen:

- **Place of processing (cl. 12):** The data is in the EU, not in Switzerland. AI requests go to the USA without identifying information (section 8).
- **Security management under ISO 27000 and external audits (cl. 8a, 9a):** Eduskript has no certification of its own and does not commission periodic audits. The hosting providers' data centres are ISO 27001 certified; the source code is publicly reviewable.
- **Access logging (cl. 8d):** Read access is not logged individually. Exam events are logged (start, hand-in, return).
- **Contractual penalty (cl. 16):** Not included. The School may agree one.
- **Passing all obligations on to sub-processors (cl. 10):** Only within the providers' standard agreements (section 7.3).

## 16. Final provisions

16.1 Amendments must be made in writing (email suffices).
16.2 If individual provisions are invalid, the remainder remains valid.
16.3 Swiss law applies. Place of jurisdiction is the School's seat.

---

[Place, date] _______________________ [Place, date] _______________________

For the School For Luz Media GmbH

---

## Annex 1 – Data, data subjects, purpose

| Data subjects | Data | Purpose |
|---|---|---|
| Teachers | Name, email, settings, created content, payment status (card data only at Payrexx) | Account, publishing, billing |
| Students | Pseudonym (HMAC), optional nickname, class membership | Access to classes |
| | Answers, code, quiz results, progress, annotations/drawings, exam answers, points, AI feedback | Teaching, feedback, assessment by the teacher |
| All | IP address (transient, not stored) | Abuse prevention |

No sensitive personal data within the meaning of Art. 5 lit. c FADP is intended.

## Annex 2 – Technical and organisational measures

- Encrypted transmission (TLS) for all connections
- Encrypted storage of the database (AES-256) and of files containing student data (SSE)
- Pseudonymisation of students at sign-in; no storage of student email addresses
- Roles and permissions: teachers see only their own classes; students only released content; data of different schools and teachers is logically separated
- Access to production systems only by the operator, with two-factor authentication (passkey or TOTP)
- Regular backups according to the hosting provider's retention
- No third-party analytics, no tracking, no advertising
- Source code publicly available (open source, AGPL v3) – security review by third parties possible
- Rate limiting against abuse
- Server logs without student content; logging of content for debugging is off by default and only switched on selectively and temporarily for individual features

## Annex 3 – Sub-processors

As at signature. The current, dated list is in the [privacy policy](https://eduskript.org/datenschutz#unterauftragsbearbeiter) (German).

| Provider | Purpose | Location | Student data? |
|---|---|---|---|
| Koyeb SAS | Application hosting, PostgreSQL database | Frankfurt, Germany | yes |
| Neon, Inc. and Amazon Web Services (on behalf of Koyeb) | Database infrastructure | Frankfurt, Germany | yes |
| Scaleway SAS | File storage | Paris, France | yes (uploads) |
| Brevo (Sendinblue SAS) | Email delivery to teachers | EU | no |
| Payrexx AG | Payment processing | Switzerland | no |
| Mux, Inc. | Video hosting (videos uploaded by teachers) | USA | no |
| OpenRouter, Inc. | Routing of AI requests (section 9) | USA | only answers without identifying information |
| Google LLC (Vertex AI) | AI feedback on handwriting (Gemini) | chosen by Google (global) | as OpenRouter |
| DigitalOcean, LLC | AI scoring (DeepSeek V4 Flash, open weights) | USA | as OpenRouter |
| Other model providers via OpenRouter | AI support for teachers when writing | USA and others | no |

Sign-in via Microsoft happens at the identity provider of the School or teacher and is not processing on behalf by Eduskript.

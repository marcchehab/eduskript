// Pulls email addresses out of free-form pasted text (lists, HTML, Word, "Name <addr>").
// RFC 5322 dot-atom local part + hostname, widened to Unicode letters/digits (RFC 6531/IDN)
// so "müller@ex.ch" is not cut to "ller@ex.ch". Purely syntactic; the server re-validates.
const EMAIL_REGEX = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*/gu

export function extractEmails(input: string): string[] {
  // NFC first: a decomposed "u + U+0308" (e.g. macOS paste) would otherwise split at the mark.
  return input.normalize('NFC').match(EMAIL_REGEX) ?? []
}

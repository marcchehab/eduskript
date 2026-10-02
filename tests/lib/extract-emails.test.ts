import { describe, it, expect } from 'vitest'
import { extractEmails } from '@/lib/extract-emails'

describe('extractEmails', () => {
  it('1. semicolon-separated list', () => {
    const input = 'nastia.allemann@stud.kswe.ch;sophie.baer@stud.kswe.ch;jolina.beetschen@stud.kswe.ch'
    expect(extractEmails(input)).toEqual([
      'nastia.allemann@stud.kswe.ch',
      'sophie.baer@stud.kswe.ch',
      'jolina.beetschen@stud.kswe.ch',
    ])
  })

  it('2. comma-separated list', () => {
    const input = 'alice@example.com, bob@example.com, carol@example.com'
    expect(extractEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ])
  })

  it('3. newline-separated list', () => {
    const input = `alice@example.com
bob@example.com
carol@example.com`
    expect(extractEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ])
  })

  it('4. space-separated list', () => {
    const input = 'alice@example.com bob@example.com carol@example.com'
    expect(extractEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ])
  })

  it('5. mixed separators', () => {
    const input = `alice@example.com; bob@example.com,
carol@example.com
dave@example.com`
    expect(extractEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ])
  })

  it('6. emails in HTML document', () => {
    const input = `<html><body>
      <p>Contact us at support@company.com</p>
      <a href="mailto:admin@company.com">admin@company.com</a>
      <footer>sales@company.com</footer>
    </body></html>`
    expect(extractEmails(input)).toEqual([
      'support@company.com',
      'admin@company.com',
      'admin@company.com',
      'sales@company.com',
    ])
  })

  it('7. emails in a Word-style paste with surrounding text', () => {
    const input = `Student List - Class 3A
    Name: Alice Smith, Email: alice.smith@school.edu
    Name: Bob Jones, Email: bob.jones@school.edu
    Name: Carol Lee, Email: carol.lee@school.edu
    Total: 3 students`
    expect(extractEmails(input)).toEqual([
      'alice.smith@school.edu',
      'bob.jones@school.edu',
      'carol.lee@school.edu',
    ])
  })

  it('8. emails with special local-part characters', () => {
    const input = "user+tag@example.com; first.last@example.com; test_user@sub.domain.com"
    expect(extractEmails(input)).toEqual([
      'user+tag@example.com',
      'first.last@example.com',
      'test_user@sub.domain.com',
    ])
  })

  it('9. tab-separated (spreadsheet paste)', () => {
    const input = "alice@uni.ch\tbob@uni.ch\tcarol@uni.ch"
    expect(extractEmails(input)).toEqual([
      'alice@uni.ch',
      'bob@uni.ch',
      'carol@uni.ch',
    ])
  })

  it('10. messy real-world paste with brackets and quotes', () => {
    const input = `"Alice" <alice@example.com>, "Bob" <bob@example.com>;
      carol@example.com (Carol); <dave@example.com>`
    expect(extractEmails(input)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ])
  })

  it('11. non-ASCII local parts are kept whole (Swiss names)', () => {
    const input = 'Hallo, bitte: Student2 <student2@eduskript.test>, müller@ex.ch; anna.küng@schule.ch'
    expect(extractEmails(input)).toEqual([
      'student2@eduskript.test',
      'müller@ex.ch',
      'anna.küng@schule.ch',
    ])
  })

  it('12. non-ASCII (IDN) domains are kept whole', () => {
    expect(extractEmails('info@zürich.ch')).toEqual(['info@zürich.ch'])
  })

  it('13. decomposed umlauts (NFD paste) are normalized, not split', () => {
    expect(extractEmails('mu\u0308ller@ex.ch')).toEqual(['müller@ex.ch'])
  })

  it('returns empty array for no emails', () => {
    expect(extractEmails('no emails here')).toEqual([])
    expect(extractEmails('')).toEqual([])
    expect(extractEmails('just @ signs @ everywhere')).toEqual([])
  })
})

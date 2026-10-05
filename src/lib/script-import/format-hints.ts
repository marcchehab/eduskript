import type { ImportWarnings } from './service'

/**
 * Upload hints per file extension and post-import notices, shared by /import (import-upload.tsx) and
 * the dashboard import modal (src/components/dashboard/import-modal.tsx).
 */
export type Locale = 'de' | 'en'
/** proceed: the file is still accepted (PDF), the hint is advice only. */
export type Hint = { title: string; body: string; steps: string[]; proceed?: boolean }

/**
 * Hints per file extension. .docx/.odt/.rtf: none. .doc and .pdf: accepted,
 * with a non-blocking hint (proceed). .pages and anything else: rejected with
 * instructions. .doc/.odt/.rtf are converted to .docx server-side by
 * LibreOffice (src/lib/script-import/libreoffice.ts), which also turns old
 * Equation Editor formulas into Word formulas (some Symbol-font glyphs come
 * out wrong; cleanup.ts asks the model to fix them).
 */
export function formatHint(ext: string, locale: Locale): Hint | null {
  const de = locale === 'de'
  const resave = de
    ? [
        'Word: Datei → Speichern unter → Dateityp «Word-Dokument (*.docx)»',
        'LibreOffice: Datei → Speichern unter → Dateityp «Word 2007–365 (.docx)»',
        'Pages: Ablage → Exportieren → Word',
      ]
    : [
        'Word: File → Save As → type "Word Document (*.docx)"',
        'LibreOffice: File → Save As → type "Word 2007–365 (.docx)"',
        'Pages: File → Export To → Word',
      ]
  switch (ext) {
    case 'doc':
      // Accepted (LibreOffice converts it server-side); the hint is just a smile.
      return de
        ? {
            title: 'Oh, eine .doc-Datei – die ist älter als manche Ihrer Schülerinnen und Schüler 😄',
            body: 'Kein Problem, wir wandeln sie um. Formeln aus dem alten Formel-Editor werden dabei zu echten Formeln; bitte danach kurz prüfen.',
            steps: [],
            proceed: true,
          }
        : {
            title: 'Oh, a .doc file – older than some of your students 😄',
            body: "No problem, we'll convert it. Formulas from the old equation editor become real formulas along the way; please check them afterwards.",
            steps: [],
            proceed: true,
          }
    case 'odt':
    case 'rtf':
      return null
    case 'pages':
      return de
        ? { title: 'Pages-Dateien können wir (noch) nicht lesen.', body: 'Exportieren Sie sie als Word-Datei:', steps: [resave[2]] }
        : { title: "We can't read Pages files (yet).", body: 'Export it as a Word file:', steps: [resave[2]] }
    case 'pdf':
      // Not blocking: the PDF is imported (convert-pdf.ts), but the original is better.
      return de
        ? {
            title: 'PDF geht – aber haben Sie die Originaldatei?',
            body: 'Aus der Originaldatei gelingt das Skript meist genauer, weil Formeln, Tabellen und Bilder direkt übernommen werden können: eine Word-Datei hochladen oder LaTeX- bzw. Markdown-Text einfügen. Aus einem PDF liest die KI den Inhalt vom Seitenbild ab und schneidet Abbildungen aus – das klappt oft gut, aber nicht immer.',
            steps: [],
            proceed: true,
          }
        : {
            title: 'PDF works – but do you have the original file?',
            body: 'The original file usually gives a more accurate skript, because formulas, tables and images can be taken over directly: upload a Word file or paste LaTeX or Markdown text. From a PDF the AI reads the content off the page images and cuts out figures – this often works well, but not always.',
            steps: [],
            proceed: true,
          }
    case 'docx':
      return null
    default:
      return de
        ? { title: 'Dieses Format können wir nicht lesen.', body: 'Bitte laden Sie eine Word-Datei (.docx) hoch.', steps: [] }
        : { title: "We can't read this format.", body: 'Please upload a Word file (.docx).', steps: [] }
  }
}


/** Extensions the script importer converts (everything else gets a hint or is rejected). */
export const SCRIPT_IMPORT_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf', 'pdf'] as const

/** Notices shown with a finished import (preview page and dashboard import modal). */
export function importNotices(w: ImportWarnings | null | undefined, locale: Locale): string[] {
  const t = (de: string, en: string) => (locale === 'de' ? de : en)
  return [
    w?.source === 'pdf'
      ? t(
          `Aus PDF gelesen: Text und Formeln hat die KI vom Seitenbild abgelesen${w.pdfFigures ? `, ${w.pdfFigures} Abbildungen wurden ausgeschnitten` : ''}. Bitte prüfen – aus der Word-Datei wäre es genauer.`,
          `Read from PDF: the AI read text and formulas off the page images${w.pdfFigures ? `, ${w.pdfFigures} figures were cut out` : ''}. Please check – the Word file would be more accurate.`
        )
      : null,
    w?.pagesAsImages
      ? t(
          `${w.pagesAsImages} Seiten konnten nicht gelesen werden und erscheinen als Bild.`,
          `${w.pagesAsImages} pages could not be read and are shown as pictures.`
        )
      : null,
    w?.formulasTranscribed
      ? t(
          `${w.formulasTranscribed} Formeln lagen im alten Word-Formeleditor vor und wurden automatisch abgelesen. Bitte stichprobenartig prüfen.`,
          `${w.formulasTranscribed} formulas used Word's old equation editor and were read automatically. Please spot-check them.`
        )
      : null,
    w?.formulasAsImages
      ? t(
          `${w.formulasAsImages} Formeln konnten nicht abgelesen werden und erscheinen als Bild.`,
          `${w.formulasAsImages} formulas could not be read and are shown as pictures.`
        )
      : null,
    w?.imagesDropped
      ? t(
          `${w.imagesDropped} Grafiken liegen als Word-Vektorgrafik vor und fehlen. Sie sind im Text markiert.`,
          `${w.imagesDropped} graphics are Word vector graphics and are missing. They are marked in the text.`
        )
      : null,
    w?.drawingsRendered
      ? t(
          `${w.drawingsRendered} Zeichnungen aus Word-Formen wurden als Bild nachgezeichnet. Kleine Abweichungen (Schrift, Abstände) sind möglich.`,
          `${w.drawingsRendered} drawings made from Word shapes were redrawn as pictures. Small differences (fonts, spacing) are possible.`
        )
      : null,
    w?.drawingsDropped
      ? t(
          `${w.drawingsDropped} Zeichnungen aus Word-Formen (Pfeile, Kästchen mit Beschriftung) konnten nicht übernommen werden. Sie sind im Text markiert.`,
          `${w.drawingsDropped} drawings made from Word shapes (arrows, labelled boxes) could not be taken over. They are marked in the text.`
        )
      : null,
    w?.chunksUncleaned
      ? t(
          `${w.chunksUncleaned} Abschnitte wurden nur umgewandelt, nicht aufbereitet (Kästen, Formeln).`,
          `${w.chunksUncleaned} sections were only converted, not tidied up (boxes, formulas).`
        )
      : null,
  ].filter((n): n is string => Boolean(n))
}

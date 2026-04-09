/**
 * Extract PDF pages as PNG images.
 *
 * Uses pdfjs-dist (dynamically imported) to render each page to a canvas,
 * then exports as PNG blobs. Runs client-side only.
 */

/** Render all pages of a PDF to PNG blobs. */
export async function extractPdfPages(
  pdfUrl: string,
  /** Render scale — 2 gives ~150 DPI for a typical PDF (72pt base). */
  scale = 2
): Promise<Blob[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

  const doc = await pdfjsLib.getDocument(pdfUrl).promise
  const blobs: Blob[] = []

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale })

    canvas.width = viewport.width
    canvas.height = viewport.height

    // Clear canvas and fill with white background (PDFs assume white)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, canvas, viewport }).promise

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`Failed to export page ${i}`))),
        'image/png'
      )
    })
    blobs.push(blob)
  }

  return blobs
}

/**
 * Extract PDF pages, upload each as a skript file, return filenames.
 * Naming: {pdfBaseName}-page-1.png, {pdfBaseName}-page-2.png, …
 */
export async function extractAndUploadPdfPages(
  pdfUrl: string,
  pdfFilename: string,
  skriptId: string,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const blobs = await extractPdfPages(pdfUrl)
  const baseName = pdfFilename.replace(/\.pdf$/i, '')
  const filenames: string[] = []

  for (let i = 0; i < blobs.length; i++) {
    onProgress?.(i + 1, blobs.length)

    const filename = `${baseName}-page-${i + 1}.png`
    const file = new File([blobs[i]], filename, { type: 'image/png' })

    const formData = new FormData()
    formData.append('file', file)
    formData.append('uploadType', 'skript')
    formData.append('skriptId', skriptId)

    const response = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || `Failed to upload page ${i + 1}`)
    }

    filenames.push(filename)
  }

  return filenames
}

'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface ExportPDFProps {
  title: string
  content: string
  author: string
}

export function ExportPDF({ title, content, author }: ExportPDFProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    
    try {
      // Create a new window with the content for printing
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        throw new Error('Unable to open print window')
      }

      // Create a complete HTML document for the PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
            }
            h1 { color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
            h2 { color: #4a5568; margin-top: 2rem; }
            h3 { color: #718096; }
            pre { background: #f7fafc; padding: 1rem; border-radius: 6px; overflow-x: auto; }
            code { background: #edf2f7; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
            blockquote { 
              border-left: 4px solid #3182ce; 
              margin: 1.5rem 0; 
              padding-left: 1rem; 
              color: #4a5568;
              font-style: italic;
            }
            .header { text-align: center; margin-bottom: 2rem; }
            .footer { margin-top: 3rem; text-align: center; color: #718096; font-size: 0.9em; }
            @media print {
              body { margin: 0; padding: 1cm; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${title}</h1>
            <p>By ${author}</p>
            <p>Generated on ${new Date().toLocaleDateString()}</p>
          </div>
          
          <div class="content">
            ${content}
          </div>
          
          <div class="footer">
            <p>This document was generated from Eduscript</p>
          </div>
        </body>
        </html>
      `

      printWindow.document.write(htmlContent)
      printWindow.document.close()

      // Wait for content to load, then trigger print
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print()
          printWindow.close()
          setIsExporting(false)
        }, 250)
      }
    } catch (error) {
      console.error('Error exporting PDF:', error)
      alert('Unable to export PDF. Please try again.')
      setIsExporting(false)
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {isExporting ? (
        <>
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Preparing PDF...
        </>
      ) : (
        <>
          <Download className="w-4 h-4" />
          Export as PDF
        </>
      )}
    </button>
  )
}

'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { HardDriveUpload, Loader2, FileArchive, AlertTriangle, CheckCircle, Package, XCircle } from 'lucide-react'
import {
  parseImportZip,
  previewImport,
  importParsedZip,
  type ParsedImport,
  type ImportPreview,
  type ImportProgress,
  type ImportOutcome
} from '@/lib/skript-import-client'

const STAGE_LABELS: Record<ImportProgress['stage'], string> = {
  structure: 'Creating collections, skripts and pages…',
  attachments: 'Uploading attachments…',
  videos: 'Uploading videos…',
  done: 'Done'
}

export function ImportExportSettings() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const alert = useAlertDialog()

  const reset = () => {
    setFile(null)
    setParsed(null)
    setPreview(null)
    setProgress(null)
    setOutcome(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    reset()
    setFile(selected)
    setParsing(true)
    try {
      const parsedZip = await parseImportZip(selected)
      setParsed(parsedZip)
      setPreview(await previewImport(parsedZip))
    } catch (error) {
      alert.showError(error instanceof Error ? error.message : 'Could not read this file')
      reset()
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!parsed) return

    setImporting(true)
    try {
      const result = await importParsedZip(parsed, setProgress)
      setOutcome(result)
      const failed = result.errors.filter(e => e.type === 'error').length
      if (failed > 0) {
        alert.showError(`Imported with ${failed} error(s) — see details below.`)
      } else {
        alert.showSuccess(
          `Imported ${result.collectionsCreated} collections, ${result.skriptsCreated} skripts, ` +
          `${result.pagesCreated} pages, ${result.filesImported} attachments, ${result.videosImported} videos.`
        )
      }
    } catch (error) {
      alert.showError(error instanceof Error ? error.message : 'Import failed')
      setProgress(null)
    } finally {
      setImporting(false)
    }
  }

  const hasBlockingErrors = preview?.errors.some(e => e.type === 'error') ?? false

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          <CardTitle>Import</CardTitle>
        </div>
        <CardDescription>
          Import content from another Eduskript instance. The zip is read and uploaded directly from
          your browser — the server isn&rsquo;t involved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Import Content</h3>
          <p className="text-sm text-muted-foreground">
            Upload a zip file exported from Eduskript to import content. Existing content with the same slug will be skipped.
          </p>

          {!file && (
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileSelect}
                className="hidden"
                id="import-file"
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={parsing} variant="outline">
                {parsing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Reading…
                  </>
                ) : (
                  <>
                    <HardDriveUpload className="w-4 h-4 mr-2" />
                    Select File
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Progress */}
          {importing && progress && (
            <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                {STAGE_LABELS[progress.stage]}
                {progress.label ? ` — ${progress.label}` : ''}
              </div>
              {progress.total > 1 && <Progress value={(progress.current / progress.total) * 100} />}
            </div>
          )}

          {/* Preview */}
          {preview && file && !importing && !outcome && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2">
                <FileArchive className="w-5 h-5" />
                <span className="font-medium">{file.name}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Collections:</span>{' '}
                  <span className="font-medium">{preview.collections.length}</span>
                  {preview.collections.filter(c => c.isNew).length > 0 && (
                    <span className="text-green-600 ml-1">
                      ({preview.collections.filter(c => c.isNew).length} new)
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Skripts:</span>{' '}
                  <span className="font-medium">{preview.skripts.length}</span>
                  {preview.skripts.filter(s => s.isNew).length > 0 && (
                    <span className="text-green-600 ml-1">
                      ({preview.skripts.filter(s => s.isNew).length} new)
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Pages:</span>{' '}
                  <span className="font-medium">{preview.skripts.reduce((sum, s) => sum + s.pageCount, 0)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Attachments:</span>{' '}
                  <span className="font-medium">{preview.skripts.reduce((sum, s) => sum + s.attachments, 0)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Videos:</span>{' '}
                  <span className="font-medium">{preview.skripts.reduce((sum, s) => sum + s.videos, 0)}</span>
                </div>
              </div>

              {preview.skripts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Skripts to import:</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {preview.skripts.map(skript => (
                      <div key={skript.slug} className="text-sm flex items-center gap-2 py-1 px-2 rounded bg-muted/50">
                        {skript.isNew ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <span className="w-3.5 h-3.5 text-muted-foreground">-</span>
                        )}
                        <span className={skript.isNew ? '' : 'text-muted-foreground'}>{skript.title}</span>
                        <span className="text-xs text-muted-foreground">({skript.pageCount} pages)</span>
                        {!skript.isNew && <span className="text-xs text-muted-foreground ml-auto">exists</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="space-y-2">
                  {preview.errors.filter(e => e.type === 'error').length > 0 && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                      <div className="flex items-center gap-2 text-destructive font-medium text-sm mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        Errors (must be fixed before import)
                      </div>
                      <ul className="text-sm space-y-1">
                        {preview.errors.filter(e => e.type === 'error').map((error, i) => (
                          <li key={i} className="text-destructive">
                            <span className="font-mono text-xs">{error.location}</span>: {error.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preview.errors.filter(e => e.type === 'warning').length > 0 && (
                    <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 font-medium text-sm mb-2">
                        <AlertTriangle className="w-4 h-4" />
                        Warnings
                      </div>
                      <ul className="text-sm space-y-1">
                        {preview.errors.filter(e => e.type === 'warning').map((warning, i) => (
                          <li key={i} className="text-yellow-600 dark:text-yellow-400">
                            <span className="font-mono text-xs">{warning.location}</span>: {warning.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button onClick={handleImport} disabled={importing || hasBlockingErrors}>
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      <HardDriveUpload className="w-4 h-4 mr-2" />
                      Import Content
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={reset} disabled={importing}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Result */}
          {outcome && (
            <div className={`border rounded-lg p-4 ${outcome.errors.some(e => e.type === 'error') ? 'bg-destructive/10 border-destructive/20' : 'bg-green-500/10 border-green-500/20'}`}>
              <div className={`flex items-center gap-2 ${outcome.errors.some(e => e.type === 'error') ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                {outcome.errors.some(e => e.type === 'error') ? <XCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                <span className="font-medium">Import Finished</span>
              </div>
              <p className="text-sm mt-2">
                {outcome.collectionsCreated} collections, {outcome.skriptsCreated} skripts,{' '}
                {outcome.pagesCreated} pages, {outcome.filesImported} attachments, {outcome.videosImported} videos.
              </p>
              {outcome.errors.length > 0 && (
                <ul className="text-sm space-y-1 mt-2">
                  {outcome.errors.map((e, i) => (
                    <li key={i} className={e.type === 'error' ? 'text-destructive' : 'text-yellow-600 dark:text-yellow-400'}>
                      <span className="font-mono text-xs">{e.location}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </CardContent>
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </Card>
  )
}

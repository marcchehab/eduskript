'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Download, Upload, Loader2, FileArchive, AlertTriangle, CheckCircle, Package, XCircle, Cloud, Clock } from 'lucide-react'

// Files larger than 10MB use S3 upload flow
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024

interface ImportPreview {
  collections: { slug: string; title: string; isNew: boolean }[]
  skripts: { slug: string; title: string; pageCount: number; isNew: boolean }[]
  attachments: number
  errors: { type: 'error' | 'warning'; location: string; message: string }[]
}

interface ImportJob {
  id: string
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  fileName: string | null
  result?: {
    collectionsCreated?: number
    skriptsCreated?: number
    pagesCreated?: number
    filesImported?: number
  }
  error?: string
}

export function ImportExportSettings() {
  const [isExporting, setIsExporting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [currentJob, setCurrentJob] = useState<ImportJob | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [s3Configured, setS3Configured] = useState<boolean | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const alert = useAlertDialog()
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const isUploadingRef = useRef(false) // Track if we're currently uploading (to prevent state overwrites)

  // Define startPolling before the useEffect that uses it
  const startPolling = useCallback((jobId: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    const poll = async () => {
      try {
        const response = await fetch(`/api/import?action=status&jobId=${jobId}`)
        if (response.ok) {
          const job = await response.json()
          setCurrentJob(job)

          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }

            if (job.status === 'completed') {
              const r = job.result
              alert.showSuccess(
                `Import completed: ${r?.collectionsCreated || 0} collections, ` +
                `${r?.skriptsCreated || 0} skripts, ${r?.pagesCreated || 0} pages, ` +
                `${r?.filesImported || 0} files`
              )
            } else if (job.status === 'failed') {
              alert.showError(job.error || 'Import failed')
            }
          }
        }
      } catch (error) {
        console.error('Failed to poll job status:', error)
      }
    }

    pollingRef.current = setInterval(poll, 1000)
    poll() // Initial poll
  }, [alert])

  // Check if S3 is configured and if there's an active job - only on mount
  useEffect(() => {
    let mounted = true

    const checkStatus = async () => {
      // Skip if we're actively uploading
      if (isUploadingRef.current) return

      try {
        const response = await fetch('/api/import/prepare')
        if (response.ok && mounted) {
          const data = await response.json()
          setS3Configured(data.s3Configured)

          // Only set currentJob if we're not actively uploading
          if (data.activeJob && !isUploadingRef.current) {
            setCurrentJob(data.activeJob)
            // Only start polling if job is already processing (not pending/uploading from browser)
            if (data.activeJob.status === 'processing') {
              startPolling(data.activeJob.id)
            }
          }
        }
      } catch (error) {
        console.error('Failed to check import status:', error)
      }
    }
    checkStatus()

    return () => {
      mounted = false
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const response = await fetch('/api/export')

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Export failed')
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition')
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch?.[1] || 'eduskript-export.zip'

      // Download the file
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export error:', error)
      alert.showError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadedFile(file)
    setPreview(null)

    // Check if we need to use the large file flow
    if (file.size > LARGE_FILE_THRESHOLD && s3Configured) {
      await handleLargeFileUpload(file)
    } else {
      await handleSmallFileUpload(file)
    }
  }

  const handleSmallFileUpload = async (file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/import?action=preview', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to process file')
      }

      const previewData = await response.json()
      setPreview(previewData)
    } catch (error) {
      console.error('Upload error:', error)
      alert.showError(error instanceof Error ? error.message : 'Failed to process file')
      setUploadedFile(null)
    } finally {
      setIsUploading(false)
    }
  }

  const handleLargeFileUpload = async (file: File) => {
    isUploadingRef.current = true // Prevent status polling from overwriting our state
    try {
      // Step 1: Prepare upload
      setUploadProgress(0)
      const prepareResponse = await fetch('/api/import/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileSize: file.size })
      })

      if (!prepareResponse.ok) {
        const error = await prepareResponse.json()
        throw new Error(error.error || 'Failed to prepare upload')
      }

      const { jobId, uploadUrl } = await prepareResponse.json()
      setCurrentJob({ id: jobId, status: 'uploading', progress: 0, message: 'Uploading to storage...', fileName: file.name })

      // Step 2: Upload directly to S3 with progress
      await uploadToS3WithProgress(uploadUrl, file, (progress) => {
        setUploadProgress(progress)
        const totalProgress = Math.floor(progress * 0.5) // Upload is 0-50% of total
        setCurrentJob(prev => prev ? { ...prev, progress: totalProgress, message: `Uploading to cloud... ${totalProgress}%` } : null)
      })

      // Step 3: Start processing
      const startResponse = await fetch(`/api/import?action=start&jobId=${jobId}`, {
        method: 'POST'
      })

      if (!startResponse.ok) {
        const error = await startResponse.json()
        throw new Error(error.error || 'Failed to start import')
      }

      // Step 4: Start polling for status (now safe because upload is done)
      isUploadingRef.current = false
      startPolling(jobId)
    } catch (error) {
      console.error('Large file upload error:', error)
      alert.showError(error instanceof Error ? error.message : 'Upload failed')
      setCurrentJob(null)
      setUploadedFile(null)
      isUploadingRef.current = false
    } finally {
      setIsUploading(false)
    }
  }

  const uploadToS3WithProgress = async (
    uploadUrl: string,
    file: File,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      // Set a long timeout for large files (30 minutes)
      xhr.timeout = 30 * 60 * 1000

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100
          onProgress(progress)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          console.error('[S3 Upload] Failed:', { status: xhr.status, statusText: xhr.statusText, response: xhr.responseText })
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
        }
      })

      xhr.addEventListener('error', (event) => {
        console.error('[S3 Upload] Network error:', event)
        reject(new Error('Upload failed: Network error. Check browser console for details.'))
      })

      xhr.addEventListener('abort', () => {
        console.error('[S3 Upload] Aborted')
        reject(new Error('Upload was aborted'))
      })

      xhr.addEventListener('timeout', () => {
        console.error('[S3 Upload] Timeout after 30 minutes')
        reject(new Error('Upload timed out after 30 minutes'))
      })

      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', 'application/zip')
      xhr.send(file)
    })
  }

  const handleImport = async () => {
    if (!uploadedFile) return

    setIsImporting(true)

    try {
      const formData = new FormData()
      formData.append('file', uploadedFile)

      const response = await fetch('/api/import?action=import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Import failed')
      }

      alert.showSuccess(
        `Successfully imported ${result.imported.collections} collections, ` +
        `${result.imported.skripts} skripts, ${result.imported.pages} pages, ` +
        `and ${result.imported.files} files.`
      )

      // Reset state
      setPreview(null)
      setUploadedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Import error:', error)
      alert.showError(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  const handleCancelImport = async () => {
    if (currentJob && (currentJob.status === 'pending' || currentJob.status === 'uploading')) {
      try {
        await fetch(`/api/import?jobId=${currentJob.id}`, { method: 'DELETE' })
      } catch (error) {
        console.error('Failed to cancel job:', error)
      }
    }

    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    setPreview(null)
    setUploadedFile(null)
    setCurrentJob(null)
    setUploadProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const hasBlockingErrors = preview?.errors.some(e => e.type === 'error') ?? false
  const isLargeFile = uploadedFile && uploadedFile.size > LARGE_FILE_THRESHOLD
  // Show progress for uploading, processing, OR if we're actively uploading (isUploading with a job)
  const showJobProgress = currentJob && (
    ['uploading', 'processing'].includes(currentJob.status) ||
    (currentJob.status === 'pending' && isUploading)
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          <CardTitle>Import / Export</CardTitle>
        </div>
        <CardDescription>
          Export your content as a zip file or import from another Eduskript instance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export Section */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Export Content</h3>
          <p className="text-sm text-muted-foreground">
            Download all your collections, skripts, pages, and attachments as a zip file.
          </p>
          <Button
            onClick={handleExport}
            disabled={isExporting}
            variant="outline"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export All Content
              </>
            )}
          </Button>
        </div>

        <div className="border-t pt-6">
          {/* Import Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Import Content</h3>
            <p className="text-sm text-muted-foreground">
              Upload a zip file exported from Eduskript to import content. Existing content with the same slug will be skipped.
              {s3Configured && (
                <span className="block mt-1 text-xs">
                  <Cloud className="w-3 h-3 inline mr-1" />
                  Large file support enabled (files &gt;10MB upload via cloud storage)
                </span>
              )}
            </p>

            {/* Job Progress Display */}
            {showJobProgress && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  <span className="font-medium">{currentJob.fileName}</span>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{currentJob.message || 'Processing...'}</span>
                    <span className="font-mono">{currentJob.progress}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${currentJob.progress}%` }}
                    />
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelImport}
                  disabled={currentJob.status === 'processing'}
                >
                  Cancel
                </Button>
              </div>
            )}

            {/* Completed/Failed Job Display */}
            {currentJob && currentJob.status === 'completed' && (
              <div className="border rounded-lg p-4 bg-green-500/10 border-green-500/20">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Import Completed</span>
                </div>
                <p className="text-sm mt-2">
                  Imported {currentJob.result?.collectionsCreated || 0} collections,{' '}
                  {currentJob.result?.skriptsCreated || 0} skripts,{' '}
                  {currentJob.result?.pagesCreated || 0} pages,{' '}
                  {currentJob.result?.filesImported || 0} files.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleCancelImport}
                >
                  Dismiss
                </Button>
              </div>
            )}

            {currentJob && currentJob.status === 'failed' && (
              <div className="border rounded-lg p-4 bg-destructive/10 border-destructive/20">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="w-5 h-5" />
                  <span className="font-medium">Import Failed</span>
                </div>
                <p className="text-sm mt-2 text-destructive">{currentJob.error || 'Unknown error'}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleCancelImport}
                >
                  Dismiss
                </Button>
              </div>
            )}

            {/* Pending job - can be cancelled */}
            {currentJob && currentJob.status === 'pending' && (
              <div className="border rounded-lg p-4 bg-yellow-500/10 border-yellow-500/20">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                  <Clock className="w-5 h-5" />
                  <span className="font-medium">Pending Upload: {currentJob.fileName}</span>
                </div>
                <p className="text-sm mt-2 text-muted-foreground">
                  A previous import was started but not completed. Cancel it to start a new one.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={handleCancelImport}
                >
                  Cancel &amp; Start New
                </Button>
              </div>
            )}

            {!preview && !showJobProgress && (!currentJob || currentJob.status === 'cancelled') && (
              <div className="flex items-center gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="import-file"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  variant="outline"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Select File
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Preview (for small files) */}
            {preview && !isLargeFile && (
              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <FileArchive className="w-5 h-5" />
                  <span className="font-medium">{uploadedFile?.name}</span>
                </div>

                {/* Summary */}
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
                    <span className="font-medium">
                      {preview.skripts.reduce((sum, s) => sum + s.pageCount, 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attachments:</span>{' '}
                    <span className="font-medium">{preview.attachments}</span>
                  </div>
                </div>

                {/* Skript List */}
                {preview.skripts.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Skripts to import:</h4>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {preview.skripts.map(skript => (
                        <div
                          key={skript.slug}
                          className="text-sm flex items-center gap-2 py-1 px-2 rounded bg-muted/50"
                        >
                          {skript.isNew ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                          ) : (
                            <span className="w-3.5 h-3.5 text-muted-foreground">-</span>
                          )}
                          <span className={skript.isNew ? '' : 'text-muted-foreground'}>
                            {skript.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({skript.pageCount} pages)
                          </span>
                          {!skript.isNew && (
                            <span className="text-xs text-muted-foreground ml-auto">exists</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Errors and Warnings */}
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

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={handleImport}
                    disabled={isImporting || hasBlockingErrors}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import Content
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelImport}
                    disabled={isImporting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
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

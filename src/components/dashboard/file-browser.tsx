'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Image as ImageIcon, Video, Music, FileText, Archive, File, Trash2, ExternalLink, Pencil, TextCursor, Database, FileCode, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTheme } from 'next-themes'

interface FileItem {
  id: string
  name: string
  filename?: string // For backward compatibility
  originalName?: string
  size?: number
  url?: string
  isDirectory?: boolean
  contentType?: string
  uploadType?: 'global' | 'skript'
  skriptId?: string
  uploadedAt?: string
  createdAt?: Date
  updatedAt?: Date
}

export type FileInsertionType = 'embed' | 'link' | 'sql-editor'

interface FileBrowserProps {
  skriptId?: string
  onFileSelect?: (file: FileItem, insertionType: FileInsertionType) => void
  className?: string
  onUploadComplete?: () => void
  files: FileItem[]
  loading: boolean
  onFileRenamed?: (oldFilename: string, newFilename: string) => void
  onExcalidrawEdit?: (file: FileItem) => void
}

export function FileBrowser({ skriptId, onFileSelect, className = '', onUploadComplete, files, loading, onFileRenamed, onExcalidrawEdit }: FileBrowserProps) {
  const [dragOver, setDragOver] = useState(false)
  const [renameFile, setRenameFile] = useState<FileItem | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [updateLinks, setUpdateLinks] = useState(true)
  const [duplicateUpload, setDuplicateUpload] = useState<{file: File, existingFile: FileItem} | null>(null)
  const [newUploadName, setNewUploadName] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null) // 0-100 or null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { resolvedTheme } = useTheme()
  const alert = useAlertDialog()

  const getFileIcon = (filename: string) => {
    // Check if it's an Excalidraw file
    if (filename.endsWith('.excalidraw')) {
      return <Pencil className="w-5 h-5 text-orange-500" />
    }

    const extension = filename.split('.').pop()?.toLowerCase()

    switch (extension) {
      case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg':
        return <ImageIcon className="w-5 h-5 text-blue-500" />
      case 'mp4': case 'avi': case 'mov': case 'wmv':
        return <Video className="w-5 h-5 text-purple-500" />
      case 'mp3': case 'wav': case 'ogg': case 'flac':
        return <Music className="w-5 h-5 text-green-500" />
      case 'pdf': case 'doc': case 'docx': case 'txt': case 'md':
        return <FileText className="w-5 h-5 text-destructive" />
      case 'zip': case 'rar': case '7z': case 'tar':
        return <Archive className="w-5 h-5 text-yellow-500" />
      case 'sqlite': case 'db':
        return <Database className="w-5 h-5 text-cyan-500" />
      default:
        return <File className="w-5 h-5 text-icon-muted" />
    }
  }

  const isExcalidrawFile = (filename: string) => {
    return filename.endsWith('.excalidraw')
  }

  const isDatabaseFile = (filename: string) => {
    return filename.endsWith('.sqlite') || filename.endsWith('.db')
  }

  const getDatabaseSchemaName = (dbFilename: string) => {
    // Remove .sqlite or .db extension and add -schema.excalidraw
    const baseName = dbFilename.replace(/\.(sqlite|db)$/i, '')
    return `${baseName}-schema.excalidraw`
  }

  const findSchemaForDatabase = (dbFile: FileItem) => {
    const schemaName = getDatabaseSchemaName(getFileName(dbFile))
    return files.find(f => getFileName(f) === schemaName)
  }

  // Filter out auto-generated files
  const shouldShowFile = (filename: string) => {
    // Don't show .excalidraw.light.svg or .excalidraw.dark.svg files
    if (filename.match(/\.excalidraw\.(light|dark)\.svg$/)) {
      return false
    }
    // Don't show database schema excalidraw files (they're shown inline with the DB)
    if (filename.match(/-schema\.excalidraw$/)) {
      return false
    }
    return true
  }

  const getDisplayFiles = () => {
    return files.filter(f => {
      const filename = getFileName(f)
      // Show .excalidraw files (they can be edited and used across skripts)
      // But hide the auto-generated .light.svg and .dark.svg variants
      return !f.isDirectory && (f.uploadType === 'skript' || !f.uploadType) && shouldShowFile(filename)
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent, uploadType: 'global' | 'skript' = 'skript') => {
    e.preventDefault()
    setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    await uploadFiles(droppedFiles, uploadType)
  }

  // Helper functions to handle both old and new file structures
  const getFileName = (file: FileItem) => {
    return file.name || file.filename || file.originalName || 'Unknown file'
  }

  const getFileUrl = (file: FileItem) => {
    return file.url || ''
  }

  const getFileSize = (file: FileItem) => {
    return file.size || 0
  }

  const isImageFile = (filename: string | undefined) => {
    if (!filename) return false
    const extension = filename.split('.').pop()?.toLowerCase()
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension || '')
  }

  const getExcalidrawPreviewUrl = (file: FileItem) => {
    // Get the theme-appropriate SVG variant for the preview
    // The file URL is like /api/files/[fileId]
    // We need /api/files/[fileId].light.svg or .dark.svg
    const fileUrl = getFileUrl(file)
    const variant = resolvedTheme === 'dark' ? 'dark' : 'light'
    return `${fileUrl}.${variant}.svg`
  }

  const openFileLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleRename = (file: FileItem) => {
    setRenameFile(file)
    setNewFileName(getFileName(file))
  }

  const handleDuplicateCheck = async (file: File, uploadType: 'global' | 'skript' = 'skript') => {
    // Check if file with same name already exists
    const existingFile = files.find(f => 
      (f.uploadType === uploadType || !f.uploadType) && 
      getFileName(f) === file.name
    )
    
    if (existingFile) {
      setDuplicateUpload({ file, existingFile })
      setNewUploadName(file.name)
      return false // Don't upload yet
    }
    
    return true // Proceed with upload
  }

  const uploadFiles = async (fileList: File[], uploadType: 'global' | 'skript' = 'skript') => {
    // Size limits
    const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB max
    const DIRECT_UPLOAD_THRESHOLD = 10 * 1024 * 1024 // 10MB - use direct S3 upload for larger files

    for (const file of fileList) {
      if (file.size > MAX_FILE_SIZE) {
        alert.showError(`File "${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 500MB.`)
        return
      }
    }

    for (const file of fileList) {
      const canUpload = await handleDuplicateCheck(file, uploadType)
      if (!canUpload) {
        return // Stop if duplicate found - user will handle via modal
      }
    }

    setUploadProgress(0)
    const uploadPromises = fileList.map(async (file) => {
      try {
        // For large files, use direct S3 upload via presigned URL
        if (file.size > DIRECT_UPLOAD_THRESHOLD && skriptId) {
          await uploadDirectToS3(file, skriptId)
        } else {
          // For smaller files, use the standard upload endpoint
          await uploadViaServer(file, uploadType)
        }
        if (onUploadComplete) onUploadComplete()
      } catch (error) {
        console.error('Upload error:', error)
        if (error instanceof Error) {
          alert.showError(`Upload failed: ${error.message}`)
        } else {
          alert.showError('Upload failed. Please check your connection and try again.')
        }
      }
    })

    await Promise.all(uploadPromises)
    setUploadProgress(null)
  }

  // Upload large files directly to S3 via presigned URL
  const uploadDirectToS3 = async (file: File, targetSkriptId: string) => {
    // Step 1: Get presigned URL
    const presignedResponse = await fetch('/api/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        skriptId: targetSkriptId
      })
    })

    if (!presignedResponse.ok) {
      const error = await presignedResponse.json().catch(() => ({ error: 'Failed to get upload URL' }))
      throw new Error(error.error || 'Failed to get upload URL')
    }

    const { uploadUrl, uploadToken, uploadData, signature } = await presignedResponse.json()

    // Step 2: Upload directly to S3 (XMLHttpRequest for progress tracking)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`S3 upload failed: ${xhr.status} ${xhr.statusText}`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(file)
    })

    // Step 3: Confirm upload and create database record
    const confirmResponse = await fetch('/api/upload/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadToken,
        uploadData,
        signature
      })
    })

    if (!confirmResponse.ok) {
      const error = await confirmResponse.json().catch(() => ({ error: 'Failed to confirm upload' }))
      throw new Error(error.error || 'Failed to confirm upload')
    }

    return await confirmResponse.json()
  }

  // Upload smaller files via server
  const uploadViaServer = async (file: File, uploadType: 'global' | 'skript') => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('uploadType', uploadType)
    if (skriptId && uploadType === 'skript') {
      formData.append('skriptId', skriptId)
    }

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      try {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      } catch (e) {
        if (e instanceof Error && e.message !== 'Upload failed') {
          throw e
        }
        throw new Error(`Upload failed (${response.status}). The file may be too large.`)
      }
    }

    return await response.json()
  }

  const handleFileDragStart = (e: React.DragEvent, file: FileItem) => {
    // Set data for drag-and-drop to editor
    e.dataTransfer.setData('application/Eduskript-file', JSON.stringify(file))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleFileDelete = async (file: FileItem) => {
    if (!window.confirm(`Are you sure you want to delete "${getFileName(file)}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        if (onUploadComplete) onUploadComplete()
      } else {
        const error = await response.json()
        console.error('Delete failed:', error.error)
      }
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  if (loading) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={`p-4 space-y-4 ${className}`}>
      {/* Hidden file input for click-to-upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const selectedFiles = Array.from(e.target.files || [])
          if (selectedFiles.length > 0) {
            await uploadFiles(selectedFiles, 'skript')
          }
          // Reset so the same file can be selected again
          e.target.value = ''
        }}
      />

      {/* Skript Files Section */}
      {skriptId && (
        <div>
          <div
            className={`border-2 border-dashed rounded-lg p-3 transition-colors cursor-pointer relative ${
              dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10' : 'border-border'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'skript')}
            onClick={(e) => {
              // Only trigger file picker if clicking the drop zone itself, not file items
              if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-upload-zone]')) {
                fileInputRef.current?.click()
              }
            }}
            data-upload-zone
          >
            {/* Upload progress overlay */}
            {uploadProgress !== null && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[1px]">
                <svg width="40" height="40" viewBox="0 0 40 40" className="text-primary">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.15" />
                  <circle
                    cx="20" cy="20" r="16"
                    fill="none" stroke="currentColor" strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 16}`}
                    strokeDashoffset={`${2 * Math.PI * 16 * (1 - uploadProgress / 100)}`}
                    transform="rotate(-90 20 20)"
                    className="transition-[stroke-dashoffset] duration-200"
                  />
                  <text x="20" y="20" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontSize="10" fontWeight="500">
                    {uploadProgress}%
                  </text>
                </svg>
              </div>
            )}
            {getDisplayFiles().length === 0 ? (
              <div className="text-center py-2 text-muted-foreground text-sm" data-upload-zone>
                Drop files here or click to upload
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground mb-2">
                  {getDisplayFiles().length} file{getDisplayFiles().length !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                {getDisplayFiles().map((file) => (
                  <div
                    key={file.id || file.url}
                    className="flex items-center space-x-2 p-2 rounded hover:bg-muted group"
                  >
                    {/* Image preview or file icon */}
                    <div className="flex-shrink-0">
                      {isImageFile(getFileName(file)) ? (
                        <div className="w-8 h-8 rounded overflow-hidden bg-muted relative">
                          <Image
                            src={getFileUrl(file)}
                            alt={getFileName(file)}
                            fill
                            className="object-cover"
                          />
                        </div>
                      ) : isExcalidrawFile(getFileName(file)) ? (
                        <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center">
                          <Image
                            src={getExcalidrawPreviewUrl(file)}
                            alt={getFileName(file)}
                            width={32}
                            height={32}
                            className="w-full h-full object-contain p-0.5"
                          />
                        </div>
                      ) : (
                        getFileIcon(getFileName(file))
                      )}
                    </div>

                    <div
                      className="flex items-center space-x-2 flex-1 cursor-pointer min-w-0"
                      draggable
                      onDragStart={(e) => handleFileDragStart(e, file)}
                      onClick={() => onFileSelect?.(file, 'embed')}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {getFileName(file)}
                          </p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openFileLink(getFileUrl(file))
                            }}
                            className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Open original file"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatFileSize(getFileSize(file))}</p>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center space-x-1">
                      {isExcalidrawFile(getFileName(file)) && onExcalidrawEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onExcalidrawEdit(file)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-orange-500 hover:text-orange-600 transition-opacity"
                          title="Edit drawing"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {isDatabaseFile(getFileName(file)) && onExcalidrawEdit && (() => {
                        const schema = findSchemaForDatabase(file)
                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (schema) {
                                onExcalidrawEdit(schema)
                              } else {
                                // Create new schema file
                                const schemaName = getDatabaseSchemaName(getFileName(file))
                                // We'll create a placeholder file object that the handler can use
                                onExcalidrawEdit({
                                  id: '', // Empty ID signals new file
                                  name: schemaName,
                                  filename: schemaName,
                                  skriptId: file.skriptId
                                })
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-orange-500 hover:text-orange-600 transition-opacity"
                            title={schema ? "Edit schema" : "Create schema"}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )
                      })()}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRename(file)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
                        title="Rename file"
                      >
                        <TextCursor className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFileDelete(file) }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-destructive hover:text-destructive/80 transition-opacity"
                        title="Delete file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameFile && (
        <Dialog open={!!renameFile} onOpenChange={() => setRenameFile(null)}>
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
          <div className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                Rename File
              </h2>
              <p className="text-sm text-muted-foreground">
                Enter a new name for &ldquo;{renameFile ? getFileName(renameFile) : ''}&rdquo;
              </p>
            </div>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="filename">New filename</Label>
                <Input
                  id="filename"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="Enter new filename"
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="update-links"
                  checked={updateLinks}
                  onChange={(e) => setUpdateLinks(e.target.checked)}
                  className="rounded border-border"
                />
                <Label htmlFor="update-links" className="text-sm">
                  Update all links throughout this skript
                </Label>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => setRenameFile(null)}>
                Cancel
              </Button>
              <Button onClick={async () => {
                if (!renameFile || !newFileName.trim()) return
                
                try {
                  const response = await fetch(`/api/files/${renameFile.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      newFilename: newFileName.trim()
                    })
                  })
                  
                  if (response.ok) {
                    const result = await response.json()

                    // Call the callback to update live editor content if updateLinks is enabled
                    if (updateLinks && onFileRenamed) {
                      onFileRenamed(result.file.oldName, result.file.name)
                    }

                    setRenameFile(null)
                    setNewFileName('')
                    if (onUploadComplete) onUploadComplete() // Refresh the file list
                  } else {
                    const error = await response.json()
                    alert.showError(error.error || 'Failed to rename file')
                  }
                } catch (error) {
                  console.error('Rename error:', error)
                  alert.showError('Failed to rename file')
                }
              }}>
                Rename
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Duplicate Upload Modal */}
      {duplicateUpload && (
        <Dialog open={!!duplicateUpload} onOpenChange={() => setDuplicateUpload(null)}>
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
          <div className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg">
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                File Already Exists
              </h2>
              <p className="text-sm text-muted-foreground">
                A file named &ldquo;{duplicateUpload ? getFileName(duplicateUpload.existingFile) : ''}&rdquo; already exists.
              </p>
            </div>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="new-upload-name">New filename (if renaming)</Label>
                <Input
                  id="new-upload-name"
                  value={newUploadName}
                  onChange={(e) => setNewUploadName(e.target.value)}
                  placeholder="Enter new filename"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => setDuplicateUpload(null)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={async () => {
                if (!duplicateUpload) return
                
                try {
                  // Upload with overwrite
                  const formData = new FormData()
                  formData.append('file', duplicateUpload.file)
                  formData.append('overwrite', 'true')
                  if (skriptId) {
                    formData.append('skriptId', skriptId)
                  }

                  const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                  })

                  if (response.ok) {
                    setDuplicateUpload(null)
                    setNewUploadName('')
                    if (onUploadComplete) onUploadComplete()
                  } else {
                    const error = await response.json()
                    alert.showError(error.error || 'Failed to overwrite file')
                  }
                } catch (error) {
                  console.error('Overwrite error:', error)
                  alert.showError('Failed to overwrite file')
                }
              }}>
                Overwrite Existing
              </Button>
              <Button onClick={async () => {
                if (!duplicateUpload || !newUploadName.trim()) return
                
                try {
                  // Upload with new name
                  const formData = new FormData()
                  // Create a new file with the new name
                  const blob = new Blob([duplicateUpload.file], { type: duplicateUpload.file.type })
                  formData.append('file', blob, newUploadName.trim())
                  if (skriptId) {
                    formData.append('skriptId', skriptId)
                  }

                  const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                  })

                  if (response.ok) {
                    setDuplicateUpload(null)
                    setNewUploadName('')
                    if (onUploadComplete) onUploadComplete()
                  } else {
                    const error = await response.json()
                    alert.showError(error.error || 'Failed to upload file with new name')
                  }
                } catch (error) {
                  console.error('Rename upload error:', error)
                  alert.showError('Failed to upload file with new name')
                }
              }}>
                Rename & Upload
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </div>
  )
}

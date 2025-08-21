'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Image as ImageIcon, Video, Music, FileText, Archive, File, Trash2, ExternalLink, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

interface FileBrowserProps {
  skriptId?: string
  onFileSelect?: (file: FileItem) => void
  className?: string
  onUploadComplete?: () => void
  files: FileItem[]
  loading: boolean
  onFileRenamed?: (oldFilename: string, newFilename: string) => void
}

export function FileBrowser({ skriptId, onFileSelect, className = '', onUploadComplete, files, loading, onFileRenamed }: FileBrowserProps) {
  const [dragOver, setDragOver] = useState(false)
  const [renameFile, setRenameFile] = useState<FileItem | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [updateLinks, setUpdateLinks] = useState(true)
  const [duplicateUpload, setDuplicateUpload] = useState<{file: File, existingFile: FileItem} | null>(null)
  const [newUploadName, setNewUploadName] = useState('')

  const getFileIcon = (filename: string) => {
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
      default:
        return <File className="w-5 h-5 text-icon-muted" />
    }
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

  const openFileLink = (url: string) => {
    console.log('Opening file URL:', url)
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
    for (const file of fileList) {
      const canUpload = await handleDuplicateCheck(file, uploadType)
      if (!canUpload) {
        return // Stop if duplicate found - user will handle via modal
      }
    }

    const uploadPromises = fileList.map(async (file) => {
      try {
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

        if (response.ok) {
          if (onUploadComplete) onUploadComplete()
        } else {
          const error = await response.json()
          console.error('Upload failed:', error.error)
        }
      } catch (error) {
        console.error('Upload error:', error)
      }
    })

    await Promise.all(uploadPromises)
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
      {/* Skript Files Section */}
      {skriptId && (
        <div>
          <div
            className={`border-2 border-dashed rounded-lg p-3 transition-colors ${
              dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10' : 'border-border'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'skript')}
          >
            {files.filter(f => !f.isDirectory && (f.uploadType === 'skript' || !f.uploadType)).length === 0 ? (
              <div className="text-center py-2 text-muted-foreground text-sm">
                No skript files. Drop files here or click upload.
              </div>
            ) : (
              <div className="space-y-1">
                {files.filter(f => !f.isDirectory && (f.uploadType === 'skript' || !f.uploadType)).map((file) => (
                  <div
                    key={file.id || file.url}
                    className="flex items-center space-x-2 p-2 rounded hover:bg-muted group"
                  >
                    {/* Image preview or file icon */}
                    <div className="flex-shrink-0">
                      {isImageFile(getFileName(file)) ? (
                        <div className="w-8 h-8 rounded overflow-hidden bg-muted">
                          <Image 
                            src={getFileUrl(file)} 
                            alt={getFileName(file)}
                            width={32}
                            height={32}
                            className="w-full h-full object-cover"
                            placeholder="blur"
                            blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bVl+6V3BcBv09f/Z"
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
                      onClick={() => onFileSelect?.(file)}
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRename(file)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
                        title="Rename file"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleFileDelete(file)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-destructive hover:text-destructive/80 transition-opacity"
                        title="Delete file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
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
                    alert(error.error || 'Failed to rename file')
                  }
                } catch (error) {
                  console.error('Rename error:', error)
                  alert('Failed to rename file')
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
                    alert(error.error || 'Failed to overwrite file')
                  }
                } catch (error) {
                  console.error('Overwrite error:', error)
                  alert('Failed to overwrite file')
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
                    alert(error.error || 'Failed to upload file with new name')
                  }
                } catch (error) {
                  console.error('Rename upload error:', error)
                  alert('Failed to upload file with new name')
                }
              }}>
                Rename & Upload
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

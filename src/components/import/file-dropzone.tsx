'use client'

/**
 * Drag-and-drop / click-to-choose file area. Used by the anonymous upload
 * page (src/app/(app)/import/import-upload.tsx) and the dashboard import
 * modal (src/components/dashboard/import-modal.tsx). One file at a time.
 */
import { useRef, useState, type ReactNode } from 'react'
import { FileText, Upload } from 'lucide-react'

interface FileDropzoneProps {
  accept: string
  onFile: (file: File) => void
  /** Name of the chosen file, shown instead of the prompt. */
  fileName?: string | null
  prompt: ReactNode
  hint?: ReactNode
  disabled?: boolean
  className?: string
}

export function FileDropzone({ accept, onFile, fileName, prompt, hint, disabled, className = '' }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const open = () => !disabled && inputRef.current?.click()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f && !disabled) onFile(f)
      }}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'} ${className}`}
    >
      {fileName ? <FileText className="w-10 h-10 text-primary" /> : <Upload className="w-10 h-10 text-muted-foreground" />}
      <span className="font-medium text-center break-all">{fileName ?? prompt}</span>
      {hint && <span className="text-sm text-muted-foreground text-center">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = '' // allow choosing the same file again
        }}
      />
    </div>
  )
}

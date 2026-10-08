'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Folder, FileArchive, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import {
  exportSkriptAsZip,
  exportSkriptToDirectory,
  type ExportProgress
} from '@/lib/skript-export-client'

const STAGE_LABELS: Record<ExportProgress['stage'], string> = {
  fetching: 'Loading pages…',
  attachments: 'Downloading attachments…',
  videos: 'Preparing videos…',
  zipping: 'Building zip…',
  writing: 'Writing files…',
  done: 'Done'
}

interface ExportSkriptPanelProps {
  skriptId: string
}

/** Skript export as an inline panel (the skript's "Export" manage tab). */
export function ExportSkriptPanel({ skriptId }: ExportSkriptPanelProps) {
  const { data: session } = useSession()
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [includeVideos, setIncludeVideos] = useState(false)

  const directoryPickerSupported = typeof window !== 'undefined' && !!window.showDirectoryPicker
  const busy = progress !== null && progress.stage !== 'done'

  async function run(fn: (id: string, onProgress: (p: ExportProgress) => void, exportedBy: { userId: string; name: string | null } | null, includeVideos: boolean) => Promise<{ errors: string[] }>) {
    setErrors([])
    setFailure(null)
    setProgress({ stage: 'fetching', current: 0, total: 1 })
    const exportedBy = session?.user?.id ? { userId: session.user.id, name: session.user.name ?? null } : null
    try {
      const result = await fn(skriptId, setProgress, exportedBy, includeVideos)
      setErrors(result.errors)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Export failed')
      setProgress(null)
    }
  }

  function reset() {
    setProgress(null)
    setErrors([])
    setFailure(null)
  }

  return (
    // Full-width text, centered; only the button grid keeps the former
    // dialog width (max-w-md).
    <div className="space-y-3 p-3 text-center">
        <p className="text-sm text-muted-foreground">
          Pages as markdown and attachments are downloaded and packed directly in your browser —
          the server isn&rsquo;t involved.
        </p>

        {!busy && progress?.stage !== 'done' && (
          <div className="space-y-3">
            <label className="flex items-center justify-center gap-2 text-sm">
              <Checkbox checked={includeVideos} onCheckedChange={v => setIncludeVideos(v === true)} />
              Also export videos (takes a while)
            </label>
            <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                disabled={!directoryPickerSupported}
                onClick={() => run(exportSkriptToDirectory)}
              >
                <Folder className="h-6 w-6" />
                Choose folder
              </Button>
              <Button
                variant="outline"
                className="h-auto flex-col gap-2 py-4"
                onClick={() => run(exportSkriptAsZip)}
              >
                <FileArchive className="h-6 w-6" />
                As zip
              </Button>
            </div>
            {!directoryPickerSupported && (
              <p className="text-xs text-muted-foreground text-center">
                Folder export is only supported in Chrome-based browsers.
              </p>
            )}
          </div>
        )}

        {busy && progress && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              {/* Fixed 3-line box: a file name wrapping or not would otherwise change the dialog height per file. */}
              <span className="min-w-0 h-[3lh] line-clamp-3 break-words">
                {STAGE_LABELS[progress.stage]}
                {progress.label ? ` — ${progress.label}` : ''}
              </span>
            </div>
            {progress.total > 1 && (
              <Progress value={(progress.current / progress.total) * 100} />
            )}
          </div>
        )}

        {progress?.stage === 'done' && (
          <div className="space-y-2 text-sm">
            <p>Export complete.</p>
            {errors.length > 0 && (
              <div className="text-destructive">
                <p>{errors.length} file(s) could not be exported:</p>
                <ul className="list-disc pl-4">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {failure && <p className="text-sm text-destructive">{failure}</p>}

        {(progress?.stage === 'done' || failure) && (
          <Button variant="outline" size="sm" onClick={reset}>Export again</Button>
        )}
    </div>
  )
}

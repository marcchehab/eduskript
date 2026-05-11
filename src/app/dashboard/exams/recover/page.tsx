/**
 * Exam Backup Recovery Page
 *
 * Teachers drop a student's encrypted .examfile here when hand-in failed
 * (e.g. network was down during the live exam). The server decrypts with
 * the teacher's stored private key and writes the same DB rows a live
 * hand-in would have written.
 *
 * Also shows the teacher's current active encryption key and a Rotate
 * button. Rotation creates a new key for future exams; old .examfile
 * backups stay decryptable because the old key row remains.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface ActiveKeyInfo {
  keyId: string
  createdAt: string
}

interface RecoveryResult {
  success: true
  submissionId: string
  submittedAt: string
  alreadyExisted: boolean
  checkpointsInserted: number
  pageTitle: string
}

export default function ExamRecoverPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [activeKey, setActiveKey] = useState<ActiveKeyInfo | null>(null)
  const [isLoadingKey, setIsLoadingKey] = useState(true)
  const [isRotating, setIsRotating] = useState(false)
  const [rotateConfirm, setRotateConfirm] = useState(false)

  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<RecoveryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.id) {
      router.replace('/auth/signin?callbackUrl=/dashboard/exams/recover')
      return
    }
    void fetch('/api/exams/keys/rotate', { method: 'GET' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: ActiveKeyInfo) => setActiveKey(data))
      .catch((err) => {
        console.error('Failed to load active exam key:', err)
        setError('Could not load your current encryption key.')
      })
      .finally(() => setIsLoadingKey(false))
  }, [session, status, router])

  async function handleRotate() {
    setIsRotating(true)
    setError(null)
    try {
      const res = await fetch('/api/exams/keys/rotate', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to rotate key')
      }
      const data = (await res.json()) as ActiveKeyInfo
      setActiveKey(data)
      setRotateConfirm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key')
    } finally {
      setIsRotating(false)
    }
  }

  async function handleFile(file: File) {
    setIsUploading(true)
    setError(null)
    setResult(null)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('File is not valid JSON. Is this an .examfile backup?')
      }
      const res = await fetch('/api/exams/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Recovery failed (HTTP ${res.status})`)
      }
      setResult((await res.json()) as RecoveryResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed')
    } finally {
      setIsUploading(false)
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6" />
          Recover offline exam backups
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          If a student&apos;s hand-in failed (e.g. the network was down), they
          can save an encrypted <code>.examfile</code> from the exam page.
          Upload it here to recover their work.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-3 text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload a backup file
          </CardTitle>
          <CardDescription>
            Drop the student&apos;s <code>.examfile</code> here, or click to
            browse. The file is encrypted; only your key can read it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted/40'
            }`}
          >
            {isUploading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Decrypting and recovering…</span>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drag and drop a <code>.examfile</code> here, or click to pick
                  one.
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".examfile,application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
                e.target.value = ''
              }}
            />
          </div>

          {result && (
            <div className="mt-4 rounded-md border border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400 p-3 text-sm flex gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">
                  Recovered submission for &ldquo;{result.pageTitle}&rdquo;
                </p>
                <p className="text-xs mt-1">
                  {result.alreadyExisted
                    ? 'Submission already existed; added recovery checkpoints.'
                    : 'Created a new submission.'}
                  {' '}
                  Inserted {result.checkpointsInserted} checkpoint
                  {result.checkpointsInserted === 1 ? '' : 's'}.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Encryption key
          </CardTitle>
          <CardDescription>
            Students use the public half of this keypair to encrypt their
            offline backups. Rotating creates a new key for future exams. Old
            backup files are still recoverable because we keep all previous
            keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingKey ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : activeKey ? (
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Active key id:</span>{' '}
                <code className="font-mono">{activeKey.keyId}</code>
              </p>
              <p>
                <span className="text-muted-foreground">Created:</span>{' '}
                {new Date(activeKey.createdAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active key. One will be generated automatically on your next
              exam page render, or you can rotate now to create one.
            </p>
          )}

          {!rotateConfirm ? (
            <Button
              variant="outline"
              onClick={() => setRotateConfirm(true)}
              disabled={isRotating}
              className="gap-2"
            >
              <RefreshCcw className="w-4 h-4" />
              Rotate key
            </Button>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
              <p>
                Rotating creates a new keypair. Future exam pages will use it.
                Existing <code>.examfile</code> backups stay decryptable as
                long as you keep the old key (which we do automatically — no
                action needed).
              </p>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleRotate}
                  disabled={isRotating}
                  className="gap-2"
                >
                  {isRotating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="w-4 h-4" />
                  )}
                  Confirm rotation
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRotateConfirm(false)}
                  disabled={isRotating}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

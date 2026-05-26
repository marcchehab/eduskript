/**
 * Hand In Button + Save Backup Button
 *
 * Renders two adjacent buttons during an exam:
 *   1. "Hand in & Quit" (destructive) — POSTs to /api/exams/[pageId]/hand-in,
 *      then navigates to /api/exams/end-session which clears the cookie and
 *      hands SEB its quit URL.
 *   2. "Save backup" (outline) — gathers the same snapshots, encrypts them
 *      with the teacher's RSA-OAEP public key, and triggers a browser
 *      download. Used as a defensive measure (pre-emptive save) and as the
 *      fallback path when hand-in fails (network down, server error). The
 *      .examfile is unreadable by the student — only the teacher's recovery
 *      endpoint can decrypt it with the matching private key.
 *
 * If publicKeyJwk / keyId are not provided, the "Save backup" affordances
 * are hidden — older render paths that don't yet plumb the key still get
 * a functioning Hand-in button.
 */

'use client'

import { useState } from 'react'
import { LogOut, Loader2, Download, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { userDataService, syncEngine } from '@/lib/userdata'
import { clearPageAnnotations } from '@/lib/indexeddb/annotations'
import {
  encryptSnapshotsForBackup,
  triggerBackupDownload,
  suggestBackupFilename,
  type BackupMeta,
  type BackupSnapshot,
} from '@/lib/exam-backup'

/**
 * After a confirmed hand-in, drop this exam's LOCAL copy so it no longer
 * survives the SEB session into a re-sit. The server is then the single source
 * of truth: on the next load `initialSync` re-hydrates whatever the server
 * holds, so the teacher decides server-side whether a re-sitting student
 * resumes their answers or starts fresh.
 *
 * Safety: only wipe what is confirmed remote. We flush pending saves and push
 * the sync queue first; if cloud sync is gated (free plan → 402), the server
 * has nothing, so we keep local untouched. Best-effort throughout — a wipe
 * failure must never block the student leaving the exam.
 */
async function wipeLocalExamData(pageId: string): Promise<void> {
  try {
    await userDataService.flush()
    await syncEngine.sync()
    if (syncEngine.isCloudGated()) return // free plan: local is the only copy
    await userDataService.deleteAllForPage(pageId)
    await clearPageAnnotations(pageId)
  } catch (error) {
    console.error('[HandInButton] local wipe after hand-in failed:', error)
  }
}

/**
 * Gather snapshots of every on-page code editor's IndexedDB state. The
 * hand-in route stores these atomically with the ExamSubmission as
 * `kind='handin'` checkpoints — that's the only durable copy of the
 * student's actual code, since the editor's main data is otherwise just
 * the live-synced userData record (which gets overwritten by future edits).
 */
async function gatherEditorSnapshots(pageId: string): Promise<BackupSnapshot[]> {
  try {
    await userDataService.flush()
    const componentIds = await userDataService.getComponentsForPage(pageId)
    const editorIds = componentIds.filter((c) => c.startsWith('code-editor-'))
    const snapshots: BackupSnapshot[] = []
    for (const componentId of editorIds) {
      const record = await userDataService.get(pageId, componentId)
      if (record) snapshots.push({ componentId, payload: record.data })
    }
    return snapshots
  } catch (error) {
    console.error('[HandInButton] failed to gather snapshots:', error)
    return []
  }
}

/**
 * Gather EVERY component's IndexedDB state for the page — quiz answers
 * (quiz-*) AND code editors (code-editor-*) — for the offline backup. Unlike
 * gatherEditorSnapshots (code only, for the hand-in POST), the backup must be
 * complete: it's the single offline copy, so a recovery can rebuild the whole
 * attempt. On recovery, quiz-* snapshots are written back to live userData so
 * they grade exactly like a synced answer (see exam-recovery.applyHandinSnapshots).
 */
async function gatherAllSnapshots(pageId: string): Promise<BackupSnapshot[]> {
  try {
    await userDataService.flush()
    const componentIds = await userDataService.getComponentsForPage(pageId)
    const snapshots: BackupSnapshot[] = []
    for (const componentId of componentIds) {
      const record = await userDataService.get(pageId, componentId)
      if (record) snapshots.push({ componentId, payload: record.data })
    }
    return snapshots
  } catch (error) {
    console.error('[HandInButton] failed to gather full snapshots:', error)
    return []
  }
}

async function saveEncryptedBackup(args: {
  pageId: string
  studentId: string
  skriptId: string
  publicKeyJwk: JsonWebKey
  keyId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const snapshots = await gatherAllSnapshots(args.pageId)
    const meta: BackupMeta = {
      pageId: args.pageId,
      studentId: args.studentId,
      skriptId: args.skriptId,
      createdAt: new Date().toISOString(),
    }
    const file = await encryptSnapshotsForBackup(
      snapshots,
      args.publicKeyJwk,
      args.keyId,
      meta,
    )
    triggerBackupDownload(file, suggestBackupFilename(meta))
    return { ok: true }
  } catch (err) {
    console.error('[HandInButton] backup encryption failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Backup save failed',
    }
  }
}

interface HandInButtonProps {
  pageId: string
  /** Optional. When provided, "Save backup" affordance is enabled. */
  publicKeyJwk?: JsonWebKey
  /** Optional. Required alongside publicKeyJwk. Embedded in the .examfile. */
  keyId?: string
  /** Optional. The current student's user id — needed for backup meta. */
  studentId?: string
  /** Optional. The skript id — needed for backup meta. */
  skriptId?: string
}

export function HandInButton({
  pageId,
  publicKeyJwk,
  keyId,
  studentId,
  skriptId,
}: HandInButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSavingBackup, setIsSavingBackup] = useState(false)
  const [backupHint, setBackupHint] = useState<string | null>(null)

  const backupReady =
    !!publicKeyJwk && !!keyId && !!studentId && !!skriptId

  const handleSaveBackup = async () => {
    if (!backupReady) return
    setIsSavingBackup(true)
    setBackupHint(null)
    const result = await saveEncryptedBackup({
      pageId,
      studentId: studentId!,
      skriptId: skriptId!,
      publicKeyJwk: publicKeyJwk!,
      keyId: keyId!,
    })
    setIsSavingBackup(false)
    setBackupHint(
      result.ok
        ? 'Backup file downloaded. Keep it safe and give it to your teacher only if needed.'
        : `Backup save failed: ${result.error}`,
    )
  }

  const handleHandIn = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Gather every code editor's current state from IndexedDB and POST
      // alongside the submission. The server stores these as 'handin'
      // checkpoints atomically with the ExamSubmission record.
      const snapshots = await gatherEditorSnapshots(pageId)

      const response = await fetch(`/api/exams/${pageId}/hand-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to submit exam')
      }

      // Auto-save an encrypted local backup of the COMPLETE attempt (quiz +
      // code) before we wipe local data. Defence-in-depth: if the server copy
      // is ever lost or disputed, the teacher can recover from this file. Must
      // run before wipeLocalExamData (which clears the IndexedDB it reads).
      // Best-effort — a backup failure never blocks completing the hand-in.
      if (backupReady) {
        await saveEncryptedBackup({
          pageId,
          studentId: studentId!,
          skriptId: skriptId!,
          publicKeyJwk: publicKeyJwk!,
          keyId: keyId!,
        }).catch((e) => console.error('[HandInButton] auto-backup failed:', e))
      }

      // Hand-in is recorded server-side — now drop the local copy so it can't
      // leak into a re-sit. Best-effort; never blocks the redirect below.
      await wipeLocalExamData(pageId)

      // Navigate to end-session which clears cookie and redirects
      // SEB will then navigate to quitURL, ending the session
      window.location.href = '/api/exams/end-session'
    } catch (err) {
      console.error('Error handing in exam:', err)
      setError(err instanceof Error ? err.message : 'Failed to submit exam')
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="destructive"
          size="sm"
          className="gap-2"
          disabled={isSubmitting}
          onClick={() => setIsOpen(true)}
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LogOut className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">Hand in & Quit</span>
          <span className="sm:hidden">Quit</span>
        </Button>

        {backupReady && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isSavingBackup || isSubmitting}
            onClick={handleSaveBackup}
            title="Save an encrypted local backup of your answers. Only your teacher can read it."
          >
            {isSavingBackup ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Save backup</span>
          </Button>
        )}
      </div>

      {backupHint && (
        <p className="hidden sm:block text-xs text-muted-foreground mt-1 max-w-xs">
          {backupHint}
        </p>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hand in your exam?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Are you sure you want to hand in your exam and quit?
              </span>
              <span className="block font-medium text-destructive">
                You will not be able to return after submitting.
              </span>
              {error && (
                <span className="block text-destructive text-sm mt-2">
                  Error: {error}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {error && backupReady && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-2">
                Hand-in failed. Save an encrypted backup file, then give it to
                your teacher — they can recover your answers from it.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
                onClick={handleSaveBackup}
                disabled={isSavingBackup}
              >
                {isSavingBackup ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Download answers
              </Button>
              {backupHint && (
                <p className="text-xs text-muted-foreground mt-2">{backupHint}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleHandIn}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Yes, hand in and quit'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

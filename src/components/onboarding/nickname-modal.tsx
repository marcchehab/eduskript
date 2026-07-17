/**
 * Welcome modal shown to students once after first signin.
 *
 * Pre-fills the auto-derived "Adjective Philosopher xxxx" nickname written
 * at signup. The student can accept it (Keep this) or edit and Save.
 *
 * Trigger: parent renders this only when:
 *  - session present AND accountType === 'student'
 *  - URL has `?welcome=1`
 *  - localStorage flag `eduskript:nickname-prompt-seen` is absent
 *
 * On either button click, the flag is set and the modal closes. The parent
 * also strips `?welcome=1` from the URL so a reload doesn't re-trigger.
 */
'use client'

import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const NICKNAME_PROMPT_FLAG = 'eduskript:nickname-prompt-seen'

interface NicknameModalProps {
  /** The current nickname pre-filled into the input (the auto-derived default). */
  initialName: string
  /** Called after either Keep this or a successful Save. */
  onDismiss: () => void
}

export function NicknameModal({ initialName, onDismiss }: NicknameModalProps) {
  const [value, setValue] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const trimmed = value.trim()
  const canSave = trimmed.length >= 3 && trimmed.length <= 32 && trimmed !== initialName

  const keep = () => {
    try { window.localStorage.setItem(NICKNAME_PROMPT_FLAG, '1') } catch { /* ignore */ }
    onDismiss()
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error ?? 'Failed to save nickname')
        return
      }
      try { window.localStorage.setItem(NICKNAME_PROMPT_FLAG, '1') } catch { /* ignore */ }
      onDismiss()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) keep() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose your nickname</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            This is what teachers and classmates will see. We picked{' '}
            <strong className="text-foreground">{initialName}</strong> for you — a friendly random name
            based on a one-way hash of your email. Your real email is not stored in our database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            maxLength={32}
            disabled={saving}
            aria-label="Nickname"
            autoFocus
          />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>
              <strong>Heads up:</strong> whatever you type here is stored in plain text and visible
              to your teacher.
            </span>
          </p>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={keep} disabled={saving}>
            Keep this
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

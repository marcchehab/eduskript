'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { parseGeogebraUrl } from '@/lib/geogebra'

interface GeogebraDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the resolved material id when the user confirms. */
  onInsert: (materialId: string) => void
}

/**
 * Prompts for a GeoGebra share URL (or bare material id), parses it locally
 * with `parseGeogebraUrl`, and inserts a `<geogebra>` tag. Purely client-side —
 * no network (unlike the plugin picker). Mirrors that picker's Dialog/Input.
 */
export function GeogebraDialog({ open, onOpenChange, onInsert }: GeogebraDialogProps) {
  const [value, setValue] = useState('')
  const materialId = useMemo(() => parseGeogebraUrl(value), [value])

  // Clear the field on close so it's empty the next time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (!next) setValue('')
    onOpenChange(next)
  }

  const submit = () => {
    if (!materialId) return
    onInsert(materialId)
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert GeoGebra applet</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste a GeoGebra share link (e.g. <code>geogebra.org/m/…</code>), an embed snippet, or a material id.
          </p>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && materialId) submit() }}
            placeholder="https://www.geogebra.org/m/dNPHaqgb"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {value.trim()
                ? materialId
                  ? <>Material id: <code>{materialId}</code></>
                  : 'Not a recognizable GeoGebra link'
                : ''}
            </span>
            <Button size="sm" onClick={submit} disabled={!materialId}>Insert</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { Check, X, AlertCircle, Info } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type AlertType = 'success' | 'error' | 'warning' | 'info'

interface AlertDialogModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: AlertType
  title: string
  message: string
  onConfirm?: () => void
  confirmText?: string
  showCancel?: boolean
  cancelText?: string
}

export function AlertDialogModal({
  open,
  onOpenChange,
  type = 'info',
  title,
  message,
  onConfirm,
  confirmText = 'OK',
  showCancel = false,
  cancelText = 'Cancel',
}: AlertDialogModalProps) {
  const handleConfirm = () => {
    onConfirm?.()
    onOpenChange(false)
  }

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <Check className="w-5 h-5 text-green-600" />
      case 'error':
        return <X className="w-5 h-5 text-red-600" />
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-orange-500" />
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-500" />
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {title}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">{message}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          {showCancel && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {cancelText}
            </Button>
          )}
          <Button onClick={handleConfirm}>{confirmText}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

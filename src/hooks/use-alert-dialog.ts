import { useState } from 'react'
import type { AlertType } from '@/components/ui/alert-dialog-modal'

interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  /** Red confirm button + warning icon. Use for deletes / irreversible actions. */
  destructive?: boolean
}

/**
 * Local state for one <AlertDialogModal>. Spread the returned state onto the
 * modal and call the show helpers from handlers — the styled replacement for
 * browser alert() / confirm().
 *
 *   const dialog = useAlertDialog()
 *   dialog.showError('Upload failed')
 *   dialog.showConfirm('Delete this page?', () => doDelete(), { destructive: true })
 *   // ...
 *   <AlertDialogModal open={dialog.open} onOpenChange={dialog.setOpen}
 *     type={dialog.type} title={dialog.title} message={dialog.message}
 *     onConfirm={dialog.onConfirm} showCancel={dialog.showCancel}
 *     confirmText={dialog.confirmText} cancelText={dialog.cancelText}
 *     destructive={dialog.destructive} />
 */
export function useAlertDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<AlertType>('info')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const [confirmText, setConfirmText] = useState('OK')
  const [cancelText, setCancelText] = useState('Cancel')
  const [destructive, setDestructive] = useState(false)
  const [onConfirm, setOnConfirm] = useState<(() => void) | undefined>(undefined)

  const showAlert = (
    alertType: AlertType,
    alertTitle: string,
    alertMessage: string
  ) => {
    setType(alertType)
    setTitle(alertTitle)
    setMessage(alertMessage)
    setShowCancel(false)
    setConfirmText('OK')
    setCancelText('Cancel')
    setDestructive(false)
    setOnConfirm(undefined)
    setOpen(true)
  }

  const showSuccess = (message: string, title = 'Success') => {
    showAlert('success', title, message)
  }

  const showError = (message: string, title = 'Error') => {
    showAlert('error', title, message)
  }

  const showWarning = (message: string, title = 'Warning') => {
    showAlert('warning', title, message)
  }

  const showInfo = (message: string, title = 'Information') => {
    showAlert('info', title, message)
  }

  /**
   * Confirm dialog. `handler` runs only when the user accepts (it may be
   * async — the dialog closes immediately and the action proceeds, same as
   * any handler-driven flow).
   */
  const showConfirm = (
    message: string,
    handler: () => void,
    options: ConfirmOptions = {}
  ) => {
    setType(options.destructive ? 'warning' : 'info')
    setTitle(options.title ?? 'Please confirm')
    setMessage(message)
    setShowCancel(true)
    setConfirmText(options.confirmText ?? (options.destructive ? 'Delete' : 'Confirm'))
    setCancelText(options.cancelText ?? 'Cancel')
    setDestructive(!!options.destructive)
    // Wrap in an arrow so the state setter stores the function rather than
    // treating it as a state-updater and calling it.
    setOnConfirm(() => handler)
    setOpen(true)
  }

  return {
    // State — spread onto <AlertDialogModal />
    open,
    setOpen,
    type,
    title,
    message,
    onConfirm,
    showCancel,
    confirmText,
    cancelText,
    destructive,
    // Actions
    showAlert,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showConfirm,
  }
}

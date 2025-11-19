import { useState } from 'react'
import type { AlertType } from '@/components/ui/alert-dialog-modal'

export function useAlertDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<AlertType>('info')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')

  const showAlert = (
    alertType: AlertType,
    alertTitle: string,
    alertMessage: string
  ) => {
    setType(alertType)
    setTitle(alertTitle)
    setMessage(alertMessage)
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

  return {
    // State
    open,
    type,
    title,
    message,
    setOpen,
    // Helper functions
    showAlert,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  }
}

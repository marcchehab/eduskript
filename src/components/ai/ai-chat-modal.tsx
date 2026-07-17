/**
 * AI Chat Modal Component
 *
 * STATUS: INACTIVE - This component is currently not used in the UI.
 * The AI Edit feature (ai-edit-modal.tsx) is the active AI integration.
 * Keeping this component for potential future use as a conversational AI assistant.
 */

'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAIChat } from '@/hooks/use-ai-chat'
import { AIChatMessages } from './ai-chat-messages'
import { AIChatInput } from './ai-chat-input'
import { Trash2, Sparkles } from 'lucide-react'

interface AIChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skriptId: string
  skriptTitle: string
  pageId?: string
  pageTitle?: string
}

export function AIChatModal({
  open,
  onOpenChange,
  skriptId,
  skriptTitle,
  pageId,
  pageTitle,
}: AIChatModalProps) {
  const { messages, isStreaming, error, sendMessage, clearMessages } = useAIChat({
    skriptId,
    pageId,
  })

  const contextLabel = pageTitle ? `${skriptTitle} > ${pageTitle}` : skriptTitle

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <DialogTitle>AI Assistant</DialogTitle>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearMessages}
                disabled={isStreaming}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Working on: {contextLabel}</p>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <AIChatMessages
            messages={messages}
            isStreaming={isStreaming}
            error={error}
          />

          <AIChatInput
            onSend={sendMessage}
            disabled={isStreaming}
            placeholder={
              pageTitle
                ? `Ask about "${pageTitle}"...`
                : `Ask about this skript...`
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

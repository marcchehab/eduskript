'use client'

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/ai/types'
import { User, Bot, AlertCircle } from 'lucide-react'

interface AIChatMessagesProps {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
}

export function AIChatMessages({ messages, isStreaming, error }: AIChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Ask me anything about your content.</p>
          <p className="text-sm mt-2">
            I can help with writing, editing, and improving your educational materials.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 p-4">
      {messages.map((message, index) => (
        <div
          key={index}
          className={cn(
            'flex gap-3',
            message.role === 'user' ? 'justify-end' : 'justify-start'
          )}
        >
          {message.role === 'assistant' && (
            <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
          )}

          <div
            className={cn(
              'max-w-[80%] rounded-lg px-4 py-2',
              message.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            )}
          >
            {message.role === 'assistant' ? (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-headings:font-semibold prose-h2:text-base prose-h3:text-sm prose-h4:text-sm prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-800 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-base font-bold mt-3 mb-2">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="ml-2">{children}</li>
                    ),
                    p: ({ children }) => (
                      <p className="my-1.5">{children}</p>
                    ),
                    code: ({ className, children, ...props }) => {
                      const isInline = !className
                      return isInline ? (
                        <code className="bg-zinc-200 dark:bg-zinc-700 px-1 py-0.5 rounded text-xs" {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className={cn('block overflow-x-auto', className)} {...props}>
                          {children}
                        </code>
                      )
                    },
                    pre: ({ children }) => (
                      <pre className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-md overflow-x-auto text-xs my-2">
                        {children}
                      </pre>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold">{children}</strong>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                {isStreaming &&
                  index === messages.length - 1 &&
                  message.content && (
                    <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                  )}
              </div>
            ) : (
              <div className="whitespace-pre-wrap wrap-break-word">{message.content}</div>
            )}
          </div>

          {message.role === 'user' && (
            <div className="shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <User className="h-4 w-4 text-primary-foreground" />
            </div>
          )}
        </div>
      ))}

      {error && (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-lg px-4 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

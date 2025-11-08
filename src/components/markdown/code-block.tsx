'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  children: string
  className?: string
  language?: string
  highlighted?: string // Shiki pre-rendered HTML
  onLanguageChange?: (newLanguage: string) => void
}

export function CodeBlock({ children, className, language: propLanguage, highlighted, onLanguageChange }: CodeBlockProps) {
  // Extract language from className (e.g., "language-javascript")
  const languageFromClass = className?.replace('language-', '') || 'text'
  const initialLanguage = propLanguage || languageFromClass

  const [language, setLanguage] = useState(initialLanguage)
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Available languages
  const languages = [
    'javascript', 'typescript', 'python', 'java', 'cpp', 'c',
    'rust', 'go', 'php', 'ruby', 'swift', 'kotlin',
    'html', 'css', 'json', 'yaml', 'markdown', 'sql',
    'bash', 'shell', 'text'
  ].sort()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group my-4 overflow-auto">
      {/* Control bar */}
      <div className="absolute top-0 right-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/50 border border-border rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {/* Language selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors rounded bg-background/50 hover:bg-background"
          >
            {language}
            <ChevronDown className="w-3 h-3" />
          </button>

          {isOpen && (
            <div className="absolute top-full left-0 mt-1 w-36 max-h-48 overflow-y-auto bg-popover border border-border rounded-md shadow-lg z-20">
              {languages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    setLanguage(lang)
                    setIsOpen(false)
                    onLanguageChange?.(lang)
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors ${
                    language === lang ? 'bg-accent text-accent-foreground' : 'text-foreground'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Code content */}
      {highlighted ? (
        <div
          dangerouslySetInnerHTML={{ __html: highlighted }}
          className="rounded-md overflow-x-auto [&_pre]:!mt-0 [&_pre]:!rounded-md"
        />
      ) : (
        <pre className="rounded-md bg-muted p-4 overflow-x-auto">
          <code className={`language-${language} text-sm`}>{children}</code>
        </pre>
      )}
    </div>
  )
}

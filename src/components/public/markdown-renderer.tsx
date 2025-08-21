'use client'

import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { useEffect, useState } from 'react'

interface MarkdownRendererProps {
  content: string
  domain?: string
  skriptId?: string
}

export function MarkdownRenderer({ content, domain, skriptId }: MarkdownRendererProps) {
  const [html, setHtml] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const processMarkdown = async () => {
      try {
        const result = await remark()
          .use(remarkGfm)
          .use(remarkMath)
          .use(remarkRehype)
          .use(rehypeKatex)
          .use(rehypeHighlight)
          .use(rehypeStringify)
          .process(content)

        setHtml(String(result))
      } catch (error) {
        console.error('Error processing markdown:', error)
        setHtml(`<p>Error rendering content</p>`)
      } finally {
        setIsLoading(false)
      }
    }

    processMarkdown()
  }, [content, domain, skriptId])

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
      </div>
    )
  }

  return (
    <div 
      className="prose-theme"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

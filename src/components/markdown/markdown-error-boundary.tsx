'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time errors from compiled markdown (e.g. malformed
 * `style="..."` attributes that escape `compileMarkdown`'s try/catch when
 * rehype-react defers element construction). Without this, a single bad
 * markdown attribute can take down the dev server via unhandledRejection.
 */
export class MarkdownErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Markdown render error:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="text-destructive p-4 border border-destructive rounded-md">
          <p className="font-semibold">Markdown Rendering Error</p>
          <p className="text-sm mt-2">{this.state.error.message || String(this.state.error)}</p>
        </div>
      )
    }
    return this.props.children
  }
}

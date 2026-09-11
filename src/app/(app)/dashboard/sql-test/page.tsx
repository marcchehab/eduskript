'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import CodeEditor with no SSR to avoid sql.js issues
const CodeEditor = dynamic(
  () => import('@/components/public/code-editor').then(mod => ({ default: mod.CodeEditor })),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full">Loading SQL Editor...</div> }
)

export default function SqlTestPage() {
  const defaultSqlQuery = `-- Find the longest movies in the Netflix database
SELECT
  title,
  runtime,
  strftime('%Y', release_date) as year
FROM movie
WHERE runtime > 120
ORDER BY runtime DESC
LIMIT 15;`

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">SQL Editor Test</h1>
        <p className="text-muted-foreground mb-6">
          Test the interactive SQL editor with the Netflix database
        </p>

        <div className="h-[600px] border rounded-lg overflow-hidden">
          <CodeEditor
            id="sql-test"
            language="sql"
            initialCode={defaultSqlQuery}
            db="netflix.db"
            showCanvas={true}
          />
        </div>

        <div className="mt-6 space-y-4">
          <h2 className="text-xl font-semibold">Sample Queries</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">List tables</h3>
              <code className="text-sm bg-muted p-2 block rounded">
                SELECT name FROM sqlite_master WHERE type=&apos;table&apos;;
              </code>
            </div>
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">Movies by release year</h3>
              <code className="text-sm bg-muted p-2 block rounded">
                SELECT strftime(&apos;%Y&apos;, release_date) as year, COUNT(*) as count FROM movie WHERE release_date IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 10;
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { CodeEditor } from '@/components/public/code-editor'

export default function SqlTestPage() {
  const defaultSqlQuery = `-- Query the Netflix database
SELECT title, release_year, type
FROM movie
WHERE release_year > 2020
ORDER BY release_year DESC
LIMIT 10;`

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
            sqlDatabase="/sql/netflixdb.sqlite"
            showCanvas={false}
          />
        </div>

        <div className="mt-6 space-y-4">
          <h2 className="text-xl font-semibold">Sample Queries</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">List tables</h3>
              <code className="text-sm bg-muted p-2 block rounded">
                SELECT name FROM sqlite_master WHERE type='table';
              </code>
            </div>
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">Count movies by year</h3>
              <code className="text-sm bg-muted p-2 block rounded">
                SELECT release_year, COUNT(*) as count FROM movie GROUP BY release_year ORDER BY release_year DESC LIMIT 10;
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

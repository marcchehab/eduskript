'use client'

/**
 * Where visitors and new teachers come from (src/lib/visit-source.ts).
 * Visits are anonymous daily counters; signups show the first-touch source
 * the browser attached to the account, if it had one.
 */

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Megaphone } from 'lucide-react'

interface VisitSourcesResponse {
  days: number
  visits: Array<{ kind: string; label: string; count: number }>
  signups: Array<{
    email: string | null
    name: string | null
    createdAt: string
    signupSource: { ref?: string; utm?: string; referrer?: string } | null
  }>
}

const RANGES = [7, 30, 90]

export function VisitSourcesCard() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<VisitSourcesResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/visit-sources?days=${days}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load visit sources')
        return res.json()
      })
      .then(json => {
        if (!cancelled) {
          setData(json)
          setError('')
        }
      })
      .catch(err => !cancelled && setError(err instanceof Error ? err.message : 'An error occurred'))
    return () => {
      cancelled = true
    }
  }, [days])

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Visit sources</h2>
        <div className="ml-auto flex gap-1">
          {RANGES.map(d => (
            <Button key={d} size="sm" variant={d === days ? 'default' : 'outline'} onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-sm mb-2">Visits (anonymous counts)</h3>
            {data.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No visits with a source yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.visits.map(v => (
                    <tr key={`${v.kind}:${v.label}`} className="border-b last:border-0">
                      <td className="py-1 pr-2 text-muted-foreground">{v.kind}</td>
                      <td className="py-1 pr-2 font-mono text-xs break-all">{v.label}</td>
                      <td className="py-1 text-right tabular-nums">{v.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h3 className="font-medium text-sm mb-2">Teacher signups</h3>
            {data.signups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No signups in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.signups.map(s => (
                    <tr key={`${s.email}-${s.createdAt}`} className="border-b last:border-0">
                      <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-1 pr-2 break-all">{s.name || s.email}</td>
                      <td className="py-1 font-mono text-xs break-all">
                        {s.signupSource
                          ? [s.signupSource.ref && `ref:${s.signupSource.ref}`, s.signupSource.utm && `utm:${s.signupSource.utm}`, s.signupSource.referrer]
                              .filter(Boolean)
                              .join(' · ')
                          : <span className="text-muted-foreground">–</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

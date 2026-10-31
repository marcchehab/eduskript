'use client'

/**
 * `<leaderboard source="class" value="score" limit="10" />`: a list fed by
 * plugins with share="…". Rendered client-side per viewer, since a page is
 * cached and the list depends on who is logged in. With collect="page" it also
 * sends the scores that components on the page report (reportScore) into the
 * list. A score from before the tag was added counts once the student redoes it.
 *
 * @see src/lib/plugin-share.ts
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Pencil, Trophy } from 'lucide-react'
import { useCurrentSite } from '@/contexts/current-site-context'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import {
  CLASS_LIST, PAGE_SCORE, PLUGIN_SHARE_UPDATED,
  type PageScore, type ShareEntry, type ShareResults,
} from '@/lib/plugin-share'

interface LeaderboardProps {
  source?: string
  value?: string
  limit?: string
  collect?: string
  pageId?: string
}

export function Leaderboard({ source = CLASS_LIST, value = 'score', limit = '10', collect, pageId }: LeaderboardProps) {
  const { status } = useSession()
  const { siteId } = useCurrentSite()
  const [results, setResults] = useState<ShareResults | null>(null)
  const [classId, setClassId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // studentId of the row being renamed; '' = the viewer's own nickname.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [nicknameError, setNicknameError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (status !== 'authenticated' || !siteId) return
    const params = new URLSearchParams({ siteId, source, value, limit })
    if (classId) params.set('classId', classId)
    try {
      const res = await fetch(`/api/plugin-share?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      setResults(await res.json())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [status, siteId, source, value, limit, classId])

  useEffect(() => { void load() }, [load])

  // Live: a full class checking at once sends a burst, so refetch once per second.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtimeEvents(['leaderboard-update'], (event) => {
    if ((event.siteId && event.siteId !== siteId) || (event.list && event.list !== source)) return
    if (refetchTimer.current) return
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null
      void load()
    }, 1000)
  }, { enabled: !!results?.member })
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current) }, [])

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const updated = (e as CustomEvent<{ source?: string }>).detail?.source
      if (!updated || updated === source) void load()
    }
    window.addEventListener(PLUGIN_SHARE_UPDATED, onUpdate)
    return () => window.removeEventListener(PLUGIN_SHARE_UPDATED, onUpdate)
  }, [load, source])

  useEffect(() => {
    if (collect !== 'page' || status !== 'authenticated' || !siteId || !pageId) return
    const onScore = (e: Event) => {
      const { componentId, earned } = (e as CustomEvent<PageScore>).detail
      fetch('/api/plugin-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, pageId, componentId, share: source, values: { score: earned } }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((result) => {
          if (result?.stored) window.dispatchEvent(new CustomEvent(PLUGIN_SHARE_UPDATED, { detail: { source } }))
        })
        .catch(() => {})
    }
    window.addEventListener(PAGE_SCORE, onScore)
    return () => window.removeEventListener(PAGE_SCORE, onScore)
  }, [collect, status, siteId, pageId, source])

  const saveNickname = async () => {
    if (editing === null || !siteId) return
    const res = editing
      ? await fetch('/api/plugin-share', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId, nickname: draft, studentId: editing }),
        })
      : await fetch('/api/user/nickname', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: draft }),
        })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setNicknameError(body?.error ?? 'The nickname could not be saved.')
    } else {
      setEditing(null)
      // No source: a nickname shows in every list on the page, also this one.
      window.dispatchEvent(new CustomEvent(PLUGIN_SHARE_UPDATED, { detail: {} }))
    }
  }

  const startEdit = (id: string, current: string) => {
    setEditing(id)
    setDraft(current)
    setNicknameError(null)
  }

  const note = (text: string) => <p className="my-3 text-sm text-muted-foreground">{text}</p>
  if (status === 'loading') return null
  if (status !== 'authenticated') return note('Log in to see this leaderboard.')
  if (failed) return note('The leaderboard could not be loaded.')
  if (!results) return null
  if (!results.member) return note('This leaderboard is visible to class members.')

  const row = (e: ShareEntry) => (
    <li key={e.studentId ?? `${e.rank}-${e.nickname}`} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${e.isSelf ? 'bg-primary/10 font-medium' : ''}`}>
      <span className="w-6 text-right tabular-nums text-muted-foreground">{e.rank}</span>
      <span className="min-w-0 flex-1 truncate">
        {e.nickname}
        {e.email && <span className="ml-2 font-normal text-muted-foreground">{e.email}</span>}
      </span>
      {e.studentId && (
        <button type="button" aria-label={`Rename ${e.nickname}`} title="Rename" onClick={() => startEdit(e.studentId!, e.nickname)} className="text-muted-foreground hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="tabular-nums">{e.value}</span>
    </li>
  )
  const selfOutside = results.self && !results.entries.some((e) => e.isSelf)

  return (
    <div className="my-4 max-w-md overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">
        <Trophy className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1">Leaderboard</span>
        {results.classes.length > 1 && (
          <select
            aria-label="Class"
            value={results.classId ?? ''}
            onChange={(e) => setClassId(e.target.value)}
            className="rounded border border-border bg-background px-1 py-0.5 text-xs font-normal"
          >
            {results.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      {results.entries.length === 0
        ? <p className="px-3 py-3 text-sm text-muted-foreground">No results yet.</p>
        : <ol className="m-0 list-none p-0">{results.entries.map(row)}</ol>}
      {selfOutside && <ol className="m-0 list-none border-t border-border p-0">{row(results.self!)}</ol>}
      {editing !== null ? (
        <form
          className="flex flex-wrap gap-2 border-t border-border px-3 py-2"
          onSubmit={(e) => { e.preventDefault(); void saveNickname() }}
        >
          <input
            autoFocus
            aria-label="Nickname"
            value={draft}
            maxLength={32}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded bg-primary px-2 py-1 text-sm text-primary-foreground">Save</button>
          <button type="button" onClick={() => setEditing(null)} className="px-1 text-sm text-muted-foreground">Cancel</button>
          {nicknameError && <p role="alert" className="m-0 w-full text-xs text-destructive">{nicknameError}</p>}
        </form>
      ) : results.nickname && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>Your nickname: {results.nickname}</span>
          <button type="button" onClick={() => startEdit('', results.nickname!)} className="underline">Change</button>
        </div>
      )}
    </div>
  )
}

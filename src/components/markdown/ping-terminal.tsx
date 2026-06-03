'use client'

import { useEffect, useRef, useState } from 'react'

// Interactive terminal where students type the ping command themselves
// (e.g. `ping wairualodge.co.nz` or `ping -c 6 8.8.8.8`). The measurement is a
// TCP connect from the server, not ICMP (see /api/tools/ping, which requires a
// logged-in user). RTT, resolved IP, loss % and min/avg/max are real;
// bytes/icmp_seq are cosmetic and TTL is omitted (a faked TTL would mislead).

export type OsStyle = 'linux' | 'macos' | 'windows'

export interface PingProbe {
  seq: number
  rttMs: number | null
  ok: boolean
}

export interface PingStats {
  sent: number
  recv: number
  lossPct: number
  min: number
  avg: number
  max: number
  mdev: number
}

export interface PingData {
  ok: true
  host: string
  ip: string
  port: number
  probes: PingProbe[]
  stats: PingStats
}

// History entries are structured (not pre-formatted) so the OS toggle can
// re-render every past result live without re-pinging.
type HistoryEntry =
  | { kind: 'cmd'; text: string }
  | { kind: 'result'; data: PingData }
  | { kind: 'text'; text: string }

interface PingTerminalProps {
  host?: string // optional: auto-run `ping <host>` once on first view (demo)
  count?: string
  os?: string
}

const r1 = (n: number) => n.toFixed(1)
const r3 = (n: number) => n.toFixed(3)
const MAX_COUNT = 8

function detectOs(): OsStyle {
  if (typeof navigator === 'undefined') return 'linux'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac OS X|Macintosh|iPhone|iPad/i.test(ua)) return 'macos'
  return 'linux'
}

// --- Command parsing (exported for tests) ------------------------------------

export type ParsedCommand =
  | { kind: 'ping'; host: string; count: number }
  | { kind: 'clear' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }

/** Parses a shell-ish line. Supports `ping [-c N] host` (flag in any order). */
export function parsePingCommand(input: string): ParsedCommand {
  const trimmed = input.trim()
  if (!trimmed) return { kind: 'empty' }
  const tokens = trimmed.split(/\s+/)
  const cmd = tokens[0].toLowerCase()
  if (cmd === 'clear') return { kind: 'clear' }
  if (cmd !== 'ping') return { kind: 'error', message: `${cmd}: command not found` }

  let host: string | undefined
  let count = 4
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-c' || t === '-n') {
      const n = Number(tokens[++i])
      if (!Number.isFinite(n) || n < 1) {
        return { kind: 'error', message: `ping: bad number of packets to transmit` }
      }
      count = Math.min(MAX_COUNT, Math.floor(n))
    } else if (t.startsWith('-')) {
      return { kind: 'error', message: `ping: unsupported option ${t}` }
    } else if (!host) {
      host = t
    }
  }
  if (!host) return { kind: 'error', message: 'usage: ping [-c count] host' }
  return { kind: 'ping', host, count }
}

// --- Pure per-OS formatters (exported for tests) -----------------------------

export function formatLinux(d: PingData): string {
  const lines = [`PING ${d.host} (${d.ip}) 56(84) bytes of data.`]
  for (const p of d.probes) {
    lines.push(
      p.ok && p.rttMs != null
        ? `64 bytes from ${d.ip}: icmp_seq=${p.seq + 1} time=${r1(p.rttMs)} ms`
        : `Request timeout for icmp_seq ${p.seq + 1}`,
    )
  }
  lines.push('', `--- ${d.host} ping statistics ---`)
  lines.push(
    `${d.stats.sent} packets transmitted, ${d.stats.recv} received, ${Math.round(d.stats.lossPct)}% packet loss`,
  )
  if (d.stats.recv) {
    lines.push(
      `rtt min/avg/max/mdev = ${r1(d.stats.min)}/${r1(d.stats.avg)}/${r1(d.stats.max)}/${r3(d.stats.mdev)} ms`,
    )
  }
  return lines.join('\n')
}

export function formatMacos(d: PingData): string {
  const lines = [`PING ${d.host} (${d.ip}): 56 data bytes`]
  for (const p of d.probes) {
    lines.push(
      p.ok && p.rttMs != null
        ? `64 bytes from ${d.ip}: icmp_seq=${p.seq} time=${r1(p.rttMs)} ms`
        : `Request timeout for icmp_seq ${p.seq}`,
    )
  }
  lines.push('', `--- ${d.host} ping statistics ---`)
  lines.push(
    `${d.stats.sent} packets transmitted, ${d.stats.recv} packets received, ${r1(d.stats.lossPct)}% packet loss`,
  )
  if (d.stats.recv) {
    lines.push(
      `round-trip min/avg/max/stddev = ${r1(d.stats.min)}/${r1(d.stats.avg)}/${r1(d.stats.max)}/${r3(d.stats.mdev)} ms`,
    )
  }
  return lines.join('\n')
}

export function formatWindows(d: PingData): string {
  const lines = [`Pinging ${d.host} [${d.ip}] with 32 bytes of data:`]
  for (const p of d.probes) {
    lines.push(
      p.ok && p.rttMs != null
        ? `Reply from ${d.ip}: bytes=32 time=${Math.max(1, Math.round(p.rttMs))}ms`
        : `Request timed out.`,
    )
  }
  const lost = d.stats.sent - d.stats.recv
  lines.push('', `Ping statistics for ${d.ip}:`)
  lines.push(
    `    Packets: Sent = ${d.stats.sent}, Received = ${d.stats.recv}, Lost = ${lost} (${Math.round(d.stats.lossPct)}% loss),`,
  )
  if (d.stats.recv) {
    lines.push('Approximate round trip times in milli-seconds:')
    lines.push(
      `    Minimum = ${Math.round(d.stats.min)}ms, Maximum = ${Math.round(d.stats.max)}ms, Average = ${Math.round(d.stats.avg)}ms`,
    )
  }
  return lines.join('\n')
}

export function formatPing(d: PingData, os: OsStyle): string {
  if (os === 'windows') return formatWindows(d)
  if (os === 'macos') return formatMacos(d)
  return formatLinux(d)
}

function renderEntry(e: HistoryEntry, os: OsStyle): string {
  if (e.kind === 'cmd') return `$ ${e.text}`
  if (e.kind === 'text') return e.text
  return formatPing(e.data, os)
}

const OS_LABELS: Array<{ key: OsStyle; label: string }> = [
  { key: 'linux', label: 'Linux' },
  { key: 'macos', label: 'macOS' },
  { key: 'windows', label: 'Windows' },
]

// -----------------------------------------------------------------------------

export function PingTerminal({ host, count, os }: PingTerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)

  // Up/down arrow recall of past commands.
  const cmdLog = useRef<string[]>([])
  const cmdIdx = useRef<number>(-1)

  const initialOs = os === 'macos' || os === 'windows' || os === 'linux' ? (os as OsStyle) : undefined
  const [activeOs, setActiveOs] = useState<OsStyle>(initialOs ?? 'linux')

  useEffect(() => {
    if (!initialOs) setActiveOs(detectOs())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lazy mount.
  useEffect(() => {
    if (visible) return
    const el = wrapperRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  // Keep scrolled to the bottom as output streams in.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, running])

  const runPing = async (host: string, count: number) => {
    setRunning(true)
    try {
      const res = await fetch('/api/tools/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, count }),
      })
      const json = await res.json().catch(() => ({}))
      if (json.ok) {
        setHistory((h) => [...h, { kind: 'result', data: json as PingData }])
      } else {
        setHistory((h) => [...h, { kind: 'text', text: errorLine(json, host) }])
      }
    } catch {
      setHistory((h) => [...h, { kind: 'text', text: `ping: ${host}: network error` }])
    } finally {
      setRunning(false)
    }
  }

  const submit = async () => {
    if (running) return
    const raw = input
    setInput('')
    const parsed = parsePingCommand(raw)
    if (parsed.kind === 'empty') return
    cmdLog.current.push(raw)
    cmdIdx.current = cmdLog.current.length

    if (parsed.kind === 'clear') {
      setHistory([])
      return
    }
    setHistory((h) => [...h, { kind: 'cmd', text: raw.trim() }])
    if (parsed.kind === 'error') {
      setHistory((h) => [...h, { kind: 'text', text: parsed.message }])
      return
    }
    await runPing(parsed.host, parsed.count)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (cmdLog.current.length === 0) return
      cmdIdx.current = Math.max(0, cmdIdx.current - 1)
      setInput(cmdLog.current[cmdIdx.current] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cmdIdx.current >= cmdLog.current.length - 1) {
        cmdIdx.current = cmdLog.current.length
        setInput('')
      } else {
        cmdIdx.current += 1
        setInput(cmdLog.current[cmdIdx.current] ?? '')
      }
    }
  }

  // Optional author demo: auto-run once on first view.
  useEffect(() => {
    if (!visible || !host) return
    const c = count ? Math.min(MAX_COUNT, Math.max(1, Number(count) || 4)) : 4
    setHistory((h) => [...h, { kind: 'cmd', text: `ping -c ${c} ${host}` }])
    void runPing(host, c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  return (
    <div ref={wrapperRef} className="my-4">
      <div
        className="relative overflow-hidden rounded-lg border border-gray-800 bg-gray-950"
        onClick={() => inputRef.current?.focus()}
      >
        {/* OS toggle, top-right */}
        <div className="absolute top-2 right-2 z-10 flex gap-0.5 rounded border border-border/40 bg-background/90 p-0.5 backdrop-blur">
          {OS_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(e) => {
                e.stopPropagation()
                setActiveOs(key)
              }}
              className={`rounded px-2 py-0.5 text-xs transition-colors hover:bg-accent ${
                activeOs === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              title={`${label} ping output`}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed text-green-400"
        >
          {history.map((e, i) => (
            <pre key={i} className="whitespace-pre-wrap break-words">
              {renderEntry(e, activeOs)}
            </pre>
          ))}
          {running && <pre className="whitespace-pre-wrap text-green-600">…</pre>}

          {/* Live prompt */}
          <div className="flex items-center">
            <span className="shrink-0 select-none text-green-500">$&nbsp;</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={running}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={history.length === 0 ? 'try: ping wairualodge.co.nz' : ''}
              className="flex-1 border-0 bg-transparent font-mono text-xs text-green-400 outline-none placeholder:text-green-900"
              aria-label="ping command"
            />
          </div>
        </div>
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">
        TCP connect from the server (ports 443/80) · RTT is real, not ICMP · login required
      </p>
    </div>
  )
}

function errorLine(json: { error?: string; retryAfter?: number }, host: string): string {
  switch (json.error) {
    case 'name-not-resolved':
      return `ping: cannot resolve ${host}: Unknown host`
    case 'blocked-host':
      return `ping: ${host} resolves to a blocked (private/internal) address`
    case 'rate-limited':
      return `ping: too many requests, try again in ${json.retryAfter ?? 60}s`
    case 'unauthorized':
      return `ping: permission denied (please log in)`
    case 'invalid-host':
      return `ping: invalid host`
    default:
      return `ping: failed`
  }
}

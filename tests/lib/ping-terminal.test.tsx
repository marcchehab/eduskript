import { describe, it, expect } from 'vitest'
import {
  formatLinux,
  formatMacos,
  formatWindows,
  parsePingCommand,
  type PingData,
} from '@/components/markdown/ping-terminal'

describe('parsePingCommand', () => {
  it('parses a bare ping host', () => {
    expect(parsePingCommand('ping example.com')).toEqual({ kind: 'ping', host: 'example.com', count: 4 })
  })
  it('parses -c count before the host', () => {
    expect(parsePingCommand('ping -c 6 8.8.8.8')).toEqual({ kind: 'ping', host: '8.8.8.8', count: 6 })
  })
  it('parses -c count after the host and clamps to 8', () => {
    expect(parsePingCommand('ping host -c 99')).toEqual({ kind: 'ping', host: 'host', count: 8 })
  })
  it('accepts the Windows -n flag too', () => {
    expect(parsePingCommand('ping -n 2 host')).toEqual({ kind: 'ping', host: 'host', count: 2 })
  })
  it('treats clear as its own command', () => {
    expect(parsePingCommand('clear')).toEqual({ kind: 'clear' })
  })
  it('returns empty for blank input', () => {
    expect(parsePingCommand('   ')).toEqual({ kind: 'empty' })
  })
  it('reports unknown commands', () => {
    expect(parsePingCommand('curl foo')).toEqual({ kind: 'error', message: 'curl: command not found' })
  })
  it('requires a host', () => {
    expect(parsePingCommand('ping')).toEqual({ kind: 'error', message: 'usage: ping [-c count] host' })
  })
  it('rejects unsupported options', () => {
    expect(parsePingCommand('ping -z host')).toEqual({ kind: 'error', message: 'ping: unsupported option -z' })
  })
  it('rejects a bad -c value', () => {
    expect(parsePingCommand('ping -c x host')).toEqual({
      kind: 'error',
      message: 'ping: bad number of packets to transmit',
    })
  })
})

const base: PingData = {
  ok: true,
  host: 'example.com',
  ip: '93.184.216.34',
  port: 443,
  probes: [
    { seq: 0, rttMs: 11.8, ok: true },
    { seq: 1, rttMs: 12.3, ok: true },
  ],
  stats: { sent: 2, recv: 2, lossPct: 0, min: 11.8, avg: 12.05, max: 12.3, mdev: 0.25 },
}

// One lost probe → 50% loss, recv 1.
const withLoss: PingData = {
  ...base,
  probes: [
    { seq: 0, rttMs: 11.8, ok: true },
    { seq: 1, rttMs: null, ok: false },
  ],
  stats: { sent: 2, recv: 1, lossPct: 50, min: 11.8, avg: 11.8, max: 11.8, mdev: 0 },
}

describe('formatLinux', () => {
  it('renders iputils header, seq starting at 1, and rtt/mdev stats', () => {
    const out = formatLinux(base)
    expect(out).toContain('PING example.com (93.184.216.34) 56(84) bytes of data.')
    expect(out).toContain('64 bytes from 93.184.216.34: icmp_seq=1 time=11.8 ms')
    expect(out).toContain('2 packets transmitted, 2 received, 0% packet loss')
    expect(out).toContain('rtt min/avg/max/mdev = 11.8/12.1/12.3/0.250 ms')
  })

  it('renders timeout lines and loss % when a probe fails', () => {
    const out = formatLinux(withLoss)
    expect(out).toContain('Request timeout for icmp_seq 2')
    expect(out).toContain('2 packets transmitted, 1 received, 50% packet loss')
  })
})

describe('formatMacos', () => {
  it('renders BSD header, seq starting at 0, and stddev stats', () => {
    const out = formatMacos(base)
    expect(out).toContain('PING example.com (93.184.216.34): 56 data bytes')
    expect(out).toContain('64 bytes from 93.184.216.34: icmp_seq=0 time=11.8 ms')
    expect(out).toContain('2 packets transmitted, 2 packets received, 0.0% packet loss')
    expect(out).toContain('round-trip min/avg/max/stddev = 11.8/12.1/12.3/0.250 ms')
  })
})

describe('formatWindows', () => {
  it('renders Windows reply lines and Sent/Received/Lost stats', () => {
    const out = formatWindows(base)
    expect(out).toContain('Pinging example.com [93.184.216.34] with 32 bytes of data:')
    expect(out).toContain('Reply from 93.184.216.34: bytes=32 time=12ms')
    expect(out).toContain('Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),')
    expect(out).toContain('Minimum = 12ms, Maximum = 12ms, Average = 12ms')
  })

  it('renders "Request timed out." and Lost count on failure', () => {
    const out = formatWindows(withLoss)
    expect(out).toContain('Request timed out.')
    expect(out).toContain('Lost = 1 (50% loss),')
  })

  it('clamps sub-ms RTT to 1ms (Windows never shows 0ms)', () => {
    const out = formatWindows({ ...base, probes: [{ seq: 0, rttMs: 0.4, ok: true }] })
    expect(out).toContain('time=1ms')
  })

  it('omits TTL entirely (honest mode — no faked TTL)', () => {
    expect(formatWindows(base)).not.toMatch(/TTL=/i)
    expect(formatLinux(base)).not.toMatch(/ttl=/i)
    expect(formatMacos(base)).not.toMatch(/ttl=/i)
  })
})

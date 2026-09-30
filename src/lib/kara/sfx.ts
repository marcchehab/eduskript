'use client'

/**
 * Subtle Kara sound effects, synthesized with Web Audio (no files, no
 * licences). Played by KaraPanel when the replay steps forward. Respects the
 * page-wide mute (src/lib/sound.ts). Levels are deliberately low.
 */

import { isMuted } from '@/lib/sound'
import { audio } from './voice'

export type KaraSfx = 'move' | 'turn' | 'bump' | 'door' | 'switch' | 'chip' | 'barrel' | 'log' | 'win' | 'fail' | 'acid'

const MASTER = 0.5

function tone(c: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, gain: number) {
  const o = c.createOscillator(); o.type = type
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.02)
}

function noise(c: AudioContext, out: AudioNode, t0: number, dur: number, gain: number, f0: number, f1: number, q = 1.5) {
  const len = Math.ceil(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource(); src.buffer = buf
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q
  bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp).connect(g).connect(out); src.start(t0)
}

export function playSfx(kind: KaraSfx) {
  if (isMuted()) return
  const c = audio()
  const out = c.createGain(); out.gain.value = MASTER; out.connect(c.destination)
  const t = c.currentTime + 0.01
  switch (kind) {
    case 'move': noise(c, out, t, 0.09, 0.05, 900, 500, 3); tone(c, out, 'triangle', 170, 130, t, 0.07, 0.03); break
    case 'turn': tone(c, out, 'sawtooth', 260, 420, t, 0.1, 0.015); noise(c, out, t, 0.1, 0.03, 1500, 2500, 4); break
    case 'bump': tone(c, out, 'sine', 110, 55, t, 0.18, 0.2); noise(c, out, t, 0.12, 0.08, 400, 150, 1); break
    case 'door': noise(c, out, t, 0.45, 0.06, 300, 1800, 2); tone(c, out, 'sine', 90, 70, t, 0.4, 0.04); break
    case 'switch': tone(c, out, 'square', 1400, 1200, t, 0.025, 0.03); tone(c, out, 'sine', 660, 660, t + 0.04, 0.12, 0.05); break
    case 'chip': tone(c, out, 'sine', 880, 880, t, 0.12, 0.06); tone(c, out, 'sine', 1320, 1320, t + 0.09, 0.2, 0.06); break
    case 'barrel': tone(c, out, 'triangle', 220, 160, t, 0.15, 0.08); noise(c, out, t, 0.08, 0.04, 600, 300, 2); break
    case 'log': for (let i = 0; i < 3; i++) tone(c, out, 'square', 1000 + i * 150, 1000 + i * 150, t + i * 0.07, 0.04, 0.02); break
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(c, out, 'triangle', f, f, t + i * 0.09, 0.25, 0.07)); break
    case 'fail': tone(c, out, 'triangle', 392, 370, t, 0.2, 0.06); tone(c, out, 'triangle', 311, 290, t + 0.18, 0.35, 0.06); break
    case 'acid': for (let i = 0; i < 5; i++) tone(c, out, 'sine', 300 + Math.random() * 400, 150, t + i * 0.06, 0.08, 0.04); break
  }
}

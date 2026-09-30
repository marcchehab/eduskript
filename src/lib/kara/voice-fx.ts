'use client'

/**
 * Client-side voice effects for Kara speakers (Web Audio), so generated lines
 * — pre-rendered or, later, dynamic — get their character in the browser, no
 * ffmpeg anywhere. Modelled on the ffmpeg chain from the trailer
 * (kara-trailer/fx.py): high/low-pass, bass shelf, frequency shift, chorus,
 * echo, volume. Tuned with the dev page /dashboard/voice-fx, which uses this
 * exact code.
 *
 * Frequency shift: Web Audio has none, so an AudioWorklet does single-sideband
 * shifting like ffmpeg's afreqshift: a 127-tap windowed Hilbert FIR gives the
 * analytic signal, then y = re·cos(ωt) − im·sin(ωt). O(127) per sample.
 * Chorus ≈ ffmpeg chorus (one voice: delay + sine LFO depth, decay = wet gain).
 * Echo ≈ ffmpeg aecho (one tap, no feedback).
 */

export interface VoiceFx {
  highpass: number // Hz, 0 = off
  lowpass: number // Hz, 0 = off
  bass: { gain: number; freq: number } // lowshelf dB / Hz, gain 0 = off
  shift: number // Hz, 0 = off
  chorus: { in: number; out: number; delay: number; decay: number; speed: number; depth: number } | null // ms / Hz / ms
  echo: { in: number; out: number; delay: number; decay: number } | null // ms
  volume: number
  /** playback speed, pitch preserved (1 = as generated) */
  rate: number
}

/** Speaker (upper-case) → effect. Tuned in /dashboard/voice-fx. */
export const VOICE_FX: Record<string, VoiceFx> = {
  AURORA: {
    highpass: 200,
    lowpass: 8000,
    bass: { gain: 0, freq: 120 },
    shift: 25,
    chorus: { in: 0.7, out: 0.9, delay: 18, decay: 0.3, speed: 0.3, depth: 2 },
    echo: { in: 0.8, out: 0.4, delay: 20, decay: 0.15 },
    volume: 1,
    rate: 1.15,
  },
}

const SHIFTER = `
class FreqShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'shift', defaultValue: 0 }] }
  constructor() {
    super()
    this.M = 63; this.N = 2 * this.M + 1
    this.h = new Float32Array(this.N)
    for (let i = 0; i < this.N; i++) {
      const n = i - this.M
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (this.N - 1))
      this.h[i] = n % 2 === 0 ? 0 : (2 / (Math.PI * n)) * w
    }
    this.buf = new Float32Array(this.N); this.pos = 0; this.phase = 0
  }
  process(inputs, outputs, params) {
    const input = inputs[0][0], output = outputs[0][0]
    if (!output) return true
    const shift = params.shift[0], dphi = (2 * Math.PI * shift) / sampleRate
    for (let s = 0; s < output.length; s++) {
      this.buf[this.pos] = input ? input[s] : 0
      let im = 0
      for (let k = 0; k < this.N; k++) im += this.h[k] * this.buf[(this.pos - k + this.N) % this.N]
      const re = this.buf[(this.pos - this.M + this.N) % this.N]
      output[s] = re * Math.cos(this.phase) - im * Math.sin(this.phase)
      this.phase = (this.phase + dphi) % (2 * Math.PI)
      this.pos = (this.pos + 1) % this.N
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output)
    return true
  }
}
registerProcessor('kara-freq-shifter', FreqShifter)
`

const workletLoaded = new WeakMap<BaseAudioContext, Promise<void>>()
function loadShifter(ctx: BaseAudioContext): Promise<void> {
  let p = workletLoaded.get(ctx)
  if (!p) {
    const url = URL.createObjectURL(new Blob([SHIFTER], { type: 'application/javascript' }))
    p = ctx.audioWorklet.addModule(url)
    workletLoaded.set(ctx, p)
  }
  return p
}

/**
 * Connect `source` → effect chain → `destination`. Returns a stop function
 * (ends LFOs). Mono in / mono out.
 */
export async function connectVoiceFx(ctx: BaseAudioContext, source: AudioNode, destination: AudioNode, fx: VoiceFx): Promise<() => void> {
  const stops: (() => void)[] = []
  let node: AudioNode = source
  const chain = (n: AudioNode) => { node.connect(n); node = n }

  if (fx.highpass > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = fx.highpass; chain(f) }
  if (fx.lowpass > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fx.lowpass; chain(f) }
  if (fx.bass.gain !== 0) { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = fx.bass.freq; f.gain.value = fx.bass.gain; chain(f) }
  if (fx.shift !== 0) {
    await loadShifter(ctx)
    const w = new AudioWorkletNode(ctx, 'kara-freq-shifter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    w.parameters.get('shift')!.value = fx.shift
    chain(w)
  }
  if (fx.chorus) {
    const c = fx.chorus
    const inG = ctx.createGain(); inG.gain.value = c.in
    const sum = ctx.createGain(); sum.gain.value = c.out
    const delay = ctx.createDelay(0.2); delay.delayTime.value = c.delay / 1000
    const lfo = ctx.createOscillator(); lfo.frequency.value = c.speed
    const depth = ctx.createGain(); depth.gain.value = c.depth / 1000
    const wet = ctx.createGain(); wet.gain.value = c.decay
    lfo.connect(depth).connect(delay.delayTime); lfo.start(); stops.push(() => lfo.stop())
    node.connect(inG)
    inG.connect(sum)
    inG.connect(delay).connect(wet).connect(sum)
    node = sum
  }
  if (fx.echo) {
    const e = fx.echo
    const inG = ctx.createGain(); inG.gain.value = e.in
    const sum = ctx.createGain(); sum.gain.value = e.out
    const delay = ctx.createDelay(1); delay.delayTime.value = e.delay / 1000
    const wet = ctx.createGain(); wet.gain.value = e.decay
    node.connect(inG)
    inG.connect(sum)
    inG.connect(delay).connect(wet).connect(sum)
    node = sum
  }
  const vol = ctx.createGain(); vol.gain.value = fx.volume
  chain(vol)
  node.connect(destination)
  return () => stops.forEach(s => s())
}

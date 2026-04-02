/**
 * Celebration Effects
 *
 * A collection of tsParticles-based celebration animations for when students
 * pass all tests. Effects are loaded from CDN on demand (~180KB, cached).
 * Each effect is a function that takes a container rect and the tsParticles instance.
 */

type TsParticles = any
type EffectFn = (tsParticles: TsParticles, id: string, rect: DOMRect) => Promise<void>

/** Load tsParticles v2 from CDN. Cached after first load. */
export function loadTsParticles(): Promise<TsParticles> {
  if ((window as any).tsParticles) return Promise.resolve((window as any).tsParticles)
  if ((window as any).__tsParticlesPromise) return (window as any).__tsParticlesPromise

  ;(window as any).__tsParticlesPromise = new Promise<TsParticles>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/tsparticles@2/tsparticles.bundle.min.js'
    script.onload = () => resolve((window as any).tsParticles)
    script.onerror = () => reject(new Error('Failed to load tsParticles'))
    document.head.appendChild(script)
  })
  return (window as any).__tsParticlesPromise
}

// Helper: viewport-relative position (percentage)
function vx(px: number) { return (px / window.innerWidth) * 100 }
function vy(px: number) { return (px / window.innerHeight) * 100 }

const COLORS = [
  '#00FFFC', '#FC00FF', '#fffc00',
  '#22c55e', '#84cc16', '#f472b6',
  '#a855f7', '#3b82f6', '#ef4444',
  '#f59e0b', '#06b6d4', '#ec4899',
]

// Shared particle config for confetti-like behavior
const confettiParticles = {
  number: { value: 0 },
  color: { value: COLORS },
  shape: { type: ['circle', 'square'] },
  opacity: {
    value: { min: 0, max: 1 },
    animation: { enable: true, speed: 2, startValue: 'max' as const, destroy: 'min' as const },
  },
  size: { value: { min: 2, max: 4 } },
  links: { enable: false },
  life: { duration: { sync: true, value: 5 }, count: 1 },
  move: {
    enable: true,
    gravity: { enable: true, acceleration: 10 },
    speed: { min: 10, max: 20 },
    decay: 0.1,
    direction: 'none' as const,
    straight: false,
    outModes: { default: 'destroy' as const, top: 'none' as const },
  },
  rotate: {
    value: { min: 0, max: 360 },
    direction: 'random' as const,
    move: true,
    animation: { enable: true, speed: 60 },
  },
  tilt: {
    direction: 'random' as const,
    enable: true,
    move: true,
    value: { min: 0, max: 360 },
    animation: { enable: true, speed: 60 },
  },
  roll: {
    darken: { enable: true, value: 25 },
    enable: true,
    speed: { min: 15, max: 25 },
  },
  wobble: {
    distance: 30,
    enable: true,
    move: true,
    speed: { min: -15, max: 15 },
  },
}

// Shorthand for rect edges/center in viewport %
function rx(rect: DOMRect, frac: number) { return vx(rect.left + rect.width * frac) }
function ry(rect: DOMRect, frac: number) { return vy(rect.top + rect.height * frac) }

// ─── Effect 1: Center Burst ───────────────────────────────────────────────────
const centerBurst: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: confettiParticles,
    emitters: {
      life: { count: 1, duration: 0.1, delay: 0.1 },
      rate: { delay: 0.1, quantity: 120 },
      size: { width: 0, height: 0 },
      position: { x: rx(rect, 0.5), y: ry(rect, 0.5) },
    },
  })
}

// ─── Effect 2: Two Cannons ────────────────────────────────────────────────────
const twoCannons: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      move: {
        ...confettiParticles.move,
        speed: { min: 20, max: 40 },
        decay: 0.08,
      },
    },
    emitters: [
      {
        life: { count: 1, duration: 0.1, delay: 0.1 },
        rate: { delay: 0.1, quantity: 80 },
        size: { width: 0, height: 0 },
        position: { x: rx(rect, 0), y: ry(rect, 1) },
        particles: {
          move: {
            direction: 'top-right' as const,
            outModes: { default: 'destroy' as const, top: 'none' as const },
          },
        },
      },
      {
        life: { count: 1, duration: 0.1, delay: 0.1 },
        rate: { delay: 0.1, quantity: 80 },
        size: { width: 0, height: 0 },
        position: { x: rx(rect, 1), y: ry(rect, 1) },
        particles: {
          move: {
            direction: 'top-left' as const,
            outModes: { default: 'destroy' as const, top: 'none' as const },
          },
        },
      },
    ],
  })
}

// ─── Effect 3: Rising Embers ──────────────────────────────────────────────────
const risingEmbers: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      color: { value: ['#ef4444', '#f97316', '#eab308', '#fbbf24', '#fde68a'] },
      shape: { type: 'circle' },
      size: { value: { min: 1, max: 3 } },
      move: {
        enable: true,
        direction: 'top' as const,
        speed: { min: 5, max: 15 },
        gravity: { enable: true, acceleration: -5 },
        decay: 0.05,
        outModes: { default: 'destroy' as const },
      },
      wobble: { distance: 15, enable: true, move: true, speed: { min: -10, max: 10 } },
    },
    emitters: {
      life: { count: 1, duration: 1, delay: 0 },
      rate: { delay: 0.02, quantity: 3 },
      size: { width: vx(rect.width), height: 0 },
      position: { x: rx(rect, 0.5), y: ry(rect, 1) },
    },
  })
}

// ─── Effect 4: Heart Shower ───────────────────────────────────────────────────
const heartShower: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      color: { value: ['#ec4899', '#f43f5e', '#e11d48', '#fb7185', '#fda4af'] },
      shape: {
        type: 'char',
        options: { char: { value: ['❤', '💕', '💗', '💖'], font: 'Verdana', weight: '400' } },
      },
      size: { value: { min: 4, max: 8 } },
      move: {
        enable: true,
        speed: { min: 25, max: 45 },
        gravity: { enable: true, acceleration: 7 },
        decay: 0.04,
        direction: 'none' as const,
        outModes: { default: 'destroy' as const, top: 'none' as const },
      },
    },
    emitters: [
      {
        life: { count: 1, duration: 2, delay: 0 },
        rate: { delay: 0.06, quantity: 1 },
        size: { width: 0, height: 0 },
        position: { x: rx(rect, 0), y: ry(rect, 1) },
        particles: { move: { direction: 'top-right' as const, angle: { value: 60, offset: 0 } } },
      },
      {
        life: { count: 1, duration: 2, delay: 0 },
        rate: { delay: 0.06, quantity: 1 },
        size: { width: 0, height: 0 },
        position: { x: rx(rect, 1), y: ry(rect, 1) },
        particles: { move: { direction: 'top-left' as const, angle: { value: 60, offset: 0 } } },
      },
    ],
  })
}

// ─── Effect 5: Star Explosion ─────────────────────────────────────────────────
const starExplosion: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      color: { value: ['#fbbf24', '#f59e0b', '#eab308', '#fde68a', '#fffbeb'] },
      shape: { type: 'star' },
      size: { value: { min: 3, max: 6 } },
      move: {
        enable: true,
        speed: { min: 15, max: 30 },
        gravity: { enable: true, acceleration: 12 },
        decay: 0.1,
        direction: 'none' as const,
        outModes: { default: 'destroy' as const, top: 'none' as const },
      },
    },
    emitters: {
      life: { count: 1, duration: 0.05, delay: 0.1 },
      rate: { delay: 0.05, quantity: 100 },
      size: { width: 0, height: 0 },
      position: { x: rx(rect, 0.5), y: ry(rect, 0.5) },
    },
  })
}

// ─── Effect 6: Sparkle Rain ──────────────────────────────────────────────────
const sparkleRain: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      size: { value: { min: 1.5, max: 4 } },
      move: {
        enable: true,
        direction: 'bottom' as const,
        speed: { min: 3, max: 8 },
        gravity: { enable: true, acceleration: 2 },
        decay: 0.02,
        outModes: { default: 'destroy' as const },
      },
      wobble: { distance: 20, enable: true, move: true, speed: { min: -8, max: 8 } },
    },
    emitters: {
      life: { count: 1, duration: 1.5, delay: 0 },
      rate: { delay: 0.03, quantity: 4 },
      size: { width: vx(rect.width), height: 0 },
      position: { x: rx(rect, 0.5), y: ry(rect, 0) },
    },
  })
}

// ─── Effect 7: Fireworks ─────────────────────────────────────────────────────
const fireworks: EffectFn = async (ts, id, rect) => {
  const bursts = [
    { x: 0.2, y: 0.3, delay: 0 },
    { x: 0.7, y: 0.2, delay: 0.3 },
    { x: 0.4, y: 0.6, delay: 0.6 },
  ]

  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      move: {
        enable: true,
        speed: { min: 8, max: 18 },
        gravity: { enable: true, acceleration: 10 },
        decay: 0.12,
        direction: 'none' as const,
        outModes: { default: 'destroy' as const, top: 'none' as const },
      },
    },
    emitters: bursts.map(b => ({
      life: { count: 1, duration: 0.05, delay: b.delay },
      rate: { delay: 0.05, quantity: 60 },
      size: { width: 0, height: 0 },
      position: { x: rx(rect, b.x), y: ry(rect, b.y) },
    })),
  })
}

// ─── Effect 10: Side Sweep ───────────────────────────────────────────────────
const sideSweep: EffectFn = async (ts, id, rect) => {
  await ts.load(id, {
    fullScreen: { zIndex: 9999 },
    particles: {
      ...confettiParticles,
      move: {
        enable: true,
        direction: 'right' as const,
        speed: { min: 8, max: 16 },
        gravity: { enable: true, acceleration: 5 },
        decay: 0.06,
        outModes: { default: 'destroy' as const },
      },
      wobble: { distance: 20, enable: true, move: true, speed: { min: -10, max: 10 } },
    },
    emitters: {
      life: { count: 1, duration: 0.8, delay: 0 },
      rate: { delay: 0.02, quantity: 4 },
      size: { width: 0, height: vy(rect.height) },
      position: { x: rx(rect, 0), y: ry(rect, 0.5) },
    },
  })
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const effects: { name: string; fn: EffectFn }[] = [
  { name: 'Center Burst', fn: centerBurst },
  { name: 'Two Cannons', fn: twoCannons },
  { name: 'Rising Embers', fn: risingEmbers },
  { name: 'Heart Shower', fn: heartShower },
  { name: 'Star Explosion', fn: starExplosion },
  { name: 'Sparkle Rain', fn: sparkleRain },
  { name: 'Fireworks', fn: fireworks },
  { name: 'Side Sweep', fn: sideSweep },
]

/** Play a specific effect by index. Handles loading, container creation, and cleanup. */
export async function playEffect(index: number, containerEl: HTMLElement, customRect?: DOMRect): Promise<void> {
  const effect = effects[index % effects.length]
  const ts = await loadTsParticles()
  if (!ts) return

  const id = `celebration-${Date.now()}`
  const rect = customRect ?? containerEl.getBoundingClientRect()

  await effect.fn(ts, id, rect)

  setTimeout(() => {
    const el = document.getElementById(id)
    if (el) el.remove()
  }, 8000)
}

/** Play a random effect. */
export async function playRandomEffect(containerEl: HTMLElement, customRect?: DOMRect): Promise<void> {
  const index = Math.floor(Math.random() * effects.length)
  return playEffect(index, containerEl, customRect)
}

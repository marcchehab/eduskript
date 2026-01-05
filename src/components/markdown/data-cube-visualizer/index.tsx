'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Play } from 'lucide-react'

// Lazy load the 3D component - Three.js only loads when needed
const DataCubeCanvas = dynamic(() => import('./data-cube-canvas'), {
  ssr: false,
  loading: () => (
    <span className="block aspect-video bg-neutral-900 rounded-lg animate-pulse flex items-center justify-center">
      <span className="text-white/50">Loading 3D visualization...</span>
    </span>
  )
})

/**
 * DataCubeVisualizer - Interactive 3D visualization of image data structure.
 * Shows how images are stored as width × height × color depth data cubes.
 *
 * Three.js is lazy-loaded only when user clicks to activate.
 */
export function DataCubeVisualizer() {
  const [isActive, setIsActive] = useState(false)

  // Render as span with display:block to avoid p > div hydration error
  // User must put blank lines around <datacubevisualizer> in markdown
  if (!isActive) {
    return (
      <span
        className="block relative aspect-video bg-neutral-900 rounded-lg cursor-pointer overflow-hidden group my-4"
        onClick={() => setIsActive(true)}
      >
        {/* Preview placeholder */}
        <span className="absolute inset-0 flex items-center justify-center">
          {/* Simple visual preview using inline SVG */}
          <svg width="120" height="80" viewBox="0 0 120 80" className="opacity-30">
            {[0, 1, 2, 3].map((x) =>
              [0, 1, 2, 3].map((y) => (
                <g key={`${x}-${y}`} transform={`translate(${x * 30}, ${y * 20})`}>
                  <rect x="0" y="0" width="8" height="8" fill="#ef4444" rx="1" />
                  <rect x="10" y="0" width="8" height="8" fill="#22c55e" rx="1" />
                  <rect x="20" y="0" width="8" height="8" fill="#3b82f6" rx="1" />
                </g>
              ))
            )}
          </svg>
        </span>

        {/* Play button */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-black/50 rounded-full p-4 transition-transform group-hover:scale-110 inline-flex">
            <Play className="w-12 h-12 text-white fill-white" />
          </span>
        </span>

        {/* Label */}
        <span className="absolute bottom-4 left-4 text-white/70 text-sm">
          Click to load 3D visualization
        </span>
      </span>
    )
  }

  // Wrap in span with display:block for the same reason
  return (
    <span className="block my-4">
      <DataCubeCanvas />
    </span>
  )
}

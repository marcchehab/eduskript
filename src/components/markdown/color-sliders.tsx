"use client"

import { useState } from "react"

/**
 * Interactive RGB color sliders for teaching color representation.
 * Changes the background of #paper to demonstrate RGB values.
 * Just a fun gimmick - refreshing the page resets it.
 */
export function ColorSliders() {
  const [rgb, setRgb] = useState({ r: 255, g: 255, b: 255 })

  const padHex = (n: string): string => (n.length < 2 ? "0" + n : n)

  const rgbToHex = (r: number, g: number, b: number) => {
    return `#${padHex(r.toString(16))}${padHex(g.toString(16))}${padHex(b.toString(16))}`
  }

  const hex = rgbToHex(rgb.r, rgb.g, rgb.b)

  const handleSliderChange = (color: "r" | "g" | "b", value: string) => {
    const newRgb = { ...rgb, [color]: parseInt(value) }
    setRgb(newRgb)

    // Change #paper background - just for fun, not persisted
    const paper = document.getElementById('paper')
    if (paper) {
      const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b)
      paper.style.backgroundColor = newHex
    }
  }

  return (
    <div className="p-4 space-y-4 rounded-lg bg-black/10 dark:bg-white/10">
      {/* Red Slider */}
      <fieldset className="border-none flex items-center gap-2">
        <label
          htmlFor="color-r"
          className="px-2 py-1 rounded bg-red-500 text-white font-mono text-sm min-w-[2.5em] text-center"
        >
          R
        </label>
        <input
          type="range"
          min="0"
          max="255"
          id="color-r"
          value={rgb.r}
          onChange={(e) => handleSliderChange("r", e.target.value)}
          className="flex-1 accent-red-500"
        />
        <output
          htmlFor="color-r"
          className="px-2 py-1 rounded bg-red-500 text-white font-mono text-sm min-w-[3em] text-center"
        >
          {rgb.r}
        </output>
        <output className="px-2 py-1 rounded bg-red-500/30 font-mono text-sm min-w-[3em] text-center">
          {padHex(rgb.r.toString(16)).toUpperCase()}
        </output>
      </fieldset>

      {/* Green Slider */}
      <fieldset className="border-none flex items-center gap-2">
        <label
          htmlFor="color-g"
          className="px-2 py-1 rounded bg-green-500 text-white font-mono text-sm min-w-[2.5em] text-center"
        >
          G
        </label>
        <input
          type="range"
          min="0"
          max="255"
          id="color-g"
          value={rgb.g}
          onChange={(e) => handleSliderChange("g", e.target.value)}
          className="flex-1 accent-green-500"
        />
        <output
          htmlFor="color-g"
          className="px-2 py-1 rounded bg-green-500 text-white font-mono text-sm min-w-[3em] text-center"
        >
          {rgb.g}
        </output>
        <output className="px-2 py-1 rounded bg-green-500/30 font-mono text-sm min-w-[3em] text-center">
          {padHex(rgb.g.toString(16)).toUpperCase()}
        </output>
      </fieldset>

      {/* Blue Slider */}
      <fieldset className="border-none flex items-center gap-2">
        <label
          htmlFor="color-b"
          className="px-2 py-1 rounded bg-blue-500 text-white font-mono text-sm min-w-[2.5em] text-center"
        >
          B
        </label>
        <input
          type="range"
          min="0"
          max="255"
          id="color-b"
          value={rgb.b}
          onChange={(e) => handleSliderChange("b", e.target.value)}
          className="flex-1 accent-blue-500"
        />
        <output
          htmlFor="color-b"
          className="px-2 py-1 rounded bg-blue-500 text-white font-mono text-sm min-w-[3em] text-center"
        >
          {rgb.b}
        </output>
        <output className="px-2 py-1 rounded bg-blue-500/30 font-mono text-sm min-w-[3em] text-center">
          {padHex(rgb.b.toString(16)).toUpperCase()}
        </output>
      </fieldset>

      {/* Combined Hex Output */}
      <div className="flex items-center justify-center gap-4 pt-2">
        <output className="text-2xl px-4 py-2 rounded bg-white/50 dark:bg-black/50 font-mono tracking-wider">
          {hex.toUpperCase()}
        </output>
        <div
          className="w-12 h-12 rounded border-2 border-white/50 shadow-inner"
          style={{ backgroundColor: hex }}
          title="Color preview"
        />
      </div>
    </div>
  )
}

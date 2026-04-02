export type SnapColor = 'blue' | 'yellow' | 'green' | 'pink' | 'purple'

export interface Snap {
  id: string
  name: string
  imageUrl: string
  top: number    // Logical (unzoomed) pixels from paper top
  left: number   // Logical (unzoomed) pixels from paper left
  width: number  // Display width in logical pixels
  height: number // Display height in logical pixels
  sectionId?: string
  sectionOffsetY?: number
  color?: SnapColor    // Header/border tint (default: 'blue')
  minimized?: boolean  // Collapse to titlebar only
}

'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { quantizeImageData, DEFAULT_IMAGE_DATA } from './image-processor'

interface SliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  unit?: string
}

function Slider({ label, value, onChange, min, max, unit = '' }: SliderProps) {
  return (
    <span className="flex items-center gap-3">
      <label className="text-sm font-medium min-w-[100px]">
        {label}: <span className="font-mono">{value}</span> {unit}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="flex-1 accent-blue-500 cursor-pointer"
      />
    </span>
  )
}

export default function DataCubeCanvas() {
  const containerRef = useRef<HTMLSpanElement>(null)
  const canvas2dRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [width, setWidth] = useState(16)
  const [height, setHeight] = useState(16)
  const [colorDepth, setColorDepth] = useState(2)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Load demo image once on mount
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)
    }
    img.onerror = () => {
      // Fallback: create a colorful test pattern
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (ctx) {
        for (let y = 0; y < 64; y++) {
          for (let x = 0; x < 64; x++) {
            ctx.fillStyle = `rgb(${x * 4}, ${y * 4}, ${(x + y) * 2})`
            ctx.fillRect(x, y, 1, 1)
          }
        }
        const testImg = new Image()
        testImg.onload = () => {
          imageRef.current = testImg
          setImageLoaded(true)
        }
        testImg.src = canvas.toDataURL()
      }
    }
    img.src = DEFAULT_IMAGE_DATA
  }, [])

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const size = 400

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x171717)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 100)
    camera.position.set(-15, 15, -15)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(size, size)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(1, 1, 1).normalize()
    scene.add(directionalLight)

    const ambientLight = new THREE.AmbientLight(0x404040)
    scene.add(ambientLight)

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controlsRef.current = controls

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  // Update 3D cube when dimensions change
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Remove existing cubes and edges
    const objectsToRemove = scene.children.filter(
      (child) => child instanceof THREE.Mesh || child.type === 'LineSegments'
    )
    objectsToRemove.forEach((obj) => scene.remove(obj))

    const cubeSize = 0.5
    const cubeDistance = cubeSize + 0.1
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize)

    // Materials for each color channel
    const redMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 })
    const greenMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 })
    const blueMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff })
    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 0.5 })

    // Calculate center offset for centering the cube
    const offsetX = (width * cubeDistance) / 2
    const offsetY = (colorDepth * 3 * cubeDistance) / 2
    const offsetZ = (height * cubeDistance) / 2

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < colorDepth * 3; y++) {
        for (let z = 0; z < height; z++) {
          let material: THREE.MeshPhongMaterial

          // Determine material based on y-coordinate (color channel)
          if (y < colorDepth) {
            material = blueMaterial
          } else if (y < colorDepth * 2) {
            material = greenMaterial
          } else {
            material = redMaterial
          }

          const cube = new THREE.Mesh(geometry, material)
          cube.position.set(
            x * cubeDistance - offsetX,
            y * cubeDistance - offsetY,
            z * cubeDistance - offsetZ
          )
          scene.add(cube)

          // Add edges for visibility
          const edgesGeometry = new THREE.EdgesGeometry(cube.geometry)
          const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
          edges.position.copy(cube.position)
          scene.add(edges)
        }
      }
    }
  }, [width, height, colorDepth])

  // Update 2D canvas when dimensions or image changes
  useEffect(() => {
    const canvas = canvas2dRef.current
    const img = imageRef.current
    if (!canvas || !img || !imageLoaded) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    // Create offscreen canvas for processing at target resolution
    const offscreen = document.createElement('canvas')
    offscreen.width = width
    offscreen.height = height
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true })
    if (!offCtx) return

    // Draw image at current resolution on offscreen canvas
    offCtx.imageSmoothingEnabled = false
    offCtx.drawImage(img, 0, 0, width, height)

    // Apply color depth reduction
    if (colorDepth < 8) {
      const imageData = offCtx.getImageData(0, 0, width, height)
      quantizeImageData(imageData.data, colorDepth)
      offCtx.putImageData(imageData, 0, 0)
    }

    // Scale up to display canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(offscreen, 0, 0, width, height, 0, 0, canvas.width, canvas.height)
  }, [width, height, colorDepth, imageLoaded])

  return (
    <span className="flex flex-col gap-4 p-4 bg-neutral-900 rounded-lg text-white">
      {/* Sliders */}
      <span className="flex flex-col gap-3">
        <Slider
          label="Breite"
          value={width}
          onChange={setWidth}
          min={1}
          max={64}
          unit="Pixel"
        />
        <Slider
          label="Höhe"
          value={height}
          onChange={setHeight}
          min={1}
          max={64}
          unit="Pixel"
        />
        <Slider
          label="Farbtiefe"
          value={colorDepth}
          onChange={setColorDepth}
          min={1}
          max={8}
          unit="Bit pro Farbkanal"
        />
      </span>

      {/* Canvases */}
      <span className="flex flex-wrap gap-4 items-start justify-center">
        {/* Original Image */}
        <span className="flex flex-col items-center gap-2">
          <span className="w-[200px] h-[200px] border-2 border-neutral-600 bg-white rounded overflow-hidden block">
            {imageLoaded && imageRef.current && (
              <img
                src={imageRef.current.src}
                alt="Original"
                className="w-full h-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            )}
          </span>
          <span className="text-sm text-neutral-400">Original</span>
        </span>

        {/* 2D Quantized Preview */}
        <span className="flex flex-col items-center gap-2">
          <canvas
            ref={canvas2dRef}
            width={200}
            height={200}
            className="border-2 border-neutral-600 bg-white rounded"
          />
          <span className="text-sm text-neutral-400">Quantisiert ({width}×{height}, {colorDepth} Bit)</span>
        </span>

        {/* 3D Cube */}
        <span className="flex flex-col items-center gap-2">
          <span
            ref={containerRef}
            className="border-2 border-neutral-600 rounded block"
          />
          <span className="text-sm text-neutral-400">Daten-Würfel (3D)</span>
        </span>
      </span>
    </span>
  )
}

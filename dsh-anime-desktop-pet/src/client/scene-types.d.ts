/**
 * Explicit runtime data types for assets/slices/manifest.json and layout.json.
 * The JS modules remain checkable with `tsc --allowJs --checkJs`; validators in
 * scene-core.mjs enforce the same invariants at runtime before rendering.
 */

export type SceneLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
export type SceneAnimationType = 'none' | 'float' | 'sway' | 'tailWave' | 'finWave' | 'blink' | 'bubbleRise' | 'lightSweep'
export type SceneBreakpointName = 'wide' | 'medium' | 'narrow'

export interface ScenePivot {
  x: number
  y: number
}

export interface SceneSlice {
  id: string
  layer: SceneLayer
  tags: string[]
  pivot: ScenePivot
  file: string
  file1x: string
  width: number
  height: number
  source?: { x: number; y: number; width: number; height: number }
}

export interface SceneManifest {
  version: 1
  source: string
  stage: { width: number; height: number }
  slices: SceneSlice[]
}

export interface SceneAnimation {
  type: SceneAnimationType
  duration?: number
  delay?: number
  amplitude?: number
}

export interface SceneElement {
  instanceId: string
  slice: string
  layer: SceneLayer
  anchor: { x: number; y: number }
  scale: number
  rotation?: number
  opacity?: number
  zIndex: number
  animation?: SceneAnimation
  parallax?: number
  interactive?: boolean
  mirror?: boolean
  responsive?: Partial<Record<Exclude<SceneBreakpointName, 'wide'>, { hidden?: boolean; scaleMultiplier?: number }>>
}

export interface SceneInteractionConfig {
  petClick?: {
    bubbleCount?: number
    bubbleLayer?: SceneLayer
    bubbleIntervalMs?: number
    bubbleCap?: number
  }
}

export interface SceneLayout {
  version: 1
  stage: { mode: string; coordinateSpace: string; sizeUnit: string }
  breakpoints: { wide: number; medium: number }
  responsive: Partial<Record<SceneBreakpointName, { scaleMultiplier?: number; hideLayers?: SceneLayer[] }>>
  layers: Record<SceneLayer, number>
  interactions?: SceneInteractionConfig
  elements: SceneElement[]
}

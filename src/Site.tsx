import { useMemo } from 'react'
import { Line, useTexture } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from './store'
import { contourInterval } from './units'
import type { Site } from './types'

/**
 * Site coordinates are meters east (dE) and north (dN) of the plan origin.
 * Inside <SiteFrame> they are drawn at x = dE, z = -dN, and the frame's
 * rotation turns that into the house's own frame, where the plan is drawn.
 */
export function SiteFrame({ site, children }: { site: Site; children: React.ReactNode }) {
  return <group rotation={[0, (site.rotationDeg * Math.PI) / 180, 0]}>{children}</group>
}

/** Decoded terrain grid with bilinear lookup. */
export const terrainGrid = (site: Site) => {
  const t = site.terrain
  const bytes = Uint8Array.from(atob(t.heightsCm), (c) => c.charCodeAt(0))
  const cm = new Int16Array(bytes.buffer)
  const h = new Float32Array(cm.length)
  for (let i = 0; i < cm.length; i++) h[i] = cm[i] / 100
  const heightAt = (dE: number, dN: number) => {
    const c = Math.min(Math.max((dE - t.west) / t.cell, 0), t.cols - 1.001)
    const r = Math.min(Math.max((t.north - dN) / t.cell, 0), t.rows - 1.001)
    const c0 = Math.floor(c)
    const r0 = Math.floor(r)
    const fc = c - c0
    const fr = r - r0
    const i = r0 * t.cols + c0
    return (
      h[i] * (1 - fc) * (1 - fr) + h[i + 1] * fc * (1 - fr) + h[i + t.cols] * (1 - fc) * fr + h[i + t.cols + 1] * fc * fr
    )
  }
  return { heights: h, heightAt }
}

/** Draws contour lines over a material by height, using screen-space derivatives for even line width. */
const withContours = (material: THREE.MeshStandardMaterial, interval: number) => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInterval = { value: interval }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;\nuniform float uInterval;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float minor = vHeight / uInterval;
        float major = vHeight / (uInterval * 5.0);
        float lm = abs(fract(minor - 0.5) - 0.5) / max(fwidth(minor), 1e-4);
        float lM = abs(fract(major - 0.5) - 0.5) / max(fwidth(major), 1e-4);
        float minorLine = 1.0 - clamp(lm, 0.0, 1.0);
        float majorLine = 1.0 - clamp(lM / 1.6, 0.0, 1.0);
        float line = max(minorLine * 0.45, majorLine * 0.8);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.32, 0.2, 0.08), line);`,
      )
  }
  material.customProgramCacheKey = () => `contours-${interval}`
  material.needsUpdate = true
  return material
}

export function Terrain({ site, base }: { site: Site; base: string }) {
  const units = useStore((s) => s.units)
  const setHoverElevation = useStore((s) => s.setHoverElevation)
  const photo = useTexture(base + 'data/' + site.photo)
  const t = site.terrain

  const geometry = useMemo(() => {
    const { heights } = terrainGrid(site)
    const pos = new Float32Array(t.cols * t.rows * 3)
    const uv = new Float32Array(t.cols * t.rows * 2)
    for (let r = 0; r < t.rows; r++)
      for (let c = 0; c < t.cols; c++) {
        const i = r * t.cols + c
        pos[i * 3] = t.west + c * t.cell
        pos[i * 3 + 1] = heights[i]
        pos[i * 3 + 2] = -(t.north - r * t.cell)
        uv[i * 2] = (c + 0.5) / t.cols
        uv[i * 2 + 1] = 1 - (r + 0.5) / t.rows
      }
    const index: number[] = []
    for (let r = 0; r < t.rows - 1; r++)
      for (let c = 0; c < t.cols - 1; c++) {
        const a = r * t.cols + c
        index.push(a, a + t.cols, a + 1, a + 1, a + t.cols, a + t.cols + 1)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [site, t])

  const material = useMemo(() => {
    photo.colorSpace = THREE.SRGBColorSpace
    photo.anisotropy = 8
    return withContours(new THREE.MeshStandardMaterial({ map: photo, roughness: 1 }), contourInterval(units))
  }, [photo, units])

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    // The frame only rotates about the vertical axis, so world height is grid height.
    setHoverElevation(site.floorElevation + e.point.y)
  }

  return (
    <mesh geometry={geometry} material={material} receiveShadow onPointerMove={onMove} onPointerOut={() => setHoverElevation(null)} />
  )
}

export function LotLine({ site }: { site: Site }) {
  const points = useMemo(() => {
    if (!site.lot) return null
    const { heightAt } = terrainGrid(site)
    const out: [number, number, number][] = []
    const lot = site.lot
    for (let i = 0; i < lot.length; i++) {
      const [e1, n1] = lot[i]
      const [e2, n2] = lot[(i + 1) % lot.length]
      const steps = Math.max(1, Math.ceil(Math.hypot(e2 - e1, n2 - n1) / 2))
      for (let k = 0; k < steps; k++) {
        const dE = e1 + ((e2 - e1) * k) / steps
        const dN = n1 + ((n2 - n1) * k) / steps
        out.push([dE, heightAt(dE, dN) + 0.25, -dN])
      }
    }
    out.push(out[0])
    return out
  }, [site])
  if (!points) return null
  return <Line points={points} color="#ffd23f" lineWidth={2.5} />
}

/** The lot's bounds in the house's frame, for framing the camera. */
export const siteBounds = (site: Site) => {
  const pts: [number, number][] = site.lot ?? [
    [site.terrain.west, site.terrain.north],
    [site.terrain.west + (site.terrain.cols - 1) * site.terrain.cell, site.terrain.north - (site.terrain.rows - 1) * site.terrain.cell],
  ]
  const t = (site.rotationDeg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  // Same mapping as <SiteFrame>: (x = dE, z = -dN) rotated about the vertical axis by t.
  const xs: number[] = []
  const zs: number[] = []
  for (const [dE, dN] of pts) {
    const x = dE
    const z = -dN
    xs.push(c * x + s * z)
    zs.push(-s * x + c * z)
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}

export const lotAcres = (site: Site) => {
  const l = site.lot
  if (!l) return null
  let a = 0
  for (let i = 0; i < l.length; i++) {
    const [x1, y1] = l[i]
    const [x2, y2] = l[(i + 1) % l.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2 / 4046.86
}

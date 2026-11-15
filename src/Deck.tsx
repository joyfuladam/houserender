import { useMemo } from 'react'
import * as THREE from 'three'
import type { Deck, PorchRoof, Vec2 } from './types'

const WOOD = '#8b6a4f'
const TRIM = '#f2efe9'
const POST = '#b08d63'
const ROOF = '#4a4f57'
const BOARD = 0.14 // m, 5/4x6 decking

type Box = { p: [number, number, number]; s: [number, number, number]; ry?: number; color: string }

/** Decking texture: boards running along the plan's y axis. */
const boardTexture = (() => {
  let tex: THREE.CanvasTexture | null = null
  return () => {
    if (tex) return tex
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 8
    const g = c.getContext('2d')!
    g.fillStyle = '#9a7656'
    g.fillRect(0, 0, 64, 8)
    g.fillStyle = '#6e5038'
    g.fillRect(60, 0, 4, 8)
    tex = new THREE.CanvasTexture(c)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.repeat.set(1 / BOARD, 1)
    return tex
  }
})()

/** Boxes along a line from a to b (plan coords) at heights [y0, y1]. */
const beam = (a: Vec2, b: Vec2, y0: number, y1: number, thick: number, color: string): Box => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return {
    p: [(a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2],
    s: [len, y1 - y0, thick],
    ry: -Math.atan2(b[1] - a[1], b[0] - a[0]),
    color,
  }
}

function roofGeometry(r: PorchRoof) {
  const [a, b, c, d] = r.points
  const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  // Rotate the corner list so the named edge comes first: a-b is that edge.
  const pts = [a, b, c, d]
  const k = r.edge % 4
  const [p0, p1, p2, p3] = [pts[k], pts[(k + 1) % 4], pts[(k + 2) % 4], pts[(k + 3) % 4]]
  const v = (p: Vec2, h: number) => [p[0], h, p[1]]
  let tris: number[][] = []
  if (r.kind === 'shed') {
    // p0-p1 is high (against the house), p2-p3 low.
    tris = [
      [...v(p0, r.peak), ...v(p1, r.peak), ...v(p2, r.eave)],
      [...v(p0, r.peak), ...v(p2, r.eave), ...v(p3, r.eave)],
    ]
  } else {
    // Ridge parallel to p0-p1, through the middle of the rectangle.
    const m0 = lerp(p0, p3, 0.5)
    const m1 = lerp(p1, p2, 0.5)
    tris = [
      [...v(p0, r.eave), ...v(p1, r.eave), ...v(m1, r.peak)],
      [...v(p0, r.eave), ...v(m1, r.peak), ...v(m0, r.peak)],
      [...v(m0, r.peak), ...v(m1, r.peak), ...v(p2, r.eave)],
      [...v(m0, r.peak), ...v(p2, r.eave), ...v(p3, r.eave)],
      // Gable ends.
      [...v(p0, r.eave), ...v(m0, r.peak), ...v(p3, r.eave)],
      [...v(p1, r.eave), ...v(p2, r.eave), ...v(m1, r.peak)],
    ]
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3))
  g.computeVertexNormals()
  return g
}

export function DeckMesh({ deck, maxHeight, foundation }: { deck: Deck; maxHeight: number; foundation: number }) {
  const surface = useMemo(() => {
    const shape = new THREE.Shape(deck.points.map(([x, y]) => new THREE.Vector2(x, -y)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false })
    return g
  }, [deck.points])

  const boxes = useMemo(() => {
    const out: Box[] = []
    const h = deck.height
    const n = deck.points.length
    // Rim joists around the edge.
    for (let i = 0; i < n; i++) out.push(beam(deck.points[i], deck.points[(i + 1) % n], h - 0.25, h - 0.04, 0.05, TRIM))

    // Railings: posts at most 1.8 m apart, a top rail, and cables.
    const stairGaps = deck.stairs.map((s) => ({ c: [s.x, s.y] as Vec2, half: s.width / 2 }))
    for (const i of deck.railingEdges) {
      const a = deck.points[i]
      const b = deck.points[(i + 1) % n]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      // Split the edge around any stairs that sit on it.
      let cuts: [number, number][] = [[0, len]]
      for (const g of stairGaps) {
        const t = (g.c[0] - a[0]) * dir[0] + (g.c[1] - a[1]) * dir[1]
        const off = Math.abs((g.c[0] - a[0]) * -dir[1] + (g.c[1] - a[1]) * dir[0])
        if (off > 0.2 || t < 0 || t > len) continue
        cuts = cuts.flatMap(([s, e]) =>
          t - g.half > s || t + g.half < e
            ? ([[s, Math.max(s, t - g.half)], [Math.min(e, t + g.half), e]] as [number, number][]).filter(([x, y]) => y - x > 0.1)
            : [],
        )
      }
      for (const [s, e] of cuts) {
        const p = (t: number): Vec2 => [a[0] + dir[0] * t, a[1] + dir[1] * t]
        const count = Math.max(1, Math.ceil((e - s) / 1.8))
        for (let k = 0; k <= count; k++) {
          const q = p(s + ((e - s) * k) / count)
          out.push({ p: [q[0], h + deck.railingHeight / 2, q[1]], s: [0.09, deck.railingHeight, 0.09], color: POST })
        }
        out.push(beam(p(s), p(e), h + deck.railingHeight - 0.04, h + deck.railingHeight, 0.14, POST))
        for (let c = 1; c <= 6; c++) {
          const y = h + 0.1 + c * 0.13
          out.push(beam(p(s), p(e), y, y + 0.006, 0.006, '#5d6168'))
        }
      }
    }

    // Stairs: each step drops 0.19 m and runs 0.28 m outward.
    for (const s of deck.stairs) {
      const r = (s.rotation * Math.PI) / 180
      const fwd: Vec2 = [-Math.sin(r), Math.cos(r)]
      for (let k = 0; k < s.steps; k++) {
        const top = h - 0.19 * (k + 1)
        const c: Vec2 = [s.x + fwd[0] * (0.14 + 0.28 * k), s.y + fwd[1] * (0.14 + 0.28 * k)]
        out.push({ p: [c[0], top - 0.02, c[1]], s: [s.width, 0.04, 0.3], ry: -r, color: WOOD })
      }
    }

    // Porch roof posts and beams, cut to the wall height in cutaway views.
    for (const roof of deck.roofs) {
      const top = Math.min(roof.eave, maxHeight)
      for (const [x, y] of roof.posts) out.push({ p: [x, h + (top - h) / 2, y], s: [0.14, top - h, 0.14], color: POST })
    }

    // Support posts down to the ground, only when there is terrain to reach.
    if (foundation > 0) {
      const xs = deck.points.map((p) => p[0])
      const ys = deck.points.map((p) => p[1])
      for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += 2.4)
        for (let y = Math.min(...ys) + 0.3; y < Math.max(...ys); y += 2.2)
          out.push({ p: [x, h - 0.25 - foundation / 2, y], s: [0.14, foundation, 0.14], color: POST })
    }
    return out
  }, [deck, maxHeight, foundation])

  const roofs = useMemo(() => deck.roofs.map(roofGeometry), [deck.roofs])
  const showRoofs = maxHeight === Infinity

  return (
    <group>
      <mesh geometry={surface} rotation={[-Math.PI / 2, 0, 0]} position={[0, deck.height - 0.04, 0]} receiveShadow castShadow>
        <meshStandardMaterial map={boardTexture()} color="#ffffff" roughness={0.85} />
      </mesh>
      {boxes.map((b, i) => (
        <mesh key={i} position={b.p} rotation={[0, b.ry ?? 0, 0]} castShadow receiveShadow>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color={b.color} roughness={0.8} />
        </mesh>
      ))}
      {showRoofs &&
        roofs.map((g, i) => (
          <mesh key={i} geometry={g} castShadow receiveShadow>
            <meshStandardMaterial color={ROOF} roughness={0.5} metalness={0.3} side={THREE.DoubleSide} />
          </mesh>
        ))}
    </group>
  )
}

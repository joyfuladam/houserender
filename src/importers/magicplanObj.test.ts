import { describe, expect, it } from 'vitest'
import { importMagicplanObj } from './magicplanObj'

// Two 4 m x 3 m rooms side by side with a 0.12 m wall between them, in the
// decimeter units MagicPlan writes. The shared wall has a 0.9 m x 2 m doorway
// on both sides; floor at y = -7.5, ceiling at y = 17.5.
const F = -7.5
const C = 17.5

const quad = (a: number[], b: number[]) => [
  [a[0], F, a[1]], [b[0], F, b[1]], [b[0], C, b[1]],
  [a[0], F, a[1]], [b[0], C, b[1]], [a[0], C, a[1]],
]

/** Wall from a to b along z at fixed x, with a doorway from z1 to z2 up to y = top. */
const wallWithDoor = (x: number, z0: number, z3: number, z1: number, z2: number, top: number) => [
  [x, F, z0], [x, F, z1], [x, C, z1], [x, F, z0], [x, C, z1], [x, C, z0],
  [x, top, z1], [x, top, z2], [x, C, z2], [x, top, z1], [x, C, z2], [x, C, z1],
  [x, F, z2], [x, F, z3], [x, C, z3], [x, F, z2], [x, C, z3], [x, C, z2],
]

const toObj = (objects: { name: string; verts: number[][] }[]) => {
  let out = ''
  let n = 0
  for (const o of objects) {
    out += `o ${o.name}\n` + o.verts.map((v) => `v ${v.join(' ')}`).join('\n') + '\n'
    for (let i = 0; i < o.verts.length; i += 3) out += `f ${n + i + 1} ${n + i + 2} ${n + i + 3}\n`
    n += o.verts.length
  }
  return out
}

const fixture = toObj([
  { name: 'InnerSide:a1', verts: quad([0, 0], [40, 0]) },
  { name: 'InnerSide:a2', verts: wallWithDoor(40, 0, 30, 10, 19, F + 20) },
  { name: 'InnerSide:a3', verts: quad([40, 30], [0, 30]) },
  { name: 'InnerSide:a4', verts: quad([0, 30], [0, 0]) },
  { name: 'InnerSide:b1', verts: quad([41.2, 0], [81.2, 0]) },
  { name: 'InnerSide:b2', verts: quad([81.2, 0], [81.2, 30]) },
  { name: 'InnerSide:b3', verts: quad([81.2, 30], [41.2, 30]) },
  { name: 'InnerSide:b4', verts: wallWithDoor(41.2, 0, 30, 10, 19, F + 20) },
  {
    name: 'ExternalWalls:shell',
    verts: [...quad([-2.5, -2.5], [83.7, -2.5]), ...quad([83.7, -2.5], [83.7, 32.5]), ...quad([83.7, 32.5], [-2.5, 32.5]), ...quad([-2.5, 32.5], [-2.5, -2.5])],
  },
])

describe('importMagicplanObj', () => {
  const floor = importMagicplanObj(fixture)
  const [a, b] = floor.rooms

  it('finds each room and its size in meters', () => {
    expect(floor.rooms).toHaveLength(2)
    expect(a.points).toHaveLength(4)
    const xs = a.points.map((p) => p[0])
    const ys = a.points.map((p) => p[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3)
    expect(a.ceilingHeight).toBeCloseTo(2.5)
  })

  it('recovers the doorway on both sides of the shared wall', () => {
    for (const room of [a, b]) {
      expect(room.openings).toHaveLength(1)
      const o = room.openings[0]
      expect(o.type).toBe('door')
      expect(o.width).toBeCloseTo(0.9)
      expect(o.height).toBeCloseTo(2)
      expect(o.sill).toBeCloseTo(0)
      // Position along the wall, whichever way the wall runs in the outline.
      const p = room.points[o.wall]
      const q = room.points[(o.wall + 1) % room.points.length]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      const mid = (o.offset + o.width / 2) / len
      expect(p[1] + (q[1] - p[1]) * mid).toBeCloseTo(1.45)
    }
  })

  it('gives shared walls half the gap and exterior walls the shell thickness', () => {
    const shared = a.wallDepths![a.openings[0].wall]
    expect(shared).toBeCloseTo(0.06)
    const others = a.wallDepths!.filter((_, i) => i !== a.openings[0].wall)
    for (const d of others) expect(d).toBeCloseTo(0.25)
  })

  it('uses door hints to tell a doorway from a door', () => {
    const hinted = importMagicplanObj(fixture, { doors: [{ x: 4.06, y: 1.45, leaf: false }] })
    expect(hinted.rooms[0].openings[0].type).toBe('opening')
    expect(hinted.rooms[1].openings[0].type).toBe('opening')
  })
})

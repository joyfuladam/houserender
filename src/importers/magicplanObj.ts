// Reads a MagicPlan "3D export" OBJ of one floor.
//
// What the file contains: one `InnerSide:<id>` object per wall surface as seen
// from inside a room (a vertical rectangle with the door and window openings
// left out of its triangles), plus `ExternalWalls`, `WholeFloor` and
// `FloorFillerTop` shells. Room names and door types are not in the file.
import type { Floor, Opening, Room, Vec2 } from '../types.ts'

export interface ObjImportOptions {
  /** Meters per OBJ unit. MagicPlan writes decimeters. */
  scale?: number
  floorId?: string
  floorName?: string
  /**
   * Where the export has door frames, in meters, and whether each has a door
   * leaf. The OBJ cannot tell a door from an empty doorway; the USDZ can.
   */
  doors?: { x: number; y: number; leaf: boolean }[]
}

type V3 = [number, number, number]

interface RawObject {
  kind: string
  tris: [V3, V3, V3][]
}

interface Wall {
  a: Vec2
  b: Vec2
  floor: number
  ceiling: number
  /** Openings as [start, end, bottom, top] with start/end measured from `a`. */
  holes: [number, number, number, number][]
}

const JOIN_TOLERANCE = 0.08 // m; wall ends closer than this are the same corner
const MIN_OPENING = 0.25 // m; anything smaller is a triangulation sliver
const UNKNOWN_NEIGHBOR = 0.06 // m; wall depth where nothing was captured behind it

const parseObjects = (text: string, scale: number): RawObject[] => {
  const verts: V3[] = []
  const objects: RawObject[] = []
  let cur: RawObject | null = null
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/)
    if (p[0] === 'o') {
      cur = { kind: p[1].split(':')[0], tris: [] }
      objects.push(cur)
    } else if (p[0] === 'v') {
      verts.push([+p[1] * scale, +p[2] * scale, +p[3] * scale])
    } else if (p[0] === 'f' && cur) {
      const idx = p.slice(1).map((s) => {
        const i = parseInt(s, 10)
        return i < 0 ? verts.length + i : i - 1
      })
      for (let i = 1; i + 1 < idx.length; i++) cur.tris.push([verts[idx[0]], verts[idx[i]], verts[idx[i + 1]]])
    }
  }
  return objects
}

/** Merges values closer than `tol` so near-duplicate coordinates share one grid line. */
const cluster = (values: number[], tol: number) => {
  const sorted = [...values].sort((x, y) => x - y)
  const out: number[] = []
  let group: number[] = []
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > tol) {
      out.push(group.reduce((s, x) => s + x, 0) / group.length)
      group = []
    }
    group.push(v)
  }
  if (group.length) out.push(group.reduce((s, x) => s + x, 0) / group.length)
  return out
}

const inTriangle = (px: number, py: number, t: Vec2[]) => {
  const sign = (a: Vec2, b: Vec2) => (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
  const d1 = sign(t[0], t[1])
  const d2 = sign(t[1], t[2])
  const d3 = sign(t[2], t[0])
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

const toWall = (obj: RawObject): Wall | null => {
  const pts = obj.tris.flat()
  if (pts.length < 3) return null
  // The two points farthest apart in plan are the ends of the wall.
  let a: V3 = pts[0]
  let b: V3 = pts[0]
  let best = -1
  for (const p of pts)
    for (const q of pts) {
      const d = Math.hypot(p[0] - q[0], p[2] - q[2])
      if (d > best) {
        best = d
        a = p
        b = q
      }
    }
  if (best < 0.05) return null
  const dir: Vec2 = [(b[0] - a[0]) / best, (b[2] - a[2]) / best]
  const u = (p: V3) => (p[0] - a[0]) * dir[0] + (p[2] - a[2]) * dir[1]
  const floor = Math.min(...pts.map((p) => p[1]))
  const ceiling = Math.max(...pts.map((p) => p[1]))

  // Lay a grid over the wall using every coordinate that appears, then find
  // the cells no triangle covers: those are the openings.
  const tris = obj.tris.map((t) => t.map((p) => [u(p), p[1]] as Vec2))
  const us = cluster(pts.map(u), 0.015)
  const vs = cluster(pts.map((p) => p[1]), 0.015)
  const columns: { s: number; e: number; bottom: number; top: number }[] = []
  for (let i = 0; i + 1 < us.length; i++) {
    let bottom = Infinity
    let top = -Infinity
    for (let j = 0; j + 1 < vs.length; j++) {
      const cx = (us[i] + us[i + 1]) / 2
      const cy = (vs[j] + vs[j + 1]) / 2
      if (!tris.some((t) => inTriangle(cx, cy, t))) {
        bottom = Math.min(bottom, vs[j])
        top = Math.max(top, vs[j + 1])
      }
    }
    if (top > bottom) columns.push({ s: us[i], e: us[i + 1], bottom, top })
  }
  const holes: Wall['holes'] = []
  for (const c of columns) {
    const last = holes[holes.length - 1]
    if (last && Math.abs(last[1] - c.s) < 1e-6 && Math.abs(last[2] - c.bottom) < 0.02 && Math.abs(last[3] - c.top) < 0.02)
      last[1] = c.e
    else holes.push([c.s, c.e, c.bottom, c.top])
  }
  return {
    a: [a[0], a[2]],
    b: [b[0], b[2]],
    floor,
    ceiling,
    holes: holes.filter((h) => h[1] - h[0] >= MIN_OPENING && h[3] - h[2] >= MIN_OPENING),
  }
}

const near = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < JOIN_TOLERANCE

/** Chains walls end to end into closed room outlines. */
const toLoops = (walls: Wall[]) => {
  const unused = new Set(walls)
  const loops: { wall: Wall; flipped: boolean }[][] = []
  while (unused.size) {
    const first = unused.values().next().value as Wall
    unused.delete(first)
    const loop = [{ wall: first, flipped: false }]
    let end = first.b
    while (!near(end, first.a)) {
      let next: { wall: Wall; flipped: boolean } | null = null
      for (const w of unused) {
        if (near(w.a, end)) next = { wall: w, flipped: false }
        else if (near(w.b, end)) next = { wall: w, flipped: true }
        if (next) break
      }
      if (!next) break
      unused.delete(next.wall)
      loop.push(next)
      end = next.flipped ? next.wall.a : next.wall.b
    }
    if (loop.length >= 3 && near(end, first.a)) loops.push(loop)
  }
  return loops
}

const raySegment = (o: Vec2, d: Vec2, p: Vec2, q: Vec2) => {
  const ex = q[0] - p[0]
  const ey = q[1] - p[1]
  const den = d[0] * ey - d[1] * ex
  if (Math.abs(den) < 1e-9) return Infinity
  const t = ((p[0] - o[0]) * ey - (p[1] - o[1]) * ex) / den
  const s = ((p[0] - o[0]) * d[1] - (p[1] - o[1]) * d[0]) / den
  return t > 0 && s >= 0 && s <= 1 ? t : Infinity
}

const signedArea = (pts: Vec2[]) =>
  pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2

export const importMagicplanObj = (text: string, options: ObjImportOptions = {}): Floor => {
  const objects = parseObjects(text, options.scale ?? 0.1)
  const walls = objects
    .filter((o) => o.kind === 'InnerSide')
    .map(toWall)
    .filter((w): w is Wall => w !== null)

  // Outer faces of the building shell, as plan segments.
  const shell: [Vec2, Vec2][] = []
  for (const o of objects.filter((x) => x.kind === 'ExternalWalls'))
    for (const t of o.tris) {
      const xz = t.map((p) => [p[0], p[2]] as Vec2)
      for (let i = 0; i < 3; i++) {
        const p = xz[i]
        const q = xz[(i + 1) % 3]
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02 && Math.abs(t[i][1] - t[(i + 1) % 3][1]) < 1e-6) shell.push([p, q])
      }
    }

  const rooms: Room[] = toLoops(walls).map((loop, n) => {
    const points = loop.map(({ wall, flipped }) => (flipped ? wall.b : wall.a))
    const floor = Math.min(...loop.map((l) => l.wall.floor))
    const openings: Opening[] = []
    loop.forEach(({ wall, flipped }, i) => {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
      for (const [s, e, bottom, top] of wall.holes) {
        const sill = Math.max(0, bottom - floor)
        const width = e - s
        const mid = (s + e) / 2 / length
        const cx = wall.a[0] + (wall.b[0] - wall.a[0]) * mid
        const cy = wall.a[1] + (wall.b[1] - wall.a[1]) * mid
        const hint = options.doors?.find((d) => Math.hypot(d.x - cx, d.y - cy) < Math.max(0.35, width / 4))
        // Anything that starts above the floor is a window. Without a hint,
        // a doorway of ordinary width is assumed to have a door.
        const type = sill > 0.15 ? 'window' : hint ? (hint.leaf ? 'door' : 'opening') : width <= 1.1 ? 'door' : 'opening'
        openings.push({
          wall: i,
          type,
          offset: flipped ? length - e : s,
          width,
          height: top - bottom,
          sill,
        })
      }
    })
    return {
      id: `room-${n + 1}`,
      name: `Room ${n + 1}`,
      points,
      ceilingHeight: Math.max(...loop.map((l) => l.wall.ceiling)) - floor,
      openings,
    }
  })

  // How far each wall extends outward from the room's surface: half the gap to
  // the room behind it, or the full shell thickness for an exterior wall.
  for (const room of rooms) {
    const ccw = signedArea(room.points) > 0
    room.wallDepths = room.points.map((a, i) => {
      const b = room.points[(i + 1) % room.points.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      const out: Vec2 = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]]
      let depth = Infinity
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const o: Vec2 = [a[0] + dir[0] * len * f, a[1] + dir[1] * len * f]
        let toRoom = Infinity
        for (const other of rooms) {
          if (other === room) continue
          other.points.forEach((p, k) => {
            toRoom = Math.min(toRoom, raySegment(o, out, p, other.points[(k + 1) % other.points.length]))
          })
        }
        let toShell = Infinity
        for (const [p, q] of shell) {
          const t = raySegment(o, out, p, q)
          if (t > 0.03) toShell = Math.min(toShell, t)
        }
        depth = Math.min(depth, toRoom < 0.8 ? toRoom / 2 : toShell < 0.45 ? toShell : UNKNOWN_NEIGHBOR)
      }
      return isFinite(depth) ? Math.max(0.02, depth) : 0.06
    })
  }

  return { id: options.floorId ?? 'floor-1', name: options.floorName ?? 'Floor 1', rooms }
}

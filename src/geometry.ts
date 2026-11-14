import type { Item, Opening, Room, Vec2, FitStatus } from './types'

export const signedArea = (pts: Vec2[]) => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

export const polygonArea = (pts: Vec2[]) => Math.abs(signedArea(pts))

export const centroid = (pts: Vec2[]): Vec2 => {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-9) return pts[0] ?? [0, 0]
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    const f = x1 * y2 - x2 * y1
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  return [cx / (6 * a), cy / (6 * a)]
}

export const pointInPolygon = ([px, py]: Vec2, pts: Vec2[]) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const bounds = (rooms: Room[]) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rooms)
    for (const [x, y] of r.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  return { minX, minY, maxX, maxY }
}

/** Footprint corners of an item in plan coordinates. */
export const itemCorners = (it: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] => {
  const r = (it.rotation * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const hw = it.width / 2
  const hd = it.depth / 2
  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as Vec2[]
  ).map(([lx, ly]) => [it.x + lx * c - ly * s, it.y + lx * s + ly * c])
}

const project = (pts: Vec2[], ax: Vec2) => {
  let min = Infinity
  let max = -Infinity
  for (const [x, y] of pts) {
    const d = x * ax[0] + y * ax[1]
    min = Math.min(min, d)
    max = Math.max(max, d)
  }
  return [min, max]
}

/** Separating-axis test for two convex quads; touching edges do not count as overlap. */
export const quadsOverlap = (a: Vec2[], b: Vec2[], eps = 0.005) => {
  for (const quad of [a, b])
    for (let i = 0; i < 2; i++) {
      const [x1, y1] = quad[i]
      const [x2, y2] = quad[i + 1]
      const axis: Vec2 = [-(y2 - y1), x2 - x1]
      const len = Math.hypot(axis[0], axis[1]) || 1
      axis[0] /= len
      axis[1] /= len
      const [amin, amax] = project(a, axis)
      const [bmin, bmax] = project(b, axis)
      if (amax - eps <= bmin || bmax - eps <= amin) return false
    }
  return true
}

/** Things that sit flat on the floor or hang above it don't block other items. */
const isFlat = (it: Item) => it.height <= 0.05

const verticalOverlap = (a: Item, b: Item) => {
  const a0 = a.elevation ?? 0
  const b0 = b.elevation ?? 0
  return a0 < b0 + b.height && b0 < a0 + a.height
}

/**
 * An item fits when its whole footprint lies inside one room (inset by half the
 * wall thickness, since room polygons follow wall centerlines) and it doesn't
 * intersect another item.
 */
export const fitStatus = (item: Item, rooms: Room[], others: Item[], wallThickness: number): FitStatus => {
  const corners = itemCorners(item)
  const room = rooms.find((r) => pointInPolygon([item.x, item.y], r.points))
  if (!room) return 'outside'
  const half = wallThickness / 2
  for (const c of corners) {
    if (!pointInPolygon(c, room.points)) return 'outside'
    if (distanceToPolygon(c, room.points) < half - 0.005) return 'outside'
  }
  if (!isFlat(item))
    for (const o of others) {
      if (o.id === item.id || o.floorId !== item.floorId || isFlat(o)) continue
      if (verticalOverlap(item, o) && quadsOverlap(corners, itemCorners(o))) return 'overlap'
    }
  return 'ok'
}

const distanceToSegment = ([px, py]: Vec2, [ax, ay]: Vec2, [bx, by]: Vec2) => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export const distanceToPolygon = (p: Vec2, pts: Vec2[]) => {
  let d = Infinity
  for (let i = 0; i < pts.length; i++) d = Math.min(d, distanceToSegment(p, pts[i], pts[(i + 1) % pts.length]))
  return d
}

export interface WallPiece {
  /** World position of the box center [x, y, z]. */
  position: [number, number, number]
  rotationY: number
  size: [number, number, number]
  kind: 'wall' | 'glass'
}

/**
 * Turns a room outline into boxes. Each room draws the half of the wall on its
 * own side of the centerline, so a wall shared by two rooms comes out at full
 * thickness and each side can carry its own color.
 */
export const wallPieces = (room: Room, thickness: number, maxHeight = Infinity): WallPiece[] => {
  const pts = room.points
  const half = thickness / 2
  const ccw = signedArea(pts) > 0
  const H = Math.min(room.ceilingHeight, maxHeight)
  const out: WallPiece[] = []

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
    // Normal pointing into the room.
    const n: Vec2 = ccw ? [-dir[1], dir[0]] : [dir[1], -dir[0]]
    const rotationY = -Math.atan2(dir[1], dir[0])

    const box = (s: number, e: number, bottom: number, top: number, kind: WallPiece['kind'] = 'wall') => {
      if (e - s < 1e-4 || top - bottom < 1e-4) return
      const mid = (s + e) / 2
      const t = kind === 'glass' ? 0.02 : half
      const off = kind === 'glass' ? 0.01 : half / 2
      out.push({
        position: [a[0] + dir[0] * mid + n[0] * off, (bottom + top) / 2, a[1] + dir[1] * mid + n[1] * off],
        rotationY,
        size: [e - s, top - bottom, t],
        kind,
      })
    }

    const openings: Opening[] = room.openings
      .filter((o) => o.wall === i)
      .sort((p, q) => p.offset - q.offset)

    let cursor = 0
    for (const o of openings) {
      const s = Math.max(cursor, Math.min(len, o.offset))
      const e = Math.max(s, Math.min(len, o.offset + o.width))
      box(cursor, s, 0, H)
      box(s, e, 0, Math.min(o.sill, H))
      box(s, e, Math.min(o.sill + o.height, H), H)
      if (o.type === 'window') box(s, e, Math.min(o.sill, H), Math.min(o.sill + o.height, H), 'glass')
      cursor = e
    }
    box(cursor, len, 0, H)
  }
  return out
}

export const snap = (v: number, step = 0.025) => Math.round(v / step) * step

import type { Deck, Fixture, Item, Opening, Room, Vec2, FitStatus } from './types'

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

export const bounds = (rooms: { points: Vec2[] }[]) => {
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
 * An item fits when its whole footprint lies inside one room or on one deck
 * (and, on a deck, not inside the house), and it doesn't intersect another
 * item or a built-in fixture.
 */
export const fitStatus = (
  item: Item,
  rooms: Room[],
  others: Item[],
  fixtures: Fixture[] = [],
  decks: Deck[] = [],
): FitStatus => {
  const corners = itemCorners(item)
  const center: Vec2 = [item.x, item.y]
  const inRoom = (p: Vec2, r: Room) => pointInPolygon(p, r.points) || distanceToPolygon(p, r.points) <= 0.005
  const room = rooms.find((r) => pointInPolygon(center, r.points))
  if (room) {
    if (!corners.every((c) => inRoom(c, room))) return 'outside'
  } else {
    const deck = decks.find((d) => pointInPolygon(center, d.points))
    if (!deck) return 'outside'
    for (const c of corners) {
      if (!pointInPolygon(c, deck.points) && distanceToPolygon(c, deck.points) > 0.005) return 'outside'
      if (rooms.some((r) => pointInPolygon(c, r.points))) return 'outside'
    }
  }
  if (!isFlat(item)) {
    for (const o of others) {
      if (o.id === item.id || o.floorId !== item.floorId || isFlat(o)) continue
      if (verticalOverlap(item, o) && quadsOverlap(corners, itemCorners(o))) return 'overlap'
    }
    for (const f of fixtures)
      if ((item.elevation ?? 0) < f.height && quadsOverlap(corners, itemCorners(f))) return 'overlap'
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
  kind: 'wall' | 'glass' | 'threshold'
}

/**
 * Turns a room outline into boxes. The outline is the wall surface, so each
 * wall is built outward from it by its depth: half the wall for one shared
 * with another room (the other room builds the other half), the full
 * thickness for an exterior wall.
 */
export const wallPieces = (room: Room, defaultDepth: number, maxHeight = Infinity): WallPiece[] => {
  const pts = room.points
  const n = pts.length
  const ccw = signedArea(pts) > 0
  const H = Math.min(room.ceilingHeight, maxHeight)
  const depthOf = (i: number) => room.wallDepths?.[(i + n) % n] ?? defaultDepth
  const dirOf = (i: number): Vec2 => {
    const a = pts[(i + n) % n]
    const b = pts[(i + 1 + n) % n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  }
  // A corner is convex when the outline turns the same way as its winding.
  const convex = (i: number) => {
    const p = dirOf(i - 1)
    const c = dirOf(i)
    const cross = p[0] * c[1] - p[1] * c[0]
    return ccw ? cross > 1e-6 : cross < -1e-6
  }
  const out: WallPiece[] = []

  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    const dir = dirOf(i)
    const depth = depthOf(i)
    // Normal pointing out of the room, into the wall.
    const o: Vec2 = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]]
    const rotationY = -Math.atan2(dir[1], dir[0])

    const box = (s: number, e: number, bottom: number, top: number, kind: WallPiece['kind'] = 'wall') => {
      if (e - s < 1e-4 || top - bottom < 1e-4) return
      const mid = (s + e) / 2
      const t = kind === 'glass' ? 0.02 : depth
      out.push({
        position: [a[0] + dir[0] * mid + o[0] * (depth / 2), (bottom + top) / 2, a[1] + dir[1] * mid + o[1] * (depth / 2)],
        rotationY,
        size: [e - s, top - bottom, t],
        kind,
      })
    }

    const openings: Opening[] = room.openings
      .filter((op) => op.wall === i)
      .sort((p, q) => p.offset - q.offset)

    // Fill the outside of convex corners, where neighboring walls would
    // otherwise leave a square notch.
    let cursor = convex(i) ? -depthOf(i - 1) : 0
    const end = convex(i + 1) ? len + depthOf(i + 1) : len
    for (const op of openings) {
      const s = Math.max(cursor, Math.min(len, op.offset))
      const e = Math.max(s, Math.min(len, op.offset + op.width))
      box(cursor, s, 0, H)
      box(s, e, 0, Math.min(op.sill, H))
      box(s, e, Math.min(op.sill + op.height, H), H)
      if (op.type === 'window') box(s, e, Math.min(op.sill, H), Math.min(op.sill + op.height, H), 'glass')
      if (op.sill < 0.01) box(s, e, -0.02, 0, 'threshold')
      cursor = e
    }
    box(cursor, end, 0, H)
  }
  return out
}

export const snap = (v: number, step = 0.025) => Math.round(v / step) * step

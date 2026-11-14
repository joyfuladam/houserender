import { describe, expect, it } from 'vitest'
import { fitStatus, itemCorners, polygonArea, quadsOverlap, wallPieces } from './geometry'
import type { Item, Room } from './types'

const room: Room = {
  id: 'r',
  name: 'Room',
  ceilingHeight: 2.5,
  points: [[0, 0], [4, 0], [4, 3], [0, 3]],
  openings: [
    { wall: 0, type: 'door', offset: 1, width: 1, height: 2, sill: 0 },
    { wall: 2, type: 'window', offset: 1, width: 2, height: 1, sill: 1 },
  ],
}

const item = (p: Partial<Item>): Item => ({
  id: 'a', name: 'a', floorId: 'f', x: 2, y: 1.5, rotation: 0, width: 1, depth: 1, height: 1, color: '#000', ...p,
})

describe('geometry', () => {
  it('measures room area', () => {
    expect(polygonArea(room.points)).toBeCloseTo(12)
  })

  it('rotates footprints clockwise in plan space', () => {
    const [c0] = itemCorners(item({ x: 0, y: 0, width: 2, depth: 1, rotation: 90 }))
    expect(c0[0]).toBeCloseTo(0.5)
    expect(c0[1]).toBeCloseTo(-1)
  })

  it('flags items that cross a wall', () => {
    expect(fitStatus(item({}), [room], [], 0.12)).toBe('ok')
    expect(fitStatus(item({ x: 3.8 }), [room], [], 0.12)).toBe('outside')
    // Touching the wall centerline still collides with the wall's thickness.
    expect(fitStatus(item({ x: 3.5 }), [room], [], 0.12)).toBe('outside')
    expect(fitStatus(item({ x: 3.44 }), [room], [], 0.12)).toBe('ok')
  })

  it('flags overlapping items but lets furniture sit on rugs', () => {
    const a = item({})
    const b = item({ id: 'b', x: 2.5 })
    const rug = item({ id: 'rug', width: 3, depth: 2, height: 0.02 })
    expect(fitStatus(a, [room], [a, b], 0.12)).toBe('overlap')
    expect(fitStatus(a, [room], [a, rug], 0.12)).toBe('ok')
    expect(quadsOverlap(itemCorners(a), itemCorners(item({ x: 3 })))).toBe(false)
  })

  it('lets a wall shelf hang above furniture', () => {
    const a = item({})
    const shelf = item({ id: 's', height: 0.3, elevation: 1.5 })
    expect(fitStatus(a, [room], [a, shelf], 0.12)).toBe('ok')
  })

  it('cuts door and window openings out of walls', () => {
    const pieces = wallPieces(room, 0.12)
    const volume = (kind: string) =>
      pieces.filter((p) => p.kind === kind).reduce((s, p) => s + p.size[0] * p.size[1], 0)
    // Perimeter 14 m x 2.5 m high, minus a 1x2 door and a 2x1 window.
    expect(volume('wall')).toBeCloseTo(14 * 2.5 - 2 - 2)
    expect(volume('glass')).toBeCloseTo(2)
    // Every piece sits on the room side of the centerline.
    for (const p of pieces) {
      expect(p.position[0]).toBeGreaterThan(0)
      expect(p.position[0]).toBeLessThan(4)
      expect(p.position[2]).toBeGreaterThan(0)
      expect(p.position[2]).toBeLessThan(3)
    }
  })
})

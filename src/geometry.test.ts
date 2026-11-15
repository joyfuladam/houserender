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
    expect(fitStatus(item({}), [room], [])).toBe('ok')
    expect(fitStatus(item({ x: 3.8 }), [room], [])).toBe('outside')
    // Flush against the wall surface is allowed.
    expect(fitStatus(item({ x: 3.5 }), [room], [])).toBe('ok')
    expect(fitStatus(item({ x: 3.52 }), [room], [])).toBe('outside')
  })

  it('flags overlapping items but lets furniture sit on rugs', () => {
    const a = item({})
    const b = item({ id: 'b', x: 2.5 })
    const rug = item({ id: 'rug', width: 3, depth: 2, height: 0.02 })
    expect(fitStatus(a, [room], [a, b])).toBe('overlap')
    expect(fitStatus(a, [room], [a, rug])).toBe('ok')
    expect(quadsOverlap(itemCorners(a), itemCorners(item({ x: 3 })))).toBe(false)
  })

  it('lets a wall shelf hang above furniture', () => {
    const a = item({})
    const shelf = item({ id: 's', height: 0.3, elevation: 1.5 })
    expect(fitStatus(a, [room], [a, shelf])).toBe('ok')
  })

  it('blocks items from built-in fixtures', () => {
    const stairs = { id: 's', name: 'Stairs', x: 2, y: 1.5, rotation: 0, width: 1, depth: 2, height: 2.5 }
    expect(fitStatus(item({}), [room], [], [stairs])).toBe('overlap')
    expect(fitStatus(item({ x: 0.6, y: 0.6 }), [room], [], [stairs])).toBe('ok')
  })

  it('lets items sit on a deck but not straddle the house wall', () => {
    const deck = {
      id: 'd', name: 'Deck', points: [[4.2, 0], [7, 0], [7, 3], [4.2, 3]] as [number, number][],
      height: -0.05, railingEdges: [], railingHeight: 1.07, stairs: [], roofs: [],
    }
    expect(fitStatus(item({ x: 5.5 }), [room], [], [], [deck])).toBe('ok')
    expect(fitStatus(item({ x: 6.8 }), [room], [], [], [deck])).toBe('outside')
    // Center on the deck, back half through the wall into the room.
    expect(fitStatus(item({ x: 4.3 }), [room], [], [], [deck])).toBe('outside')
    expect(fitStatus(item({ x: 8 }), [room], [], [], [deck])).toBe('outside')
  })

  it('cuts door and window openings out of walls', () => {
    const depth = 0.1
    const pieces = wallPieces(room, depth)
    const area = (kind: string) =>
      pieces.filter((p) => p.kind === kind).reduce((s, p) => s + p.size[0] * p.size[1], 0)
    // Perimeter 14 m x 2.5 m high, minus a 1x2 door and a 2x1 window, plus
    // the four corners filled from both sides.
    expect(area('wall')).toBeCloseTo(14 * 2.5 - 2 - 2 + 8 * depth * 2.5)
    expect(area('glass')).toBeCloseTo(2)
    // Walls are built outward: nothing sits inside the room outline.
    for (const p of pieces.filter((q) => q.kind === 'wall')) {
      const inside = p.position[0] > 0 && p.position[0] < 4 && p.position[2] > 0 && p.position[2] < 3
      expect(inside).toBe(false)
    }
  })
})

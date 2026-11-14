// All lengths are meters. Plan coordinates are [x, y] with y pointing "down" the
// page (same as SVG); in the 3D scene plan-x maps to world X and plan-y to world Z.

export type Vec2 = [number, number]

export interface Opening {
  /** Index of the wall: the edge from points[wall] to points[wall + 1]. */
  wall: number
  type: 'door' | 'window' | 'opening'
  /** Distance along the wall from its start point to the near edge of the opening. */
  offset: number
  width: number
  height: number
  /** Height of the bottom of the opening above the floor (0 for doors). */
  sill: number
}

export interface Room {
  id: string
  name: string
  /** Wall centerline polygon, in order. */
  points: Vec2[]
  ceilingHeight: number
  floorColor?: string
  wallColor?: string
  openings: Opening[]
}

export interface Floor {
  id: string
  name: string
  rooms: Room[]
}

export interface House {
  name: string
  wallThickness: number
  floors: Floor[]
}

export interface Item {
  id: string
  name: string
  floorId: string
  /** Center of the footprint, plan coordinates. */
  x: number
  y: number
  /** Degrees, clockwise when viewed from above. */
  rotation: number
  width: number
  depth: number
  height: number
  color: string
  /** Bottom of the item above the floor (wall art, shelves, pendant lights). */
  elevation?: number
  productUrl?: string
  price?: string
  /** GLB/GLTF model, scaled to the item's dimensions. */
  modelUrl?: string
  notes?: string
}

export interface Layout {
  name: string
  items: Item[]
}

export type FitStatus = 'ok' | 'outside' | 'overlap'

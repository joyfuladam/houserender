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
  /** Outline of the room at the wall surfaces, in order. */
  points: Vec2[]
  /** How far each wall extends outward from the outline; index matches `points`. */
  wallDepths?: number[]
  ceilingHeight: number
  floorColor?: string
  wallColor?: string
  openings: Opening[]
}

/** Something built in that furniture has to avoid, such as a staircase. */
export interface Fixture {
  id: string
  name: string
  x: number
  y: number
  rotation: number
  width: number
  depth: number
  height: number
}

export interface Floor {
  id: string
  name: string
  rooms: Room[]
  fixtures?: Fixture[]
}

export interface House {
  name: string
  /** Wall depth used where a room has no `wallDepths`. */
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

/** Terrain and lot around the house, from scripts/site_from_usgs.py. */
export interface Site {
  crs: string
  /** Projected coordinates of the plan's (0, 0). */
  origin: [number, number]
  /** Compass bearing the plan's "up" (negative y) faces. */
  rotationDeg: number
  /** Elevation of the floor (meters above sea level); terrain heights are relative to it. */
  floorElevation: number
  gradeAtHouse: { min: number; max: number }
  terrain: {
    /** Grid extent in meters east / north of `origin`. */
    west: number
    north: number
    cell: number
    cols: number
    rows: number
    /** Int16 little-endian, centimeters relative to the floor, row-major from the north-west corner. */
    heightsCm: string
    min: number
    max: number
  }
  /** Lot line, meters east / north of `origin`. */
  lot: [number, number][] | null
  photo: string
  sources: Record<string, string | null>
}

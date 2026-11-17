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

/** A roof over part of a deck: a shed sloping away from one edge, or a gable. */
export interface PorchRoof {
  kind: 'shed' | 'gable'
  /** Rectangle, four corners in order. */
  points: Vec2[]
  /**
   * Shed: the edge (points[i] to points[i + 1]) that sits high, against the house.
   * Gable: the ridge runs parallel to this edge, through the middle.
   */
  edge: number
  /** Underside height at the low (outer) side, above the floor. */
  eave: number
  /** Shed: height at the high edge. Gable: height of the ridge. */
  peak: number
  /** Support posts, plan coordinates. */
  posts: Vec2[]
}

export interface Stairs {
  /** Center of the top step's front edge, plan coordinates. */
  x: number
  y: number
  width: number
  /** Degrees; 0 descends toward plan +y, like an item facing front. */
  rotation: number
  steps: number
}

/** An outdoor deck or porch attached to the floor; furniture can go on it. */
export interface Deck {
  id: string
  name: string
  points: Vec2[]
  /** Top of the decking, relative to the floor (usually a little below it). */
  height: number
  /** Edges (points[i] to points[i + 1]) that have a railing. */
  railingEdges: number[]
  railingHeight: number
  stairs: Stairs[]
  roofs: PorchRoof[]
  /** Where the dimensions came from, shown to the user. */
  note?: string
}

export interface Floor {
  id: string
  name: string
  rooms: Room[]
  fixtures?: Fixture[]
  decks?: Deck[]
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
  /** Lowest and highest ground within the lot, relative to the floor. */
  lotRange?: [number, number] | null
  /** Other parcel outlines in the area, same coordinates. */
  neighbors?: [number, number][][]
  /** Other buildings; height is null when unknown, base is the ground under them relative to the floor. */
  buildings?: { ring: [number, number][]; height: number | null; base: number }[]
  photo: string
  sources: Record<string, string | null>
}

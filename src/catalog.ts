// Generic starting sizes (meters). Real products get their own dimensions.
export interface Preset {
  name: string
  width: number
  depth: number
  height: number
  color: string
}

export const PRESETS: Preset[] = [
  { name: 'Sofa (3-seat)', width: 2.13, depth: 0.94, height: 0.86, color: '#8a94a6' },
  { name: 'Loveseat', width: 1.52, depth: 0.94, height: 0.86, color: '#8a94a6' },
  { name: 'Armchair', width: 0.84, depth: 0.86, height: 0.84, color: '#a68a6d' },
  { name: 'Coffee table', width: 1.22, depth: 0.61, height: 0.43, color: '#7a5c44' },
  { name: 'Side table', width: 0.51, depth: 0.51, height: 0.56, color: '#7a5c44' },
  { name: 'TV console', width: 1.63, depth: 0.43, height: 0.56, color: '#4a4f57' },
  { name: 'Bookcase', width: 0.91, depth: 0.33, height: 1.83, color: '#b8a07e' },
  { name: 'Dining table (6)', width: 1.83, depth: 0.97, height: 0.76, color: '#7a5c44' },
  { name: 'Dining chair', width: 0.46, depth: 0.53, height: 0.89, color: '#5d6470' },
  { name: 'King bed', width: 1.93, depth: 2.03, height: 0.61, color: '#c9c3b8' },
  { name: 'Queen bed', width: 1.52, depth: 2.03, height: 0.61, color: '#c9c3b8' },
  { name: 'Nightstand', width: 0.56, depth: 0.43, height: 0.61, color: '#7a5c44' },
  { name: 'Dresser', width: 1.52, depth: 0.48, height: 0.86, color: '#7a5c44' },
  { name: 'Desk', width: 1.4, depth: 0.7, height: 0.75, color: '#b8a07e' },
  { name: 'Area rug 8×10', width: 3.05, depth: 2.44, height: 0.02, color: '#b9aa94' },
  { name: 'Area rug 5×8', width: 2.44, depth: 1.52, height: 0.02, color: '#b9aa94' },
]

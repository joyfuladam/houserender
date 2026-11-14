export type Units = 'imperial' | 'metric'

const IN = 0.0254

/** Meters -> value in the user's small unit (inches or centimeters). */
export const toDisplay = (m: number, u: Units) => (u === 'imperial' ? m / IN : m * 100)
export const fromDisplay = (v: number, u: Units) => (u === 'imperial' ? v * IN : v / 100)
export const unitLabel = (u: Units) => (u === 'imperial' ? 'in' : 'cm')

export const formatLength = (m: number, u: Units) => {
  if (u === 'metric') return `${Math.round(m * 100)} cm`
  const total = Math.round(m / IN)
  const ft = Math.floor(total / 12)
  const inch = total % 12
  return ft ? `${ft}′ ${inch}″` : `${inch}″`
}

export const formatArea = (m2: number, u: Units) =>
  u === 'imperial' ? `${Math.round(m2 * 10.7639)} sq ft` : `${m2.toFixed(1)} m²`

export const formatDims = (w: number, d: number, h: number, u: Units) => {
  const f = (m: number) => (u === 'imperial' ? `${Math.round(m / IN)}` : `${Math.round(m * 100)}`)
  return `${f(w)} × ${f(d)} × ${f(h)} ${unitLabel(u)}`
}

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

/** Elevation in feet or meters; `signed` adds a + for values above zero. */
export const formatElevation = (m: number, u: Units, signed = false) => {
  const v = u === 'imperial' ? m / 0.3048 : m
  const digits = signed ? 1 : 0
  const text = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const sign = signed ? (v > 0.05 ? '+' : v < -0.05 ? '−' : '') : v < 0 ? '−' : ''
  return `${sign}${text} ${u === 'imperial' ? 'ft' : 'm'}`
}

/** Contour spacing: 2 ft (major every 10 ft) or 1 m (major every 5 m). */
export const contourInterval = (u: Units) => (u === 'imperial' ? 2 * 0.3048 : 1)

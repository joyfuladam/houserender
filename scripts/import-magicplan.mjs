// Converts a MagicPlan 3D export into the house.json the viewer reads.
//
//   node scripts/import-magicplan.mjs --name "My house" --out private/data/house.json \
//        "1st Floor=first.obj:first-hints.json" "2nd Floor=second.obj"
//
// Each floor is NAME=OBJ[:HINTS], where HINTS is the output of
// magicplan_usd_hints.py for the USDZ of the same floor (optional).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { importMagicplanObj } from '../src/importers/magicplanObj.ts'

const args = process.argv.slice(2)
const take = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i < 0 ? fallback : args.splice(i, 2)[1]
}
const name = take('--name', 'My house')
const out = take('--out', 'private/data/house.json')
const scale = Number(take('--scale', '0.1'))
if (!args.length) throw new Error('Give at least one floor as NAME=OBJ[:HINTS]')

/** Plan extent of the building shell in the OBJ, in meters. */
const shellOf = (text) => {
  let inShell = false
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  for (const line of text.split('\n')) {
    if (line.startsWith('o ')) inShell = line.startsWith('o ExternalWalls')
    else if (inShell && line.startsWith('v ')) {
      const [, x, , z] = line.split(/\s+/).map(Number)
      b.minX = Math.min(b.minX, x * scale)
      b.maxX = Math.max(b.maxX, x * scale)
      b.minZ = Math.min(b.minZ, z * scale)
      b.maxZ = Math.max(b.maxZ, z * scale)
    }
  }
  return b
}

const round = (v) => Math.round(v * 1000) / 1000

const floors = args.map((spec, n) => {
  const [floorName, files] = spec.split('=')
  const [objPath, hintsPath] = files.split(':')
  const text = readFileSync(objPath, 'utf8')
  const hints = hintsPath ? JSON.parse(readFileSync(hintsPath, 'utf8')) : null

  // The USDZ is a scaled-down copy of the OBJ; map it onto the OBJ's shell.
  let toMeters = null
  if (hints?.shell) {
    const o = shellOf(text)
    const k = (o.maxX - o.minX) / (hints.shell.maxX - hints.shell.minX)
    const kz = (o.maxZ - o.minZ) / (hints.shell.maxZ - hints.shell.minZ)
    if (Math.abs(k / kz - 1) > 0.01) throw new Error(`${hintsPath} does not match ${objPath}`)
    toMeters = { k, x: (v) => o.minX + (v - hints.shell.minX) * k, z: (v) => o.minZ + (v - hints.shell.minZ) * k }
  }

  const floor = importMagicplanObj(text, {
    scale,
    floorId: `floor-${n + 1}`,
    floorName,
    doors: toMeters ? hints.doors.map((d) => ({ x: toMeters.x(d.x), y: toMeters.z(d.z), leaf: d.leaf })) : undefined,
  })
  if (toMeters && hints.fixtures.length)
    floor.fixtures = hints.fixtures.map((f, i) => ({
      id: `${floor.id}-fixture-${i + 1}`,
      name: /stair/i.test(f.name) ? 'Stairs' : f.name,
      x: round(toMeters.x(f.x)),
      y: round(toMeters.z(f.z)),
      rotation: 0,
      width: round(f.width * toMeters.k),
      depth: round(f.depth * toMeters.k),
      height: round(f.height * toMeters.k),
    }))
  for (const r of floor.rooms) {
    r.points = r.points.map(([x, y]) => [round(x), round(y)])
    r.wallDepths = r.wallDepths.map(round)
    r.ceilingHeight = round(r.ceilingHeight)
    for (const o of r.openings) for (const k of ['offset', 'width', 'height', 'sill']) o[k] = round(o[k])
  }
  const count = (t) => floor.rooms.reduce((s, r) => s + r.openings.filter((o) => o.type === t).length, 0)
  console.log(`${floorName}: ${floor.rooms.length} rooms, ${count('door')} door sides, ${count('opening')} open doorway sides, ${count('window')} windows, ${floor.fixtures?.length ?? 0} fixtures`)
  return floor
})

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ name, wallThickness: 0.12, floors }, null, 1) + '\n')
console.log(`wrote ${out}`)

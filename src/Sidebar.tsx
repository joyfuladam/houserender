import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useStore } from './store'
import { PRESETS } from './catalog'
import { centroid, fitStatus, polygonArea } from './geometry'
import { lotAcres } from './Site'
import { contourInterval, formatDims, formatElevation, fromDisplay, toDisplay, unitLabel } from './units'
import type { FitStatus, House, Item, Layout } from './types'

const STATUS_TEXT: Record<FitStatus, string> = {
  ok: 'Fits',
  outside: 'Crosses a wall',
  overlap: 'Overlaps another item',
}

const download = (name: string, data: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// Inside a Claude artifact the page cannot start a download, so the layout is
// copied to the clipboard instead.
const IN_ARTIFACT = Boolean(import.meta.env.VITE_ARTIFACT)

const readJson = async <T,>(file: File) => JSON.parse(await file.text()) as T

function NumberField({ label, meters, onChange }: { label: string; meters: number; onChange: (m: number) => void }) {
  const units = useStore((s) => s.units)
  const shown = Math.round(toDisplay(meters, units) * 10) / 10
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={units === 'imperial' ? 1 : 5}
        value={shown}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (isFinite(v) && v >= 0) onChange(fromDisplay(v, units))
        }}
      />
    </label>
  )
}

export function Sidebar() {
  const s = useStore()
  const [preset, setPreset] = useState(0)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'' | 'done' | 'manual'>('')
  const layoutInput = useRef<HTMLInputElement>(null)
  const houseInput = useRef<HTMLInputElement>(null)
  const modelInput = useRef<HTMLInputElement>(null)

  const floor = s.house?.floors.find((f) => f.id === s.floorId) ?? s.house?.floors[0]
  const rooms = floor?.rooms ?? []
  const floorItems = useMemo(() => s.items.filter((it) => it.floorId === floor?.id), [s.items, floor?.id])
  const selected = s.items.find((it) => it.id === s.selectedId)
  const status = (it: Item) => fitStatus(it, rooms, floorItems, floor?.fixtures, floor?.decks)

  // New items land in the middle of the largest room, or the plan center.
  const dropPoint = (): [number, number] => {
    const biggest = [...rooms].sort((a, c) => polygonArea(c.points) - polygonArea(a.points))[0]
    return biggest ? centroid(biggest.points) : [0, 0]
  }

  const add = (p: { name: string; width: number; depth: number; height: number; color: string; modelUrl?: string }) => {
    if (!floor) return
    const [x, y] = dropPoint()
    s.addItem({ ...p, floorId: floor.id, x, y, rotation: 0 })
  }

  const addModel = async (file: File) => {
    setError('')
    const url = URL.createObjectURL(file)
    try {
      const gltf = await new GLTFLoader().loadAsync(url)
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3())
      add({
        name: file.name.replace(/\.(glb|gltf)$/i, ''),
        width: size.x || 1,
        depth: size.z || 1,
        height: size.y || 1,
        color: '#9aa0a6',
        modelUrl: url,
      })
    } catch {
      URL.revokeObjectURL(url)
      setError(`Could not read ${file.name} as a GLB/GLTF model.`)
    }
  }

  const layoutJson = () => JSON.stringify({ name: s.layoutName, items: s.items } satisfies Layout, null, 2)
  const copyLayout = () => {
    navigator.clipboard.writeText(layoutJson()).then(
      () => setCopied('done'),
      () => setCopied('manual'),
    )
  }

  const loadLayout = async (file: File) => {
    setError('')
    try {
      const l = await readJson<Layout>(file)
      if (!Array.isArray(l.items)) throw new Error()
      s.setLayout(l)
    } catch {
      setError(`${file.name} is not a layout file.`)
    }
  }

  const loadHouse = async (file: File) => {
    setError('')
    try {
      const h = await readJson<House>(file)
      if (!Array.isArray(h.floors)) throw new Error()
      s.setHouse(h)
    } catch {
      setError(`${file.name} is not a house file.`)
    }
  }

  return (
    <aside className="sidebar">
      <header>
        <h1>House Render</h1>
        <p className="muted">{s.house?.name}</p>
      </header>

      <section className="row">
        <div className="seg">
          <button className={s.view === '3d' ? 'on' : ''} onClick={() => s.setView('3d')}>
            3D
          </button>
          <button className={s.view === 'plan' ? 'on' : ''} onClick={() => s.setView('plan')}>
            Plan
          </button>
          {s.site && (
            <button className={s.view === 'site' ? 'on' : ''} onClick={() => s.setView('site')}>
              Site
            </button>
          )}
        </div>
        <div className="seg">
          <button className={s.units === 'imperial' ? 'on' : ''} onClick={() => s.setUnits('imperial')}>
            in
          </button>
          <button className={s.units === 'metric' ? 'on' : ''} onClick={() => s.setUnits('metric')}>
            cm
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={!s.lowWalls} onChange={(e) => s.setLowWalls(!e.target.checked)} />
          Full walls
        </label>
      </section>

      {s.house && s.house.floors.length > 1 && (
        <section className="row">
          <select value={floor?.id} onChange={(e) => s.setFloor(e.target.value)}>
            {s.house.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </section>
      )}

      {s.site && s.view === 'site' && (
        <section className="card">
          <h2>Site</h2>
          <dl className="facts">
            {lotAcres(s.site) !== null && (
              <>
                <dt>Lot</dt>
                <dd>{lotAcres(s.site)!.toFixed(2)} acres</dd>
              </>
            )}
            <dt>{s.site.lotRange ? 'Ground on the lot' : 'Ground shown'}</dt>
            <dd>
              {formatElevation(s.site.floorElevation + (s.site.lotRange?.[0] ?? s.site.terrain.min), s.units)} to{' '}
              {formatElevation(s.site.floorElevation + (s.site.lotRange?.[1] ?? s.site.terrain.max), s.units)}
            </dd>
            <dt>First floor</dt>
            <dd>{formatElevation(s.site.floorElevation, s.units)} (estimated)</dd>
            <dt>Ground at the house</dt>
            <dd>
              {formatElevation(s.site.gradeAtHouse.min, s.units, true)} to {formatElevation(s.site.gradeAtHouse.max, s.units, true)} vs. floor
            </dd>
            <dt>Contours</dt>
            <dd>
              every {formatElevation(contourInterval(s.units), s.units)}, darker every{' '}
              {formatElevation(contourInterval(s.units) * 5, s.units)}
            </dd>
          </dl>
          <p className="muted small">
            Yellow: your lot. White: neighboring lots{s.site.buildings?.length ? '; blocks are other buildings, heights approximate' : ''}.
          </p>
          <p className="muted small">
            Elevation: USGS 3DEP 1 m LiDAR. Lot lines: county parcel map, not a survey.
            {s.site.sources.buildings ? ` Buildings: ${s.site.sources.buildings}.` : ''}
          </p>
        </section>
      )}

      <section>
        <h2>Add an item</h2>
        <div className="row">
          <select value={preset} onChange={(e) => setPreset(+e.target.value)}>
            {PRESETS.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => add(PRESETS[preset])}>
            Add
          </button>
        </div>
        <div className="row">
          <button onClick={() => add({ name: 'Custom item', width: 1, depth: 0.5, height: 0.75, color: '#9aa0a6' })}>
            Custom size
          </button>
          <button onClick={() => modelInput.current?.click()}>3D model (.glb)</button>
        </div>
      </section>

      {selected && (
        <section className="card">
          <h2>Selected</h2>
          <label className="field wide">
            <span>Name</span>
            <input value={selected.name} onChange={(e) => s.updateItem(selected.id, { name: e.target.value })} />
          </label>
          <div className="grid3">
            <NumberField label={`W (${unitLabel(s.units)})`} meters={selected.width} onChange={(width) => s.updateItem(selected.id, { width })} />
            <NumberField label={`D (${unitLabel(s.units)})`} meters={selected.depth} onChange={(depth) => s.updateItem(selected.id, { depth })} />
            <NumberField label={`H (${unitLabel(s.units)})`} meters={selected.height} onChange={(height) => s.updateItem(selected.id, { height })} />
          </div>
          <div className="grid3">
            <label className="field">
              <span>Rotation °</span>
              <input
                type="number"
                step={15}
                value={selected.rotation}
                onChange={(e) => s.updateItem(selected.id, { rotation: (+e.target.value || 0) % 360 })}
              />
            </label>
            <NumberField label="Off floor" meters={selected.elevation ?? 0} onChange={(elevation) => s.updateItem(selected.id, { elevation })} />
            <label className="field">
              <span>Color</span>
              <input type="color" value={selected.color} onChange={(e) => s.updateItem(selected.id, { color: e.target.value })} />
            </label>
          </div>
          <label className="field wide">
            <span>Product link</span>
            <input
              type="url"
              placeholder="https://…"
              value={selected.productUrl ?? ''}
              onChange={(e) => s.updateItem(selected.id, { productUrl: e.target.value || undefined })}
            />
          </label>
          <div className="row">
            <button onClick={() => s.updateItem(selected.id, { rotation: (selected.rotation + 90) % 360 })}>Rotate 90°</button>
            <button onClick={() => s.duplicateItem(selected.id)}>Duplicate</button>
            <button className="danger" onClick={() => s.removeItem(selected.id)}>
              Delete
            </button>
          </div>
          <p className={`status ${status(selected)}`}>{STATUS_TEXT[status(selected)]}</p>
        </section>
      )}

      <section>
        <h2>
          Items <span className="muted">({floorItems.length})</span>
        </h2>
        <ul className="items">
          {floorItems.map((it) => {
            const st = status(it)
            return (
              <li key={it.id} className={it.id === s.selectedId ? 'on' : ''} onClick={() => s.select(it.id)}>
                <i style={{ background: it.color }} />
                <div>
                  <b>{it.name}</b>
                  <span className="muted">{formatDims(it.width, it.depth, it.height, s.units)}</span>
                </div>
                {st !== 'ok' && <em className={st}>{st === 'outside' ? 'wall' : 'overlap'}</em>}
              </li>
            )
          })}
          {!floorItems.length && <li className="muted empty">Nothing placed on this floor yet.</li>}
        </ul>
      </section>

      <section>
        <h2>Files</h2>
        <div className="row">
          {IN_ARTIFACT ? (
            <button id="copy-layout" onClick={copyLayout}>
              {copied === 'done' ? 'Copied' : 'Copy layout'}
            </button>
          ) : (
            <button onClick={() => download('layout.json', JSON.parse(layoutJson()))}>Save layout</button>
          )}
          <button onClick={() => layoutInput.current?.click()}>Open layout</button>
          <button onClick={() => houseInput.current?.click()}>Open house</button>
        </div>
        {copied === 'manual' && (
          <textarea id="layout-json" className="json" readOnly rows={5} value={layoutJson()} onFocus={(e) => e.target.select()} />
        )}
        {error && <p className="status outside">{error}</p>}
        <p className="muted small">Drag items to move them. R rotates the selected item 15°, Shift+R 90°, Delete removes it.</p>
      </section>

      <input ref={modelInput} type="file" accept=".glb,.gltf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addModel(f); e.target.value = '' }} />
      <input ref={layoutInput} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadLayout(f); e.target.value = '' }} />
      <input ref={houseInput} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadHouse(f); e.target.value = '' }} />
    </aside>
  )
}

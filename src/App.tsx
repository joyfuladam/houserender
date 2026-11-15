import { useEffect, useState } from 'react'
import { Scene } from './Scene'
import { Sidebar } from './Sidebar'
import { useStore } from './store'
import { formatElevation } from './units'
import type { House, Layout, Site } from './types'

export function App() {
  const house = useStore((s) => s.house)
  const view = useStore((s) => s.view)
  const hover = useStore((s) => s.hoverElevation)
  const site = useStore((s) => s.site)
  const units = useStore((s) => s.units)
  const [error, setError] = useState('')

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    const get = async <T,>(path: string) => {
      const res = await fetch(base + path)
      if (!res.ok) throw new Error(`${path}: ${res.status}`)
      return (await res.json()) as T
    }
    get<House>('data/house.json')
      .then(async (h) => {
        // The bundled layout is only a starting point: keep the layout someone
        // has been working on in this browser, unless it was for another house.
        const sameHouse = useStore.getState().houseKey === h.name
        useStore.getState().setHouse(h)
        if (!sameHouse) useStore.getState().setLayout(await get<Layout>('data/layout.json'))
      })
      .catch((e: Error) => setError(e.message))
    // The site model is optional; without it there is no site view.
    get<Site>('data/site.json')
      .then((site) => useStore.getState().setSite(site))
      .catch(() => useStore.getState().setSite(null))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      const { selectedId, items, updateItem, removeItem, select } = useStore.getState()
      const it = items.find((i) => i.id === selectedId)
      if (e.key === 'Escape') select(null)
      if (!it) return
      if (e.key === 'r' || e.key === 'R') updateItem(it.id, { rotation: (it.rotation + (e.shiftKey ? 90 : 15)) % 360 })
      if (e.key === 'Delete' || e.key === 'Backspace') removeItem(it.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <main className="viewport">
        {house ? <Scene /> : <p className="loading">{error ? `Could not load the house: ${error}` : 'Loading…'}</p>}
        {view === 'site' && site && hover !== null && (
          <div className="readout">
            Ground {formatElevation(hover, units)}
            <span>{formatElevation(hover - site.floorElevation, units, true)} vs. floor</span>
          </div>
        )}
      </main>
      <Sidebar />
    </div>
  )
}

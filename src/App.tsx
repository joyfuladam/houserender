import { useEffect, useState } from 'react'
import { Scene } from './Scene'
import { Sidebar } from './Sidebar'
import { hasSavedLayout, useStore } from './store'
import type { House, Layout } from './types'

const hadSavedLayout = hasSavedLayout()

export function App() {
  const house = useStore((s) => s.house)
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
        useStore.getState().setHouse(h)
        // The bundled layout is only a starting point; never overwrite the
        // layout someone has been working on in this browser.
        if (!hadSavedLayout) useStore.getState().setLayout(await get<Layout>('data/layout.json'))
      })
      .catch((e: Error) => setError(e.message))
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
      </main>
      <Sidebar />
    </div>
  )
}

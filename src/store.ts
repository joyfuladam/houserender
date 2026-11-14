import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { House, Item, Layout } from './types'
import type { Units } from './units'

export type ViewMode = '3d' | 'plan'

interface State {
  house: House | null
  floorId: string
  items: Item[]
  layoutName: string
  /** Which house the saved layout belongs to. */
  houseKey: string
  selectedId: string | null
  dragging: boolean
  view: ViewMode
  lowWalls: boolean
  units: Units
  setHouse: (h: House) => void
  setFloor: (id: string) => void
  setLayout: (l: Layout) => void
  addItem: (it: Omit<Item, 'id'>) => string
  updateItem: (id: string, patch: Partial<Item>) => void
  removeItem: (id: string) => void
  duplicateItem: (id: string) => void
  select: (id: string | null) => void
  setDragging: (d: boolean) => void
  setView: (v: ViewMode) => void
  setLowWalls: (v: boolean) => void
  setUnits: (u: Units) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      house: null,
      floorId: '',
      items: [],
      layoutName: 'Untitled',
      houseKey: '',
      selectedId: null,
      dragging: false,
      view: '3d',
      lowWalls: true,
      units: 'imperial',
      setHouse: (house) =>
        set((s) => ({
          house,
          houseKey: house.name,
          floorId: house.floors.some((f) => f.id === s.floorId) ? s.floorId : (house.floors[0]?.id ?? ''),
        })),
      setFloor: (floorId) => set({ floorId, selectedId: null }),
      setLayout: (l) => set({ items: l.items, layoutName: l.name, selectedId: null }),
      addItem: (it) => {
        const id = uid()
        set((s) => ({ items: [...s.items, { ...it, id }], selectedId: id }))
        return id
      },
      updateItem: (id, patch) =>
        set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
      removeItem: (id) =>
        set((s) => ({
          items: s.items.filter((it) => it.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      duplicateItem: (id) => {
        const src = get().items.find((it) => it.id === id)
        if (src) get().addItem({ ...src, x: src.x + 0.3, y: src.y + 0.3 })
      },
      select: (selectedId) => set({ selectedId }),
      setDragging: (dragging) => set({ dragging }),
      setView: (view) => set({ view }),
      setLowWalls: (lowWalls) => set({ lowWalls }),
      setUnits: (units) => set({ units }),
    }),
    {
      name: 'houserender',
      version: 1,
      // The house itself always comes from the data file; only the working
      // layout and view preferences live in the browser.
      partialize: (s) => ({
        items: s.items.map((it) => (it.modelUrl?.startsWith('blob:') ? { ...it, modelUrl: undefined } : it)),
        layoutName: s.layoutName,
        houseKey: s.houseKey,
        floorId: s.floorId,
        view: s.view,
        lowWalls: s.lowWalls,
        units: s.units,
      }),
    },
  ),
)

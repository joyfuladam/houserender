import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { MapControls, OrbitControls, OrthographicCamera, PerspectiveCamera, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from './store'
import { bounds, centroid, fitStatus, polygonArea, snap, wallPieces } from './geometry'
import { formatArea } from './units'
import { Buildings, LotLine, SiteFrame, Terrain, siteBounds } from './Site'
import { DeckMesh } from './Deck'
import type { Deck, FitStatus, Fixture, Item, Room } from './types'

const LOW_WALL = 0.9
const NO_FIXTURES: Fixture[] = []
const NO_DECKS: Deck[] = []
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

function RoomMesh(p: { room: Room; thickness: number; maxHeight: number; plan: boolean; foundation: number }) {
  const { room, thickness, maxHeight, plan, foundation } = p
  const floor = useMemo(() => {
    const shape = new THREE.Shape(room.points.map(([x, y]) => new THREE.Vector2(x, -y)))
    return new THREE.ShapeGeometry(shape)
  }, [room.points])
  const pieces = useMemo(() => wallPieces(room, thickness / 2, maxHeight), [room, thickness, maxHeight])
  return (
    <group>
      <mesh geometry={floor} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={room.floorColor ?? '#cdbfa8'} roughness={0.85} />
      </mesh>
      {pieces.map((p, i) => (
        <mesh key={i} position={p.position} rotation={[0, p.rotationY, 0]} castShadow={p.kind === 'wall'} receiveShadow>
          <boxGeometry args={p.size} />
          {p.kind === 'glass' ? (
            <meshStandardMaterial color="#9fd0e6" transparent opacity={0.35} roughness={0.1} />
          ) : p.kind === 'threshold' ? (
            <meshStandardMaterial color={room.floorColor ?? '#cdbfa8'} roughness={0.85} />
          ) : (
            <meshStandardMaterial color={plan ? '#3d424b' : (room.wallColor ?? '#f1eee8')} roughness={0.95} />
          )}
        </mesh>
      ))}
      {/* Where the ground falls away from the house, show the foundation down to it. */}
      {foundation > 0 &&
        pieces
          .filter((p) => p.kind !== 'glass')
          .map((p, i) => (
            <mesh
              key={`f${i}`}
              position={[p.position[0], -foundation / 2, p.position[2]]}
              rotation={[0, p.rotationY, 0]}
              receiveShadow
            >
              <boxGeometry args={[p.size[0], foundation, Math.max(p.size[2], 0.05)]} />
              <meshStandardMaterial color="#9a958c" roughness={1} />
            </mesh>
          ))}
    </group>
  )
}

/** Text drawn to a canvas and shown as a camera-facing sprite, so it works in both views. */
function RoomLabel({ room, height }: { room: Room; height: number }) {
  const units = useStore((s) => s.units)
  const area = formatArea(polygonArea(room.points), units)
  const { texture, aspect } = useMemo(() => {
    const scale = 4
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const title = `600 ${13 * scale}px system-ui, sans-serif`
    const sub = `${11 * scale}px system-ui, sans-serif`
    ctx.font = title
    const w = Math.max(ctx.measureText(room.name).width, ctx.measureText(area).width) + 16 * scale
    const h = 38 * scale
    canvas.width = Math.ceil(w)
    canvas.height = h
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.beginPath()
    ctx.roundRect(0, 0, canvas.width, h, 5 * scale)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#23272e'
    ctx.font = title
    ctx.fillText(room.name, canvas.width / 2, 12 * scale)
    ctx.fillStyle = '#6b7280'
    ctx.font = sub
    ctx.fillText(area, canvas.width / 2, 27 * scale)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return { texture, aspect: canvas.width / h }
  }, [room.name, area])
  const [cx, cy] = centroid(room.points)
  return (
    <sprite position={[cx, 1.4, cy]} scale={[height * aspect, height, 1]} renderOrder={10} raycast={() => null}>
      <spriteMaterial map={texture} depthTest={false} toneMapped={false} transparent />
    </sprite>
  )
}

/** Fits an imported model into the item's box: footprint centered, base on the floor. */
function Model({ url, size }: { url: string; size: [number, number, number] }) {
  const { scene } = useGLTF(url)
  const { object, scale, offset } = useMemo(() => {
    const object = scene.clone(true)
    object.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    const box = new THREE.Box3().setFromObject(object)
    const dim = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale: [number, number, number] = [size[0] / (dim.x || 1), size[1] / (dim.y || 1), size[2] / (dim.z || 1)]
    const offset: [number, number, number] = [-center.x, -box.min.y, -center.z]
    return { object, scale, offset }
  }, [scene, size])
  return (
    <group scale={scale}>
      <primitive object={object} position={offset} />
    </group>
  )
}

/** Top-down camera zoomed so the whole floor fits the viewport. */
function PlanCamera(p: { position: [number, number, number]; target: [number, number, number]; width: number; depth: number; enabled: boolean }) {
  const size = useThree((s) => s.size)
  const zoom = Math.min(size.width / (p.width + 2), size.height / (p.depth + 2))
  return (
    <>
      <OrthographicCamera makeDefault position={p.position} up={[0, 0, -1]} zoom={zoom} near={0.1} far={200} />
      <MapControls makeDefault enabled={p.enabled} enableRotate={false} target={p.target} screenSpacePanning />
    </>
  )
}

const STATUS_COLOR: Record<FitStatus, string> = { ok: '#2f6fed', outside: '#d93025', overlap: '#e8710a' }

function ItemMesh({ item, status }: { item: Item; status: FitStatus }) {
  const selected = useStore((s) => s.selectedId === item.id)
  const select = useStore((s) => s.select)
  const updateItem = useStore((s) => s.updateItem)
  const setDragging = useStore((s) => s.setDragging)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const hit = useMemo(() => new THREE.Vector3(), [])

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    select(item.id)
    if (!e.ray.intersectPlane(GROUND, hit)) return
    drag.current = { dx: item.x - hit.x, dy: item.y - hit.z }
    setDragging(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current || !e.ray.intersectPlane(GROUND, hit)) return
    e.stopPropagation()
    updateItem(item.id, { x: snap(hit.x + drag.current.dx), y: snap(hit.z + drag.current.dy) })
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  const size = useMemo<[number, number, number]>(
    () => [item.width, item.height, item.depth],
    [item.width, item.height, item.depth],
  )
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0] + 0.02, size[1] + 0.02, size[2] + 0.02)),
    [size],
  )
  const bad = status !== 'ok'
  const outline = selected || bad
  const box = (
    <mesh position={[0, item.height / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={item.color} roughness={0.8} />
    </mesh>
  )
  return (
    <group
      position={[item.x, item.elevation ?? 0, item.y]}
      rotation={[0, (-item.rotation * Math.PI) / 180, 0]}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {item.modelUrl ? (
        <Suspense fallback={box}>
          <Model url={item.modelUrl} size={size} />
          {/* Invisible box so the whole footprint is easy to grab. */}
          <mesh position={[0, item.height / 2, 0]}>
            <boxGeometry args={size} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </Suspense>
      ) : (
        box
      )}
      {outline && (
        <lineSegments position={[0, item.height / 2, 0]} geometry={edges}>
          <lineBasicMaterial color={bad ? STATUS_COLOR[status] : STATUS_COLOR.ok} />
        </lineSegments>
      )}
      {/* Front marker: the side people face or sit on. */}
      {selected && (
        <mesh position={[0, 0.015 - (item.elevation ?? 0), item.depth / 2 + 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.06, 3]} />
          <meshBasicMaterial color={STATUS_COLOR.ok} />
        </mesh>
      )}
    </group>
  )
}

export function Scene() {
  const house = useStore((s) => s.house)
  const floorId = useStore((s) => s.floorId)
  const items = useStore((s) => s.items)
  const view = useStore((s) => s.view)
  const lowWalls = useStore((s) => s.lowWalls)
  const dragging = useStore((s) => s.dragging)
  const select = useStore((s) => s.select)
  const site = useStore((s) => s.site)
  const siteView = view === 'site' && site !== null

  const floor = house?.floors.find((f) => f.id === floorId) ?? house?.floors[0]
  const rooms = floor?.rooms ?? []
  const fixtures = floor?.fixtures ?? NO_FIXTURES
  const decks = floor?.decks ?? NO_DECKS
  const thickness = house?.wallThickness ?? 0.12
  const b = useMemo(() => bounds([...rooms, ...decks]), [rooms, decks])
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minY + b.maxY) / 2
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  const floorItems = useMemo(() => items.filter((it) => it.floorId === floor?.id), [items, floor?.id])
  const statuses = useMemo(
    () => new Map(floorItems.map((it) => [it.id, fitStatus(it, rooms, floorItems, fixtures, decks)])),
    [floorItems, rooms, fixtures, decks],
  )

  const cam = useMemo(
    () => ({
      persp: [cx + span * 0.6, span * 1.05, cz + span * 1.2] as [number, number, number],
      orbitTarget: [cx, 0.5, cz] as [number, number, number],
      ortho: [cx, 50, cz] as [number, number, number],
      mapTarget: [cx, 0, cz] as [number, number, number],
    }),
    [cx, cz, span],
  )
  const siteCam = useMemo(() => {
    if (!site) return null
    const sb = siteBounds(site)
    const scx = (sb.minX + sb.maxX) / 2
    const scz = (sb.minZ + sb.maxZ) / 2
    const sspan = Math.max(sb.maxX - sb.minX, sb.maxZ - sb.minZ)
    return {
      position: [scx + sspan * 0.25, sspan * 0.95, scz + sspan * 0.7] as [number, number, number],
      target: [scx, 0, scz] as [number, number, number],
      span: sspan,
    }
  }, [site])

  if (!house || !floor) return null
  const maxHeight = view !== 'plan' && !lowWalls ? Infinity : LOW_WALL
  const foundation = siteView ? Math.max(0, -site.gradeAtHouse.min + 0.3) : 0

  return (
    <Canvas shadows dpr={[1, 2]} onPointerMissed={() => select(null)} gl={{ preserveDrawingBuffer: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}>
      {siteView && siteCam ? (
        <>
          <PerspectiveCamera makeDefault fov={45} near={0.5} far={siteCam.span * 10} position={siteCam.position} />
          <OrbitControls
            makeDefault
            enabled={!dragging}
            target={siteCam.target}
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={3}
            maxDistance={siteCam.span * 3}
          />
        </>
      ) : view !== 'plan' ? (
        <>
          <PerspectiveCamera makeDefault fov={45} position={cam.persp} />
          <OrbitControls
            makeDefault
            enabled={!dragging}
            target={cam.orbitTarget}
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={1}
            maxDistance={span * 4}
          />
        </>
      ) : (
        <PlanCamera position={cam.ortho} target={cam.mapTarget} width={b.maxX - b.minX} depth={b.maxY - b.minY} enabled={!dragging} />
      )}
      <hemisphereLight args={['#ffffff', '#b7b2a8', 1.1]} />
      <directionalLight
        position={[cx + span * 0.6, span * 1.4, cz - span * 0.4]}
        intensity={1.6}
        castShadow={view !== 'plan'}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-bias={-0.0004}
      />
      {siteView ? (
        <SiteFrame site={site}>
          <Suspense fallback={null}>
            <Terrain site={site} base={import.meta.env.BASE_URL} />
          </Suspense>
          <LotLine site={site} />
          <Buildings site={site} />
        </SiteFrame>
      ) : (
        <mesh position={[cx, -0.01, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[span * 6, span * 6]} />
          <shadowMaterial opacity={0.2} />
        </mesh>
      )}
      {rooms.map((r) => (
        <RoomMesh key={r.id} room={r} thickness={thickness} maxHeight={maxHeight} plan={view === 'plan'} foundation={foundation} />
      ))}
      {!siteView && rooms.map((r) => <RoomLabel key={r.id} room={r} height={Math.max(0.5, span * 0.04)} />)}
      {decks.map((d) => (
        <DeckMesh key={d.id} deck={d} maxHeight={maxHeight} foundation={foundation} />
      ))}
      {fixtures.map((f) => (
        <mesh
          key={f.id}
          position={[f.x, Math.min(f.height, maxHeight) / 2, f.y]}
          rotation={[0, (-f.rotation * Math.PI) / 180, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[f.width, Math.min(f.height, maxHeight), f.depth]} />
          <meshStandardMaterial color="#a9a49b" roughness={0.9} />
        </mesh>
      ))}
      {floorItems.map((it) => (
        <ItemMesh key={it.id} item={it} status={statuses.get(it.id) ?? 'ok'} />
      ))}
    </Canvas>
  )
}

# houserender

A digital copy of the house for trying furniture before buying it: place items at
their real dimensions, see whether they fit, and compare layouts.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # geometry tests
npm run build    # type-check + production build
```

## What works today

- 3D view (orbit) and top-down plan view of the house, with doors, windows and
  room areas.
- Add furniture from a list of standard sizes, by custom dimensions, or from a
  `.glb`/`.gltf` 3D model. Drag to move, `R` to rotate 15° (`Shift+R` 90°),
  `Delete` to remove.
- Fit check on every item: flags anything that crosses a wall or overlaps
  another item. Rugs and items hung above the floor don't count as collisions.
- Inches or centimeters.
- Save and open layouts as JSON files. The working layout is also kept in the
  browser between visits.

## Data

Everything is plain JSON in meters, so layouts can be edited, reviewed and
versioned like any other file.

- `public/data/house.json` — the building. Each room is a polygon of wall
  centerline points plus its doors and windows (`src/types.ts` has the schema).
  **The file checked in now is a made-up sample**; it is replaced by the import
  of the MagicPlan capture.
- `public/data/layout.json` — the starting furniture layout. Each item has a
  position, rotation, width/depth/height, and optionally a product link and a
  3D model.

## Not built yet

- MagicPlan importer (needs the real export files to build and check against).
- Adding an item from a retailer product page (dimensions, photo, price, and
  the 3D model when the retailer publishes one).
- Suggested layouts, checked against clearances, door swings and sight lines.
- Walk-through view, real materials and lighting, multiple saved layouts side
  by side.

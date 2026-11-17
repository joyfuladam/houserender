"""Builds the site model (terrain, aerial photo, lot line) around the house.

    pip install numpy tifffile pyproj pillow
    python scripts/site_from_usgs.py --house private/data/house.json \
        --origin EASTING NORTHING --rotation DEGREES --epsg 269XX \
        --parcels https://<county parcel MapServer>/<layer> --out private/data

--origin is where the floor plan's (0, 0) sits, in the projected CRS given by
--epsg (UTM, meters). --rotation is the compass bearing, in degrees clockwise
from north, that the plan's "up" (negative y) faces. scripts/fit_house_to_lidar.py
finds both from USGS LiDAR.

Sources:
  elevation  USGS 3DEP 1 m bare-earth DEM (elevation.nationalmap.gov ImageServer)
  photo      USGS National Map orthoimagery (basemap.nationalmap.gov), or any
             ArcGIS MapServer given by --photo (in Pennsylvania, PASDA's
             PEMAImagery2021_2023 is far sharper)
  buildings  Microsoft Global ML Building Footprints, with --buildings
  lot line   the county parcel layer given by --parcels (optional), an ArcGIS
             MapServer polygon layer such as the county layers on PASDA
"""
import argparse
import base64
import csv
import gzip
import io
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
import tifffile
from PIL import Image, ImageDraw

DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
PHOTO = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"


def get(url, params, timeout=300, tries=4):
    """GET with a few retries: the USGS services return occasional 502/503s."""
    for attempt in range(tries):
        try:
            q = f"?{urllib.parse.urlencode(params)}" if params else ""
            with urllib.request.urlopen(url + q, timeout=timeout) as r:
                return r.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt == tries - 1 or (isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429):
                raise
            time.sleep(5 * 2**attempt)


def plan_to_world(rotation_deg):
    """(x, y) in the plan -> (dE, dN) from the plan origin."""
    t = math.radians(rotation_deg)
    c, s = math.cos(t), math.sin(t)
    return lambda x, y: (c * x - s * y, -s * x - c * y)


BUILDING_INDEX = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"


def quadkey(lon, lat, z):
    x = (lon + 180) / 360
    sl = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + sl) / (1 - sl)) / (4 * math.pi)
    tx, ty = int(x * 2**z), int(y * 2**z)
    return "".join(str((1 if tx >> i & 1 else 0) + (2 if ty >> i & 1 else 0)) for i in range(z - 1, -1, -1))


def footprints(epsg, E0, N0, box, house, sample, floor_elev):
    """Building outlines from Microsoft's footprints inside `box`, minus the house itself."""
    from pyproj import Transformer

    w, s, e, n = box
    to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
    to_xy = Transformer.from_crs(4326, epsg, always_xy=True)
    corners = [to_ll.transform(E0 + x, N0 + y) for x in (w, e) for y in (s, n)]
    lons, lats = [c[0] for c in corners], [c[1] for c in corners]
    keys = {quadkey(lo, la, 9) for lo, la in corners}
    rows = [r for r in csv.DictReader(io.StringIO(get(BUILDING_INDEX, {}).decode()))
            if r["QuadKey"] in keys and r["Location"] == "UnitedStates"]
    house_pts = np.array([p for poly in house for p in poly])
    hx0, hy0 = house_pts.min(axis=0)
    hx1, hy1 = house_pts.max(axis=0)
    out = []
    for r in rows:
        with gzip.open(io.BytesIO(get(r["Url"], {}, timeout=900)), "rt") as f:
            for line in f:
                if not line.startswith("{"):
                    continue
                g = json.loads(line)
                ring = g["geometry"]["coordinates"][0]
                lo, la = ring[0]
                if not (min(lons) <= lo <= max(lons) and min(lats) <= la <= max(lats)):
                    continue
                pts = [to_xy.transform(x, y) for x, y in ring]
                pts = [(px - E0, py - N0) for px, py in pts]
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                if not (w <= min(xs) and max(xs) <= e and s <= min(ys) and max(ys) <= n):
                    continue
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                if hx0 - 2 <= cx <= hx1 + 2 and hy0 - 2 <= cy <= hy1 + 2:
                    continue  # the house, which is modeled from the floor plan
                h = g["properties"].get("height", -1)
                base = min(sample(x, y) for x, y in pts) - floor_elev
                out.append({
                    "ring": [[round(x, 2), round(y, 2)] for x, y in pts],
                    "height": round(h, 1) if h and h > 0 else None,
                    "base": round(base, 2),
                })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--house", required=True)
    ap.add_argument("--origin", nargs=2, type=float, required=True)
    ap.add_argument("--rotation", type=float, required=True)
    ap.add_argument("--epsg", type=int, required=True)
    ap.add_argument("--parcels")
    ap.add_argument("--margin", type=float, default=40, help="meters of terrain around the lot")
    ap.add_argument("--cell", type=float, default=1.0, help="terrain grid spacing, meters")
    ap.add_argument("--neighbors", action="store_true", help="also draw the other parcels in the area")
    ap.add_argument("--buildings", action="store_true", help="add building footprints around the house")
    ap.add_argument("--photo", default=PHOTO.rsplit("/export", 1)[0], help="ArcGIS MapServer for the aerial photo")
    ap.add_argument("--photo-layers", help='e.g. "show:3"')
    ap.add_argument("--photo-res", type=float, default=0.2, help="meters per photo pixel (at most 4096 px a side)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    E0, N0 = a.origin
    to_world = plan_to_world(a.rotation)
    floor = json.load(open(a.house))["floors"][0]

    # Lot line from the county parcel layer, else a square around the house.
    lot, lot_source = None, None
    if a.parcels:
        q = {
            "geometry": json.dumps({"x": E0, "y": N0, "spatialReference": {"wkid": a.epsg}}),
            "geometryType": "esriGeometryPoint",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "PIN",
            "returnGeometry": "true",
            "outSR": a.epsg,
            "f": "json",
        }
        feats = json.loads(get(f"{a.parcels}/query", q))["features"]
        if feats:
            lot = [(x - E0, y - N0) for x, y in feats[0]["geometry"]["rings"][0]]
            lot_source = a.parcels
    pts = np.array(lot if lot else [(-60, -60), (60, 60)])
    w = math.floor(pts[:, 0].min() - a.margin)
    e = math.ceil(pts[:, 0].max() + a.margin)
    s = math.floor(pts[:, 1].min() - a.margin)
    n = math.ceil(pts[:, 1].max() + a.margin)
    cols, rows = int((e - w) / a.cell) + 1, int((n - s) / a.cell) + 1

    # Elevation: one sample per grid point, so ask for a raster whose pixel
    # centers fall on the grid.
    half = a.cell / 2
    bbox = f"{E0 + w - half},{N0 + s - half},{E0 + e + half},{N0 + n + half}"
    tif = get(DEM, {
        "bbox": bbox, "bboxSR": a.epsg, "imageSR": a.epsg, "size": f"{cols},{rows}",
        "format": "tiff", "pixelType": "F32", "noData": -9999,
        "interpolation": "RSP_BilinearInterpolation", "f": "image",
    })
    z = tifffile.imread(io.BytesIO(tif)).astype(np.float64)
    if (z < -1000).any():
        raise SystemExit("The elevation service returned gaps for this area")

    # Floor level: highest ground along the outside of the house, so the floor
    # never sits below grade. The terrain inside the footprint is cut down to
    # just under the floor so it doesn't show through.
    def sample(dE, dN):
        c = (dE - w) / a.cell
        r = (n - dN) / a.cell
        c0, r0 = min(max(int(c), 0), cols - 2), min(max(int(r), 0), rows - 2)
        fc, fr = c - c0, r - r0
        return (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr)
                + z[r0 + 1, c0] * (1 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)

    footprint = []
    for room in floor["rooms"]:
        footprint.append([to_world(x, y) for x, y in room["points"]])
    ring = []
    for poly in footprint:
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
            for t in np.linspace(0, 1, 8):
                ring.append(sample(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
    floor_elev = float(np.max(ring)) + 0.15
    grade = {"min": round(float(np.min(ring)) - floor_elev, 2), "max": round(float(np.max(ring)) - floor_elev, 2)}

    mask = Image.new("L", (cols, rows), 0)
    d = ImageDraw.Draw(mask)
    for poly in footprint:
        d.polygon([((x - w) / a.cell, (n - y) / a.cell) for x, y in poly], fill=1, outline=1)
    inside = np.array(mask, bool)
    z[inside] = np.minimum(z[inside], floor_elev - 0.05)
    # Keep the ground below decks too.
    for deck in floor.get("decks", []):
        m = Image.new("L", (cols, rows), 0)
        ImageDraw.Draw(m).polygon([((x - w) / a.cell, (n - y) / a.cell) for x, y in (to_world(*p) for p in deck["points"])], fill=1)
        under = np.array(m, bool)
        z[under] = np.minimum(z[under], floor_elev + deck["height"] - 0.3)

    heights = np.round((z - floor_elev) * 100).astype("<i2")  # cm relative to the floor

    # Elevation range within the lot itself (the grid covers more than the lot).
    lot_range = None
    if lot:
        m = Image.new("L", (cols, rows), 0)
        ImageDraw.Draw(m).polygon([((x - w) / a.cell, (n - y) / a.cell) for x, y in lot], fill=1)
        zl = z[np.array(m, bool)]
        lot_range = [round(float(zl.min()) - floor_elev, 2), round(float(zl.max()) - floor_elev, 2)]

    # Aerial photo covering the same area.
    width_m, height_m = (e - w) + a.cell, (n - s) + a.cell
    res = max(a.photo_res, width_m / 4096, height_m / 4096)
    q = {
        "bbox": bbox, "bboxSR": a.epsg, "imageSR": a.epsg,
        "size": f"{round(width_m / res)},{round(height_m / res)}", "format": "jpg", "f": "image",
    }
    if a.photo_layers:
        q["layers"] = a.photo_layers
    photo = get(f"{a.photo}/export", q)
    os.makedirs(a.out, exist_ok=True)
    Image.open(io.BytesIO(photo)).convert("RGB").save(os.path.join(a.out, "site-photo.jpg"), quality=82)

    # Other parcels in the area, for context. Only the outlines are kept.
    neighbors = []
    if a.parcels and a.neighbors:
        q = {
            "geometry": json.dumps({"xmin": E0 + w, "ymin": N0 + s, "xmax": E0 + e, "ymax": N0 + n,
                                    "spatialReference": {"wkid": a.epsg}}),
            "geometryType": "esriGeometryEnvelope", "spatialRel": "esriSpatialRelIntersects",
            "outFields": "OBJECTID", "returnGeometry": "true", "outSR": a.epsg, "f": "json",
        }
        for f in json.loads(get(f"{a.parcels}/query", q))["features"]:
            for ring_ in f["geometry"]["rings"]:
                r = [(round(x - E0, 2), round(y - N0, 2)) for x, y in ring_]
                if lot and abs(r[0][0] - lot[0][0]) < 0.01 and abs(r[0][1] - lot[0][1]) < 0.01:
                    continue  # the lot itself
                neighbors.append(r)

    buildings = []
    if a.buildings:
        buildings = footprints(a.epsg, E0, N0, (w, s, e, n), footprint, sample, floor_elev)

    site = {
        "crs": f"EPSG:{a.epsg}",
        "origin": [E0, N0],
        "rotationDeg": a.rotation,
        "floorElevation": round(floor_elev, 2),
        "gradeAtHouse": grade,
        "terrain": {
            "west": w, "north": n, "cell": a.cell, "cols": cols, "rows": rows,
            "heightsCm": base64.b64encode(heights.tobytes()).decode(),
            "min": round(float(z.min()) - floor_elev, 2), "max": round(float(z.max()) - floor_elev, 2),
        },
        "lot": [[round(x, 2), round(y, 2)] for x, y in lot] if lot else None,
        "lotRange": lot_range,
        "neighbors": neighbors,
        "buildings": buildings,
        "photo": "site-photo.jpg",
        "sources": {
            "elevation": "USGS 3DEP 1 m DEM",
            "photo": a.photo,
            "buildings": "Microsoft Global ML Building Footprints" if a.buildings else None,
            "lot": lot_source,
        },
    }
    json.dump(site, open(os.path.join(a.out, "site.json"), "w"))
    area = 0.0
    if lot:
        area = abs(sum(lot[i][0] * lot[i + 1][1] - lot[i + 1][0] * lot[i][1] for i in range(len(lot) - 1))) / 2
    print(f"{len(neighbors)} neighboring parcels, {len(buildings)} buildings, photo {res:.2f} m/px")
    print(f"terrain {cols} x {rows} at {a.cell} m, elevation {z.min():.1f}-{z.max():.1f} m, "
          f"floor {floor_elev:.2f} m, grade at house {grade}, lot {area / 4046.86:.2f} acres")


if __name__ == "__main__":
    main()

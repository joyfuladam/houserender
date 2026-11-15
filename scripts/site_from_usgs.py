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
  photo      USGS National Map orthoimagery (basemap.nationalmap.gov)
  lot line   the county parcel layer given by --parcels (optional), an ArcGIS
             MapServer polygon layer such as the county layers on PASDA
"""
import argparse
import base64
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
            with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=timeout) as r:
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--house", required=True)
    ap.add_argument("--origin", nargs=2, type=float, required=True)
    ap.add_argument("--rotation", type=float, required=True)
    ap.add_argument("--epsg", type=int, required=True)
    ap.add_argument("--parcels")
    ap.add_argument("--margin", type=float, default=40, help="meters of terrain around the lot")
    ap.add_argument("--cell", type=float, default=1.0, help="terrain grid spacing, meters")
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

    heights = np.round((z - floor_elev) * 100).astype("<i2")  # cm relative to the floor

    # Aerial photo covering the same area.
    photo = get(PHOTO, {
        "bbox": bbox, "bboxSR": a.epsg, "imageSR": a.epsg,
        "size": f"{min(2048, cols * 4)},{min(2048, rows * 4)}", "format": "jpg", "f": "image",
    })
    os.makedirs(a.out, exist_ok=True)
    Image.open(io.BytesIO(photo)).convert("RGB").save(os.path.join(a.out, "site-photo.jpg"), quality=85)

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
        "photo": "site-photo.jpg",
        "sources": {
            "elevation": "USGS 3DEP 1 m DEM",
            "photo": "USGS National Map orthoimagery",
            "lot": lot_source,
        },
    }
    json.dump(site, open(os.path.join(a.out, "site.json"), "w"))
    area = 0.0
    if lot:
        area = abs(sum(lot[i][0] * lot[i + 1][1] - lot[i + 1][0] * lot[i][1] for i in range(len(lot) - 1))) / 2
    print(f"terrain {cols} x {rows} at {a.cell} m, elevation {z.min():.1f}-{z.max():.1f} m, "
          f"floor {floor_elev:.2f} m, grade at house {grade}, lot {area / 4046.86:.2f} acres")


if __name__ == "__main__":
    main()

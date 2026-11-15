"""Finds where the floor plan sits on the ground, from USGS LiDAR.

    pip install numpy scipy pyproj pillow "laspy[lazrs]"
    python scripts/fit_house_to_lidar.py --house private/data/house.json \
        --near LON LAT --ept DATASET --epsg 269XX

--near is a rough position of the house (longitude, latitude), within ~30 m.
--ept is the dataset name in the public USGS LiDAR bucket
(s3://usgs-lidar-public); the USGS National Map's LiDAR Explorer lists which
surveys cover a place.

Roof points are the single-return LiDAR points 2-10 m above the bare-earth
DEM. The plan's room outlines are rotated, optionally mirrored, and slid over
that roof; the pose covering the most roof while leaving the least plan off
the roof wins. Plan area off the roof counts half, because the house may have
been extended after the LiDAR was flown.

Prints --origin and --rotation for site_from_usgs.py and writes
lidar-fit.png to check the result by eye.
"""
import argparse
import io
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request

import laspy
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage
from scipy.signal import fftconvolve

RES = 0.25  # m per raster cell
HALF = 45  # m around --near
BUCKET = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"
DEM = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"


def get(url, params=None, timeout=180, tries=4):
    """GET with a few retries: the USGS services return occasional 502/503s."""
    q = f"?{urllib.parse.urlencode(params)}" if params else ""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url + q, timeout=timeout) as r:
                return r.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt == tries - 1 or (isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429):
                raise
            time.sleep(5 * 2**attempt)


def lidar_points(dataset, lon, lat, epsg):
    """Points within HALF m of (lon, lat) from an Entwine Point Tile dataset, in `epsg`."""
    base = f"{BUCKET}/{dataset}"
    ept = json.loads(get(f"{base}/ept.json"))
    if ept["srs"].get("horizontal") != "3857":
        raise SystemExit(f"{dataset} is not in Web Mercator; this script expects EPSG:3857 tiles")
    cx, cy = Transformer.from_crs(4326, 3857, always_xy=True).transform(lon, lat)
    k = 1 / math.cos(math.radians(lat))  # Web Mercator stretch at this latitude
    box = (cx - HALF * k, cy - HALF * k, cx + HALF * k, cy + HALF * k)
    b0 = ept["bounds"]

    def overlaps(d, x, y):
        size = (b0[3] - b0[0]) / 2**d
        x0, y0 = b0[0] + x * size, b0[1] + y * size
        return not (x0 + size < box[0] or x0 > box[2] or y0 + size < box[1] or y0 > box[3])

    nodes, pending = [], ["0-0-0-0"]
    while pending:
        for key, count in json.loads(get(f"{base}/ept-hierarchy/{pending.pop()}.json")).items():
            d, x, y, _ = map(int, key.split("-"))
            if overlaps(d, x, y):
                (pending if count == -1 else nodes).append(key)

    to_proj = Transformer.from_crs(3857, epsg, always_xy=True)
    parts = []
    for key in nodes:
        las = laspy.read(io.BytesIO(get(f"{base}/ept-data/{key}.laz")))
        x, y = np.asarray(las.x), np.asarray(las.y)
        m = (x >= box[0]) & (x <= box[2]) & (y >= box[1]) & (y <= box[3])
        if m.any():
            px, py = to_proj.transform(x[m], y[m])
            parts.append(np.column_stack([px, py, np.asarray(las.z)[m], np.asarray(las.number_of_returns)[m]]))
    return np.vstack(parts)


def ground(epsg, x0, y0, size):
    """1 m bare-earth DEM covering [x0, x0 + size] x [y0, y0 + size]."""
    import tifffile

    raw = get(DEM, {
        "bbox": f"{x0},{y0},{x0 + size},{y0 + size}", "bboxSR": epsg, "imageSR": epsg,
        "size": f"{size},{size}", "format": "tiff", "pixelType": "F32", "f": "image",
    })
    return tifffile.imread(io.BytesIO(raw)).astype(np.float64)


def plan_to_world(theta, mirror):
    t = math.radians(theta)
    c, s = math.cos(t), math.sin(t)

    def f(x, y):
        if mirror:
            x = -x
        return c * x - s * y, -s * x - c * y

    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--house", required=True)
    ap.add_argument("--near", nargs=2, type=float, required=True, metavar=("LON", "LAT"))
    ap.add_argument("--ept", required=True)
    ap.add_argument("--epsg", type=int, required=True)
    ap.add_argument("--floor", type=int, default=0, help="index of the floor whose outline to fit")
    ap.add_argument("--png", default="lidar-fit.png")
    a = ap.parse_args()

    lon, lat = a.near
    cx, cy = Transformer.from_crs(4326, a.epsg, always_xy=True).transform(lon, lat)
    pts = lidar_points(a.ept, lon, lat, a.epsg)
    x0, y0 = math.floor(cx - HALF), math.floor(cy - HALF)
    dem = ground(a.epsg, x0, y0, 2 * HALF)
    col = np.clip((pts[:, 0] - x0).astype(int), 0, 2 * HALF - 1)
    row = np.clip(((y0 + 2 * HALF) - pts[:, 1]).astype(int), 0, 2 * HALF - 1)
    above = pts[:, 2] - dem[row, col]
    roof_pts = pts[(above > 2) & (above < 10) & (pts[:, 3] == 1)]

    n = int(2 * HALF / RES)
    west, north = cx - HALF, cy + HALF
    ci = ((roof_pts[:, 0] - west) / RES).astype(int)
    ri = ((north - roof_pts[:, 1]) / RES).astype(int)
    ok = (ci >= 0) & (ci < n) & (ri >= 0) & (ri < n)
    roof = np.zeros((n, n), bool)
    roof[ri[ok], ci[ok]] = True
    roof = ndimage.binary_fill_holes(ndimage.binary_closing(roof, iterations=4))
    labels, count = ndimage.label(roof)
    if not count:
        raise SystemExit("No roof found near --near")
    sizes = ndimage.sum(roof, labels, range(1, count + 1))
    roof = ndimage.binary_opening(labels == 1 + int(np.argmax(sizes)), iterations=2)
    print(f"{len(pts)} LiDAR points, roof {roof.sum() * RES * RES:.0f} m2")

    rooms = [r["points"] for r in json.load(open(a.house))["floors"][a.floor]["rooms"]]
    reward = roof.astype(float)
    penalty = 1 - reward

    def score(theta, mirror):
        f = plan_to_world(theta, mirror)
        polys = [[f(x, y) for x, y in r] for r in rooms]
        allp = np.array([p for poly in polys for p in poly])
        e0, n1 = allp[:, 0].min(), allp[:, 1].max()
        w = int((allp[:, 0].max() - e0) / RES) + 2
        h = int((n1 - allp[:, 1].min()) / RES) + 2
        im = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(im)
        for poly in polys:
            d.polygon([((e - e0) / RES, (n1 - nn) / RES) for e, nn in poly], fill=1)
        fm = np.array(im, float)[::-1, ::-1]
        corr = fftconvolve(reward, fm, mode="valid") - 0.5 * fftconvolve(penalty, fm, mode="valid")
        r, c = np.unravel_index(np.argmax(corr), corr.shape)
        # Where the plan's (0, 0) lands.
        return corr[r, c] / fm.sum(), west + c * RES - e0, north - r * RES - n1, polys

    results = sorted(
        ((score(t, m)[0], t, m) for m in (False, True) for t in range(0, 360, 2)), reverse=True
    )
    _, t_best, m_best = results[0]
    fine = max((score(t, m_best)[0], t) for t in np.arange(t_best - 2, t_best + 2.01, 0.5))
    s, E, N, polys = score(fine[1], m_best)
    others = [r for r in results if r[2] != m_best or min(abs(r[1] - t_best) % 360, 360 - abs(r[1] - t_best) % 360) > 15]

    print(f"best: rotation {fine[1]:.1f} deg, mirrored {m_best}, score {s:.2f}")
    print(f"next best: rotation {others[0][1]} deg, mirrored {others[0][2]}, score {others[0][0]:.2f}")
    if m_best:
        print("The plan fits best mirrored: check the MagicPlan export before using this.")
    print(f"--origin {E:.2f} {N:.2f} --rotation {fine[1]:.1f}")

    img = np.zeros((n, n, 3), np.uint8)
    img[roof] = (120, 120, 120)
    out = Image.fromarray(img)
    d = ImageDraw.Draw(out)
    for poly in polys:
        d.polygon([((E + e - west) / RES, (north - (N + nn)) / RES) for e, nn in poly], outline=(230, 40, 40))
    out.save(a.png)


if __name__ == "__main__":
    main()

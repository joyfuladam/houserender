"""Pulls what the MagicPlan OBJ lacks out of the USDZ of the same floor.

The OBJ has the room and wall geometry. The USDZ additionally has a frame for
every doorway, a door leaf where there is an actual door, and built-in objects
such as staircases. This prints those as JSON for import-magicplan.mjs.

    pip install usd-core
    python scripts/magicplan_usd_hints.py floor.usdz > hints.json

Coordinates are in the USDZ's own units; the importer rescales them by
comparing the building shell in both files.
"""
import json
import re
import sys

from pxr import Usd, UsdGeom

SHELLS = ("InnerSide", "ExternalWalls", "WholeFloor", "FloorFillerTop")
ID = re.compile(r"_[0-9a-f]{8}(_[0-9a-f]{4}){3}_[0-9a-f]{12}$")

stage = Usd.Stage.Open(sys.argv[1])
cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), [UsdGeom.Tokens.default_])


def box(prim):
    r = cache.ComputeWorldBound(prim).ComputeAlignedRange()
    return r.GetMin(), r.GetMax()


shell = None
doors = []
fixtures = []
for prim in stage.Traverse():
    name = prim.GetName()
    if prim.IsA(UsdGeom.Mesh):
        kind = ID.sub("", name)
        parent_is_door = any(c.GetName().startswith("t_frame") for c in prim.GetParent().GetChildren())
        if kind == "ExternalWalls":
            lo, hi = box(prim)
            shell = {"minX": lo[0], "maxX": hi[0], "minZ": lo[2], "maxZ": hi[2]}
        elif not kind.startswith(SHELLS) and not parent_is_door:
            lo, hi = box(prim)
            fixtures.append({
                "name": kind,
                "x": (lo[0] + hi[0]) / 2,
                "z": (lo[2] + hi[2]) / 2,
                "width": hi[0] - lo[0],
                "depth": hi[2] - lo[2],
                "height": hi[1] - lo[1],
            })
    elif prim.IsA(UsdGeom.Xform):
        kids = {ID.sub("", c.GetName()): c for c in prim.GetChildren()}
        if "t_frame" in kids:
            # The top of the frame spans the opening, so its center is the
            # opening's center whichever way the door leaf is swung.
            lo, hi = box(kids["t_frame"])
            doors.append({
                "x": (lo[0] + hi[0]) / 2,
                "z": (lo[2] + hi[2]) / 2,
                "leaf": any(k.startswith("door") for k in kids),
                "kinds": sorted(kids),
            })

json.dump({"shell": shell, "doors": doors, "fixtures": fixtures}, sys.stdout, indent=1)

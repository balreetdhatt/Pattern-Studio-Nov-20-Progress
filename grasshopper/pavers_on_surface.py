# -*- coding: utf-8 -*-
"""Lay a field of paver modules over your own Rhino boundary or surface, the type of each module chosen by a pattern you
control or by a picture you upload. One GhPython component.

The precedent is Michel Desvigne's Keio University roof garden (Tokyo, 2005): one 500 mm granite slab in five types,
cut with a round planting hole of 375, 300, 200 or 150 mm or left solid, the types scattered over the grid so that trees
stand in the biggest holes, grasses in the middle ones and the solid slabs make the paths. Philip Belesky's Groundhog
project reverse-engineered it in Grasshopper (groundhog.philipbelesky.com/projects/keio-university-roof-garden/): a grid
over the boundary, a greyscale image sampled at each cell, the tone quantised to a slab type. This component does that
on geometry you drew, and lets the pattern come from controls instead of a picture.

The second precedent is Bryum's Roche pocket park (Basel, 2021; landezine.com/roche-pocket-park-by-bryum/): one square
paver, no hole types, and around each tree the paving thins out: cells are left out and planted, with a chance that
rises toward the tree, while the paths through the square stay solid. That is the Cull here: wire the trees as the
Field, set Cull to how open the paving gets at a tree, and the paths as Keep curves. With Holes left at 0 that is Roche;
with the five holes and a picture it is Keio; both can be mixed.

What it does:

  - a square grid of Module + Joint pitch over the boundary, turned by Spin, starting with a whole paver at the corner of
    the boundary's box (as the web tool's Pavers mode does); cells whose centre is inside are laid; cells the boundary
    crosses are cut to it when Clip is on (pieces under MinPiece of a module are dropped and counted);
  - a tone 0..1 at every cell from the pattern: 'gradient' (along Angle), 'radial' (from Centre, out to Scale),
    'noise' (seeded, Scale is the wavelength), 'attract' (1 on the Field geometry, 0 at Reach), 'image' (the picture at
    Image stretched over the boundary's box), 'random' (seeded); Contrast and Invert shape it;
  - the tone becomes a type: tone 0 takes the first entry of Holes (the biggest hole), tone 1 the last (solid); nearest
    level, or error-diffused over the grid when Dither is on so a smooth gradient reads as a scatter, as Keio does;
  - a cell is left out and planted (Roche) when a seeded draw at its centre falls under tone x Cull, unless it lies
    within KeepWidth of a Keep curve (a path); the cells left out come back as Planted outlines;
  - every paver is a solid slab Thick deep with its hole cut through; trees are placed in the first type's holes and
    grasses in every other type with a hole, as points to plant from;
  - a surface or Brep under Geo lifts each paver to its own height on it (a terraced or sloping roof), the pavers level.

INPUTS (set each type hint as given; anything left off takes its default)
    Geo      [Curve | Surface | Brep]  a closed plan boundary, or a surface whose outline is the boundary and whose
                                       height each paver takes                              (required)
    Module   [float]  the paver, mm                                                         500
    Joint    [float]  the joint, mm                                                         5
    Thick    [float]  the slab, mm                                                          60
    Holes    [float, list] hole diameter per type, biggest first, 0 for solid              375, 300, 200, 150, 0
    Spin     [float]  degrees the grid is turned                                            0
    Mode     [str]    gradient | radial | noise | attract | image | random                  gradient
    Angle    [float]  degrees, the gradient's direction (0 = along x, tone 0 at the start)  0
    Centre   [Point]  for radial; default the boundary's centroid                           none
    Scale    [float]  mm: the radial reach, or the noise wavelength                         3000
    Seed     [int]    for noise and random                                                  1
    Field    [Point | Curve | Brep, list]  attractors for 'attract'                         none
    Reach    [float]  mm, the attractors' reach                                             2000
    Image    [str]    path to a picture for 'image'; read with System.Drawing              none
    Contrast [float]  1 leaves the tone alone; more pushes it to the ends                   1
    Invert   [bool]   swap the ends: tone 1 takes the biggest hole                          False
    Dither   [bool]   error-diffuse the types over the grid instead of nearest level        True
    Cull     [float]  0 to 1: the chance a cell at tone 1 is left out and planted (Roche)    0
    Keep     [Curve, list]  paths: cells within KeepWidth of them are never left out        none
    KeepWidth [float] mm, half the path's width                                              1000
    Clip     [bool]   cut edge pavers to the boundary                                       True
    MinPiece [float]  drop a cut piece under this fraction of a whole paver                 0.25
    Go       [bool]

OUTPUTS
    Pavers    one solid per paver (Brep), the hole cut through
    Outlines  the paver outlines (closed curves), for a drawing
    HoleCrvs  the planting holes (circles), for a drawing
    Types     type per paver, 1-based, in the order of Holes
    Tones     the tone each paver was given
    Trees     a point in every hole of the first type
    Grasses   a point in every other hole
    Planted   the outlines of the cells left out by Cull, to plant
    Csv       the schedule: paver,col,row,type,hole_mm,x_mm,y_mm,z_mm,cut,area_mm2 (the cells left out have type 0)
    Count     pavers laid
    Info      what was laid: the count per type, pieces cut and dropped, the pattern used

Units are read as millimetres. Nothing is written to disk. Written 1 November 2026 to the conventions of
bricks_on_surface.py (IronPython 2.7 and CPython 3 both: no f-strings). Run in Rhino 8 on 1 November 2026 through the Rhino MCP; grasshopper/README.md says what was tested.
"""
from __future__ import division
import math
import os
import Rhino.Geometry as rg


def d(v, fallback):
    return fallback if v is None else v


def geo(v):
    """what a Grasshopper input hands over, as RhinoCommon: geometry as it is, a GH goo by its Value, or the Guid of a
    ghdoc object (what the legacy GhPython component gives an input with no type hint) through rhinoscriptsyntax"""
    if v is None or isinstance(v, (rg.GeometryBase, rg.Point3d, rg.Vector3d, rg.Plane)):
        return v
    val = getattr(v, 'Value', None)
    if isinstance(val, (rg.GeometryBase, rg.Point3d, rg.Vector3d, rg.Plane)):
        return val
    try:
        import System
        if isinstance(v, (System.Guid, str)):
            import rhinoscriptsyntax as rs
            for f in (rs.coercecurve, rs.coercebrep, rs.coercesurface, rs.coerce3dpoint, rs.coercegeometry):
                try:
                    g = f(v)
                    if g is not None:
                        return g
                except Exception:
                    pass
    except Exception:
        pass
    return v


def as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [x for x in v if x is not None]
    try:
        return [x for x in list(v) if x is not None]
    except TypeError:
        return [v]


Geo = geo(globals().get('Geo'))
Module = float(d(globals().get('Module'), 500.0))
Joint = float(d(globals().get('Joint'), 5.0))
Thick = float(d(globals().get('Thick'), 60.0))
def numbers(v):
    """a list of numbers from a list, or from one string typed as '375, 300, 200' (a panel gives text)"""
    out = []
    for x in as_list(v):
        if isinstance(x, str):
            for part in x.replace(';', ',').replace('\n', ',').replace(' ', ',').split(','):
                if part.strip():
                    try:
                        out.append(float(part))
                    except ValueError:
                        pass
        else:
            try:
                out.append(float(x))
            except (TypeError, ValueError):
                pass
    return out


Holes = numbers(globals().get('Holes')) or [375.0, 300.0, 200.0, 150.0, 0.0]
Spin = float(d(globals().get('Spin'), 0.0))
Mode = str(d(globals().get('Mode'), 'gradient')).strip().lower()
Angle = float(d(globals().get('Angle'), 0.0))
Centre = geo(globals().get('Centre'))
Scale = float(d(globals().get('Scale'), 3000.0))
Seed = int(d(globals().get('Seed'), 1))
Field = [geo(x) for x in as_list(globals().get('Field'))]
Reach = float(d(globals().get('Reach'), 2000.0))
Image = globals().get('Image')
Contrast = float(d(globals().get('Contrast'), 1.0))
Invert = bool(d(globals().get('Invert'), False))
Dither = bool(d(globals().get('Dither'), True))
Cull = float(d(globals().get('Cull'), 0.0))
Keep = [geo(x) for x in as_list(globals().get('Keep'))]
KeepWidth = float(d(globals().get('KeepWidth'), 1000.0))
Clip = bool(d(globals().get('Clip'), True))
MinPiece = float(d(globals().get('MinPiece'), 0.25))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01
UP = rg.Vector3d.ZAxis
D = math.pi / 180.0


# ---------------------------------------------------------------- the boundary
def as_brep(g):
    if isinstance(g, rg.Brep):
        return g
    if isinstance(g, (rg.Surface, rg.Extrusion)):
        return g.ToBrep()
    return None


def boundary_of(g):
    """-> (closed planar curve in world XY, brep or None). A surface gives its outline, projected flat."""
    if isinstance(g, rg.Curve):
        c = rg.Curve.ProjectToPlane(g, rg.Plane.WorldXY)
        return (c if c is not None and c.IsClosed else None), None
    b = as_brep(g)
    if b is None:
        return None, None
    edges = b.DuplicateNakedEdgeCurves(True, True)
    joined = rg.Curve.JoinCurves(edges, TOL * 10) if edges else []
    best = None
    for c in (joined or []):
        f = rg.Curve.ProjectToPlane(c, rg.Plane.WorldXY)
        if f is not None and f.IsClosed and (best is None or f.GetLength() > best.GetLength()):
            best = f
    return best, b


def inside(crv, p):
    c = crv.Contains(p, rg.Plane.WorldXY, TOL)
    return c == rg.PointContainment.Inside or c == rg.PointContainment.Coincident


def dist_to(g, p):
    if isinstance(g, rg.Point3d):
        return p.DistanceTo(g)
    if isinstance(g, rg.Point):
        return p.DistanceTo(g.Location)
    if isinstance(g, rg.Curve):
        ok, t = g.ClosestPoint(p)
        return p.DistanceTo(g.PointAt(t)) if ok else 1e12
    b = as_brep(g)
    if b is not None:
        q = b.ClosestPoint(p)
        return p.DistanceTo(q) if q is not None else 1e12
    return 1e12


# ---------------------------------------------------------------- the pattern
def frac(x):
    return x - math.floor(x)


def hash2(i, j, seed):
    return frac(math.sin(i * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453)


def value_noise(x, y, seed):
    """smooth seeded noise in 0..1 at a point in cells of one wavelength"""
    i, j = math.floor(x), math.floor(y)
    fx, fy = x - i, y - j
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a = hash2(i, j, seed)
    b = hash2(i + 1, j, seed)
    c = hash2(i, j + 1, seed)
    e = hash2(i + 1, j + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy


def fbm(x, y, seed):
    v, amp, tot = 0.0, 1.0, 0.0
    for o in range(3):
        v += amp * value_noise(x * (2 ** o), y * (2 ** o), seed + o)
        tot += amp
        amp *= 0.5
    return v / tot


class Picture(object):
    """the picture at Image, downsampled to one tone per grid cell and stretched over the boundary's box"""
    def __init__(self, path, cols, rows):
        self.ok = False
        self.lum = None
        self.cols, self.rows = cols, rows
        self.note = ''
        if not path or not os.path.exists(str(path)):
            self.note = 'no picture at Image' if path else 'no picture wired to Image'
            return
        try:
            import System.Drawing as sd
            src = sd.Bitmap(str(path))
            dst = sd.Bitmap(cols, rows)
            g = sd.Graphics.FromImage(dst)
            g.InterpolationMode = sd.Drawing2D.InterpolationMode.HighQualityBicubic
            g.DrawImage(src, 0, 0, cols, rows)
            g.Dispose()
            self.lum = [0.0] * (cols * rows)
            for j in range(rows):
                for i in range(cols):
                    p = dst.GetPixel(i, j)
                    self.lum[j * cols + i] = (0.299 * p.R + 0.587 * p.G + 0.114 * p.B) / 255.0
            dst.Dispose()
            src.Dispose()
            self.ok = True
        except Exception as e:
            self.note = 'could not read the picture: %s' % e

    def at(self, i, j):
        # row 0 of the picture is its top; row 0 of the grid is its bottom
        return self.lum[(self.rows - 1 - j) * self.cols + i]


def shaped(t):
    t = min(1.0, max(0.0, t))
    if abs(Contrast - 1.0) > 1e-9 and Contrast > 0:
        t = 0.5 + (t - 0.5) * Contrast
        t = min(1.0, max(0.0, t))
    return 1.0 - t if Invert else t


# ---------------------------------------------------------------- the component
Pavers, Outlines, HoleCrvs, Types, Tones, Trees, Grasses, Planted = [], [], [], [], [], [], [], []
Csv, Count, Info = '', 0, ''

if Go:
    bnd, brep = boundary_of(Geo)
    if bnd is None:
        Info = 'wire a closed plan curve, or a surface, to Geo'
    else:
        pitch = Module + max(0.0, Joint)
        # the grid's own frame: world XY turned by Spin about the boundary's centre
        amp = rg.AreaMassProperties.Compute(bnd)
        ctr = rg.Point3d(amp.Centroid.X, amp.Centroid.Y, 0.0) if amp is not None else bnd.GetBoundingBox(True).Center
        ctr = rg.Point3d(ctr.X, ctr.Y, 0.0)
        gp = rg.Plane(ctr, UP)
        gp.Rotate(Spin * D, UP, ctr)
        to_grid = rg.Transform.ChangeBasis(rg.Plane.WorldXY, gp)
        to_world = rg.Transform.ChangeBasis(gp, rg.Plane.WorldXY)
        local = bnd.DuplicateCurve()
        local.Transform(to_grid)
        bb = local.GetBoundingBox(True)
        x0, y0 = bb.Min.X, bb.Min.Y
        cols = int(math.ceil((bb.Max.X - x0) / pitch)) + 1
        rows = int(math.ceil((bb.Max.Y - y0) / pitch)) + 1
        if cols * rows > 60000:
            Info = '%d cells is more than this will lay; use a bigger module' % (cols * rows)
            cols = rows = 0
        n_types = len(Holes)
        c0 = Centre if isinstance(Centre, rg.Point3d) else (Centre.Location if isinstance(Centre, rg.Point) else ctr)
        pic = Picture(Image, max(1, cols), max(1, rows)) if Mode == 'image' else None
        ang = Angle * D
        bw, bh = max(1e-9, bb.Max.X - x0), max(1e-9, bb.Max.Y - y0)

        def tone_at(i, j, P):
            """the pattern's tone at cell (i, j) whose world centre is P"""
            if Mode == 'radial':
                return 1.0 - min(1.0, P.DistanceTo(rg.Point3d(c0.X, c0.Y, 0.0)) / max(1.0, Scale))
            if Mode == 'noise':
                return fbm(P.X / max(1.0, Scale), P.Y / max(1.0, Scale), Seed)
            if Mode == 'attract':
                if not Field:
                    return 0.5
                return 1.0 - min(1.0, min(dist_to(g, P) for g in Field) / max(1.0, Reach))
            if Mode == 'image':
                return pic.at(i, j) if pic.ok else 0.5
            if Mode == 'random':
                return hash2(i, j, Seed)
            # gradient along Angle in the grid's frame
            u = ((i * pitch) * math.cos(ang) + (j * pitch) * math.sin(ang))
            lo = min(0.0, bw * math.cos(ang), bh * math.sin(ang), bw * math.cos(ang) + bh * math.sin(ang))
            hi = max(0.0, bw * math.cos(ang), bh * math.sin(ang), bw * math.cos(ang) + bh * math.sin(ang))
            return (u - lo) / max(1e-9, hi - lo)

        # ---- the cells: which are laid, whole or cut
        cells = []  # dicts in reading order (row by row from the bottom)
        dropped, cut_n, culled, kept = 0, 0, 0, 0
        half = Module / 2.0
        planted_rows = []

        def on_path(P):
            return bool(Keep) and min(dist_to(k, P) for k in Keep) <= KeepWidth
        for j in range(rows):
            for i in range(cols):
                cx, cy = x0 + i * pitch + half, y0 + j * pitch + half
                corners_l = [rg.Point3d(cx - half, cy - half, 0), rg.Point3d(cx + half, cy - half, 0),
                             rg.Point3d(cx + half, cy + half, 0), rg.Point3d(cx - half, cy + half, 0)]
                P = rg.Point3d(cx, cy, 0)
                P.Transform(to_world)
                cw = []
                for q in corners_l:
                    w = rg.Point3d(q)
                    w.Transform(to_world)
                    cw.append(w)
                ins = [inside(bnd, w) for w in cw]
                cin = inside(bnd, P)
                outline, cut, area = None, False, Module * Module
                if all(ins):
                    outline = rg.Polyline(cw + [cw[0]]).ToNurbsCurve()
                elif any(ins) or cin:
                    if not Clip:
                        if cin:
                            outline = rg.Polyline(cw + [cw[0]]).ToNurbsCurve()
                        else:
                            continue
                    else:
                        rect = rg.Polyline(cw + [cw[0]]).ToNurbsCurve()
                        pieces = None
                        try:
                            pieces = rg.Curve.CreateBooleanIntersection(rect, bnd, TOL)
                        except TypeError:
                            pieces = rg.Curve.CreateBooleanIntersection(rect, bnd)
                        best, best_a = None, 0.0
                        for pc in (pieces or []):
                            am = rg.AreaMassProperties.Compute(pc)
                            if am is not None and am.Area > best_a:
                                best, best_a = pc, am.Area
                        if best is None or best_a < MinPiece * Module * Module:
                            dropped += 1
                            continue
                        outline, cut, area = best, True, best_a
                        cut_n += 1
                else:
                    continue
                z = 0.0
                if brep is not None:
                    q = brep.ClosestPoint(rg.Point3d(P.X, P.Y, 0.0))
                    if q is not None:
                        z = q.Z
                tone = shaped(tone_at(i, j, P))
                # the cull: a seeded draw against tone x Cull leaves the cell out and planted, unless it is on a path
                if Cull > 0 and hash2(i, j, Seed + 97) < tone * min(1.0, Cull):
                    if on_path(P):
                        kept += 1
                    else:
                        culled += 1
                        o = outline.DuplicateCurve()
                        o.Translate(rg.Vector3d(0, 0, z))
                        Planted.append(o)
                        planted_rows.append(','.join(['0', str(i), str(j), '0', '0', '%.1f' % P.X, '%.1f' % P.Y, '%.1f' % z,
                                                      '1' if cut else '0', '%.0f' % area]))
                        continue
                cells.append({'i': i, 'j': j, 'P': rg.Point3d(P.X, P.Y, z), 'outline': outline, 'cut': cut, 'area': area,
                              'tone': tone, 'type': 0})

        # ---- the tone becomes a type: nearest level, or error-diffused over the grid
        if cells and n_types > 1:
            if Dither:
                err = {}
                by = dict(((c['i'], c['j']), c) for c in cells)
                for c in cells:  # reading order: row by row from the bottom, left to right
                    t = min(1.0, max(0.0, c['tone'] + err.get((c['i'], c['j']), 0.0)))
                    lvl = int(round(t * (n_types - 1)))
                    c['type'] = lvl
                    e = t - lvl / (n_types - 1.0)
                    for (di, dj, w) in ((1, 0, 7 / 16.0), (-1, 1, 3 / 16.0), (0, 1, 5 / 16.0), (1, 1, 1 / 16.0)):
                        k = (c['i'] + di, c['j'] + dj)
                        if k in by:
                            err[k] = err.get(k, 0.0) + e * w
            else:
                for c in cells:
                    c['type'] = int(round(c['tone'] * (n_types - 1)))
        elif cells:
            for c in cells:
                c['type'] = 0

        # ---- the solids: a slab with its hole cut through; the planting points
        counts = [0] * n_types
        lines = ['paver,col,row,type,hole_mm,x_mm,y_mm,z_mm,cut,area_mm2']
        for n, c in enumerate(cells):
            hole = Holes[c['type']]
            base = rg.Plane(rg.Point3d(c['P'].X, c['P'].Y, c['P'].Z), UP)
            outline = c['outline'].DuplicateCurve()
            outline.Translate(rg.Vector3d(0, 0, c['P'].Z))
            curves = [outline]
            circle = None
            if hole > 0:
                circle = rg.Circle(base, hole / 2.0).ToNurbsCurve()
                # a cut piece may not hold the whole hole; keep the hole only when the circle lies inside the outline
                keep = True
                if c['cut']:
                    for k in range(8):
                        q = circle.PointAt(circle.Domain.ParameterAt(k / 8.0))
                        if outline.Contains(q, base, TOL) != rg.PointContainment.Inside:
                            keep = False
                            break
                if keep:
                    curves.append(circle)
                else:
                    circle = None
            solid = None
            faces = rg.Brep.CreatePlanarBreps(curves, TOL) if len(curves) > 1 else rg.Brep.CreatePlanarBreps(outline, TOL)
            if faces and len(faces) > 0:
                path = rg.Line(base.Origin, base.Origin + UP * (-Thick)).ToNurbsCurve()
                solid = faces[0].Faces[0].CreateExtrusion(path, True)
            if solid is None:
                ext = rg.Extrusion.Create(outline, -Thick, True)
                solid = ext.ToBrep() if ext is not None else None
            if solid is None:
                continue
            Pavers.append(solid)
            Outlines.append(outline)
            Types.append(c['type'] + 1)
            Tones.append(round(c['tone'], 3))
            counts[c['type']] += 1
            if circle is not None:
                HoleCrvs.append(circle)
                if c['type'] == 0:
                    Trees.append(rg.Point3d(base.Origin))
                else:
                    Grasses.append(rg.Point3d(base.Origin))
            lines.append(','.join([str(len(Pavers)), str(c['i']), str(c['j']), str(c['type'] + 1), '%g' % hole,
                                   '%.1f' % c['P'].X, '%.1f' % c['P'].Y, '%.1f' % c['P'].Z, '1' if c['cut'] else '0', '%.0f' % c['area']]))
        Count = len(Pavers)
        Csv = '\n'.join(lines + planted_rows) + '\n'
        if Count:
            parts = ['%d pavers of %g mm on a %d x %d grid' % (Count, Module, cols, rows),
                     ', '.join('type %d (hole %g): %d' % (k + 1, Holes[k], counts[k]) for k in range(n_types)),
                     '%d trees, %d grasses' % (len(Trees), len(Grasses)),
                     'pattern %s%s%s' % (Mode, ' (dithered)' if Dither and n_types > 1 else ' (nearest level)',
                                         ', inverted' if Invert else '')]
            if Mode == 'image' and pic is not None and not pic.ok:
                parts.append(pic.note + ', so every cell took the middle tone')
            if Mode == 'attract' and not Field:
                parts.append('no attractors wired to Field, so every cell took the middle tone')
            if culled or kept:
                parts.append('%d cells left out and planted (Cull %.2f)%s' % (culled, Cull, (', %d kept on the paths' % kept) if kept else ''))
            if cut_n:
                parts.append('%d cut to the boundary' % cut_n)
            if dropped:
                parts.append('%d pieces under %.0f%% of a paver dropped' % (dropped, MinPiece * 100))
            if brep is not None:
                parts.append('each paver at its own height on the surface')
            parts.append('units read as mm')
            Info = '; '.join(parts)
        elif not Info:
            Info = ('every cell was left out: lower Cull' if culled else 'no cell of the grid falls inside the boundary')

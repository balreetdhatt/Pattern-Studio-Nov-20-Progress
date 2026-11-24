# -*- coding: utf-8 -*-
"""Lay optical tiles or perforations over your own Rhino surface, by a picture or a pattern, and write the tile list. One GhPython component.

Pattern Studio's Ombrae tiles mode hinges a disc per cell and turns the hinge so the tile returns a given tone of light
under one design sun; the Perforated image mode cuts a hole per cell whose size is the tone. This does both on a surface
you drew: the grid by arc length over the surface, the tone from a picture stretched over it or from a pattern you
control, and each tile solved against the design sun on ITS OWN normal, so a curved facade is solved cell by cell, not
once for the panel.

  tiles  a disc of diameter Dia per cell, hinged on a diameter and tilted by Tilt out of the face. The hinge's plan
         angle theta is solved exactly for the tone t: n . L = sin(tilt) R sin(theta - phi) + cos(tilt) Lz, so
         theta = phi + asin(2t - 1) in the cell's own frame. Off the design sun the picture washes out; that is the effect.
  holes  a hole per cell, Dmin at tone 0 to Dmax at tone 1, held under the pitch minus a web of Web mm; HoleCrvs on the
         surface, and the plate with the holes cut if Plate is on (slow on big grids: it is a boolean per hole).

INPUTS
    Geo      [Surface | Brep | Curve]  the face; a closed plan curve is a flat panel                  (required)
    Kind     [str]    tiles | holes                                                                   tiles
    Pitch    [float]  cell pitch, mm                                                                   31.75
    Dia      [float]  tile diameter, mm (tiles)                                                        25.4
    Tilt     [float]  tile tilt out of the face, degrees (tiles)                                       30
    Rise     [float]  mm the tile's low edge clears the plate (KPS's tiles stand about 3 mm proud); the disc hangs
                      on a hinge pin carried by two posts, so nothing sits inside the plate (tiles)     3
    Sun      [Vector] the design sun, a vector toward the sun, in world (tiles)                        (1, -1, 1)
    Dmin, Dmax [float] hole diameter at tone 0 and 1, mm (holes)                                       2, 24
    Web      [float]  the least web between holes, mm (holes)                                          3
    Plate    [bool]   cut the holes through the surface (holes), as a Brep                             False
    Thick    [float]  tile or plate thickness, mm                                                      1.5
    Mode     [str]    gradient | radial | noise | attract | image | random                            image
    Angle, Centre, Scale, Seed, Field, Reach, Image, Contrast, Invert  as in pavers_on_surface.py
    FlipN    [bool]   face the other way (tiles hinge and holes are set on the surface's normal)       False
    FlipUV   [bool]   swap which surface direction runs along the face (it is read from the surface)   False
    Go       [bool]

OUTPUTS
    Tiles     per cell: the disc on its hinge, the hinge pin and its two posts (tiles), as Breps
    Hinges    the hinge line per tile (at the pin's height)
    HoleCrvs  one circle per cell on the surface (holes)
    PlateB    the surface with the holes cut (holes, Plate on)
    Planes    the cell planes (origin at the centre, z the normal)
    Tones     the tone per cell
    Csv       tiles: tile,col,row,x_mm,y_mm,z_mm,hinge_deg,tilt_deg,tone  |  holes: hole,col,row,x_mm,y_mm,z_mm,d_mm,tone
    Count     cells
    Info      what was laid; for tiles, how much tonal range the design sun gives (dial) on the average normal

Ombrae(TM), OpticalTile(TM) and Sculptural Imaging(TM) are marks of Ombrae Studios Inc. and Keith Panel Systems; the
geometry is reconstructed from the dimensions KPS publish, and this is not their process or software. Units are read as
millimetres. Written 1 November 2026 (IronPython 2.7 and CPython 3: no f-strings). Run in Rhino 8 on 1 November 2026 through the Rhino MCP; grasshopper/README.md says what was tested.
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
Kind = str(d(globals().get('Kind'), 'tiles')).strip().lower()
Pitch = float(d(globals().get('Pitch'), 31.75))
Dia = float(d(globals().get('Dia'), 25.4))
Tilt = float(d(globals().get('Tilt'), 30.0))
Rise = float(d(globals().get('Rise'), 3.0))
Sun = globals().get('Sun')
Dmin = float(d(globals().get('Dmin'), 2.0))
Dmax = float(d(globals().get('Dmax'), 24.0))
Web = float(d(globals().get('Web'), 3.0))
Plate = bool(d(globals().get('Plate'), False))
Thick = float(d(globals().get('Thick'), 1.5))
Mode = str(d(globals().get('Mode'), 'image')).strip().lower()
Angle = float(d(globals().get('Angle'), 0.0))
Centre = geo(globals().get('Centre'))
Scale = float(d(globals().get('Scale'), 3000.0))
Seed = int(d(globals().get('Seed'), 1))
Field = [geo(x) for x in as_list(globals().get('Field'))]
Reach = float(d(globals().get('Reach'), 1500.0))
Image = globals().get('Image')
Contrast = float(d(globals().get('Contrast'), 1.0))
Invert = bool(d(globals().get('Invert'), False))
FlipN = bool(d(globals().get('FlipN'), False))
FlipUV = bool(d(globals().get('FlipUV'), False))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01
D = math.pi / 180.0


def solid(b):
    """a closed Brep with its normals outward: an extrusion run against its face's normal comes out inside out"""
    if b is None:
        return None
    if b.SolidOrientation == rg.BrepSolidOrientation.Inward:
        b.Flip()
    return b


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def face_of(g):
    if isinstance(g, rg.Brep) and g.Faces.Count:
        return g.Faces[0], g
    if isinstance(g, (rg.Surface, rg.Extrusion)):
        b = g.ToBrep()
        return b.Faces[0], b
    if isinstance(g, rg.Curve) and g.IsClosed:
        bs = rg.Brep.CreatePlanarBreps(g, TOL)
        if bs and len(bs):
            return bs[0].Faces[0], bs[0]
    return None, None


def grid_on(face, pitch):
    """cells by arc length: rows up the face, columns along it. Which surface direction runs along the face is read from
    the surface (the direction whose middle isocurve rises less; FlipUV overrides), so a picture is never turned on its
    side by how the surface was built. -> (i, j, u_along, v_up, P, normal, tangent_along), cols, rows, (W, H)"""
    srf = face.UnderlyingSurface()
    dom = [srf.Domain(0), srf.Domain(1)]

    def rise(direction):
        c = srf.IsoCurve(direction, dom[1 - direction].ParameterAt(0.5))
        if c is None:
            return 0.0
        v = c.PointAtEnd - c.PointAtStart
        return abs(v.Z) / max(1e-9, v.Length)

    A = 0 if rise(0) <= rise(1) else 1
    if FlipUV:
        A = 1 - A
    B = 1 - A

    def uv(a, b):
        return (a, b) if A == 0 else (b, a)

    upc = srf.IsoCurve(B, dom[A].ParameterAt(0.5))
    bt = upc.DivideByLength(pitch, True) if upc is not None else None
    if not bt:
        return [], 0, 0, (0, 0)
    out, cols_max, W = [], 0, 0.0
    for j, b in enumerate(bt):
        alc = srf.IsoCurve(A, b)
        if alc is None:
            continue
        La = alc.GetLength()
        W = max(W, La)
        n = int(math.floor(La / pitch)) + 1
        lead = (La - (n - 1) * pitch) / 2.0
        cols_max = max(cols_max, n)
        for i in range(n):
            ok, a = alc.LengthParameter(lead + i * pitch)
            if not ok:
                continue
            u, v = uv(a, b)
            if face.IsPointOnFace(u, v) == rg.PointFaceRelation.Exterior:
                continue
            P = srf.PointAt(u, v)
            nrm = srf.NormalAt(u, v)
            nrm.Unitize()
            if FlipN:
                nrm = -nrm
            u2, v2 = uv(a + dom[A].Length * 1e-4, b)
            ta = srf.PointAt(u2, v2) - P
            if ta.Length < 1e-9:
                ta = rg.Vector3d.XAxis
            ta.Unitize()
            out.append((i, j, (a - dom[A].Min) / max(1e-9, dom[A].Length), (b - dom[B].Min) / max(1e-9, dom[B].Length), P, nrm, ta))
    return out, cols_max, len(bt), (W, upc.GetLength())


# ---- the tone (as pavers_on_surface.py)
def frac(x):
    return x - math.floor(x)


def hash2(i, j, seed):
    return frac(math.sin(i * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453)


def value_noise(x, y, seed):
    i, j = math.floor(x), math.floor(y)
    fx, fy = x - i, y - j
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a, b, c, e = hash2(i, j, seed), hash2(i + 1, j, seed), hash2(i, j + 1, seed), hash2(i + 1, j + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy


def fbm(x, y, seed):
    v, amp, tot = 0.0, 1.0, 0.0
    for o in range(3):
        v += amp * value_noise(x * (2 ** o), y * (2 ** o), seed + o)
        tot += amp
        amp *= 0.5
    return v / tot


def dist_to(g, p):
    if isinstance(g, rg.Point3d):
        return p.DistanceTo(g)
    if isinstance(g, rg.Point):
        return p.DistanceTo(g.Location)
    if isinstance(g, rg.Curve):
        ok, t = g.ClosestPoint(p)
        return p.DistanceTo(g.PointAt(t)) if ok else 1e12
    if isinstance(g, rg.Brep):
        q = g.ClosestPoint(p)
        return p.DistanceTo(q) if q is not None else 1e12
    return 1e12


class Picture(object):
    def __init__(self, path, cols, rows):
        self.ok, self.lum, self.note = False, None, ''
        self.cols, self.rows = max(1, cols), max(1, rows)
        if not path or not os.path.exists(str(path)):
            self.note = 'no picture at Image' if path else 'no picture wired to Image'
            return
        try:
            import System.Drawing as sd
            src = sd.Bitmap(str(path))
            dst = sd.Bitmap(self.cols, self.rows)
            g = sd.Graphics.FromImage(dst)
            g.InterpolationMode = sd.Drawing2D.InterpolationMode.HighQualityBicubic
            g.DrawImage(src, 0, 0, self.cols, self.rows)
            g.Dispose()
            self.lum = [0.0] * (self.cols * self.rows)
            for j in range(self.rows):
                for i in range(self.cols):
                    p = dst.GetPixel(i, j)
                    self.lum[j * self.cols + i] = (0.299 * p.R + 0.587 * p.G + 0.114 * p.B) / 255.0
            dst.Dispose()
            src.Dispose()
            self.ok = True
        except Exception as e:
            self.note = 'could not read the picture: %s' % e

    def at(self, u, v):
        i = min(self.cols - 1, int(u * self.cols))
        j = min(self.rows - 1, int((1.0 - v) * self.rows))
        return self.lum[j * self.cols + i]


def shaped(t):
    t = clamp(t)
    if abs(Contrast - 1.0) > 1e-9 and Contrast > 0:
        t = clamp(0.5 + (t - 0.5) * Contrast)
    return 1.0 - t if Invert else t


# ---------------------------------------------------------------- the component
Tiles, Hinges, HoleCrvs, Planes, Tones = [], [], [], [], []
PlateB, Csv, Count, Info = None, '', 0, ''

if Go:
    face, brep = face_of(Geo)
    if face is None:
        Info = 'wire a surface, a Brep or a closed plan curve to Geo'
    else:
        cells, cols, rows, size = grid_on(face, Pitch)
        if not cells:
            Info = 'no cell fits: the pitch is larger than the surface'
        elif len(cells) > 40000:
            Info = '%d cells is more than this will build; use a bigger pitch' % len(cells)
        else:
            srf = face.UnderlyingSurface()
            pic = Picture(Image, cols, rows) if Mode == 'image' else None
            ctr = Centre if isinstance(Centre, rg.Point3d) else (Centre.Location if isinstance(Centre, rg.Point)
                                                                   else srf.PointAt(srf.Domain(0).ParameterAt(0.5), srf.Domain(1).ParameterAt(0.5)))
            ang = Angle * D
            sun = rg.Vector3d(Sun) if isinstance(Sun, rg.Vector3d) and Sun.Length > 1e-9 else rg.Vector3d(1, -1, 1)
            sun.Unitize()
            tilt = Tilt * D
            dmax = min(Dmax, Pitch - Web)

            def tone_at(i, j, u, v, P):
                if Mode == 'radial':
                    return 1.0 - clamp(P.DistanceTo(ctr) / max(1.0, Scale))
                if Mode == 'noise':
                    return fbm(u * size[0] / max(1.0, Scale), v * size[1] / max(1.0, Scale), Seed)
                if Mode == 'attract':
                    return 1.0 - clamp(min(dist_to(g, P) for g in Field) / max(1.0, Reach)) if Field else 0.5
                if Mode == 'image':
                    return pic.at(u, v) if pic.ok else 0.5
                if Mode == 'random':
                    return hash2(i, j, Seed)
                g = u * math.cos(ang) + v * math.sin(ang)
                lo = min(0.0, math.cos(ang), math.sin(ang), math.cos(ang) + math.sin(ang))
                hi = max(0.0, math.cos(ang), math.sin(ang), math.cos(ang) + math.sin(ang))
                return (g - lo) / max(1e-9, hi - lo)

            head = 'tile,col,row,x_mm,y_mm,z_mm,hinge_deg,tilt_deg,tone' if Kind == 'tiles' else 'hole,col,row,x_mm,y_mm,z_mm,d_mm,tone'
            lines = [head]
            dial_sum, flat_cells = 0.0, 0
            hole_curves_world = []
            for n, (i, j, u, v, P, nrm, tu) in enumerate(cells):
                pl = rg.Plane(P, tu, rg.Vector3d.CrossProduct(nrm, tu))
                if pl.ZAxis * nrm < 0:
                    pl = rg.Plane(P, -tu, rg.Vector3d.CrossProduct(nrm, -tu))
                Planes.append(pl)
                t = shaped(tone_at(i, j, u, v, P))
                Tones.append(round(t, 3))
                if Kind == 'tiles':
                    # the sun in the cell's own frame
                    Lx, Ly, Lz = sun * pl.XAxis, sun * pl.YAxis, sun * pl.ZAxis
                    R = math.hypot(Lx, Ly)
                    phi = math.atan2(Ly, Lx)
                    dial = math.sin(tilt) * R  # the tonal range this cell's own sun gives
                    dial_sum += dial
                    if dial < 0.05:
                        flat_cells += 1
                    theta = phi + math.asin(2.0 * clamp(t) - 1.0)
                    # the disc hinges on a pin along theta, lifted off the plate so its low edge clears it by Rise (KPS's
                    # tiles stand about 3 mm proud); the pin stands on two posts, so nothing sits inside the plate
                    hinge_dir = rg.Vector3d(pl.XAxis * math.cos(theta) + pl.YAxis * math.sin(theta))
                    lift = (Dia / 2.0) * math.sin(tilt) + Rise + Thick
                    r_pin = max(0.4, Thick * 0.5)
                    Hc = P + pl.ZAxis * lift  # the pin's axis
                    disc_pl = rg.Plane(Hc, pl.ZAxis)
                    disc_pl.Rotate(tilt, hinge_dir, Hc)
                    disc_pl.Origin = Hc + disc_pl.ZAxis * r_pin  # the disc's back face lies tangent to the pin
                    disc = rg.Circle(disc_pl, Dia / 2.0).ToNurbsCurve()
                    faces = rg.Brep.CreatePlanarBreps(disc, TOL)
                    if faces and len(faces):
                        ext = solid(faces[0].Faces[0].CreateExtrusion(rg.Line(disc_pl.Origin, disc_pl.Origin + disc_pl.ZAxis * Thick).ToNurbsCurve(), True))
                        if ext is not None:
                            Tiles.append(ext)
                    pin = solid(rg.Cylinder(rg.Circle(rg.Plane(Hc - hinge_dir * (Dia / 2.0), hinge_dir), r_pin), Dia).ToBrep(True, True))
                    if pin is not None:
                        Tiles.append(pin)
                    for sgn in (-1.0, 1.0):
                        # a post from the plate up to the pin's underside, stopping its own sagitta short so it only touches
                        foot = P + hinge_dir * (sgn * Dia * 0.42)
                        post = solid(rg.Cylinder(rg.Circle(rg.Plane(foot, pl.ZAxis), r_pin), lift - r_pin - r_pin * 0.5).ToBrep(True, True))
                        if post is not None:
                            Tiles.append(post)
                    Hinges.append(rg.Line(Hc - hinge_dir * (Dia / 2.0), Hc + hinge_dir * (Dia / 2.0)))
                    lines.append(','.join([str(n + 1), str(i + 1), str(j + 1), '%.2f' % P.X, '%.2f' % P.Y, '%.2f' % P.Z,
                                           '%.2f' % (theta / D), '%.1f' % Tilt, '%.3f' % t]))
                else:
                    dia = Dmin + t * (dmax - Dmin)
                    if dia > 0.2:
                        c = rg.Circle(pl, dia / 2.0).ToNurbsCurve()
                        HoleCrvs.append(c)
                        hole_curves_world.append(c)
                    lines.append(','.join([str(n + 1), str(i + 1), str(j + 1), '%.2f' % P.X, '%.2f' % P.Y, '%.2f' % P.Z,
                                           '%.2f' % dia, '%.3f' % t]))
            Count = len(cells)
            Csv = '\n'.join(lines) + '\n'
            if Kind == 'holes' and Plate and brep is not None and hole_curves_world:
                # the plate: the face thickened by Thick, each hole a cylinder taken out. Slow past a few thousand holes.
                solid = brep
                offs = rg.Brep.CreateFromOffsetFace(face, Thick, TOL, False, True) if hasattr(rg.Brep, 'CreateFromOffsetFace') else None
                if offs is not None:
                    solid = offs
                cutters = []
                for c, pl in zip(hole_curves_world, [p for p in Planes]):
                    cyl = rg.Cylinder(rg.Circle(rg.Plane(pl.Origin - pl.ZAxis * Thick, pl.ZAxis), c.GetLength() / (2 * math.pi)), Thick * 3)
                    cutters.append(cyl.ToBrep(True, True))
                res = rg.Brep.CreateBooleanDifference([solid], cutters, TOL)
                PlateB = res[0] if res and len(res) else None
            parts = ['%d %s on a %d x %d grid at %g mm' % (Count, 'tiles' if Kind == 'tiles' else 'holes', cols, rows, Pitch),
                     'tone from %s' % Mode]
            if Kind == 'tiles':
                parts.append('dial %.2f on average (under 0.18 the panel cannot hold a picture): move the sun off the face to raise it'
                             % (dial_sum / max(1, Count)))
                if flat_cells:
                    parts.append('%d cells see the sun square-on and give no range' % flat_cells)
            else:
                parts.append('holes %g to %g mm, web %g mm%s' % (Dmin, dmax, Web, ' (Dmax held to the pitch minus the web)' if dmax < Dmax else ''))
                if Plate:
                    parts.append('plate cut' if PlateB is not None else 'the plate boolean failed; the HoleCrvs still stand')
            if Mode == 'image' and pic is not None and not pic.ok:
                parts.append(pic.note)
            parts.append('units read as mm')
            Info = '; '.join(parts)

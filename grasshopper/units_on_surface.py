# -*- coding: utf-8 -*-
"""Place kinetic units over your own Rhino surface, each with a real mechanism, and write the actuator table. One GhPython component.

Pattern Studio's Kinetic units mode scatters umbrella, iris and louvre units over a panel and drives them by a field, the
sun, a walker or a pulse. This does the same on a surface you drew, by arc length over it so the pitch is true on a
curved face, and gives every unit a MECHANISM rather than a picture of one:

Every unit sits in a cell of the full Pitch whose frame bars (Bar wide) are shared with its neighbours, so the frames
make one continuous lattice over the surface: square, or a hexagonal honeycomb (Grid 'hex', the Al Bahar Towers'
frame). The moving parts hang on that frame, and the mechanism is drawn, not implied:

  umbrella  one petal per side of the cell, hinged on the frame's inner edge (4 on a square cell, 6 on a hexagon: the
            Al Bahar unit). A spider of three spokes holds the actuator at the cell's centre; its rod runs through the
            frame plane to a hub in front, and a strut of length Strut joins the hub to each petal. The actuator is
            the hub's height on the axis, solved exactly from the strut geometry (the petals close flat to the centre at
            s = 1, fold out by Fold degrees at s = 0). A strut too short to reach is reported, not hidden.
  iris      a ring inscribed in the cell, touching the frame, carries Petals blades on pins; each blade is a plate whose
            inner edge is a circle of radius R through its pin. Turning every blade by the same angle a closes the
            aperture to R x (1 - 2 sin(a/2)): open at 0, shut at 60 degrees. The actuator is the ring's turn
            a = 2 asin(s / 2), the one value a drive ring needs.
  louvre    a flap hinged on the top bar of a square cell, turned out of the face by (1 - s) x 90 degrees, pushed by a
            rod from a bracket on the bottom bar that reaches Depth behind the frame to a point Arm along the flap; the
            rod's length at every state is the stroke a cylinder has to make. Louvres take the square grid.

The state s (0 closed-flat / open-aperture ... 1 deployed) at each unit and time t comes from the tone of a pattern,
then the drive: 'field' (the tone alone), 'sun' (a Sun vector per step: direct sun on the unit's own normal, full at
SunFull of square-on), 'walk' (a walker moving along the first curve in Walk over t, units within Reach lit), 'pulse'
(a sine over t, lagged by the tone). sMin and sMax bound the state.

INPUTS (set each type hint as given; anything left off takes its default)
    Geo      [Surface | Brep | Curve]  the face to populate (a closed plan curve is taken as a flat panel)   (required)
    Pitch    [float]  cell to cell, mm, by arc length over the surface; the cell is the unit                300
    Grid     [str]    square | hex (a honeycomb: rows 0.866 pitch apart, alternate rows shifted half a pitch)  square
    Bar      [float]  the frame bar's width, mm (also its depth); the opening is Pitch minus two bars     15
    Shape    [str]    umbrella | iris | louvre                                                          umbrella
    Petals   [int]    iris blades (umbrella petals follow the cell: 4 square, 6 hex)                     6
    Depth    [float]  mm: how far the mechanism sits behind the face (slider travel, rod anchor)        120
    Strut    [float]  umbrella strut length, mm; 0 takes the rim radius                                 0
    Fold     [float]  umbrella: degrees the petals fold back at s = 0                                   80
    Arm      [float]  louvre: where the rod meets the flap, mm from the hinge; 0 takes half the flap    0
    Thick    [float]  plate thickness, mm                                                               3
    Mode     [str]    the tone: gradient | radial | noise | attract | image | random | none             gradient
    Angle    [float]  gradient direction in the surface's u, v (degrees)                               0
    Centre   [Point]  for radial; default the surface's middle                                          none
    Scale    [float]  mm: radial reach, noise wavelength                                                3000
    Seed     [int]                                                                                     1
    Field    [Point | Curve | Brep, list] attractors for 'attract'                                      none
    Reach    [float]  mm, attractor and walker reach                                                    1500
    Image    [str]    picture path for 'image', stretched over u, v                                     none
    Contrast [float]                                                                                   1
    Invert   [bool]                                                                                    False
    Drive    [str]    field | sun | walk | pulse                                                        field
    Sun      [Vector, list] one sun direction (toward the sun) per step for 'sun'                       none
    SunFull  [float]  fraction of square-on sun that fully deploys a unit                               0.5
    Walk     [Curve, list] the walker's path for 'walk' (its first curve)                               none
    Blend    [str]    how the tone and the drive combine: max | mul | add                               max
    SMin, SMax [float] the state's bounds                                                               0, 1
    Steps    [int]    steps of t in the table                                                           8
    T        [float]  0..1, the time shown in the viewport                                              0
    FlipN    [bool]   face the other way (the units and the sun test use the surface's normal)          False
    FlipUV   [bool]   swap which surface direction runs along the face (it is read from the surface)   False
    Go       [bool]

OUTPUTS
    Frames    the frame of every unit (Brep)
    Parts     the moving parts at time T (Brep), one list
    Planes    the unit planes: origin at the unit's centre, z the surface normal
    States    s at time T per unit
    Actuator  the actuator value at T per unit: slider height mm (umbrella), ring turn deg (iris), rod length mm (louvre)
    Csv       the actuator table, -units.csv: unit,col,row,x_mm,y_mm,z_mm,duty,stroke,act_min,act_max,t0..tN (actuator values)
    Count     units placed
    Info      what was placed, the mechanism's range, anything unreachable

Units are read as millimetres. Written 1 November 2026 to the conventions of bricks_on_surface.py (IronPython 2.7 and
CPython 3: no f-strings). Run in Rhino 8 on 1 November 2026 through the Rhino MCP; grasshopper/README.md says what was tested.
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
Pitch = float(d(globals().get('Pitch'), 300.0))
Grid = str(d(globals().get('Grid'), 'square')).strip().lower()
Bar = max(1.0, float(d(globals().get('Bar'), 15.0)))
Shape = str(d(globals().get('Shape'), 'umbrella')).strip().lower()
if Shape == 'louvre':
    Grid = 'square'
Petals = max(3, int(d(globals().get('Petals'), 6)))
Depth = float(d(globals().get('Depth'), 120.0))
Strut = float(d(globals().get('Strut'), 0.0))
Fold = float(d(globals().get('Fold'), 80.0))
Arm = float(d(globals().get('Arm'), 0.0))
Thick = float(d(globals().get('Thick'), 3.0))
Mode = str(d(globals().get('Mode'), 'gradient')).strip().lower()
Angle = float(d(globals().get('Angle'), 0.0))
Centre = geo(globals().get('Centre'))
Scale = float(d(globals().get('Scale'), 3000.0))
Seed = int(d(globals().get('Seed'), 1))
Field = [geo(x) for x in as_list(globals().get('Field'))]
Reach = float(d(globals().get('Reach'), 1500.0))
Image = globals().get('Image')
Contrast = float(d(globals().get('Contrast'), 1.0))
Invert = bool(d(globals().get('Invert'), False))
Drive = str(d(globals().get('Drive'), 'field')).strip().lower()
Sun = as_list(globals().get('Sun'))
SunFull = float(d(globals().get('SunFull'), 0.5))
Walk = [geo(x) for x in as_list(globals().get('Walk'))]
Blend = str(d(globals().get('Blend'), 'max')).strip().lower()
SMin = float(d(globals().get('SMin'), 0.0))
SMax = float(d(globals().get('SMax'), 1.0))
Steps = max(1, int(d(globals().get('Steps'), 8)))
T = float(d(globals().get('T'), 0.0))
FlipN = bool(d(globals().get('FlipN'), False))
FlipUV = bool(d(globals().get('FlipUV'), False))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01
D = math.pi / 180.0


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


# ---------------------------------------------------------------- the surface and its grid
def face_of(g):
    """-> (BrepFace, Brep) for a surface, a brep's first face, or a planar closed curve"""
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


def grid_on(face):
    """unit centres by arc length over the surface: rows up the face, columns along it. Which surface direction runs
    ALONG the face is read from the surface itself (the direction whose middle isocurve rises less), so a picture or a
    gradient is never turned on its side by how the surface was built; FlipUV overrides it. Every row is centred so the
    margins match. -> list of (i, j, u_along, v_up, P, normal, tangent_along), cols, rows, (W, H)"""
    srf = face.UnderlyingSurface()
    dom = [srf.Domain(0), srf.Domain(1)]

    def rise(direction):
        c = srf.IsoCurve(direction, dom[1 - direction].ParameterAt(0.5))
        if c is None:
            return 0.0
        v = c.PointAtEnd - c.PointAtStart
        return abs(v.Z) / max(1e-9, v.Length)

    A = 0 if rise(0) <= rise(1) else 1  # along the face
    if FlipUV:
        A = 1 - A
    B = 1 - A  # up the face

    def uv(a, b):
        return (a, b) if A == 0 else (b, a)

    upc = srf.IsoCurve(B, dom[A].ParameterAt(0.5))
    row_pitch = Pitch * (math.sqrt(3.0) / 2.0 if Grid == 'hex' else 1.0)
    bt = upc.DivideByLength(row_pitch, True) if upc is not None else None
    if not bt:
        return [], 0, 0, (0, 0)
    out, cols_max, W = [], 0, 0.0
    H = upc.GetLength()
    for j, b in enumerate(bt):
        alc = srf.IsoCurve(A, b)
        if alc is None:
            continue
        La = alc.GetLength()
        W = max(W, La)
        shift = Pitch / 2.0 if (Grid == 'hex' and j % 2 == 1) else 0.0  # the honeycomb's alternate rows
        n = int(math.floor((La - shift) / Pitch)) + 1
        lead = (La - shift - (n - 1) * Pitch) / 2.0 + shift
        cols_max = max(cols_max, n)
        for i in range(n):
            ok, a = alc.LengthParameter(lead + i * Pitch)
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
    return out, cols_max, len(bt), (W, H)


# ---------------------------------------------------------------- the tone
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


# ---------------------------------------------------------------- the frame and the mechanisms
def rim_polygon(pl, inset):
    """the cell's frame line in its plane: a square of the pitch, or a pointy-top hexagon whose flat-to-flat is the
    pitch, so the cells of a honeycomb share their sides; inset moves it inward (the frame's inner edge)"""
    if Grid == 'hex':
        R = (Pitch / 2.0 - inset) / math.cos(math.pi / 6.0)
        return [pl.PointAt(R * math.cos(math.pi / 6.0 + k * math.pi / 3.0), R * math.sin(math.pi / 6.0 + k * math.pi / 3.0), 0.0) for k in range(6)]
    h = Pitch / 2.0 - inset
    return [pl.PointAt(-h, -h, 0.0), pl.PointAt(h, -h, 0.0), pl.PointAt(h, h, 0.0), pl.PointAt(-h, h, 0.0)]


def closed(pts):
    return rg.Polyline(list(pts) + [pts[0]]).ToNurbsCurve()


def solid(b):
    """a closed Brep with its normals outward: an extrusion run against its face's normal comes out inside out, and an
    inside-out solid misleads every boolean, mesher and inside test downstream"""
    if b is None:
        return None
    if b.SolidOrientation == rg.BrepSolidOrientation.Inward:
        b.Flip()
    return b


def extrude_region(curves, pl, depth, back=True):
    """a planar region (outer curve, holes) extruded depth along the plane's normal, backward by default"""
    faces = rg.Brep.CreatePlanarBreps(curves, TOL)
    if not faces or not len(faces):
        return None
    v = pl.ZAxis * (-depth if back else depth)
    return solid(faces[0].Faces[0].CreateExtrusion(rg.Line(pl.Origin, pl.Origin + v).ToNurbsCurve(), True))


def cyl(a, b, r):
    v = b - a
    if v.Length < 1e-6:
        return None
    return solid(rg.Cylinder(rg.Circle(rg.Plane(a, v), r), v.Length).ToBrep(True, True))


def rod(a, b, r, na=None, nb=None, ra=0.0, rb=0.0):
    """a rod from a to b whose flat end caps stop short of the faces they meet: a cap meeting a plane of normal n at an
    angle penetrates by r / tan(angle), so each end is pulled back by that; ra, rb pull back further where the end meets a
    round part (its sagitta). Nothing of the rod then lies inside what it joins."""
    v = b - a
    L = v.Length
    if L < 1e-6:
        return None
    v.Unitize()

    def back(n):
        if n is None:
            return 0.0
        s = abs(v * n)
        c = math.sqrt(max(0.0, 1.0 - s * s))
        return 0.0 if s > 0.9999 else min(L * 0.3, r * c / max(1e-6, s))

    da = back(na) + ra
    db = back(nb) + rb
    if da + db >= L:
        return None
    return cyl(a + v * da, b - v * db, r)


def frame_brep(pl):
    """the cell's frame: the region between the cell line and its inset, Bar deep, flush with the face"""
    b = extrude_region([closed(rim_polygon(pl, 0.0)), closed(rim_polygon(pl, Bar))], pl, Bar)
    return [b] if b is not None else []


def tri_brep(a, b, c, t):
    """a thin triangular plate: a triangle extruded by t along its own normal"""
    pl = rg.Polyline([a, b, c, a]).ToNurbsCurve()
    faces = rg.Brep.CreatePlanarBreps(pl, TOL)
    if not faces or not len(faces):
        return None
    n = rg.Vector3d.CrossProduct(b - a, c - a)
    n.Unitize()
    path = rg.Line(a, a + n * t).ToNurbsCurve()
    return solid(faces[0].Faces[0].CreateExtrusion(path, True))


def umbrella_actuator(R, strut, fold_deg, s):
    """-> (slider height on the axis, fold angle in degrees, reachable). Petal hinge on the rim at radius R; the strut meets
    the petal at a = 0.6 R from the hinge; the slider sits on the axis. Fold 0 = flat to the centre (s = 1)."""
    phi = (1.0 - s) * fold_deg * D
    a = 0.6 * R
    # the strut point on the petal, in the petal's own section: radial inward a cos(phi), lifted a sin(phi)
    qr = R - a * math.cos(phi)
    qz = a * math.sin(phi)
    under = strut * strut - qr * qr
    if under < 0:
        return qz, phi / D, False
    return qz + math.sqrt(under), phi / D, True


def umbrella_parts(pl, s):
    """petals on the frame's inner edge, a spider holding the actuator at the centre, its rod through the frame plane to
    the hub in front, and a strut from the hub to every petal"""
    parts = []
    rim = rim_polygon(pl, Bar)
    n = len(rim)
    C = pl.Origin
    Rm = Pitch / 2.0 - Bar  # the hinge midpoint's distance from the centre (the inner rim's apothem)
    h, phi_deg, ok = umbrella_actuator(Rm, Strut or Rm, Fold, s)
    phi = phi_deg * D
    r_rod = max(2.0, Pitch * 0.012)
    hub = C + pl.ZAxis * h
    for k in range(n):
        p0, p1 = rim[k], rim[(k + 1) % n]
        m = (p0 + p1) * 0.5
        rad = m - C
        L = rad.Length
        rad.Unitize()
        # the petal's tip stops short of the axis (a real petal leaves a hole at the centre for the actuator's rod)
        reach = max(L - L * math.cos(phi), r_rod * 1.8)
        tip = C + rad * reach + pl.ZAxis * (L * math.sin(phi))
        # the petal plate grows away from the face (+z); the strut comes from the hub and stops at whichever face of the
        # plate looks toward the hub
        pn = rg.Vector3d.CrossProduct(p1 - p0, tip - p0)
        pn.Unitize()
        if pn * pl.ZAxis < 0:
            pn = -pn
        b = tri_brep(p0, p1, tip, Thick) if rg.Vector3d.CrossProduct(p1 - p0, tip - p0) * pl.ZAxis >= 0 else tri_brep(p1, p0, tip, Thick)
        if b is not None:
            parts.append(b)
        q0 = m + (tip - m) * 0.6
        if pn * (hub - q0) >= 0:
            q, nq = q0 + pn * Thick, pn
        else:
            q, nq = q0, -pn
        out_dir = rg.Vector3d(rad)
        strut = rod(hub - pl.ZAxis * r_rod + out_dir * (r_rod * 1.95), q, r_rod * 0.7, na=pl.ZAxis, nb=nq)  # clear of the axis
        if strut is not None:
            parts.append(strut)
    # the spider sits in the frame's depth, behind the petals: three spokes from the middles of three frame bars (square
    # to the bar's inner face) to the collar's outer surface
    zs = -Bar * 0.5
    r_col = r_rod * 2.5
    for k in range(3):
        i0 = (k * n) // 3
        m = (rim[i0] + rim[(i0 + 1) % n]) * 0.5 + pl.ZAxis * zs
        inward = C + pl.ZAxis * zs - m
        inward.Unitize()
        end = C + pl.ZAxis * zs - inward * r_col
        spoke = rod(m, end, r_rod, na=inward, rb=r_col - math.sqrt(max(0.0, r_col ** 2 - r_rod ** 2)))
        if spoke is not None:
            parts.append(spoke)
    # the collar is a ring wholly behind the frame plane: the rod runs through its hole with clearance
    half = min(r_rod * 2, Bar * 0.5 - 1.0)
    cpl = rg.Plane(C + pl.ZAxis * (zs - half), pl.ZAxis)
    collar = extrude_region([rg.Circle(cpl, r_col).ToNurbsCurve(), rg.Circle(cpl, r_rod * 1.25).ToNurbsCurve()], cpl, half * 2, back=False)
    if collar is not None:
        parts.append(collar)
    # the actuator behind the frame, its rod from the body's front face through the collar to the hub's back face
    body = cyl(C - pl.ZAxis * Depth, C - pl.ZAxis * (Depth * 0.35), r_rod * 2.2)
    if body is not None:
        parts.append(body)
    axis = cyl(C - pl.ZAxis * (Depth * 0.35), hub - pl.ZAxis * r_rod, r_rod)
    if axis is not None:
        parts.append(axis)
    hub_b = cyl(hub - pl.ZAxis * r_rod, hub + pl.ZAxis * r_rod, r_rod * 2.5)
    if hub_b is not None:
        parts.append(hub_b)
    return parts, h, ok


def iris_actuator(s):
    """the ring's turn that leaves an aperture of R (1 - s): a = 2 asin(s / 2), 0 open to 60 degrees shut"""
    return 2.0 * math.asin(clamp(s) / 2.0) / D


def iris_parts(pl, s):
    """a ring inscribed in the cell (it touches the frame's inner edge), Petals blades on pins at its inner edge"""
    parts = []
    n = max(3, Petals)
    Rin = Pitch / 2.0 - Bar
    ring = extrude_region([rg.Circle(pl, Rin).ToNurbsCurve(), rg.Circle(pl, Rin * 0.9).ToNurbsCurve()], pl, Bar * 0.6)
    if ring is not None:
        parts.append(ring)
    R = Rin * 0.9
    a = iris_actuator(s) * D
    outer = rg.Circle(pl, R).ToNurbsCurve()
    r_pin = max(1.5, Pitch * 0.006)
    pivots = []
    for k in range(n):
        ang = 2 * math.pi * k / n + math.pi / n
        pivots.append(pl.PointAt((R - r_pin * 1.6) * math.cos(ang), (R - r_pin * 1.6) * math.sin(ang), 0.0))
    washer = max(0.5, Thick * 0.2)  # a washer between the ring and the first blade, and between blades
    for k in range(n):
        piv = pivots[k]
        # the pin stands on the ring's front face and runs up through a hole in every blade
        pin = cyl(piv, piv + pl.ZAxis * (washer + (Thick + washer) * n + Thick), r_pin)
        if pin is not None:
            parts.append(pin)
        to_c = pl.Origin - piv
        to_c.Unitize()
        v = rg.Vector3d(to_c)
        v.Rotate(a, pl.ZAxis)
        B = piv + v * R
        edge = rg.Circle(rg.Plane(B, pl.ZAxis), R).ToNurbsCurve()
        region = None
        try:
            region = rg.Curve.CreateBooleanDifference(outer, edge, TOL)
        except TypeError:
            region = rg.Curve.CreateBooleanDifference(outer, edge)
        for rc in (region or []):
            # the blade carries a lobe round its own pin (its inner edge runs through the pin), then every pin of the
            # ring that falls inside the blade gets a hole with clearance
            boss = rg.Circle(rg.Plane(piv, pl.ZAxis), r_pin * 2.6).ToNurbsCurve()
            lobed = None
            try:
                lobed = rg.Curve.CreateBooleanUnion([rc, boss], TOL)
            except TypeError:
                lobed = rg.Curve.CreateBooleanUnion([rc, boss])
            shape = lobed[0] if lobed and len(lobed) == 1 else rc
            # every pin near the blade is taken out of it with clearance: a hole where the pin falls inside, a notch where
            # it sits on the edge (a curve difference does both)
            loops = [shape]
            for pv in pivots:
                if pv.DistanceTo(pl.Origin) > R + r_pin * 2:
                    continue
                cutter = rg.Circle(rg.Plane(pv, pl.ZAxis), r_pin * 1.3).ToNurbsCurve()
                new_loops = []
                for lp in loops:
                    res = None
                    try:
                        res = rg.Curve.CreateBooleanDifference(lp, cutter, TOL)
                    except TypeError:
                        res = rg.Curve.CreateBooleanDifference(lp, cutter)
                    if res and len(res):
                        new_loops.extend(list(res))  # a notch gives one loop back, a hole gives the outer and the hole
                    else:
                        new_loops.append(lp)
                loops = new_loops
            faces = rg.Brep.CreatePlanarBreps(loops, TOL)
            if faces and len(faces):
                path = rg.Line(pl.Origin, pl.Origin + pl.ZAxis * Thick).ToNurbsCurve()
                b = solid(faces[0].Faces[0].CreateExtrusion(path, True))
                if b is not None:
                    b.Translate(pl.ZAxis * (washer + (Thick + washer) * k))  # the blades stack on their pins, a washer between
                    parts.append(b)
    return parts, a / D


def louvre_actuator(Rin, arm, depth, s):
    """the rod's length from the bracket's anchor (on the bottom bar, depth behind the frame) to a point arm along the
    flap, which hangs from the top bar and turns out by (1 - s) 90 degrees"""
    th = (1.0 - s) * math.pi / 2.0
    dy = 2.0 * Rin - arm * math.cos(th)
    dz = arm * math.sin(th) + depth
    return math.hypot(dy, dz), th / D


def louvre_parts(pl, s):
    """the flap on the top bar's inner edge, the bracket down from the bottom bar, the rod between"""
    Rin = Pitch / 2.0 - Bar
    hx = Rin
    th = (1.0 - s) * math.pi / 2.0
    top = Rin
    flap = 2.0 * Rin
    a = pl.PointAt(-hx, top, 0)
    b = pl.PointAt(hx, top, 0)
    c = pl.PointAt(hx, top - flap * math.cos(th), flap * math.sin(th))
    dd = pl.PointAt(-hx, top - flap * math.cos(th), flap * math.sin(th))
    quad = rg.Polyline([a, b, c, dd, a]).ToNurbsCurve()
    faces = rg.Brep.CreatePlanarBreps(quad, TOL)
    parts = []
    arm = Arm or flap / 2.0
    r_rod = max(2.0, Pitch * 0.012)
    # the bracket hangs from the bottom bar's inner edge, tangent to the bar, down to the anchor behind the frame
    foot = pl.PointAt(0, -Rin + r_rod * 1.5, 0)
    anchor = pl.PointAt(0, -Rin + r_rod * 1.5, -Depth)
    q = pl.PointAt(0, top - arm * math.cos(th), arm * math.sin(th))
    # the flap plate grows away from the rod's side, so the rod meets the plate's face and stops there
    n = rg.Vector3d.CrossProduct(b - a, dd - a)
    n.Unitize()
    if n * (q - anchor) < 0:
        n = -n
    if faces and len(faces):
        ext = solid(faces[0].Faces[0].CreateExtrusion(rg.Line(a, a + n * Thick).ToNurbsCurve(), True))
        if ext is not None:
            parts.append(ext)
    bracket = cyl(foot, anchor, r_rod * 1.5)
    if bracket is not None:
        parts.append(bracket)
    # the rod leaves the bracket's side (not its end) and stops at the flap's face
    dir_ = q - anchor
    dir_.Unitize()
    side = rg.Vector3d.CrossProduct(dir_, pl.ZAxis).Length
    exit_pt = anchor + dir_ * (r_rod * 1.5 / max(0.25, side))  # where the rod's axis leaves the bracket's side
    n_exit = exit_pt - anchor
    n_exit = n_exit - pl.ZAxis * (n_exit * pl.ZAxis)  # the bracket's radial normal there
    if n_exit.Length > 1e-9:
        n_exit.Unitize()
    else:
        n_exit = None
    push = rod(exit_pt, q, r_rod, na=n_exit, nb=n)
    if push is not None:
        parts.append(push)
    L, _ = louvre_actuator(Rin, arm, Depth, s)
    return parts, L


# ---------------------------------------------------------------- the component
Frames, Parts, Planes, States, Actuator = [], [], [], [], []
Csv, Count, Info = '', 0, ''

if Go:
    face, brep = face_of(Geo)
    if face is None:
        Info = 'wire a surface, a Brep or a closed plan curve to Geo'
    else:
        cells, cols, rows, size = grid_on(face)
        if not cells:
            Info = 'no unit fits: the pitch is larger than the surface'
        else:
            R = Pitch / 2.0 - Bar  # half the opening
            if R < Pitch * 0.1:
                R = Pitch * 0.1
            pic = Picture(Image, cols, rows) if Mode == 'image' else None
            srf = face.UnderlyingSurface()
            ctr = Centre if isinstance(Centre, rg.Point3d) else (Centre.Location if isinstance(Centre, rg.Point)
                                                                   else srf.PointAt(srf.Domain(0).ParameterAt(0.5), srf.Domain(1).ParameterAt(0.5)))
            walk = Walk[0] if Walk and isinstance(Walk[0], rg.Curve) else None
            ang = Angle * D

            def tone_at(i, j, u, v, P):
                if Mode == 'none':
                    return 0.0
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

            def blend(s, m):
                return max(s, m) if Blend == 'max' else s * m if Blend == 'mul' else clamp(s + m)

            def state_at(tone, P, nrm, t, k):
                s = tone
                if Drive == 'sun' and Sun:
                    sv = Sun[min(len(Sun) - 1, k)] if len(Sun) > 1 else Sun[0]
                    sv = rg.Vector3d(sv)
                    if sv.Length > 1e-9:
                        sv.Unitize()
                        hit = clamp((sv * nrm) / max(0.05, SunFull))
                        s = blend(s, hit)
                elif Drive == 'walk' and walk is not None:
                    ok, tw = walk.NormalizedLengthParameter(clamp(t))
                    wp = walk.PointAt(tw) if ok else walk.PointAtStart
                    near = 1.0 - clamp(P.DistanceTo(wp) / max(1.0, Reach))
                    s = blend(s, near)
                elif Drive == 'pulse':
                    s = clamp(s * (0.5 + 0.5 * math.sin(2 * math.pi * (t + tone * 0.5))))
                lo, hi = min(SMin, SMax), max(SMin, SMax)
                return clamp(lo + s * (hi - lo))

            def actuator(s):
                if Shape == 'iris':
                    return iris_actuator(s), True
                if Shape == 'louvre':
                    L, _ = louvre_actuator(R, Arm or R, Depth, s)
                    return L, True
                h, _, ok = umbrella_actuator(R, Strut or R, Fold, s)
                return h, ok

            unreach = 0
            lines = ['unit,col,row,x_mm,y_mm,z_mm,duty,stroke,act_min,act_max,' + ','.join('t%d' % k for k in range(Steps + 1))]
            mean_now, duty_all, stroke_all = 0.0, 0.0, 0.0
            a_lo, a_hi = None, None
            for n, (i, j, u, v, P, nrm, tu) in enumerate(cells):
                pl = rg.Plane(P, tu, rg.Vector3d.CrossProduct(nrm, tu))
                if pl.ZAxis * nrm < 0:
                    pl = rg.Plane(P, -tu, rg.Vector3d.CrossProduct(nrm, -tu))
                Planes.append(pl)
                tone = shaped(tone_at(i, j, u, v, P))
                states = [state_at(tone, P, nrm, k / float(Steps), k) for k in range(Steps + 1)]
                s_now = state_at(tone, P, nrm, clamp(T), int(round(clamp(T) * Steps)))
                acts = []
                for s in states:
                    a, ok = actuator(s)
                    if not ok:
                        unreach += 1
                    acts.append(a)
                a_now, _ = actuator(s_now)
                duty = sum(states) / len(states)
                stroke = max(states) - min(states)
                mean_now += s_now
                duty_all += duty
                stroke_all += stroke
                a_lo = min(acts) if a_lo is None else min(a_lo, min(acts))
                a_hi = max(acts) if a_hi is None else max(a_hi, max(acts))
                States.append(round(s_now, 3))
                Actuator.append(round(a_now, 2))
                Frames.extend(frame_brep(pl))
                if Shape == 'iris':
                    ps, _ = iris_parts(pl, s_now)
                elif Shape == 'louvre':
                    ps, _ = louvre_parts(pl, s_now)
                else:
                    ps, _, _ = umbrella_parts(pl, s_now)
                Parts.extend(ps)
                lines.append(','.join([str(n + 1), str(i + 1), str(j + 1), '%.1f' % P.X, '%.1f' % P.Y, '%.1f' % P.Z, '%.3f' % duty,
                                       '%.3f' % stroke, '%.2f' % min(acts), '%.2f' % max(acts)] + ['%.2f' % a for a in acts]))
            Count = len(cells)
            Csv = '\n'.join(lines) + '\n'
            what = {'umbrella': 'slider height on the axis, mm', 'iris': 'ring turn, degrees (60 shuts it)',
                    'louvre': 'rod length, mm'}.get(Shape, 'actuator')
            parts = ['%d %s units in %s cells of %g mm (opening %g, bars %g), %d across' % (Count, Shape, 'hexagonal' if Grid == 'hex' else 'square', Pitch, 2 * R, Bar, cols),
                     'driven by %s%s in %d steps' % (Drive, '' if Mode == 'none' else ' over a %s tone' % Mode, Steps),
                     'deployed %.0f%% at T = %.2f; mean duty %.0f%%, mean stroke %.0f%%' % (
                         100.0 * mean_now / Count, T, 100.0 * duty_all / Count, 100.0 * stroke_all / Count),
                     'actuator (%s) runs %.1f to %.1f' % (what, a_lo or 0.0, a_hi or 0.0)]
            if unreach:
                parts.append('%d states the strut cannot reach: lengthen Strut or lower Fold' % unreach)
            if Drive == 'sun' and not Sun:
                parts.append('no Sun vectors wired, so the tone alone drives it')
            if Drive == 'walk' and walk is None:
                parts.append('no path curve wired to Walk, so the tone alone drives it')
            if Mode == 'image' and pic is not None and not pic.ok:
                parts.append(pic.note)
            parts.append('units read as mm')
            Info = '; '.join(parts)

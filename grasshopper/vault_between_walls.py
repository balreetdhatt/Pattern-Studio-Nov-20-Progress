# -*- coding: utf-8 -*-
"""Span a roof between two walls you drew: arch ribs at a pitch along the walls, the vault surface lofted through them,
and the ribs laid flat for cutting. One GhPython component.

The nave in Pattern Studio stands two walls facing each other and stops there. This takes the two wall lines (their top
edges, or their plan curves on the ground) and throws an arch between them at every station: a circular arc, a catenary
(the shape a hanging chain takes, so a brick vault of that line stands in pure compression, as Dieste's do), or a pointed
arch of two arcs. Each arch becomes a rib Depth deep and T thick with its springings on the walls; the arches are lofted
into the vault surface, which can go on to bricks_on_surface.py (its courses are horizontal sections, so on a vault use
ribs_on_surface.py along the span for the brick rings instead) or to tiles_on_surface.py.

INPUTS
    A, B     [Curve]  the two walls, as curves (their tops, or their plan lines); the roof spans from A to B
    Rise     [float]  mm the arch rises above the chord at its crown                                        1500
    Profile  [str]    arc | catenary | pointed                                                              catenary
    Pitch    [float]  mm between ribs along A                                                               600
    Match    [str]    how a point on A finds its partner on B: 'length' (same fraction of the length) or
                      'closest' (the nearest point of B)                                                   length
    T        [float]  rib thickness, mm                                                                     18
    Depth    [float]  rib depth under the arch line, mm                                                      150
    Stations [int]    points along each arch in the schedule                                                24
    Gap      [float]  mm between ribs in the nest                                                           50
    Go       [bool]

OUTPUTS
    Ribs     one solid per rib (Brep)
    Arches   the arch curves
    Vault    the surface lofted through the arches (Brep)
    Nest     the ribs flat on world XY in a row, with Labels
    Labels   a point per nested rib
    Csv      rib,s_mm,span_mm,rise_mm,arch_length_mm,profile (heights above the chord at N stations)
    Count    ribs
    Info

Units are read as millimetres. Written 1 November 2026 (IronPython 2.7 and CPython 3: no f-strings). Run in Rhino 8 on 1 November
2026 (three profiles between a straight and a bowed wall) and as a GhPython component; grasshopper/README.md has the record.
"""
from __future__ import division
import math
import Rhino.Geometry as rg


def d(v, fallback):
    return fallback if v is None else v


def geo(v):
    if v is None or isinstance(v, (rg.GeometryBase, rg.Point3d, rg.Vector3d, rg.Plane)):
        return v
    val = getattr(v, 'Value', None)
    if isinstance(val, (rg.GeometryBase, rg.Point3d, rg.Vector3d, rg.Plane)):
        return val
    try:
        import System
        if isinstance(v, (System.Guid, str)):
            import rhinoscriptsyntax as rs
            for f in (rs.coercecurve, rs.coercegeometry):
                try:
                    g = f(v)
                    if g is not None:
                        return g
                except Exception:
                    pass
    except Exception:
        pass
    return v


A = geo(globals().get('A'))
B = geo(globals().get('B'))
Rise = float(d(globals().get('Rise'), 1500.0))
Profile = str(d(globals().get('Profile'), 'catenary')).strip().lower()
Pitch = float(d(globals().get('Pitch'), 600.0))
Match = str(d(globals().get('Match'), 'length')).strip().lower()
T = float(d(globals().get('T'), 18.0))
Depth = float(d(globals().get('Depth'), 150.0))
Stations = max(4, int(d(globals().get('Stations'), 24)))
Gap = float(d(globals().get('Gap'), 50.0))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01
UP = rg.Vector3d.ZAxis


def solid(b):
    """a closed Brep with its normals outward: an extrusion run against its face's normal comes out inside out"""
    if b is None:
        return None
    if b.SolidOrientation == rg.BrepSolidOrientation.Inward:
        b.Flip()
    return b


def catenary_heights(n, rise):
    """heights above the chord at n+1 stations across a unit span, for a catenary of the given rise (unit span):
    y = a (cosh(x/a) - 1) hung upside down; a found by bisection so the ends meet the chord"""
    if rise <= 1e-9:
        return [0.0] * (n + 1)
    lo, hi = 1e-3, 1e3
    for _ in range(80):
        a = (lo + hi) / 2.0
        r = a * (math.cosh(0.5 / a) - 1.0)
        if r > rise:
            lo = a
        else:
            hi = a
    a = (lo + hi) / 2.0
    top = a * (math.cosh(0.5 / a) - 1.0)
    return [top - a * (math.cosh((i / float(n) - 0.5) / a) - 1.0) for i in range(n + 1)]


def arch_curve(P, Q, rise, profile, n):
    """the arch from P to Q in the vertical plane through them"""
    chord = Q - P
    span = chord.Length
    if span < 1e-6:
        return None
    along = rg.Vector3d(chord)
    along.Unitize()
    mid = P + chord * 0.5
    apex = mid + UP * rise
    if profile == 'arc':
        return rg.Arc(P, apex, Q).ToNurbsCurve()
    if profile == 'pointed':
        # two arcs, each through its springing and the apex, bulging a third of the way across
        l = rg.Arc(P, P + along * (span * 0.25) + UP * (rise * 0.72), apex).ToNurbsCurve()
        r = rg.Arc(apex, Q - along * (span * 0.25) + UP * (rise * 0.72), Q).ToNurbsCurve()
        j = rg.Curve.JoinCurves([l, r], TOL)
        return j[0] if j and len(j) else l
    hs = catenary_heights(n, rise / span)
    pts = [P + along * (span * i / float(n)) + UP * (hs[i] * span) for i in range(n + 1)]
    return rg.Curve.CreateInterpolatedCurve(pts, 3)


Ribs, Arches, Nest, Labels = [], [], [], []
Vault, Csv, Count, Info = None, '', 0, ''

if Go:
    if not isinstance(A, rg.Curve) or not isinstance(B, rg.Curve):
        Info = 'wire the two walls as curves to A and B'
    else:
        LA = A.GetLength()
        n = max(2, int(math.floor(LA / Pitch)) + 1)
        lead = (LA - (n - 1) * Pitch) / 2.0
        lines = ['rib,s_mm,span_mm,rise_mm,arch_length_mm,profile']
        x_nest = 0.0
        spans = []
        for k in range(n):
            s = lead + k * Pitch
            ok, ta = A.NormalizedLengthParameter(s / LA)
            if not ok:
                continue
            P = A.PointAt(ta)
            if Match == 'closest':
                ok2, tb = B.ClosestPoint(P)
                Q = B.PointAt(tb) if ok2 else B.PointAtStart
            else:
                ok2, tb = B.NormalizedLengthParameter(s / LA)
                Q = B.PointAt(tb) if ok2 else B.PointAtEnd
            arch = arch_curve(P, Q, Rise, Profile, Stations)
            if arch is None:
                continue
            span = P.DistanceTo(Q)
            rise = Rise
            spans.append(span)
            Arches.append(arch)
            # the rib: the arch line and its offset Depth below, closed at the springings
            along = Q - P
            along.Unitize()
            nrm = rg.Vector3d.CrossProduct(along, UP)
            nrm.Unitize()
            rib_plane = rg.Plane(P, along, UP)
            inner = arch.Offset(rib_plane, -Depth, TOL, rg.CurveOffsetCornerStyle.Sharp)
            if inner and len(inner):
                inner = inner[0]
                # the offset may run the right way or not: keep the one whose middle lies below the arch's
                if inner.PointAt(inner.Domain.Mid).Z > arch.PointAt(arch.Domain.Mid).Z:
                    inner = arch.Offset(rib_plane, Depth, TOL, rg.CurveOffsetCornerStyle.Sharp)[0]
            else:
                inner = arch.DuplicateCurve()
                inner.Translate(-UP * Depth)
            segs = [arch, rg.Line(arch.PointAtEnd, inner.PointAtEnd).ToNurbsCurve(), inner, rg.Line(inner.PointAtStart, arch.PointAtStart).ToNurbsCurve()]
            joined = rg.Curve.JoinCurves(segs, TOL * 10)
            outline = joined[0] if joined and len(joined) and joined[0].IsClosed else None
            if outline is None:
                continue
            # the rib bears ON the walls: whatever of it would hang below the springing line (into the wall) is cut off, so
            # its underside sits flat on the wall top at each end
            above = rg.Rectangle3d(rib_plane, rg.Interval(-span, 2 * span), rg.Interval(0.0, rise * 4 + Depth * 4)).ToNurbsCurve()
            try:
                clipped = rg.Curve.CreateBooleanIntersection(outline, above, TOL)
            except TypeError:
                clipped = rg.Curve.CreateBooleanIntersection(outline, above)
            if clipped and len(clipped):
                best = clipped[0]
                for cc in clipped:
                    ab = rg.AreaMassProperties.Compute(cc)
                    ac = rg.AreaMassProperties.Compute(best)
                    if ab is not None and ac is not None and ab.Area > ac.Area:
                        best = cc
                outline = best
            faces = rg.Brep.CreatePlanarBreps(outline, TOL)
            if not faces or not len(faces):
                continue
            path = rg.Line(P - nrm * (T / 2.0), P + nrm * (T / 2.0)).ToNurbsCurve()
            rib = solid(faces[0].Faces[0].CreateExtrusion(path, True))  # not 'solid =': that shadowed the helper and the second rib failed (found 3 Nov by assembly.py)
            if rib is None:
                continue
            Ribs.append(rib)
            # the nest
            flat = outline.DuplicateCurve()
            flat.Transform(rg.Transform.ChangeBasis(rg.Plane.WorldXY, rib_plane))
            fb = flat.GetBoundingBox(True)
            flat.Translate(rg.Vector3d(x_nest - fb.Min.X, -fb.Min.Y, 0))
            Nest.append(flat)
            Labels.append(rg.Point3d(x_nest + (fb.Max.X - fb.Min.X) / 2.0, -Gap / 2.0, 0))
            x_nest += (fb.Max.X - fb.Min.X) + Gap
            heights = []
            for i in range(Stations + 1):
                ok3, t = arch.NormalizedLengthParameter(i / float(Stations))
                p = arch.PointAt(t) if ok3 else P
                base = P + along * ((p - P) * along)
                heights.append(p.Z - base.Z)
            lines.append(','.join([str(len(Ribs)), '%.1f' % s, '%.1f' % span, '%.1f' % Rise, '%.1f' % arch.GetLength(), ';'.join('%.1f' % h for h in heights)]))
        Count = len(Ribs)
        Csv = '\n'.join(lines) + '\n'
        if len(Arches) >= 2:
            lofts = rg.Brep.CreateFromLoft(Arches, rg.Point3d.Unset, rg.Point3d.Unset, rg.LoftType.Normal, False)
            Vault = lofts[0] if lofts and len(lofts) else None
        if Count:
            Info = ('%d %s ribs at %g mm along the first wall, spans %.0f to %.0f mm, rise %g mm, %g deep and %g thick; '
                    'nest %.1f m long%s; units read as mm' % (Count, Profile, Pitch, min(spans), max(spans), Rise, Depth, T,
                                                               (x_nest - Gap) / 1000.0, '' if Vault is not None else '; the loft failed'))
        else:
            Info = 'no arch could be made: check that A and B are apart and Rise is positive'

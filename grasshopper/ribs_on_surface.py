# -*- coding: utf-8 -*-
"""Cut serial sections (ribs) through your own Rhino surface or solid, nest them flat, and write the schedule. One GhPython component.

Pattern Studio's Serial sections mode builds a wall from parallel ribs whose front edges follow a field (the Aqua Tower,
Zero/Fold, One Main logic). This takes the form from you instead: a surface, a Brep or a solid you modelled, sectioned
by parallel planes at Pitch along Dir. Each section becomes a rib: a plate T thick whose front edge is the section
curve and whose back is a straight line on a common back plane Back behind the form, so the ribs stand on one line as
they would on a wall or a floor. A closed section (a solid) is a rib on its own, with the section as its whole outline.

Every rib is also laid flat on world XY beside the others (Nest), with its number, so the set can go to a CNC nest, and
the schedule carries the profile at N stations the way -ribs.csv does, so ribs_from_csv.py and the web tool agree on
the form.

INPUTS
    Geo     [Surface | Brep | Mesh]  the form to section                                         (required)
    Pitch   [float]  rib to rib, mm                                                              300
    Dir     [str | Vector]  'x', 'y', 'z' or a vector: the direction the ribs are stacked along  x
    T       [float]  rib thickness, mm                                                           18
    Back    [float]  mm the back plane sits behind the form's far side, along Face (0 = at it)  0
    Face    [str | Vector]  which way the form faces: 'y' means the back is on its -y side        -y
    Stations [int]   profile samples per rib in the schedule                                     24
    Gap     [float]  mm between ribs in the nest                                                 50
    Pair    [bool]   nest the ribs in pairs, head to tail in one strip (the web tool's zero-waste idea: a pair whose
                     depths add up to the strip is cut with one line; here each pair's waste is reported)   False
    Go      [bool]

OUTPUTS
    Ribs    one solid per rib (Brep)
    Edges   the front edge of each rib (the section curve)
    Nest    the ribs laid flat on world XY, outlines
    Labels  a point per nested rib, for a text tag with its number
    Csv     rib,pos_mm,length_mm,depth_min_mm,depth_max_mm,area_mm2,profile (depths at N stations, ; separated)
    Strips  with Pair on, one rectangle per pair: the strip both ribs are cut from
    Count   ribs cut
    Info    what was cut; with Pair on, the waste of the pairs

Units are read as millimetres. Written 1 November 2026 (IronPython 2.7 and CPython 3: no f-strings). Run in Rhino 8 on 1 November 2026 through the Rhino MCP; grasshopper/README.md says what was tested.
"""
from __future__ import division
import math
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
            for f in (rs.coercebrep, rs.coercesurface, rs.coercemesh, rs.coercegeometry):
                try:
                    g = f(v)
                    if g is not None:
                        return g
                except Exception:
                    pass
    except Exception:
        pass
    return v


Geo = geo(globals().get('Geo'))
Pitch = float(d(globals().get('Pitch'), 300.0))
Dir = globals().get('Dir')
T = float(d(globals().get('T'), 18.0))
Back = float(d(globals().get('Back'), 0.0))
Face = globals().get('Face')
Stations = max(2, int(d(globals().get('Stations'), 24)))
Gap = float(d(globals().get('Gap'), 50.0))
Pair = bool(d(globals().get('Pair'), False))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01


def solid(b):
    """a closed Brep with its normals outward: an extrusion run against its face's normal comes out inside out"""
    if b is None:
        return None
    if b.SolidOrientation == rg.BrepSolidOrientation.Inward:
        b.Flip()
    return b


def as_vec(v, fallback):
    if isinstance(v, rg.Vector3d) and v.Length > 1e-9:
        u = rg.Vector3d(v)
        u.Unitize()
        return u
    s = str(d(v, '')).strip().lower()
    m = {'x': rg.Vector3d.XAxis, 'y': rg.Vector3d.YAxis, 'z': rg.Vector3d.ZAxis,
         '-x': -rg.Vector3d.XAxis, '-y': -rg.Vector3d.YAxis, '-z': -rg.Vector3d.ZAxis}
    return m.get(s, fallback)


def as_brep(g):
    if isinstance(g, rg.Brep):
        return g
    if isinstance(g, (rg.Surface, rg.Extrusion)):
        return g.ToBrep()
    if isinstance(g, rg.Mesh):
        return rg.Brep.CreateFromMesh(g, True)
    return None


Ribs, Edges, Nest, Labels, Strips = [], [], [], [], []
Csv, Count, Info = '', 0, ''

if Go:
    brep = as_brep(Geo)
    if brep is None:
        Info = 'wire a surface, a Brep or a mesh to Geo'
    else:
        stack = as_vec(Dir, rg.Vector3d.XAxis)
        face = as_vec(Face, -rg.Vector3d.YAxis)  # the form faces this way; the back plane is on the other side
        if abs(stack * face) > 0.99:
            Info = 'Dir and Face cannot be the same axis'
        else:
            bb = brep.GetBoundingBox(True)
            corners = bb.GetCorners()
            lo = min((c - rg.Point3d.Origin) * stack for c in corners)
            hi = max((c - rg.Point3d.Origin) * stack for c in corners)
            # the back plane: the far side of the form along -Face, Back further
            back_d = min((c - rg.Point3d.Origin) * face for c in corners) - Back
            n = int(math.floor((hi - lo) / Pitch)) + 1
            lead = (hi - lo - (n - 1) * Pitch) / 2.0
            lines = ['rib,pos_mm,length_mm,depth_min_mm,depth_max_mm,area_mm2,profile']
            x_nest = 0.0
            flats = []  # (flat outline at the origin, width, depth, area), one per rib, in order
            dmin_all, dmax_all = 1e12, -1e12
            for k in range(n):
                pos = lo + lead + k * Pitch
                origin = rg.Point3d.Origin + stack * pos
                plane = rg.Plane(origin, stack)
                curves = rg.Brep.CreateContourCurves(brep, plane)
                if not curves:
                    continue
                # the rib's own frame: x along the section's run (the axis in the plane across Face), y along Face (depth)
                run = rg.Vector3d.CrossProduct(stack, face)
                run.Unitize()
                depth_axis = rg.Vector3d(face)
                for c in curves:
                    if c.GetLength() < 10.0:
                        continue
                    outline = None
                    if c.IsClosed:
                        outline = c
                    else:
                        # close it against the back plane: drop both ends straight back, join along the back
                        a, b = c.PointAtStart, c.PointAtEnd
                        da = (a - rg.Point3d.Origin) * face - back_d
                        db = (b - rg.Point3d.Origin) * face - back_d
                        a2 = a - depth_axis * da
                        b2 = b - depth_axis * db
                        segs = [c, rg.Line(b, b2).ToNurbsCurve(), rg.Line(b2, a2).ToNurbsCurve(), rg.Line(a2, a).ToNurbsCurve()]
                        joined = rg.Curve.JoinCurves(segs, TOL * 10)
                        if joined and len(joined) and joined[0].IsClosed:
                            outline = joined[0]
                    if outline is None:
                        continue
                    faces = rg.Brep.CreatePlanarBreps(outline, TOL)
                    if not faces or not len(faces):
                        continue
                    path = rg.Line(origin - stack * (T / 2.0), origin + stack * (T / 2.0)).ToNurbsCurve()
                    solid = solid(faces[0].Faces[0].CreateExtrusion(path, True))
                    if solid is None:
                        continue
                    Ribs.append(solid)
                    Edges.append(c)
                    # the profile: depth off the back plane at N stations along the front edge
                    depths = []
                    for s in range(Stations + 1):
                        ok, t = c.NormalizedLengthParameter(s / float(Stations))
                        p = c.PointAt(t) if ok else c.PointAtStart
                        depths.append((p - rg.Point3d.Origin) * face - back_d)
                    dmin, dmax = min(depths), max(depths)
                    dmin_all, dmax_all = min(dmin_all, dmin), max(dmax_all, dmax)
                    am = rg.AreaMassProperties.Compute(outline)
                    area = am.Area if am is not None else 0.0
                    # the nest: the outline turned flat onto world XY (x along the run, y the depth, the back line at y = 0)
                    rib_plane = rg.Plane(origin, run, depth_axis)
                    flat = outline.DuplicateCurve()
                    flat.Transform(rg.Transform.ChangeBasis(rg.Plane.WorldXY, rib_plane))
                    fb = flat.GetBoundingBox(True)
                    flat.Translate(rg.Vector3d(-fb.Min.X, -fb.Min.Y, 0))
                    flats.append((flat, fb.Max.X - fb.Min.X, fb.Max.Y - fb.Min.Y, area))
                    lines.append(','.join([str(len(Ribs)), '%.1f' % pos, '%.1f' % c.GetLength(), '%.1f' % dmin, '%.1f' % dmax,
                                           '%.0f' % area, ';'.join('%.1f' % x for x in depths)]))
            Count = len(Ribs)
            Csv = '\n'.join(lines) + '\n'
            # lay the flats out: in a row, or in pairs head to tail in one strip each
            waste_note = ''
            if Pair and len(flats) > 1:
                used, cut_from = 0.0, 0.0
                k = 0
                while k < len(flats):
                    f1, w1, h1, a1 = flats[k]
                    if k + 1 < len(flats):
                        f2, w2, h2, a2 = flats[k + 1]
                        W = h1 + h2
                        L = max(w1, w2)
                        c1 = f1.DuplicateCurve()
                        c1.Translate(rg.Vector3d(x_nest, 0, 0))
                        c2 = f2.DuplicateCurve()
                        c2.Rotate(math.pi, rg.Vector3d.ZAxis, rg.Point3d(w2 / 2.0, h2 / 2.0, 0))  # head to tail: its back line to the top
                        c2.Translate(rg.Vector3d(x_nest + (L - w2), W - h2, 0))
                        Nest.extend([c1, c2])
                        Labels.append(rg.Point3d(x_nest + w1 / 2.0, -Gap / 2.0, 0))
                        Labels.append(rg.Point3d(x_nest + L - w2 / 2.0, W + Gap / 2.0, 0))
                        Strips.append(rg.Rectangle3d(rg.Plane(rg.Point3d(x_nest, 0, 0), rg.Vector3d.XAxis, rg.Vector3d.YAxis), L, W).ToNurbsCurve())
                        used += a1 + a2
                        cut_from += L * W
                        x_nest += L + Gap
                        k += 2
                    else:
                        c1 = f1.DuplicateCurve()
                        c1.Translate(rg.Vector3d(x_nest, 0, 0))
                        Nest.append(c1)
                        Labels.append(rg.Point3d(x_nest + w1 / 2.0, -Gap / 2.0, 0))
                        Strips.append(rg.Rectangle3d(rg.Plane(rg.Point3d(x_nest, 0, 0), rg.Vector3d.XAxis, rg.Vector3d.YAxis), w1, h1).ToNurbsCurve())
                        used += a1
                        cut_from += w1 * h1
                        x_nest += w1 + Gap
                        k += 1
                if cut_from > 0:
                    waste_note = '; paired strips waste %.0f%% (a pair whose depths add to the strip wastes nothing)' % (100.0 * (1.0 - used / cut_from))
            else:
                for (f, w, h, a) in flats:
                    c = f.DuplicateCurve()
                    c.Translate(rg.Vector3d(x_nest, 0, 0))
                    Nest.append(c)
                    Labels.append(rg.Point3d(x_nest + w / 2.0, -Gap / 2.0, 0))
                    x_nest += w + Gap
            if Count:
                Info = ('%d ribs of %g mm at %g mm pitch along %s; depths %.0f to %.0f mm off the back plane; '
                        'nest %.1f m long%s; units read as mm'
                        % (Count, T, Pitch, str(d(Dir, 'x')), dmin_all, dmax_all, (x_nest - Gap) / 1000.0, waste_note))
            else:
                Info = 'no section met the form: check Dir against where it lies'

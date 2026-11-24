# -*- coding: utf-8 -*-
"""Build a serial-section panel from the rib schedule the web tool exported. One GhPython component.

Pattern Studio's Serial sections bundle contains <name>-ribs.csv, one row per rib:

    rib,y_mm (or x_mm),length_mm,depth_min_mm,depth_max_mm,sheet,strip,complement,profile

`profile` is the rib's front edge at every station along its length, as semicolon-separated
depths in mm (or, for a twisting band, angles in degrees). The header's second column says
whether the ribs are horizontal (y_mm: position up the panel) or vertical (x_mm: position
across it). Nothing is re-solved here: the browser decided every depth, Rhino builds the stack.
This is the Aqua Tower / Zero/Fold / One Main logic; the same rows drive a CNC nest.

INPUTS
    Csv    [str]   path to the -ribs.csv file, OR the file's contents as one string
    T      [float] rib (sheet) thickness, mm            default 18
    Twist  [bool]  profile holds angles (a twisting band) rather than depths   default False
    Depth  [float] band depth when Twist is on, mm      default 200
    Plane  [Plane] where the panel's bottom-left corner sits; default world XZ (a wall on the ground)
    Go     [bool]

OUTPUTS
    Ribs     one closed solid per rib (Brep): the profile extruded by T
    Edges    the front-edge polyline of each rib (for the nest, or a check against the browser)
    Count    number of ribs
    Info     what was read and any rows skipped

Never yet run in Rhino (30 Oct 2026); written to the conventions of ombrae_from_csv.py, which
has run under Rhino 8 Python 3.
"""
from __future__ import division
import math
import os
import Rhino.Geometry as rg


def d(v, fallback):
    return fallback if v is None else v


Csv   = globals().get('Csv')
T     = float(d(globals().get('T'), 18.0))
Twist = bool(d(globals().get('Twist'), False))
Depth = float(d(globals().get('Depth'), 200.0))
Plane = globals().get('Plane')
Go    = bool(d(globals().get('Go'), True))


def read_rows(src):
    if not src:
        return [], False, 'nothing wired to Csv'
    text = src
    if '\n' not in src and os.path.exists(src):
        f = open(src, 'r'); text = f.read(); f.close()
    lines = [ln.strip() for ln in text.replace('\r', '').split('\n') if ln.strip()]
    if not lines:
        return [], False, 'the file is empty'
    head = [h.strip().lower() for h in lines[0].split(',')]
    if 'profile' not in head or 'length_mm' not in head or not ('y_mm' in head or 'x_mm' in head):
        return [], False, ('the header is "%s"; this wants a Pattern Studio rib schedule with length_mm, '
                           'y_mm or x_mm, and profile' % lines[0][:70])
    horiz = 'y_mm' in head
    ix = dict((h, head.index(h)) for h in head)
    rows, bad = [], 0
    for ln in lines[1:]:
        c = ln.split(',')
        if len(c) < len(head):
            bad += 1; continue
        try:
            prof = [float(x) for x in c[ix['profile']].split(';') if x.strip() != '']
            rows.append({'pos': float(c[ix['y_mm' if horiz else 'x_mm']]), 'len': float(c[ix['length_mm']]), 'prof': prof})
        except ValueError:
            bad += 1
    note = ('%d rows could not be read and were skipped' % bad) if bad else ''
    return rows, horiz, note


Ribs, Edges = [], []
Count, Info = 0, ''

if Go:
    rows, horiz, note = read_rows(Csv)
    if not rows:
        Info = note or 'no rows'
    else:
        base = Plane if Plane is not None else rg.Plane(rg.Point3d.Origin, rg.Vector3d.XAxis, rg.Vector3d.ZAxis)
        for r in rows:
            n = len(r['prof']) - 1
            if n < 1:
                continue
            step = r['len'] / n
            pts = []
            for k, v in enumerate(r['prof']):
                a = k * step
                if Twist:
                    ang = math.radians(v)
                    out = Depth * math.sin(ang)
                    up = Depth * math.cos(ang)
                    # the band's tip: hinge at the face, tip swung out by the angle
                    p = base.PointAt(a, r['pos'] + up, out) if horiz else base.PointAt(r['pos'] + up, a, out)
                else:
                    p = base.PointAt(a, r['pos'], v) if horiz else base.PointAt(r['pos'], a, v)
                pts.append(p)
            edge = rg.Polyline(pts)
            Edges.append(edge.ToNurbsCurve())
            if Twist:
                # a ribbon: loft between the hinge line and the tip line
                hinge = [base.PointAt(k * step, r['pos'], 0) if horiz else base.PointAt(r['pos'], k * step, 0) for k in range(n + 1)]
                lofts = rg.Brep.CreateFromLoft([rg.Polyline(hinge).ToNurbsCurve(), edge.ToNurbsCurve()], rg.Point3d.Unset, rg.Point3d.Unset, rg.LoftType.Straight, False)
                if lofts:
                    Ribs.append(lofts[0])
            else:
                # the closed profile: back edge on the face, front edge the profile; extrude by T across the stack
                back0 = base.PointAt(0, r['pos'], 0) if horiz else base.PointAt(r['pos'], 0, 0)
                back1 = base.PointAt(r['len'], r['pos'], 0) if horiz else base.PointAt(r['pos'], r['len'], 0)
                poly = rg.Polyline([back0] + pts[::-1] + [back0]) if False else rg.Polyline([back0, back1] + pts[::-1] + [back0])
                crv = poly.ToNurbsCurve()
                direction = base.YAxis * T if horiz else base.XAxis * T
                srf = rg.Surface.CreateExtrusion(crv, direction)
                brep = srf.ToBrep().CapPlanarHoles(0.01) if srf else None
                if brep:
                    Ribs.append(brep)
        Count = len(Ribs)
        Info = '%d ribs, %s, %d stations on the first rib%s' % (Count, 'horizontal' if horiz else 'vertical', len(rows[0]['prof']), ('; ' + note) if note else '')

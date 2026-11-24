# -*- coding: utf-8 -*-
"""Build a paver field from the placement list the web tool exported. One GhPython component.

Pattern Studio's Pavers bundle contains <name>-pavers.csv, one row per paver:

    paver,type,colour,cut,x_mm,y_mm,area_mm2,height_mm,outline,name

`outline` is the paver's polygon as semicolon-separated "x y" pairs in mm (the plan, y up), `type` its type number,
`colour` its hex colour, `height_mm` its type's height and `name` its type's name when one was given (storage, fixed glass...). Nothing is re-solved: the browser chose every type,
Rhino builds the field. The same rows are the setting-out drawing and, summed by type, the order (-schedule.csv).

INPUTS
    Csv    [str]   path to the -pavers.csv file, OR the file's contents as one string
    Joint  [float] joint width, mm: each outline is offset inward by half of it   default 0
    Plane  [Plane] where the field's origin sits; default world XY (a paving on the ground)
    Upright [bool] stand the field up as a facade when no Plane is wired: x along world X, the tool's y up world Z,
                  heights toward -Y (out of the Front view), as Nested modules (Berlin Free University) are laid   default False
    Go     [bool]

OUTPUTS
    Pavers   one closed solid per paver (Brep), extruded to its type's height
    Outlines the paver polygons (curves), for a setting-out drawing
    Types    type number per paver
    Names    type name per paver ('' when none was given)
    Colours  colour per paver (System.Drawing.Color), for a Custom Preview
    Count    number of pavers
    Info     what was read and any rows skipped

Never yet run in Rhino (30 Oct 2026); written to the conventions of ombrae_from_csv.py, which has run under Rhino 8 Python 3.
"""
from __future__ import division
import os
import Rhino.Geometry as rg

try:
    import System.Drawing as sd
except Exception:  # outside Rhino
    sd = None


def d(v, fallback):
    return fallback if v is None else v


Csv   = globals().get('Csv')
Joint = float(d(globals().get('Joint'), 0.0))
Plane = globals().get('Plane')
Upright = bool(d(globals().get('Upright'), False))
Go    = bool(d(globals().get('Go'), True))


def read_rows(src):
    if not src:
        return [], 'nothing wired to Csv'
    text = src
    if '\n' not in src and os.path.exists(src):
        f = open(src, 'r'); text = f.read(); f.close()
    lines = [ln.strip() for ln in text.replace('\r', '').split('\n') if ln.strip()]
    if not lines:
        return [], 'the file is empty'
    head = [h.strip().lower() for h in lines[0].split(',')]
    need = ['type', 'height_mm', 'outline']
    if not all(h in head for h in need):
        return [], ('the header is "%s"; this wants a Pattern Studio paver placement list with type, height_mm and outline' % lines[0][:70])
    ix = dict((h, head.index(h)) for h in head)
    rows, bad = [], 0
    for ln in lines[1:]:
        c = ln.split(',')
        if len(c) < len(head):
            bad += 1; continue
        try:
            pts = []
            for pair in c[ix['outline']].split(';'):
                xy = pair.strip().split(' ')
                if len(xy) >= 2:
                    pts.append((float(xy[0]), float(xy[1])))
            if len(pts) < 3:
                bad += 1; continue
            rows.append({'type': int(float(c[ix['type']])), 'height': float(c[ix['height_mm']]),
                         'colour': c[ix['colour']].strip() if 'colour' in ix else '#888888',
                         'name': c[ix['name']].strip() if 'name' in ix else '', 'pts': pts})
        except ValueError:
            bad += 1
    note = ('%d rows could not be read and were skipped' % bad) if bad else ''
    return rows, note


def shrink(crv, plane, dist):
    """offset a closed planar curve inward by dist; returns the original if the offset fails"""
    if dist <= 0:
        return crv
    best, best_a = crv, None
    for sgn in (1, -1):
        try:
            res = crv.Offset(plane, sgn * dist, 0.01, rg.CurveOffsetCornerStyle.Sharp)
        except Exception:
            res = None
        if res and len(res) == 1 and res[0].IsClosed:
            amp = rg.AreaMassProperties.Compute(res[0])
            a = amp.Area if amp else None
            if a is not None and (best_a is None or a < best_a):
                best, best_a = res[0], a
    return best


Pavers, Outlines, Types, Names, Colours = [], [], [], [], []
Count, Info = 0, ''

if Go:
    rows, note = read_rows(Csv)
    if not rows:
        Info = note or 'no rows'
    else:
        if Plane is not None:
            base = Plane
        elif Upright:
            base = rg.Plane(rg.Point3d.Origin, rg.Vector3d.XAxis, rg.Vector3d.ZAxis)  # normal -Y: depths come toward the Front view
        else:
            base = rg.Plane.WorldXY
        hs = set()
        for r in rows:
            pts = [base.PointAt(x, y, 0) for x, y in r['pts']]
            pts.append(pts[0])
            crv = rg.Polyline(pts).ToNurbsCurve()
            crv = shrink(crv, base, Joint / 2.0)
            Outlines.append(crv)
            srf = rg.Surface.CreateExtrusion(crv, base.ZAxis * r['height'])
            brep = srf.ToBrep().CapPlanarHoles(0.01) if srf else None
            if brep:
                Pavers.append(brep)
            Types.append(r['type'])
            Names.append(r['name'])
            hs.add(r['height'])
            if sd is not None:
                try:
                    Colours.append(sd.ColorTranslator.FromHtml(r['colour']))
                except Exception:
                    Colours.append(sd.Color.Gray)
        Count = len(Outlines)
        Info = '%d pavers of %d types, heights %s mm%s' % (Count, len(set(Types)), '/'.join(str(int(h)) for h in sorted(hs)), ('; ' + note) if note else '')

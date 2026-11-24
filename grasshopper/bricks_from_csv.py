# -*- coding: utf-8 -*-
"""Build a brick-course panel from the placement list the web tool exported. One GhPython component.

Pattern Studio's Brick courses bundle contains <name>-bricks.csv, one row per brick:

    brick,course,place,length_mm,x_mm,y_mm,z_offset_mm,turn_deg,tone

x, y is the brick's centre on the wall face (y up, mm), length_mm its length (half bricks close
the odd courses of a running bond), turn_deg its rotation about its own vertical axis
(positive turns the right-hand end toward the viewer), z_offset_mm how far it stands out of
the face. Nothing is re-solved here, so if Rhino and the browser disagree it is a bug in one of
them, not a difference of opinion. This is the Gantenbein / Casa la Roca placement list; a robot
program is written from the same rows.

INPUTS
    Csv    [str]   path to the -bricks.csv file, OR the file's contents as one string
    BW     [float] brick width (the depth of the wall), mm   default 115
    BH     [float] brick height, mm                           default 65
    W, H   [float] panel size, mm; 0 means "work it out from the brick extents"
    Plane  [Plane] where the panel's bottom-left corner sits; default world XZ (a wall on the ground)
    Go     [bool]

OUTPUTS
    Bricks  one closed box per brick (Brep)
    Planes  the placement plane of each brick (origin at its centre, x along its length)
    Turns   turn_deg per brick
    Offsets z_offset_mm per brick
    Courses course number per brick
    Count   number of bricks
    Info    what was read and any rows skipped

Never yet run in Rhino (30 Oct 2026); written to the same conventions as ombrae_from_csv.py,
which has run under Rhino 8 Python 3.
"""
from __future__ import division
import math
import os
import Rhino.Geometry as rg


def d(v, fallback):
    return fallback if v is None else v


Csv   = globals().get('Csv')
BW    = float(d(globals().get('BW'), 115.0))
BH    = float(d(globals().get('BH'), 65.0))
W     = float(d(globals().get('W'), 0.0))
H     = float(d(globals().get('H'), 0.0))
Plane = globals().get('Plane')
Go    = bool(d(globals().get('Go'), True))


def read_rows(src):
    """Accept a path or the raw text, and be forgiving about column order."""
    if not src:
        return [], 'nothing wired to Csv'
    text = src
    if '\n' not in src and os.path.exists(src):
        f = open(src, 'r')
        text = f.read()
        f.close()
    lines = [ln.strip() for ln in text.replace('\r', '').split('\n') if ln.strip()]
    if not lines:
        return [], 'the file is empty'
    head = [h.strip().lower() for h in lines[0].split(',')]
    need = ['x_mm', 'y_mm', 'turn_deg']
    if not all(h in head for h in need):
        return [], ('the header is "%s"; this wants a Pattern Studio brick placement list with '
                    'x_mm, y_mm and turn_deg' % lines[0][:70])
    ix = dict((h, head.index(h)) for h in head)
    rows, bad = [], 0
    for ln in lines[1:]:
        c = ln.split(',')
        if len(c) < len(head):
            bad += 1
            continue
        try:
            rows.append({
                'course': int(float(c[ix['course']])) if 'course' in ix else 0,
                'len': float(c[ix['length_mm']]) if 'length_mm' in ix else 240.0,
                'x': float(c[ix['x_mm']]), 'y': float(c[ix['y_mm']]),
                'z': float(c[ix['z_offset_mm']]) if 'z_offset_mm' in ix else 0.0,
                'turn': float(c[ix['turn_deg']]),
                'tone': float(c[ix['tone']]) if 'tone' in ix else 0.5,
                # pass 76: a header goes through the wall, so a row may carry its own depth
                'dep': float(c[ix['depth_mm']]) if 'depth_mm' in ix else 0.0})
        except ValueError:
            bad += 1
    note = ('%d rows could not be read and were skipped' % bad) if bad else ''
    return rows, note


Bricks, Planes, Turns, Offsets, Courses = [], [], [], [], []
Count, Info = 0, ''

if Go:
    rows, note = read_rows(Csv)
    if not rows:
        Info = note or 'no rows'
    else:
        base = Plane if Plane is not None else rg.Plane(rg.Point3d.Origin, rg.Vector3d.XAxis, rg.Vector3d.ZAxis)
        if W <= 0:
            W = max(r['x'] + r['len'] / 2.0 for r in rows) + min(r['x'] - r['len'] / 2.0 for r in rows)
        if H <= 0:
            H = max(r['y'] for r in rows) + BH / 2.0 + min(r['y'] for r in rows) - BH / 2.0
        for r in rows:
            # a plane at the brick's centre: x along its length, y up the wall, z out of the face
            p = rg.Plane(base)
            p.Origin = base.PointAt(r['x'], r['y'], BW / 2.0 + r['z'])
            p.Rotate(math.radians(r['turn']), base.YAxis, p.Origin)
            dep = r.get('dep', 0.0) or BW
            box = rg.Box(p, rg.Interval(-r['len'] / 2.0, r['len'] / 2.0),
                         rg.Interval(-BH / 2.0, BH / 2.0), rg.Interval(-dep / 2.0, dep / 2.0))
            Bricks.append(box.ToBrep())
            Planes.append(p)
            Turns.append(r['turn'])
            Offsets.append(r['z'])
            Courses.append(r['course'])
        Count = len(Bricks)
        turns = [abs(t) for t in Turns]
        Info = ('%d bricks in %d courses, panel about %.0f x %.0f mm, turns up to %.1f deg, offsets up to %.1f mm'
                % (Count, max(Courses) if Courses else 0, W, H, max(turns) if turns else 0, max(Offsets) if Offsets else 0))
        if note:
            Info += '; ' + note

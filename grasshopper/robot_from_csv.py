# -*- coding: utf-8 -*-
"""Rebuild a robot-placed wall, bed of pavers or field of kinetic units from the -robot.csv Pattern Studio exports, station by station. One GhPython component.

The Brick courses, Pavers and Kinetic units bundles carry <name>-robot.csv, one row per piece in placing order:

    unit,face,station,course,place,length_mm,X_mm,Y_mm,Z_mm,A_deg,B_deg,C_deg,station_X0_mm,kind

(older files start the row with 'brick' and have no kind; both read). For pavers the frame is the bed (X along, Y across, Z up) unless
they are laid on a wall, and B, C carry the tilt; BW and BH then stand for the piece's width and height.

X, Y, Z are the brick's centre in its STATION frame: X along the wall from the station's start (station_X0_mm along the
whole face), Y out of the face from the back plane toward the viewer, Z up; A is the turn about Z in degrees (B, C are 0).
A station is one base frame of the robot: a wall longer than the arm's reach is placed from several, as the robot at
Chi She Gallery moved between segments. -robot.src is the KRL program written from the same rows.

INPUTS
    Csv     [str]   path to the -robot.csv file, OR the file's contents as one string
    BW      [float] brick width (the wall's depth), mm           default 115
    BH      [float] brick height, mm                              default 65
    Plane   [Plane] where the face's bottom-left back corner sits; default world XZ (a wall standing on the ground)
    Station [int]   show one station only (1-based); 0 shows all   default 0
    Go      [bool]

OUTPUTS
    Bricks    one Box per brick (Brep), in placing order
    Order     the placing order number per brick
    Stations  one Plane per station: the base frame the KRL expects ($BASE), on the face at its station_X0
    Reach     a Line per station along its stretch of wall, for reading
    Info      what was read

Never yet run in Rhino (30 Oct 2026); written to the conventions of bricks_from_csv.py.
"""
from __future__ import division
import os
import Rhino.Geometry as rg


def d(v, fallback):
    return fallback if v is None else v


Csv = globals().get('Csv')
BW = float(d(globals().get('BW'), 115.0))
BH = float(d(globals().get('BH'), 65.0))
Plane = globals().get('Plane')
Station = int(d(globals().get('Station'), 0))
Go = bool(d(globals().get('Go'), True))


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
    need = ['station', 'x_mm', 'y_mm', 'z_mm', 'a_deg', 'length_mm', 'station_x0_mm']
    if not all(h in head for h in need):
        return [], ('the header is "%s"; this wants a Pattern Studio robot placement list' % lines[0][:70])
    ix = dict((h, head.index(h)) for h in head)
    rows, bad = [], 0
    for ln in lines[1:]:
        c = ln.split(',')
        if len(c) < len(head):
            bad += 1; continue
        try:
            rows.append({'n': int(float(c[ix['unit']])) if 'unit' in ix else int(float(c[ix['brick']])) if 'brick' in ix else len(rows) + 1,
                         'station': int(float(c[ix['station']])), 'len': float(c[ix['length_mm']]),
                         'x': float(c[ix['x_mm']]), 'y': float(c[ix['y_mm']]), 'z': float(c[ix['z_mm']]),
                         'a': float(c[ix['a_deg']]), 'x0': float(c[ix['station_x0_mm']])})
        except ValueError:
            bad += 1
    note = ('%d rows could not be read and were skipped' % bad) if bad else ''
    return rows, note


Bricks, Order, Stations, Reach = [], [], [], []
Info = ''

if Go:
    rows, note = read_rows(Csv)
    if not rows:
        Info = note or 'no rows'
    else:
        # the face's frame: X along the wall, Y out of the face (toward the viewer), Z up. World XZ has its normal on -Y,
        # so the face looks toward -Y; the station frame sits on the face, offset along X.
        base = Plane if Plane is not None else rg.Plane(rg.Point3d.Origin, rg.Vector3d.XAxis, rg.Vector3d.ZAxis)
        face_x, face_z = base.XAxis, base.YAxis
        face_y = -base.Normal  # out of the face, toward the viewer: world XZ's normal points away (+Y), so its negative
        seen = {}
        for r in rows:
            if r['station'] not in seen:
                seen[r['station']] = r['x0']
        for k in sorted(seen):
            org = base.Origin + face_x * seen[k]
            Stations.append(rg.Plane(org, face_x, face_y))
            xs = [r['x'] for r in rows if r['station'] == k]
            Reach.append(rg.Line(org, org + face_x * (max(xs) + 200.0)))
        for r in rows:
            if Station and r['station'] != Station:
                continue
            org = base.Origin + face_x * (r['x0'] + r['x']) + face_y * r['y'] + face_z * r['z']
            p = rg.Plane(org, face_x, face_y)
            p.Rotate(r['a'] * 3.141592653589793 / 180.0, face_z, org)
            box = rg.Box(p, rg.Interval(-r['len'] / 2.0, r['len'] / 2.0), rg.Interval(-BW / 2.0, BW / 2.0), rg.Interval(-BH / 2.0, BH / 2.0))
            Bricks.append(box.ToBrep())
            Order.append(r['n'])
        Info = '%d bricks in %d stations%s%s' % (len(Bricks), len(Stations), (', station %d shown' % Station) if Station else '', ('; ' + note) if note else '')

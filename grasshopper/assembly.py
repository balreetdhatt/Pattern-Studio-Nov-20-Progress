# -*- coding: utf-8 -*-
"""One definition that chains the generators into a building piece: two brick walls on plan curves, a vault between
their tops, and a skin of optical tiles or kinetic units on the vault (and, if asked, on the walls). One GhPython
component; it runs the other generators from their files, so every rule stays in one place.

    Plan ------> bricks_on_surface (wall A)  --\
    Plan2/Span -> bricks_on_surface (wall B)  --+--> wall tops --> vault_between_walls --> Vault --> tiles_on_surface
                                                                                                  or units_on_surface

INPUTS (set each type hint as given; anything left off takes its default)
    Plan     [Curve]  the first wall's plan curve (its centreline; open or closed, kinks allowed)        (required)
    Plan2    [Curve]  the second wall's plan curve; left off, Plan is offset by Span                      none
    Span     [float]  mm between the two walls when Plan2 is not given                                    6000
    FlipA, FlipB [bool] which side of each curve is the face (bricks_on_surface's Flip)                   False, True
    Rows     [int]    courses                                                                             30
    BL, BW, BH, Joint [float] the brick and the joint, mm                                                 240, 115, 65, 10
    Bond     [str]    running | stack                                                                     running
    Corbel   [float]  mm the top course stands out past the bottom one                                    0
    Field    [Point | Curve | Brep, list] attractors for the bricks' turn and shift                       none
    Reach, Turn, Shift [float] the bricks' field: reach mm, degrees at tone 1, mm at tone 1               1500, 0, 0
    Profile  [str]    arc | catenary | pointed                                                            catenary
    Rise     [float]  mm the vault rises above the wall tops at its crown                                 2400
    Pitch    [float]  mm between ribs along the wall                                                      600
    Depth, T [float]  rib depth and thickness, mm                                                         150, 18
    Skin     [str]    tiles | units | none                                                                units
    Where    [str]    vault | walls | both: what the skin covers                                          vault
    SkinPitch [float] the skin's cell pitch, mm (tiles 31.75 is KPS's; units 300 is Al Bahar's scale)      600
    Dia, Tilt [float] tiles: disc diameter and tilt                                                       25.4, 30
    Sun      [Vector] tiles: the design sun; units with Drive 'sun': the sun shown                        (1, -1, 1)
    Shape    [str]    units: umbrella | iris | louvre                                                     umbrella
    Grid     [str]    units: square | hex                                                                 hex
    Drive    [str]    units: field | sun | walk | pulse                                                   sun
    Mode     [str]    the skin's tone: gradient | radial | noise | attract | image | random               gradient
    Image    [str]    picture path for Mode 'image'                                                       none
    Folder   [str]    the folder holding the generators (bricks_on_surface.py and the rest)               this file's
    Arm      [float]  the robot's reach for the brick stations                                            2000
    Standoff [float]  mm the units' host surface stands off the shell when their parts run into the ribs: the
                      mechanism hangs 120 behind the face, so 125 clears a rib wherever a unit column lands on one  125
    Go       [bool]

OUTPUTS
    BricksA, BricksB  the two walls, one closed solid per brick
    Ribs      the vault's ribs (Brep)
    Vault     the vault surface (Brep)
    SkinG     the skin: tiles (disc, pin, posts) or units (frames and parts), Breps
    CsvA, CsvB  the robot placement lists of the two walls (the -robot.csv shape)
    KrlA, KrlB  the KUKA programs
    VaultCsv  the rib schedule
    SkinCsv   the tile list or the actuator table
    Tops      the two wall-top curves the vault springs from
    Info      what was built, what was held

HOW IT RUNS THE OTHERS
    Each generator is read from Folder and run with its inputs in a fresh namespace (the way the Rhino MCP ran them on
    1 November), so a change to bricks_on_surface.py is a change here. Inside a GhPython component set Folder to the
    grasshopper/ folder of the Pattern Studio repository (or leave it: this file's own folder is tried first).

LIMITS, HONESTLY
    The walls stand vertical and the vault spans straight from A to B at every rib (as vault_between_walls does). The
    wall faces for the skin are the plan curves extruded, offset BW/2 to the face: flat ruled surfaces, not the brick
    texture. The vault carries no bricks (ribs_on_surface along the span is the way to brick rings). Not run in
    Rhino 7. Written for IronPython 2.7 and CPython 3 both.
"""
from __future__ import division
import math, os, sys
import Rhino.Geometry as rg

TOL = 0.01


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
        return list(v)
    try:
        return list(v)
    except Exception:
        return [v]


G = globals()
Plan = geo(G.get('Plan'))
Plan2 = geo(G.get('Plan2'))
Span = float(d(G.get('Span'), 6000.0))
FlipA = bool(d(G.get('FlipA'), False))
FlipB = bool(d(G.get('FlipB'), True))
Rows = int(d(G.get('Rows'), 30))
BL = float(d(G.get('BL'), 240.0))
BW = float(d(G.get('BW'), 115.0))
BH = float(d(G.get('BH'), 65.0))
Joint = float(d(G.get('Joint'), 10.0))
Bond = str(d(G.get('Bond'), 'running'))
Corbel = float(d(G.get('Corbel'), 0.0))
Field = as_list(G.get('Field'))
Reach = float(d(G.get('Reach'), 1500.0))
Turn = float(d(G.get('Turn'), 0.0))
Shift = float(d(G.get('Shift'), 0.0))
Profile = str(d(G.get('Profile'), 'catenary'))
Rise = float(d(G.get('Rise'), 2400.0))
Pitch = float(d(G.get('Pitch'), 600.0))
Depth = float(d(G.get('Depth'), 150.0))
T = float(d(G.get('T'), 18.0))
Skin = str(d(G.get('Skin'), 'units'))
Where = str(d(G.get('Where'), 'vault'))
SkinPitch = float(d(G.get('SkinPitch'), 600.0))
Dia = float(d(G.get('Dia'), 25.4))
Tilt = float(d(G.get('Tilt'), 30.0))
Sun = G.get('Sun')
Shape = str(d(G.get('Shape'), 'umbrella'))
Grid = str(d(G.get('Grid'), 'hex'))
Drive = str(d(G.get('Drive'), 'sun'))
Mode = str(d(G.get('Mode'), 'gradient'))
Image = G.get('Image')
Folder = G.get('Folder')
Arm = float(d(G.get('Arm'), 2000.0))
Standoff = float(d(G.get('Standoff'), 125.0))
Go = bool(d(G.get('Go'), True))


def find_folder():
    cands = []
    if Folder:
        cands.append(str(Folder))
    try:
        cands.append(os.path.dirname(os.path.abspath(__file__)))
    except Exception:
        pass
    cands.append(os.getcwd())
    for c in cands:
        if c and os.path.exists(os.path.join(c, 'bricks_on_surface.py')):
            return c
    return None


def run_generator(folder, name, inputs):
    """exec a generator with its inputs as globals; returns its namespace (the outputs are read from it)"""
    path = os.path.join(folder, name)
    with open(path, 'r') as f:
        src = f.read()
    ns = {'__name__': '__pattern_studio_' + name.replace('.py', ''), '__file__': path}
    ns.update(inputs)
    code = compile(src, path, 'exec')
    exec(code, ns)
    return ns


def wall_height():
    return Rows * (BH + Joint) - Joint


def lifted(crv, h):
    c = crv.DuplicateCurve()
    c.Translate(rg.Vector3d(0, 0, h))
    return c


def outer_edge(crv, other):
    """the plan curve offset BW/2 away from the other wall: the outer face's line"""
    m = crv.PointAtNormalizedLength(0.5)
    ok, t = other.ClosestPoint(m)
    away = m - other.PointAt(t)
    away.Z = 0
    if away.Length < 1e-6:
        return crv.DuplicateCurve()
    for sgn in (1.0, -1.0):
        try:
            res = crv.Offset(rg.Plane.WorldXY, sgn * BW / 2.0, TOL, rg.CurveOffsetCornerStyle.Sharp)
        except Exception:
            res = None
        if res and len(res):
            c = res[0] if len(res) == 1 else rg.Curve.JoinCurves(list(res), TOL)[0]
            if (c.PointAtNormalizedLength(0.5) - m) * away > 0:
                return c
    return crv.DuplicateCurve()


def face_surface(crv, flip, h):
    """the wall's outer face as a surface: the plan curve offset BW/2 to the face side, extruded to the wall's height"""
    pl = rg.Plane.WorldXY
    side = -1.0 if flip else 1.0
    off = None
    try:
        res = crv.Offset(pl, side * BW / 2.0, TOL, rg.CurveOffsetCornerStyle.Sharp)
        if res and len(res):
            off = res[0] if len(res) == 1 else rg.Curve.JoinCurves(list(res), TOL)[0]
    except Exception:
        off = None
    if off is None:
        off = crv.DuplicateCurve()
    ext = rg.Extrusion.Create(off, h, False)
    return ext.ToBrep() if ext is not None else None


def foot_width(ribs, h, tops):
    """the widest foot: for each rib and each of its two ends, how far its springing vertices (z at the wall top) spread
    from that end's top line, measured square to the line"""
    w = 0.0
    for r in ribs:
        pts = [v.Location for v in r.Vertices if v.Location.Z < h + 0.05]
        for top in tops:
            ds = []
            for p in pts:
                ok, t = top.ClosestPoint(p)
                q = top.PointAt(t)
                if p.DistanceTo(q) < 1000.0:  # this end, not the other wall
                    ds.append(p.DistanceTo(q))
            if ds:
                w = max(w, max(ds))
    return w


def stood_off(brep, dist):
    """the vault surface moved dist along its normal, as a Brep (the skin's frames stand off the shell, clear of the ribs)"""
    try:
        srf = brep.Faces[0].ToNurbsSurface().Offset(dist, TOL)
        if srf is not None:
            return srf.ToBrep()
    except Exception:
        pass
    return brep


def ribs_hit(parts):
    """how many vertices of the parts lie inside a rib (bounding boxes first, then the point test)"""
    boxes = [r.GetBoundingBox(True) for r in Ribs]
    n = 0
    for g in parts:
        gb = g.GetBoundingBox(True)
        cand = [k for k, b in enumerate(boxes) if not (gb.Min.X > b.Max.X or b.Min.X > gb.Max.X or gb.Min.Y > b.Max.Y or b.Min.Y > gb.Max.Y or gb.Min.Z > b.Max.Z or b.Min.Z > gb.Max.Z)]
        if not cand:
            continue
        for v in g.Vertices:
            p = v.Location
            for k in cand:
                if Ribs[k].IsPointInside(p, 0.1, True):
                    n += 1
                    break
    return n


BricksA, BricksB, Ribs, SkinG, Tops = [], [], [], [], []
Vault = None
CsvA, CsvB, KrlA, KrlB, VaultCsv, SkinCsv, Info = '', '', '', '', '', '', ''

if Go:
    folder = find_folder()
    if not isinstance(Plan, rg.Curve):
        Info = 'wire the first wall\'s plan curve to Plan'
    elif folder is None:
        Info = 'set Folder to the grasshopper/ folder that holds bricks_on_surface.py and the others'
    else:
        notes = []
        A = Plan
        B = Plan2 if isinstance(Plan2, rg.Curve) else None
        if B is None:
            res = None
            try:
                res = A.Offset(rg.Plane.WorldXY, Span, TOL, rg.CurveOffsetCornerStyle.Sharp)
            except Exception:
                res = None
            if res and len(res):
                B = res[0] if len(res) == 1 else rg.Curve.JoinCurves(list(res), TOL)[0]
                notes.append('the second wall is the first offset %.0f mm' % Span)
            else:
                B = A.DuplicateCurve()
                B.Translate(rg.Vector3d(0, Span, 0))
                notes.append('the first wall could not be offset; the second is a copy moved %.0f mm' % Span)
        H = wall_height()
        # 1. the two walls
        common = {'Rows': Rows, 'BL': BL, 'BW': BW, 'BH': BH, 'Joint': Joint, 'Bond': Bond, 'Lay': 'flush', 'Corbel': Corbel,
                  'Field': Field, 'Reach': Reach, 'Turn': Turn, 'Shift': Shift, 'Arm': Arm, 'Go': True}
        wa = dict(common);
        wa.update({'Geo': A, 'Flip': FlipA, 'Name': 'wall_a'})
        wb = dict(common);
        wb.update({'Geo': B, 'Flip': FlipB, 'Name': 'wall_b'})
        na = run_generator(folder, 'bricks_on_surface.py', wa)
        nb = run_generator(folder, 'bricks_on_surface.py', wb)
        BricksA, CsvA, KrlA = list(na.get('Bricks') or []), na.get('Csv') or '', na.get('Krl') or ''
        BricksB, CsvB, KrlB = list(nb.get('Bricks') or []), nb.get('Csv') or '', nb.get('Krl') or ''
        notes.append('wall A: %s' % (na.get('Info') or '').split('\n')[0])
        notes.append('wall B: %s' % (nb.get('Info') or '').split('\n')[0])
        # 2. the vault between the wall tops. The arch line sits on the OUTER face of each wall (the plan curve offset BW/2 away
        #    from the other wall), so the rib's foot, Depth wide at the springing, runs inward over the wall; Depth is held to BW so
        #    the whole foot bears on the wall top and nothing hangs past the inner face (a 115 wall carries a 115 foot)
        depth = Depth
        if depth > BW:
            notes.append('rib depth held from %.0f to %.0f mm, the width of the wall, so the springing sits on the wall' % (Depth, BW))
            depth = BW
        topA, topB = lifted(outer_edge(A, B), H), lifted(outer_edge(B, A), H)
        Tops = [topA, topB]
        vin = {'A': topA, 'B': topB, 'Rise': Rise, 'Profile': Profile, 'Pitch': Pitch, 'T': T, 'Depth': depth, 'Go': True}
        nv = run_generator(folder, 'vault_between_walls.py', vin)
        Ribs = list(nv.get('Ribs') or [])
        # the foot of a rib cut flat at the springing is wider than its depth where the arch leans (depth / sin of the arch's
        # angle there): measure the widest foot and, if it runs past the inner face, build again with the depth scaled down
        w = foot_width(Ribs, H, [topA, topB])
        if w > BW + 0.5 and depth > 1:
            depth2 = max(10.0, depth * BW / w)
            vin['Depth'] = depth2
            nv = run_generator(folder, 'vault_between_walls.py', vin)
            Ribs = list(nv.get('Ribs') or [])
            notes.append('rib depth held to %.0f mm: at the springing the arch leans, so a %.0f deep rib has a %.0f mm foot and the wall is %.0f' % (depth2, depth, w, BW))
        Vault, VaultCsv = nv.get('Vault'), nv.get('Csv') or ''
        notes.append('vault: %s' % (nv.get('Info') or '').split('\n')[0])
        # 3. the skin
        if Skin in ('tiles', 'units'):
            hosts = []
            if Where in ('vault', 'both') and Vault is not None:
                hosts.append(('vault', Vault))
            if Where in ('walls', 'both'):
                fa, fb = face_surface(A, FlipA, H), face_surface(B, FlipB, H)
                if fa is not None:
                    hosts.append(('wall A', fa))
                if fb is not None:
                    hosts.append(('wall B', fb))
            csvs = []
            for label, host in hosts:
                if Skin == 'tiles':
                    inp = {'Geo': host, 'Kind': 'tiles', 'Pitch': SkinPitch, 'Dia': Dia, 'Tilt': Tilt, 'Mode': Mode, 'Image': Image, 'Go': True}
                    if Sun is not None:
                        inp['Sun'] = Sun
                    ns = run_generator(folder, 'tiles_on_surface.py', inp)
                    SkinG.extend(list(ns.get('Tiles') or []))
                else:
                    inp = {'Geo': host, 'Pitch': SkinPitch, 'Grid': Grid, 'Shape': Shape, 'Drive': Drive, 'Mode': Mode, 'Image': Image, 'Go': True}
                    if Sun is not None:
                        inp['Sun'] = [Sun]
                    ns = run_generator(folder, 'units_on_surface.py', inp)
                    parts = list(ns.get('Frames') or []) + list(ns.get('Parts') or [])
                    if label == 'vault' and Ribs:
                        # the frames sit on the surface with their bars half in it, and the mechanisms hang behind the face: on the
                        # vault either can run into the ribs. Try the units on the shell stood off by Standoff on each side and
                        # facing each way, and keep the first that clears the ribs (the standoff is the frame's own bar)
                        hit = ribs_hit(parts)
                        if hit:
                            best = (hit, ns, parts, '')
                            for so in (Standoff, 2 * Standoff):
                                for sgn in (1.0, -1.0):
                                    for flip in (False, True):
                                        inp2 = dict(inp)
                                        inp2['Geo'] = stood_off(host, sgn * so)
                                        inp2['FlipN'] = flip
                                        ns2 = run_generator(folder, 'units_on_surface.py', inp2)
                                        parts2 = list(ns2.get('Frames') or []) + list(ns2.get('Parts') or [])
                                        hit2 = ribs_hit(parts2)
                                        if hit2 < best[0]:
                                            best = (hit2, ns2, parts2, 'units stood off the shell %.0f mm%s so they clear the ribs' % (sgn * so, ' and faced the other way' if flip else ''))
                                        if hit2 == 0:
                                            break
                                    if best[0] == 0:
                                        break
                                if best[0] == 0:
                                    break
                            hit, ns, parts, why = best
                            if why:
                                notes.append(why)
                        if hit:
                            notes.append('%d skin vertices still inside a rib: thin the ribs or raise Standoff' % hit)
                    SkinG.extend(parts)
                csvs.append('# ' + label + '\n' + (ns.get('Csv') or ''))
                notes.append('%s on the %s: %s' % (Skin, label, (ns.get('Info') or '').split('\n')[0]))
            SkinCsv = '\n'.join(csvs)
        Info = ('%d + %d bricks, %d ribs, %d skin parts, walls %.0f mm high; ' % (len(BricksA), len(BricksB), len(Ribs), len(SkinG), H)) + '; '.join(notes)

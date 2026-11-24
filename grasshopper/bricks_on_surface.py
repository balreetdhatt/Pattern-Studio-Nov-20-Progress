# -*- coding: utf-8 -*-
"""Lay brick courses on your own Rhino curve or surface, and write the robot targets. One GhPython component.

This is the first of the components that place Pattern Studio's modules on geometry you drew yourself, instead
of rebuilding a panel the browser solved. Give it a PLAN CURVE and it stands a wall on it: every course is the
curve offset by that course's corbel and lifted to its height, the bricks laid along it by arc length with the
joint widened on the outside of a bend so the inside joint never closes. Give it a SURFACE (or a Brep) and it
cuts a horizontal section through it per course and lays the bricks along each section, so a leaning, bulging
or corbelled surface becomes courses that step out and in as the surface does. The bricks stay level in both
cases (a corbel is a stepped wall, not a leaning one). A TOWER is a closed plan curve: the face is its outside,
a corbel steps out or in by course (Shape 'wave' for a bulging shaft), and Twist turns each course a little
about the centre so the bond spirals.

What the browser's Brick courses mode does, this does on your geometry:

  - running or stack bond; odd courses of a running bond start with a half brick;
  - every run is laid from joint to joint and closed with a closer cut to length; a sliver under 20 mm turns
    the last full brick into two bats that share it; at a mitred end the closer is held to the cut plus 20 mm
    (the pass 24 rule);
  - a kink in the plan curve (a polyline corner) is a mitred joint: the runs either side end on the corner and
    the end bricks are cut to the mitre, a squint. A square corner is mitred too; the quoin the browser lays is
    not laid here (say so if it matters);
  - a field turns or slides each brick: tone 1 at the attractor points or curves you wire in, falling to 0 at
    Reach; with no field the tone is a gradient up the wall;
  - the bearing rule: no brick stands out past the course below by more than MaxOver x BW, counting its corbel
    step, its offset and the corner a turned brick swings out; what would is clamped and counted;
  - the robot list: every brick as a KUKA target (X, Y, Z, A, B, C) in the frame of its station, stations by
    arm reach along the base course, plus the KRL program in the shape -robot.src takes.

INPUTS (set each type hint as given; anything left off takes its default)
    Geo      [Curve | Surface | Brep]  the plan curve the wall stands on (open or closed, kinks allowed), or the
                                       surface to lay on. A curve is the WALL'S CENTRELINE; a surface is the face
                                       the bricks' centres sit on (so BW/2 stands out either side of it)
    Rows     [int]    courses, for a plan curve (a surface sets its own from its height)     default 12
    BL, BW, BH [float] brick length, width (the wall's depth) and height, mm              240, 115, 65
    Joint    [float]  the joint, mm                                                        10
    Bond     [str]    'running' or 'stack'                                                 running
    Lay      [str]    'flush': every run laid joint to joint and closed with closers, as a wall under a plan;
                      'centred': whole bricks centred in the run with no closers, as the browser lays a
                      freestanding panel (odd courses a half brick at each end)                flush
    Corbel   [float]  how far the top course stands out past the bottom one, mm (plan curve only; a surface
                      corbels itself). Negative corbels inward                             0
    Shape    [str]    how the corbel grows up the wall: 'linear' (0 at the base to Corbel at the top),
                      'bulge' (0 at base and top, Corbel in the middle), 'top' (the last third only),
                      'wave' (Waves sine waves up the wall, +/- Corbel)                     linear
    Waves    [float]  for Shape 'wave'                                                     1
    Twist    [float]  degrees the top course is turned past the bottom one about the plan's centre (a tower on a
                      closed curve; an open curve turns about its middle). Each course turns its share, so the
                      bond spirals and every course steps sideways on the one below                        0
    Field    [Point | Curve | Brep, list] attractors: tone 1 on them, 0 at Reach           none
    Reach    [float]  mm, the field's reach from each attractor                            1500
    Turn     [float]  degrees a brick turns at tone 1 (about its vertical axis)            0
    Shift    [float]  mm a brick slides out of the face at tone 1                          0
    MaxOver  [float]  the bearing rule, as a fraction of BW                                0.4
    Flip     [bool]   which side of the curve is the face. On a closed curve the face is OUTSIDE whichever way the
                      curve was drawn, and a positive corbel steps outward; Flip turns it inside out. On an open
                      curve the face is to the left of the direction it was drawn                           False
    Arm      [float]  the robot's reach, mm; a station covers 1.4 x Arm along the wall     2000
    Pick     [str]    the pallet in the robot's own frame, 'x,y,z' mm                      '0,-1500,400'
    Name     [str]    the KRL program's name                                               'wall'
    Go       [bool]

OUTPUTS
    Bricks    one closed solid per brick (Brep), squints as mitred prisms
    Planes    the placement plane of each brick: origin at its centre, x along, y up, z out of the face
    Courses   the course curves, one per course and run (what the bricks were laid along)
    Stations  one Plane per robot station: X along the wall, Y out of the face, Z up; the $BASE the KRL expects
    Csv       the robot placement list, the columns -robot.csv has:
              unit,face,station,course,place,length_mm,X_mm,Y_mm,Z_mm,A_deg,B_deg,C_deg,station_X0_mm,kind
              X, Y, Z, A, B, C are the brick's gripper frame in ITS STATION'S frame (A about Z, B about Y, C about X,
              the KUKA order). Wire to Write File as <name>-robot.csv
    Krl       the KUKA program, the shape -robot.src takes (INI fold, pallet in $NULLFRAME, a base per station)
    Count     bricks laid
    Info      what was laid, what was held, and anything to look at

Units are taken as millimetres: a model in metres lays 240 m bricks. The file writes nothing to disk.
Written 1 November 2026 to the conventions of bricks_from_csv.py and robot_from_csv.py (IronPython 2.7 and
CPython 3 both: no f-strings). Run in Rhino 8 on 1 November 2026 through the Rhino MCP; grasshopper/README.md says what was tested.
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


Geo = geo(globals().get('Geo'))
Rows = int(d(globals().get('Rows'), 12))
BL = float(d(globals().get('BL'), 240.0))
BW = float(d(globals().get('BW'), 115.0))
BH = float(d(globals().get('BH'), 65.0))
Joint = float(d(globals().get('Joint'), 10.0))
Bond = str(d(globals().get('Bond'), 'running')).strip().lower()
Lay = str(d(globals().get('Lay'), 'flush')).strip().lower()
Corbel = float(d(globals().get('Corbel'), 0.0))
Shape = str(d(globals().get('Shape'), 'linear')).strip().lower()
Waves = float(d(globals().get('Waves'), 1.0))
Twist = float(d(globals().get('Twist'), 0.0))
Field = globals().get('Field')
Reach = float(d(globals().get('Reach'), 1500.0))
Turn = float(d(globals().get('Turn'), 0.0))
Shift = float(d(globals().get('Shift'), 0.0))
MaxOver = float(d(globals().get('MaxOver'), 0.4))
Flip = bool(d(globals().get('Flip'), False))
Arm = float(d(globals().get('Arm'), 2000.0))
Pick = str(d(globals().get('Pick'), '0,-1500,400'))
Name = str(d(globals().get('Name'), 'wall'))
Go = bool(d(globals().get('Go'), True))

TOL = 0.01
UP = rg.Vector3d.ZAxis
D = math.pi / 180.0


# ---------------------------------------------------------------- the geometry you wired in
def as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [x for x in v if x is not None]
    try:
        return [x for x in list(v) if x is not None]
    except TypeError:
        return [v]


def as_brep(g):
    if isinstance(g, rg.Brep):
        return g
    if isinstance(g, rg.Surface):
        return g.ToBrep()
    if isinstance(g, rg.Extrusion):
        return g.ToBrep()
    return None


def as_curve(g):
    if isinstance(g, rg.Curve):
        return g
    if isinstance(g, rg.Polyline):
        return g.ToNurbsCurve()
    return None


def horizontal(v):
    """the vector with its vertical part taken out, unit length; None if it was vertical"""
    h = rg.Vector3d(v.X, v.Y, 0.0)
    if h.Length < 1e-9:
        return None
    h.Unitize()
    return h


def dist_to(g, p):
    """distance from a point to a point, curve or brep, for the field"""
    if isinstance(g, rg.Point3d):
        return p.DistanceTo(g)
    if isinstance(g, rg.Point):
        return p.DistanceTo(g.Location)
    c = as_curve(g)
    if c is not None:
        ok, t = c.ClosestPoint(p)
        return p.DistanceTo(c.PointAt(t)) if ok else 1e12
    b = as_brep(g)
    if b is not None:
        q = b.ClosestPoint(p)
        return p.DistanceTo(q) if q is not None else 1e12
    return 1e12


# ---------------------------------------------------------------- courses
def corbel_at(r, rows):
    """how far course r stands out past the base course"""
    if rows < 2 or abs(Corbel) < 1e-9:
        return 0.0
    u = r / (rows - 1.0)
    if Shape == 'bulge':
        return Corbel * math.sin(math.pi * u)
    if Shape == 'top':
        return Corbel * max(0.0, (u - 2.0 / 3.0) * 3.0)
    if Shape == 'wave':
        return Corbel * math.sin(2.0 * math.pi * max(0.1, Waves) * u)
    return Corbel * u


def offset_in_plane(crv, plane, dist):
    """the curve offset by dist along its left normal (Flip reads the other way); a copy moved sideways if the offset fails"""
    if abs(dist) < 1e-9:
        return crv.DuplicateCurve()
    res = crv.Offset(plane, dist, TOL, rg.CurveOffsetCornerStyle.Sharp)
    if res and len(res) > 0:
        best = res[0]
        for c in res:
            if c.GetLength() > best.GetLength():
                best = c
        return best
    c = crv.DuplicateCurve()
    t = crv.TangentAt(crv.Domain.Mid)
    n = rg.Vector3d.CrossProduct(plane.ZAxis, t)
    n.Unitize()
    c.Translate(n * dist)
    return c


def runs_of(crv):
    """split a curve at its kinks: a list of (curve, turn_in, turn_out) with the signed turn (about UP, radians) at each end
    where it meets another run, 0 at a free end. A closed curve with no kinks is one closed run."""
    segs = None
    if crv.IsPolyline() or isinstance(crv, rg.PolyCurve) or isinstance(crv, rg.PolylineCurve):
        parts = crv.DuplicateSegments()
        if parts and len(parts) > 1:
            segs = list(parts)
    if segs is None:
        return [(crv, 0.0, 0.0, crv.IsClosed)]
    out = []
    n = len(segs)
    closed = crv.IsClosed
    for i in range(n):
        s = segs[i]
        t_in = 0.0
        t_out = 0.0
        if i > 0 or closed:
            prev = segs[(i - 1) % n]
            t_in = signed_turn(prev.TangentAt(prev.Domain.Max), s.TangentAt(s.Domain.Min))
        if i < n - 1 or closed:
            nxt = segs[(i + 1) % n]
            t_out = signed_turn(s.TangentAt(s.Domain.Max), nxt.TangentAt(nxt.Domain.Min))
        out.append((s, t_in, t_out, False))
    # a kink so slight it is not a corner: join the turn into the chord instead
    return [(s, (0.0 if abs(a) < 0.5 * D else a), (0.0 if abs(b) < 0.5 * D else b), c) for (s, a, b, c) in out]


def signed_turn(a, b):
    ha, hb = horizontal(a), horizontal(b)
    if ha is None or hb is None:
        return 0.0
    return math.atan2(rg.Vector3d.CrossProduct(ha, hb).Z, ha * hb)


def face_sign(crv):
    """+1 when the face (and a positive corbel) is to the LEFT of the curve's direction, -1 to the right. A closed curve's
    face is its outside whichever way it was drawn: the left of a clockwise loop, the right of a counter-clockwise one."""
    sg = -1.0 if Flip else 1.0
    if crv.IsClosed:
        o = crv.ClosedCurveOrientation(rg.Plane.WorldXY)
        if o == rg.CurveOrientation.CounterClockwise:
            sg = -sg
    return sg


def plan_centre(crv):
    """the point a twist turns about: the area centroid of a closed plan, the middle of an open one"""
    if crv.IsClosed:
        amp = rg.AreaMassProperties.Compute(crv)
        if amp is not None:
            return rg.Point3d(amp.Centroid.X, amp.Centroid.Y, crv.PointAtStart.Z)
    bb = crv.GetBoundingBox(True)
    return rg.Point3d((bb.Min.X + bb.Max.X) / 2.0, (bb.Min.Y + bb.Max.Y) / 2.0, crv.PointAtStart.Z)


def course_curves():
    """-> (list of courses, kind, rows, face sign). A course is a list of runs (curve, turn_in, turn_out, closed) at one height."""
    crv = as_curve(Geo)
    if crv is not None:
        # courses are level: the plan curve is read in the horizontal plane through its start, whatever plane it was drawn in
        plane = rg.Plane(crv.PointAtStart, UP)
        rows = max(1, Rows)
        sg = face_sign(crv)
        ctr = plan_centre(crv)
        courses = []
        for r in range(rows):
            c = offset_in_plane(crv, plane, sg * corbel_at(r, rows))
            if abs(Twist) > 1e-9 and rows > 1:
                c.Rotate(Twist * D * r / (rows - 1.0), UP, ctr)
            c.Translate(UP * (BH / 2.0 + r * (BH + Joint)))
            courses.append(runs_of(c))
        return courses, 'curve', rows, sg
    brep = as_brep(Geo)
    if brep is None:
        return [], 'none', 0, 1.0
    bb = brep.GetBoundingBox(True)
    z0, z1 = bb.Min.Z, bb.Max.Z
    rows = int(math.floor((z1 - z0 + Joint) / (BH + Joint)))
    if rows < 1:
        return [], 'surface', 0, 1.0
    span = rows * (BH + Joint) - Joint
    base = z0 + (z1 - z0 - span) / 2.0 + BH / 2.0
    courses = []
    for r in range(rows):
        z = base + r * (BH + Joint)
        cut = rg.Brep.CreateContourCurves(brep, rg.Plane(rg.Point3d(bb.Min.X, bb.Min.Y, z), UP))
        runs = []
        for c in (cut or []):
            if c.GetLength() >= 20.0:
                runs.extend(runs_of(c))
        courses.append(runs)
    # on a surface the face is the outside of the sections when they close, else the left of the section's direction
    sg = -1.0 if Flip else 1.0
    if courses and courses[0]:
        sg = face_sign(courses[0][0][0]) if courses[0][0][0].IsClosed else sg
    return courses, 'surface', rows, sg


# ---------------------------------------------------------------- laying one run
def curvature_at(crv, t):
    k = crv.CurvatureAt(t)
    return k.Length if k is not None and k.IsValid else 0.0


def lay_run(crv, odd, closed, cut_in, cut_out):
    """-> list of (s_centre, length) along the run by arc length. The joint is measured at the INSIDE face of a bend:
    on a bend of curvature k the inside face of a brick BL long is BL*BW*k/2 closer to its neighbour than the centreline,
    so the centreline joint grows by that much."""
    L = crv.GetLength()
    hL = (BL - Joint) / 2.0
    cells = []
    if L < 20.0:
        return cells

    def jc_at(s):
        ok, t = crv.NormalizedLengthParameter(min(1.0, max(0.0, s / L)))
        k = curvature_at(crv, t) if ok else 0.0
        return Joint + BL * BW * k / 2.0

    if closed:
        # whole bricks round the loop, the joint taking up the rest, held to the worst bend
        kmax = 0.0
        for i in range(24):
            ok, t = crv.NormalizedLengthParameter(i / 24.0)
            if ok:
                kmax = max(kmax, curvature_at(crv, t))
        pitch0 = BL + Joint + BL * BW * kmax / 2.0
        n = int(math.floor(L / pitch0))
        if n < 1:
            return cells
        pitch = L / n
        s0 = pitch / 2.0 if odd else 0.0
        for i in range(n):
            cells.append(((s0 + i * pitch + BL / 2.0) % L, BL))
        return cells

    if Lay == 'centred':
        # the browser's freestanding panel: whole bricks centred in the run, no closers, the odd courses of a running
        # bond a half brick at each end (the same span); the joint is read on the centreline here
        per = int(math.floor((L + Joint) / (BL + Joint)))
        if per < 1:
            return cells
        span = per * (BL + Joint) - Joint
        lead = (L - span) / 2.0
        if odd:
            p = lead
            cells.append((p + hL / 2.0, hL))
            p += hL + Joint
            for i in range(per - 1):
                cells.append((p + BL / 2.0, BL))
                p += BL + Joint
            cells.append((p + hL / 2.0, hL))
        else:
            for i in range(per):
                cells.append((lead + i * (BL + Joint) + BL / 2.0, BL))
        return cells
    min_end = 20.0 + max(abs(cut_in), abs(cut_out))
    pos = [0.0]
    rem = [L]

    def put(ln):
        c = pos[0] + ln / 2.0
        cells.append((c, ln))
        j = jc_at(c + ln / 2.0)
        pos[0] += ln + j
        rem[0] -= ln + j

    if odd and rem[0] >= hL:
        put(hL)
    while rem[0] >= BL:
        put(BL)
    if rem[0] >= min_end:
        put(rem[0])
    if not cells:
        return cells
    # a sliver left at the end: the last full brick and the sliver become two bats
    if 0 < rem[0] < min_end and abs(cells[-1][1] - BL) < 1e-6:
        c, ln = cells.pop()
        j = jc_at(c + ln / 2.0)
        pos[0] -= ln + j
        rem[0] += ln + j
        a = (rem[0] - Joint) / 2.0
        if a >= 20.0:
            put(a)
            put(a)
        else:
            put(rem[0])
    return cells


def brick_solid(plane, ln, cut_l, cut_r):
    """a box, or with a mitred end a prism: cut_l / cut_r are the extra length of the face at +BW/2 (the face side) at
    each end, the other face taking the opposite; a plane mitre on the centreline"""
    if abs(cut_l) < 1e-6 and abs(cut_r) < 1e-6:
        box = rg.Box(plane, rg.Interval(-ln / 2.0, ln / 2.0), rg.Interval(-BH / 2.0, BH / 2.0), rg.Interval(-BW / 2.0, BW / 2.0))
        return box.ToBrep()
    m = rg.Mesh()
    pts = []
    for z in (-BW / 2.0, BW / 2.0):
        f = z / (BW / 2.0)  # -1 on the back face, +1 on the face side
        x0 = -ln / 2.0 - cut_l * f
        x1 = ln / 2.0 + cut_r * f
        for y in (-BH / 2.0, BH / 2.0):
            for x in (x0, x1):
                pts.append(plane.PointAt(x, y, z))
    for p in pts:
        m.Vertices.Add(p.X, p.Y, p.Z)
    # vertex k = (z, y, x) bits: x is bit 0, y bit 1, z bit 2
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for q in quads:
        m.Faces.AddFace(q[0], q[1], q[2], q[3])
    m.Normals.ComputeNormals()
    m.UnifyNormals()
    m.Compact()
    b = rg.Brep.CreateFromMesh(m, True)
    if b is None:
        box = rg.Box(plane, rg.Interval(-ln / 2.0, ln / 2.0), rg.Interval(-BH / 2.0, BH / 2.0), rg.Interval(-BW / 2.0, BW / 2.0))
        return box.ToBrep()
    return b


def kuka_abc(pl):
    """A, B, C (degrees) of a plane's rotation in the KUKA order: A about Z, then B about Y, then C about X"""
    x, y, z = pl.XAxis, pl.YAxis, pl.ZAxis
    r11, r21, r31 = x.X, x.Y, x.Z
    r32, r33 = y.Z, z.Z
    A = math.atan2(r21, r11)
    B = math.atan2(-r31, math.sqrt(r32 * r32 + r33 * r33))
    C = math.atan2(r32, r33)
    return A / D, B / D, C / D


# ---------------------------------------------------------------- the component
Bricks, Planes, Courses, Stations = [], [], [], []
Csv, Krl, Count, Info = '', '', 0, ''

if Go:
    courses, kind, rows, sg = course_curves()
    if not courses:
        Info = ('wire a plan curve or a surface to Geo' if kind == 'none' else 'the surface is lower than one course' if kind == 'surface'
                else 'nothing to lay')
    else:
        field = [geo(x) for x in as_list(Field)]
        pmax = max(0.0, MaxOver) * BW
        laid = []  # dicts, one per brick
        clamped, squints, closers, bats, bends_tight, kinks = 0, 0, 0, 0, 0, 0
        max_jc = Joint
        prev_runs = None
        for r in range(rows):
            runs = courses[r]
            odd = Bond == 'running' and (r % 2 == 1)
            for (crv, t_in, t_out, closed) in runs:
                Courses.append(crv)
                L = crv.GetLength()
                # the mitre at each end: the face side's extra length is -(BW/2) tan(turn/2) for a turn toward the face side
                cut_in = -sg * (BW / 2.0) * math.tan(t_in / 2.0) if t_in else 0.0
                cut_out = -sg * (BW / 2.0) * math.tan(t_out / 2.0) if t_out else 0.0
                if t_in:
                    kinks += 1
                cells = lay_run(crv, odd, closed, cut_in, cut_out)
                for i, (s, ln) in enumerate(cells):
                    ok, t = crv.NormalizedLengthParameter(min(1.0, max(0.0, s / L)))
                    if not ok:
                        continue
                    P = crv.PointAt(t)
                    tx = horizontal(crv.TangentAt(t))
                    if tx is None:
                        continue
                    nrm = rg.Vector3d.CrossProduct(UP, tx)
                    nrm.Unitize()
                    nrm = nrm * sg
                    k = curvature_at(crv, t)
                    # a brick is a chord: on a bend of radius R its middle stands BL^2 / (8R) off the curve. Past a quarter of
                    # the brick's width the wall's face no longer reads as the curve, so say so
                    if k > 1e-12 and BL * BL * k / 8.0 > BW / 4.0:
                        bends_tight += 1
                    max_jc = max(max_jc, Joint + BL * BW * k)  # the joint on the outside face of a bend
                    # the tone: the field, or a gradient up the wall
                    if field:
                        dist = min(dist_to(g, P) for g in field)
                        tone = max(0.0, 1.0 - dist / max(1.0, Reach))
                    else:
                        tone = r / max(1.0, rows - 1.0) if rows > 1 else 0.0
                    th = tone * Turn
                    sh = tone * Shift
                    # the end bricks at a kink stay flat so the mitre closes
                    cl = cut_in if (i == 0 and t_in and not closed) else 0.0
                    cr = cut_out if (i == len(cells) - 1 and t_out and not closed) else 0.0
                    held = bool(cl or cr)
                    if held:
                        th, sh = 0.0, 0.0
                        squints += 1
                    # the bearing rule, counting how far this course's line stands out past the course below, in plan: the
                    # corbel step, and on a twisted or sectioned course whatever the turn or the surface adds. Only the part
                    # out of the face counts; a step along the face is bond, not overhang
                    step = 0.0
                    if r > 0 and prev_runs:
                        best = None
                        for (pc, a0, a1, c0) in prev_runs:
                            ok2, t2 = pc.ClosestPoint(P)
                            if ok2:
                                q = pc.PointAt(t2)
                                dd = (P.X - q.X) * nrm.X + (P.Y - q.Y) * nrm.Y
                                if best is None or abs(dd) < abs(best):
                                    best = dd
                        step = max(0.0, best) if best is not None else 0.0
                    out = abs(ln / 2.0 * math.sin(th * D)) + abs(sh) + step
                    if out > pmax + 1e-6:
                        clamped += 1
                        room = max(0.0, pmax - step)
                        if abs(sh) > room:
                            sh = math.copysign(room, sh) if sh else 0.0
                        room2 = max(0.0, room - abs(sh))
                        if abs(th) > 1e-9:
                            th = math.copysign(math.asin(min(1.0, room2 / (ln / 2.0))) / D, th)
                    if ln < BL - 0.5 and abs(ln - (BL - Joint) / 2.0) > 0.5:
                        closers += 1
                    o = P + nrm * sh
                    # the laying frame keeps x along the run (so the start cut is at x0 and the end cut at x1) with z to the
                    # right; fs says which side of it the face is on, and signs the cuts. The placement plane the outputs
                    # carry has y up and z out of the face, so on a left-facing wall its x runs against the curve
                    pg = rg.Plane(o, tx, UP)
                    pg.Rotate(th * D, UP, o)
                    fs = 1.0 if pg.ZAxis * nrm > 0 else -1.0
                    po = rg.Plane(o, rg.Vector3d.CrossProduct(UP, nrm), UP)
                    po.Rotate(th * D, UP, o)
                    laid.append({'r': r, 'i': i, 'len': ln, 'pl': po, 'pg': pg, 'fs': fs, 'th': th, 'sh': sh, 'tone': tone,
                                 'cl': cl, 'cr': cr, 's': s, 'closer': ln < BL - 0.5 and abs(ln - (BL - Joint) / 2.0) > 0.5, 'P': P})
            prev_runs = runs
        for b in laid:
            Bricks.append(brick_solid(b['pg'], b['len'], b['cl'] * b['fs'], b['cr'] * b['fs']))
            Planes.append(b['pl'])
        Count = len(Bricks)

        # ---- the robot: stations along the base course by arm reach, every brick a target in its station's frame
        base_runs = courses[0]
        base_len = sum(c.GetLength() for (c, a, bb, cc) in base_runs)
        span = max(100.0, 1.4 * Arm)
        n_st = max(1, int(math.ceil(base_len / span)))
        st_x0 = []
        acc = 0.0
        for k in range(n_st):
            s_k = k * span
            # the point s_k along the base course, across its runs
            left = s_k
            P_k, tx_k = None, None
            for (c, a, bb, cc) in base_runs:
                Lc = c.GetLength()
                if left <= Lc or c is base_runs[-1][0]:
                    ok, t = c.NormalizedLengthParameter(min(1.0, max(0.0, left / max(1e-9, Lc))))
                    P_k = c.PointAt(t)
                    tx_k = horizontal(c.TangentAt(t)) or rg.Vector3d.XAxis
                    break
                left -= Lc
            P_k = rg.Point3d(P_k.X, P_k.Y, P_k.Z - BH / 2.0)  # the base frame sits on the ground line of the base course
            ny = rg.Vector3d.CrossProduct(UP, tx_k) * sg
            ny.Unitize()
            Stations.append(rg.Plane(P_k, tx_k, ny))  # X along, Y out of the face, Z up
            st_x0.append(s_k)

        def station_of(b):
            # by the brick's arc length along its own run, summed over the runs before it in that course; a brick on a
            # later course takes the station of the base point under it
            best, bk = None, 0
            for k, st in enumerate(Stations):
                dd = st.Origin.DistanceTo(rg.Point3d(b['P'].X, b['P'].Y, st.Origin.Z))
                # prefer the station whose stretch holds the brick: project onto its X
                v = rg.Point3d(b['P'].X, b['P'].Y, st.Origin.Z) - st.Origin
                along = v * st.XAxis
                score = abs(along - span / 2.0) if 0 <= along <= span else dd + span
                if best is None or score < best:
                    best, bk = score, k
            return bk

        rows_out = []
        for b in laid:
            k = station_of(b)
            st = Stations[k]
            g = rg.Plane(b['pl'].Origin, b['pl'].XAxis, b['pl'].ZAxis)  # the gripper frame: x along the brick, y out, z up
            loc = rg.Plane(g)
            loc.Transform(rg.Transform.ChangeBasis(rg.Plane.WorldXY, st))
            A, Bb, C = kuka_abc(loc)
            rows_out.append({'b': b, 'st': k + 1, 'x': loc.Origin.X, 'y': loc.Origin.Y, 'z': loc.Origin.Z, 'A': A, 'B': Bb, 'C': C})
        rows_out.sort(key=lambda q: (q['st'], q['b']['r'], q['x']))
        lines = ['unit,face,station,course,place,length_mm,X_mm,Y_mm,Z_mm,A_deg,B_deg,C_deg,station_X0_mm,kind']
        place, key = 0, None
        for n, q in enumerate(rows_out):
            kk = (q['st'], q['b']['r'])
            if kk != key:
                key, place = kk, 0
            place += 1
            q['n'] = n + 1
            q['place'] = place
            lines.append(','.join([str(n + 1), '1', str(q['st']), str(q['b']['r'] + 1), str(place), '%.1f' % q['b']['len'],
                                   '%.2f' % q['x'], '%.2f' % q['y'], '%.2f' % q['z'], '%.2f' % q['A'], '%.2f' % q['B'], '%.2f' % q['C'],
                                   '%.1f' % st_x0[q['st'] - 1], 'brick']))
        Csv = '\n'.join(lines) + '\n'

        # ---- the KRL, in the shape Pattern Studio's -robot.src takes
        pk = [float(v) for v in Pick.replace(';', ',').replace(' ', ',').split(',') if v.strip()] + [0.0, -1500.0, 400.0]
        PX, PY, PZ = pk[0], pk[1], pk[2]

        def F(x, y, z, a, b=0.0, c=0.0):
            return '{X %.1f,Y %.1f,Z %.1f,A %.1f,B %.1f,C %.1f}' % (x, y, z, a, b, c)

        nm = ''.join(ch if ch.isalnum() or ch == '_' else '_' for ch in Name)[:20] or 'wall'
        K = ['&ACCESS RVP', '&REL 1', 'DEF %s()' % nm, ';FOLD INI', ';FOLD BASISTECH INI',
             'GLOBAL INTERRUPT DECL 3 WHEN $STOPMESS==TRUE DO IR_STOPM ( )', 'INTERRUPT ON 3', 'BAS (#INITMOV,0 )',
             ';ENDFOLD (BASISTECH INI)', ';ENDFOLD (INI)',
             ';FOLD Pattern Studio placement on a %s: %d bricks of %g x %g x %g mm in %d station%s' % (
                 'plan curve' if kind == 'curve' else 'surface', len(rows_out), BL, BW, BH, n_st, '' if n_st == 1 else 's'),
             '; base frame per station: X along the wall from the station start, Y out of the face, Z up; A about Z, B about Y, C about X',
             '; set $TOOL to the gripper and $BASE to each station frame (the Stations output) before running it; each brick is lowered from above',
             '; the pallet at %g, %g, %g is in the robot\'s own frame ($NULLFRAME)' % (PX, PY, PZ),
             ';ENDFOLD', '$TOOL=TOOL_DATA[1]', '$VEL.CP=0.25', '$APO.CDIS=20', 'PTP XHOME', '$OUT[1]=FALSE ; gripper open']
        cur = 0
        lead = BH * 2 + 50
        for q in rows_out:
            if q['st'] != cur:
                cur = q['st']
                K.extend(['', '; ---- station %d: base frame BASE_DATA[%d] at %.1f mm along the base course ----' % (cur, cur, st_x0[cur - 1])])
            b = q['b']
            over = F(q['x'], q['y'], q['z'] + lead, q['A'], q['B'], q['C'])
            at = F(q['x'], q['y'], q['z'], q['A'], q['B'], q['C'])
            K.extend(['; brick %d, course %d, place %d, %.1f mm%s%s' % (q['n'], b['r'] + 1, q['place'], b['len'],
                                                                      ', squint (mitred end)' if (b['cl'] or b['cr']) else '',
                                                                      ', closer (cut to length)' if b['closer'] else ''),
                      '$BASE=$NULLFRAME', 'LIN ' + F(PX, PY, PZ + 150, 0) + ' C_DIS', 'LIN ' + F(PX, PY, PZ, 0), '$OUT[1]=TRUE ; grip',
                      'WAIT SEC 0.3', 'LIN ' + F(PX, PY, PZ + 150, 0) + ' C_DIS', '$BASE=BASE_DATA[%d]' % cur, 'PTP ' + over + ' C_PTP',
                      'LIN ' + at, '$OUT[1]=FALSE ; release', 'WAIT SEC 0.3', 'LIN ' + over + ' C_DIS'])
        K.extend(['$BASE=$NULLFRAME', 'PTP XHOME', 'END'])
        Krl = '\n'.join(K) + '\n'

        # ---- what was laid
        parts = ['%d bricks in %d courses on a %s' % (Count, rows, 'plan curve' if kind == 'curve' else 'surface'),
                 '%s bond' % Bond, '%d station%s of %.0f mm' % (n_st, '' if n_st == 1 else 's', span)]
        if kind == 'curve' and abs(Corbel) > 1e-9:
            parts.append('corbel %g mm, %s' % (Corbel, Shape))
        if kind == 'curve' and abs(Twist) > 1e-9:
            parts.append('twist %g deg over the height, %.2f deg a course' % (Twist, Twist / max(1.0, rows - 1.0)))
        if kinks:
            parts.append('%d mitred joints (squints), the quoin is not laid here' % kinks)
        if closers:
            parts.append('%d closers cut to length' % closers)
        if clamped:
            parts.append('%d bricks held by the bearing rule (%.0f%% of BW)' % (clamped, MaxOver * 100))
        if max_jc > Joint + 0.5:
            parts.append('the joint opens to %.1f mm on the outside of the tightest bend' % max_jc)
        if bends_tight:
            parts.append('%d bricks sit on a bend tighter than a brick can follow; look at them' % bends_tight)
        if field:
            parts.append('tone from %d attractor%s within %.0f mm' % (len(field), '' if len(field) == 1 else 's', Reach))
        elif Turn or Shift:
            parts.append('no field wired: the tone is a gradient up the wall')
        parts.append('units read as mm')
        Info = '; '.join(parts)

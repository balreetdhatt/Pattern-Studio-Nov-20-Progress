"""Pattern Studio: timber frames from a schedule (GhPython component, or a Rhino 8 Python script).

Rebuilds any of the tool's built-up timber forms from the schedule it exports, as solid boxes, one per piece:
  -portals.csv   serial portal frames (chords in two leaves, posts, diagonals, purlins)
  -canopy.csv    canopy on clustered posts (posts, blocks, built-up beams, knee braces, studs, noggins)
  -corbel.csv    corbelled corridor (posts, mortised rails, top plates, cantilevers, rails, ridge, floor)
  -leanwall.csv  leaning two-layer wall (members and spacers)
Each row carries its two end points (ax..bz), its section 'w x d' (w across, d along the depth direction), the depth direction
(dx, dy, dz) and the leaf offset (ox, oy, oz), all in the tool's frame: millimetres, y up. Rhino is z up: (x, y, z) -> (x, -z, y).
Brace rods (no section) come back as lines.

Inputs (GhPython): Path (str), Build (bool). Outputs: Pieces (list of Brep), Kinds (list of str), Rods (list of Line), Info (str).
As a script: set PATH below and run; the pieces are added to the document on a layer per kind.
Written for IronPython 2.7 and CPython 3: no f-strings.
"""
import csv, math
import Rhino.Geometry as rg

def P(x, y, z):
    return rg.Point3d(x, -z, y)

def V(x, y, z):
    return rg.Vector3d(x, -z, y)

def fnum(row, ix, key, default=None):
    i = ix.get(key)
    if i is None or i >= len(row) or row[i] == '':
        return default
    try:
        return float(row[i])
    except ValueError:
        return default

def build(path):
    pieces, kinds, rods = [], [], []
    with open(path) as f:
        rd = csv.reader(f)
        head = next(rd)
        ix = dict((h.strip(), i) for i, h in enumerate(head))
        for row in rd:
            if not row:
                continue
            a = [fnum(row, ix, k) for k in ('ax', 'ay', 'az')]
            b = [fnum(row, ix, k) for k in ('bx', 'by', 'bz')]
            if None in a or None in b:
                continue
            kind = row[ix['kind']] if 'kind' in ix else 'piece'
            sec = row[ix['section_mm']] if 'section_mm' in ix and ix['section_mm'] < len(row) else ''
            parts = [s for s in sec.replace('X', 'x').split('x')]
            if len(parts) != 2:
                rods.append(rg.Line(P(*a), P(*b)))
                continue
            w, d = float(parts[0]), float(parts[1])
            dr = [fnum(row, ix, k, 0.0) for k in ('dx', 'dy', 'dz')]
            off = [fnum(row, ix, k, 0.0) for k in ('ox', 'oy', 'oz')]
            pa, pb = P(*a), P(*b)
            ax = pb - pa
            L = ax.Length
            if L < 1:
                continue
            ax.Unitize()
            yv = V(*dr)
            if yv.Length < 1e-6:
                yv = rg.Vector3d(0, 0, 1)
            yv = yv - ax * (ax * yv)
            if yv.Length < 1e-6:
                yv = rg.Vector3d.CrossProduct(ax, rg.Vector3d(0, 0, 1))
                if yv.Length < 1e-6:
                    yv = rg.Vector3d(1, 0, 0)
            yv.Unitize()
            c = (pa + pb) / 2.0 + V(*off)
            pl = rg.Plane(rg.Point3d(c), ax, yv)
            box = rg.Box(pl, rg.Interval(-L / 2, L / 2), rg.Interval(-d / 2, d / 2), rg.Interval(-w / 2, w / 2))
            pieces.append(box.ToBrep())
            kinds.append(kind)
    info = '%d pieces, %d rods from %s' % (len(pieces), len(rods), path)
    return pieces, kinds, rods, info

try:
    Build
    if Build and Path:
        Pieces, Kinds, Rods, Info = build(Path)
    else:
        Pieces, Kinds, Rods, Info = [], [], [], 'set Path and Build'
except NameError:
    PATH = ''
    if PATH:
        import scriptcontext as sc
        import Rhino
        pcs, kds, rds, info = build(PATH)
        for brep, k in zip(pcs, kds):
            name = 'timber_' + k.replace(' ', '_').replace('(', '').replace(')', '')
            li = sc.doc.Layers.FindName(name)
            idx = li.Index if li else sc.doc.Layers.Add(name, Rhino.Display.Color4f(0.79, 0.63, 0.43, 1).AsSystemColor())
            at = Rhino.DocObjects.ObjectAttributes()
            at.LayerIndex = idx
            sc.doc.Objects.AddBrep(brep, at)
        for ln in rds:
            sc.doc.Objects.AddLine(ln)
        sc.doc.Views.Redraw()
        print(info)

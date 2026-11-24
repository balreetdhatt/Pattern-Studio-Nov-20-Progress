"""Stacked timber from Pattern Studio's schedules (pass 47-49): rebuilds every member as a solid box and every dowel as a cylinder,
from -members.csv and -dowels.csv alone. GhPython (IronPython 2.7 or CPython 3): inputs MembersCSV, DowelsCSV (paths), W, H (member
width and height, mm), Footing (mm the first course stands on); outputs Members, Dowels, Report. Run as a plain Rhino script it adds
them to the document on layers 'Timber members' and 'Timber dowels'. The tool's y is up and z out of the face; Rhino's z is up, so a
point (x, y, z) in the tool is (x, -z, y) here."""
import csv, math
import Rhino.Geometry as rg

def _rows(path):
    f = open(path)
    try:
        r = list(csv.reader(f))
    finally:
        f.close()
    head = r[0]
    return [dict(zip(head, row)) for row in r[1:] if len(row) == len(head)]

def build(members_csv, dowels_csv, W=76.0, H=76.0, footing=200.0):
    mem, dow, lengths = [], [], set()
    for r in _rows(members_csv):
        if r.get('open', '0') == '1':
            continue
        ax, az, bx, bz = float(r['ax_mm']), float(r['az_mm']), float(r['bx_mm']), float(r['bz_mm'])
        y, cut = float(r['y_mm']), float(r['cut_length_mm'])
        lengths.add(round(cut, 1))
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        if L < 1e-6:
            continue
        ux, uy = dx / L, -dz / L
        o = rg.Point3d((ax + bx) / 2.0, -(az + bz) / 2.0, footing + y + H / 2.0)
        pl = rg.Plane(o, rg.Vector3d(ux, uy, 0), rg.Vector3d(-uy, ux, 0))
        box = rg.Box(pl, rg.Interval(-cut / 2.0, cut / 2.0), rg.Interval(-W / 2.0, W / 2.0), rg.Interval(-H / 2.0 + 0.5, H / 2.0 - 0.5))
        mem.append(box.ToBrep())
    for r in _rows(dowels_csv):
        x, z, y = float(r['x_mm']), float(r['z_mm']), float(r['y_mm'])
        d, ln = float(r['diameter_mm']), float(r['length_mm'])
        base = rg.Point3d(x, -z, footing + y + 4 - ln / 2.0)
        cyl = rg.Cylinder(rg.Circle(rg.Plane(base, rg.Vector3d.ZAxis), d / 2.0), ln)
        dow.append(cyl.ToBrep(True, True))
    report = '%d members (cut lengths %s), %d dowels' % (len(mem), ', '.join(str(v) for v in sorted(lengths)), len(dow))
    return mem, dow, report

def build_frame(frame_csv):
    """-frame.csv: jambs and end posts run a -> b up their axis; lintels, the cap ring and the footing run a -> b along their length with
    their depth downward from the top face at a/b."""
    out = []
    for r in _rows(frame_csv):
        a = rg.Point3d(float(r['ax_mm']), -float(r['az_mm']), float(r['ay_mm']))
        b = rg.Point3d(float(r['bx_mm']), -float(r['bz_mm']), float(r['by_mm']))
        wd, dp = float(r['width_mm']), float(r['depth_mm'])
        if r['kind'] in ('jamb', 'end post', 'knife plate'):
            # a knife plate is a flat bar on edge: its width along x, its thickness (depth_mm) along y
            dy = dp if r['kind'] == 'knife plate' else wd
            pl = rg.Plane(a, rg.Vector3d.XAxis, rg.Vector3d.YAxis)
            out.append(rg.Box(pl, rg.Interval(-wd / 2, wd / 2), rg.Interval(-dy / 2, dy / 2), rg.Interval(0, b.Z - a.Z)).ToBrep())
        else:
            v = b - a
            L = v.Length
            if L < 1e-6:
                continue
            v.Unitize()
            pl = rg.Plane(rg.Point3d((a.X + b.X) / 2, (a.Y + b.Y) / 2, a.Z), v, rg.Vector3d.CrossProduct(rg.Vector3d.ZAxis, v))
            out.append(rg.Box(pl, rg.Interval(-L / 2, L / 2), rg.Interval(-wd / 2, wd / 2), rg.Interval(-dp, 0)).ToBrep())
    return out

if 'MembersCSV' in globals():
    Members, Dowels, Report = build(MembersCSV, DowelsCSV, float(W or 76), float(H or 76), float(Footing or 200))
elif __name__ == '__main__':
    import scriptcontext as sc, Rhino
    folder = globals().get('FOLDER', '.')
    mem, dow, report = build(folder + '/timber-pavilion-members.csv', folder + '/timber-pavilion-dowels.csv')
    def layer(name, rgb):
        i = sc.doc.Layers.FindByFullPath(name, -1)
        if i < 0:
            ly = Rhino.DocObjects.Layer(); ly.Name = name; ly.Color = __import__('System').Drawing.Color.FromArgb(*rgb); i = sc.doc.Layers.Add(ly)
        a = Rhino.DocObjects.ObjectAttributes(); a.LayerIndex = i; return a
    am, ad = layer('Timber members', (201, 160, 110)), layer('Timber dowels', (126, 93, 59))
    for b in mem: sc.doc.Objects.AddBrep(b, am)
    for b in dow: sc.doc.Objects.AddBrep(b, ad)
    sc.doc.Views.Redraw(); print(report)

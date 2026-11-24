# Ombrae-style optical tiles in Grasshopper

Two GhPython components that build the same panel Pattern Studio draws in the browser.
Written for ARCH 540 coursework.

> **Attribution.** Ombrae™, OpticalTile™ and Sculptural Imaging™ are marks of
> Ombrae Studios Inc. and Keith Panel Systems. The geometry here was reconstructed from the
> dimensions KPS publish for their panels — Ø½" or 1" tiles on a 1¼" grid, tilted about 30°,
> standing roughly 3 mm proud — and from the stated principle that each tile reflects a
> varying tone of light. **This is not their process and not their software.** Anything built
> from it needs their licence. Keep this notice with the files.

---

## The two components

| file | what it does |
|---|---|
| `ombrae_from_image.py` | the whole job inside Grasshopper: reads a picture, samples it on the tile grid, solves each tile's hinge angle, builds the geometry |
| `ombrae_from_csv.py` | rebuilds a panel from the `-tiles.csv` that Pattern Studio exports — nothing is re-solved, so the browser and Rhino agree tile for tile |

`ombrae_from_image.gh` is the first component already set up in Rhino 8 (Python 3 Script) with
the canvas below — File Path → `Img`, sliders for W, H, TileD, Pitch, Tilt, DesignAz, DesignEl
and Contrast, toggles for `Solid` (off) and `Go`, panels on `Info` and `Angles`. Open it and
right-click **Image file** → *Select one existing file*. Inputs are left on the "Any" type hint;
the script casts every value itself, so that is fine.

Use the first when you want to drive the design from Grasshopper. Use the second when the
design was settled in the browser and Rhino just has to build it.

## Setting one up

1. Drop a **GhPython Script** component on the canvas (Rhino 7/GH1, or Rhino 8 — the code
   runs under IronPython 2.7 and CPython 3 alike).
2. Open it, paste the file's contents in, and save.
3. Right-click the component → add the inputs you want to drive, named exactly as in the
   file's docstring, and set each one's **type hint** (`float`, `int`, `bool`, `str`).
   Any input you leave off falls back to a sensible default, so you can start with just
   `Img` and `Go` and add sliders as you go.
4. Right-click → rename the outputs to `Plate`, `Tiles`, `Hinges`, `Angles`, `Tones`,
   `Csv`, `Info`.

A reasonable canvas, matching the groups in the reference definition:

```
  [File Path]──Img ─┐
  [Panel W] ────────┤
  [Panel H] ────────┤
  [Slider TileD]────┤                      ┌── Plate  ──→ [Custom Preview, grey]
  [Slider Pitch]────┼──→ OMBRAE FROM IMAGE ┼── Tiles  ──→ [Custom Preview, metal]
  [Slider Tilt] ────┤                      ├── Hinges ──→ [Custom Preview, green]  (shop drawing)
  [Slider Az] ──────┤                      ├── Angles ──→ [Panel]                  (the schedule)
  [Slider El] ──────┤                      ├── Csv    ──→ [Write File]             (hand-off)
  [Slider Contrast]─┤                      └── Info   ──→ [Panel]                  (read this)
  [Toggle Go] ──────┘
```

Keep `Solid` off while you are moving sliders — flat discs rebuild in a fraction of the time —
and turn it on for the final bake.

## How it works

Every tile is the same disc at the same tilt. What changes from tile to tile is the plan angle
of the hinge it is folded along. Turning that hinge sweeps the disc's normal around a cone, so
the light it returns to someone standing in front changes smoothly:

```
n · L  =  sin(tilt)·R·sin(θ − φ)  +  cos(tilt)·Lz
```

where `L` is the sun, `R = hypot(Lx, Ly)` and `φ = atan2(Ly, Lx)`. That is monotonic in `θ`
over half a turn, so it inverts exactly. A tone `t` from 0 (darkest) to 1 (brightest) becomes:

```
θ  =  φ  +  asin(2t − 1)
```

Two consequences worth knowing before you build anything:

- **The picture is solved for one sun.** Move the sun away from `DesignAz` / `DesignEl` and
  the image washes out. That is the effect these panels are sold on, not a fault.
- **A square-on sun has no range.** When the sun is near the panel's own normal, `R` is small,
  every hinge angle gives nearly the same tone, and the panel reads as flat grey. The
  component says so in `Info`. `R` measures how far the sun is off the panel's own face, so
  the fix is to move it *off* the face: swing it round in azimuth, or raise it. Azimuth
  35–65° with elevation 20–45° suits a wall that takes the afternoon; azimuth 0° at
  elevation 5°, straight at the panel, is the dead case.

## Checking it against the browser

The two must agree. To prove it on your own machine:

1. In Pattern Studio, set up a tile panel and export the fabrication bundle.
2. Unzip it and wire `<name>-tiles.csv` into `ombrae_from_csv.py`.
3. Wire the same image and the same settings into `ombrae_from_image.py`.
4. The two tile sets should land on top of each other. If they do not, the `hinge_deg`
   column and the component's `Angles` output will show you where they part company — and
   one of the two has a bug worth finding.

## What has been tested

Run in Rhino 8's Python 3 Script component (Oct 2026), `ombrae_from_image.py` only:

- solves with no errors or warnings — 3,308 tiles on a 74 × 45 grid at the default settings;
- with no image it falls back to the tone ramp and says so in `Info`;
- reads an image through `System.Drawing` under Python 3, the right way up: a black disc on a
  white ground gave mean tone 0.01 for tiles inside the disc and 0.99 at the sides;
- `Solid` on builds 3,308 solid tiles in about 4.7 s; off gives flat discs.

**Run since (1 November 2026):** `ombrae_from_csv.py` rebuilt 988 tiles from a tile list written by `tiles_on_surface.py` on a flat 1200 x 800 panel (the plate inferred from the tile extents, as it says). **Not yet run:** the browser's own `-tiles.csv` against `ombrae_from_image.py` tile for tile, and a visual inspection of the tiles in the viewport.

## Limits, honestly

- `GetPixel` is slow, so the image is downsampled to twice the tile grid before sampling.
  Fine for a panel; do not expect it to hold fine detail.
- There is no shading or reflectance model here — Rhino renders the real geometry, which is
  better than any approximation. The browser's 2D view is the approximation.
- Tiles are modelled as free-standing discs on a backing plate. On a real panel they are
  formed from the sheet itself, so the back face of a built panel will not look like this.
- Nothing here does panelisation, joints, fixings or edge conditions.

---

## Brick courses from the placement list (30 October 2026)

`bricks_from_csv.py` rebuilds a **Brick courses** panel from the `-bricks.csv` Pattern Studio
exports (one row per brick: course, place, length, x, y, offset out of the face, turn in
degrees, tone). Inputs `Csv`, `BW`, `BH`, `W`, `H`, `Plane`, `Go`; outputs `Bricks` (one box
per brick), `Planes`, `Turns`, `Offsets`, `Courses`, `Count`, `Info`. Nothing is re-solved: the
browser decided the turn and the offset, Rhino builds them. Set it up the same way as the two
tile components. **Run in Rhino 8 on 1 November 2026** on the browser's own `gantenbein-bricks.csv` (255 bricks, 30 courses) and `church-bricks.csv` (10,224 bricks, 88 courses, offsets to 1,472 mm on the wave). The precedents it
reproduces are in `../catalogue/cards/` (Gantenbein Winery, Casa la Roca, Chi She Gallery).

## Serial sections from the rib schedule (30 October 2026)

`ribs_from_csv.py` rebuilds a **Serial sections** stack from the `-ribs.csv` Pattern Studio exports
(one row per rib with the full front-edge profile at every station). Inputs `Csv`, `T`, `Twist`,
`Depth`, `Plane`, `Go`; outputs `Ribs` (one solid per rib, or a ribbon per band when `Twist` is on),
`Edges`, `Count`, `Info`. **Run in Rhino 8 on 1 November 2026** on the browser's `zero-fold-ribs.csv` (48 ribs, 77 stations each). Precedents in
`../catalogue/cards/` (Aqua Tower, Zero/Fold Screen, One Main, Signal Box).

## Robot placement, station by station (30 October 2026)

`robot_from_csv.py` reads the **-robot.csv** a Brick courses, Pavers or Kinetic units bundle carries (one row per piece in placing order, its pose in its station's base frame; the first column is `unit`, older files say `brick`, the last is `kind`; for pavers the frame is the bed unless they are laid on a wall, and B, C carry the tilt) and rebuilds the wall as boxes with one Plane per station: the `$BASE` frames the **-robot.src** KRL program expects. Inputs `Csv`, `BW`, `BH`, `Plane` (the face's bottom-left back corner; default world XZ), `Station` (show one), `Go`; outputs `Bricks`, `Order`, `Stations`, `Reach`, `Info`. **Run in Rhino 8 on 1 November 2026** on the `Csv` of `bricks_on_surface.py` (every box on its brick to 0.0 mm).

## Bricks on your own curve or surface (1 November 2026)

`bricks_on_surface.py` is the first component that lays Pattern Studio's modules on geometry **you drew in Rhino**, instead of rebuilding a panel the browser solved. It is the start of the brick slice of the new direction: walls on any plan curve, corbelled surfaces, towers, with the robot targets written from the same rows.

- **A plan curve** (open or closed, kinks allowed) is the wall's centreline. Each course is the curve offset by that course's corbel (`Corbel` mm over the height, `Shape` linear / bulge / top / wave) and lifted to its height; the bricks are laid along it by arc length. On a bend the joint is measured at the **inside** face, so the centreline joint grows by `BL·BW·κ/2` and the inside joint never closes; `Info` says how wide the outside joint opens on the tightest bend.
- **A surface or Brep** is cut by a horizontal section per course and the bricks are laid along each section, so a leaning, bulging or corbelled surface becomes level courses that step out and in as the surface does.
- **A tower** is a closed plan curve. Its face is the outside whichever way the curve was drawn (`Flip` turns it inside out), a positive corbel steps outward (`Shape` 'wave' with `Waves` gives a bulging shaft), and `Twist` (degrees over the height) turns each course its share about the plan's area centroid, so the bond spirals. The bearing rule measures each brick's step out of the face against the course curve below, so a twist on a non-round plan is checked as the overhang it really is.
- Running or stack bond; odd courses start with a half brick; with `Lay` 'flush' every run is laid joint to joint and closed with a closer, a sliver under 20 mm turns the last full brick into two bats, and at a mitred end the closer is held to the cut plus 20 mm (the pass 24 rule); with `Lay` 'centred' whole bricks are centred in the run with no closers, the browser's freestanding panel. A kink in the plan is a mitred joint (a squint) at any angle, including 90°: the quoin the browser lays is **not** laid here.
- A **field** of attractor points, curves or Breps (`Field`, `Reach`) turns (`Turn`) or slides (`Shift`) each brick, tone 1 on the attractor; with no field the tone is a gradient up the wall. The bearing rule (`MaxOver` × BW) counts the corbel step, the offset and the corner a turned brick swings out, clamps and counts.
- **Robot:** `Stations` (one Plane per station along the base course, 1.4 × `Arm` each: X along the wall, Y out of the face, Z up), `Csv` in the `-robot.csv` columns with X, Y, Z, A, B, C in the station's frame (KUKA order: A about Z, B about Y, C about X), and `Krl` in the shape `-robot.src` takes (INI fold, pallet in `$NULLFRAME`, a `$BASE` per station). Wire `Csv` and `Krl` to Write File.

Inputs `Geo`, `Rows`, `BL`, `BW`, `BH`, `Joint`, `Bond`, `Corbel`, `Shape`, `Waves`, `Twist`, `Field` (list), `Reach`, `Turn`, `Shift`, `MaxOver`, `Flip`, `Arm`, `Pick`, `Name`, `Go`; outputs `Bricks`, `Planes`, `Courses`, `Stations`, `Csv`, `Krl`, `Count`, `Info`. Units are read as millimetres. Mitred bricks are built as a six-face mesh turned into a Brep (`Brep.CreateFromMesh`); everything else is a `Box`. **Run in Rhino 8 on 1 November 2026**; see "Run in Rhino 8" below for the cases. Not carried in the export bundle (build-embed.py collects `*_from_csv.py` only); it is a generator, not a reader.

## Pavers on your own boundary or surface (1 November 2026)

`pavers_on_surface.py` lays a field of paver modules over a boundary you drew (a closed plan curve, or a surface whose outline is the boundary and whose height each paver takes), the type of each module chosen by a pattern from controls or from a picture. Two precedents, both reachable from the same inputs:

- **Keio University roof garden** (Michel Desvigne, Tokyo 2005; Philip Belesky's Groundhog reverse-engineering at groundhog.philipbelesky.com/projects/keio-university-roof-garden/): one 500 mm granite slab in five types with a round planting hole of Ø375, 300, 200, 150 or none (`Holes`, biggest first), trees in the biggest holes (`Trees`), grasses in the others (`Grasses`), the types chosen by a greyscale picture (`Mode` 'image', the file at `Image` stretched over the boundary's box) or by a control pattern: 'gradient' along `Angle`, 'radial' from `Centre` out to `Scale`, 'noise' (seeded, `Scale` the wavelength), 'attract' (1 on the `Field` geometry, 0 at `Reach`), 'random'. `Contrast`, `Invert`, and `Dither` (error diffusion over the grid, so a gradient reads as a scatter the way Keio does; off gives nearest level).
- **Roche pocket park** (Bryum, Basel 2021; landezine.com/roche-pocket-park-by-bryum/): one square paver, no holes, and around each tree the paving thins out while the paths stay solid. Wire the trees as `Field` with `Mode` 'attract', set `Cull` to how open the paving gets at a tree (a seeded draw per cell against tone × `Cull`), and the paths as `Keep` curves with `KeepWidth`; the cells left out come back as `Planted` outlines. `Holes` at 0 keeps every paver solid.

The grid is `Module` + `Joint` pitch, turned by `Spin`, a whole paver at the corner of the boundary's box; cells whose centre is inside are laid and cells the boundary crosses are cut to it when `Clip` is on (pieces under `MinPiece` of a paver dropped and counted). Each paver is a slab `Thick` deep with its hole cut through (`Brep.CreatePlanarBreps` of outline and circle, then `BrepFace.CreateExtrusion`); a cut piece keeps its hole only when the whole circle lies inside it. Outputs `Pavers`, `Outlines`, `HoleCrvs`, `Types`, `Tones`, `Trees`, `Grasses`, `Planted`, `Csv` (paver, col, row, type, hole, x, y, z, cut, area; the cells left out have type 0), `Count`, `Info` (the count per type). **Run in Rhino 8 on 1 November 2026** (the Roche, Keio and sloping-surface cases below). Not carried in the export bundle; a generator, not a reader.

## Kinetic units on your own surface (1 November 2026)

`units_on_surface.py` places umbrella, iris or louvre units over a surface, Brep or flat boundary by arc length. Every unit sits in a cell of the full `Pitch` whose frame bars (`Bar` wide and deep) are shared with its neighbours, so the frames make one continuous lattice: `Grid` 'square', or 'hex' (a honeycomb, rows 0.866 pitch apart, alternate rows shifted half a pitch: the Al Bahar Towers' frame). The moving parts hang on that frame and the mechanism is drawn, not implied (checked 1 Nov, twice: the lattice is continuous to 0.00 mm on a square grid and 0.07 mm across a bowed honeycomb; and a **penetration test**, every sampled surface point of each part tested for lying strictly inside any other part of its unit or the frame, at s = 0, 0.5 and 1: **0 pairs over 0.1 mm** for all three shapes. To get there: rod and strut end caps stop short of the face they meet by r / tan α so the rim just touches; the spokes end on the collar's surface and the collar is a ring wholly behind the frame plane; the struts leave the hub's back face beside the axis; the petals stop short of the axis, leaving a hole at the centre; the iris blades carry a lobe round their own pin and every pin is cut out of them with clearance, a washer between blades; the louvre rod leaves the bracket's side; and every extrusion is checked for outward orientation, since one run against its face normal comes out inside out and fools booleans and inside tests):

- **umbrella** (the Al Bahar unit: a hexagonal frame carrying six petals on one linear actuator; from the user's card, not from Flux): one petal per side of the cell, hinged on the frame's inner edge (4 on a square cell, 6 on a hexagon); a spider of three spokes holds the actuator at the centre; its rod runs through the frame plane to a hub in front, and a strut of `Strut` length (0 takes the rim's apothem) joins the hub to each petal. The actuator is the hub's height on the axis, solved exactly from the strut geometry for the fold angle ((1 − s) × `Fold`); a strut too short to reach a state is counted, not hidden.
- **iris**: a ring inscribed in the cell, touching the frame, carries `Petals` blades on pins; each blade is a plate whose inner edge is a circle of radius R through its pin; turning every blade by *a* leaves an aperture R(1 − 2 sin(a/2)), open at 0 and shut at 60°. The actuator is the ring's turn, a = 2 asin(s/2).
- **louvre** (square cells): a flap on the top bar turned (1 − s) × 90°, pushed by a rod from a bracket on the bottom bar that reaches `Depth` behind the frame to a point `Arm` along the flap; the actuator is the rod's length.

The state s at each unit and time comes from a tone (`Mode`, as in the paver component, over the surface's u, v) and a `Drive`: 'field', 'sun' (a `Sun` vector per step against the unit's **own** normal, full at `SunFull`), 'walk' (a walker along the first `Walk` curve, units within `Reach`), 'pulse'; `Blend` combines them, `SMin`/`SMax` bound it. Outputs `Frames`, `Parts` at time `T`, `Planes`, `States`, `Actuator` (the value per unit now), `Csv` (the actuator table `-units.csv`: duty, stroke, the actuator's min and max, and its value at every step), `Count`, `Info` (deployed now, mean duty and stroke, the actuator's range, states the strut cannot reach). Which surface direction runs along the face is read from the surface itself (the direction whose middle isocurve rises less; `FlipUV` overrides), and `FlipN` turns the face the other way, since the units, the sun test and the picture all follow the surface's normal. **Run in Rhino 8 on 1 November 2026** (all three shapes and all four drives on a bowed face; see below).

## Serial sections through your own form (1 November 2026)

`ribs_on_surface.py` sections a surface, Brep or mesh you modelled with parallel planes at `Pitch` along `Dir` ('x', 'y', 'z' or a vector). Each section is a rib `T` thick: its front edge is the section curve, its back a straight line on a common back plane `Back` behind the form's far side along `Face`, so the ribs stand on one line; a closed section is a rib with the section as its outline. Outputs `Ribs`, `Edges`, `Nest` (every rib laid flat on world XY in a row with `Gap`, for a CNC nest) with `Labels`, and `Csv` (rib, position, length, depth min and max, area, the profile at `Stations` stations, as `-ribs.csv` carries it). No zero-waste pairing here yet: that needs the browser's complement rule and is a next step. **Run in Rhino 8 on 1 November 2026** (a sphere along x, an open bowed surface along z; see below).

## Optical tiles and perforations on your own surface (1 November 2026)

`tiles_on_surface.py` lays the Ombrae-style tile grid or a perforation grid over a surface by arc length, the tone from a picture stretched over the surface or from a pattern (`Mode` as in the paver component). `Kind` 'tiles': a disc of `Dia` per cell tilted `Tilt` on a hinge whose plan angle is solved **per cell against the design `Sun` on that cell's own normal** (θ = φ + asin(2t − 1) in the cell's frame), so a curved facade is solved cell by cell; the disc hangs tangent on a hinge pin carried by two posts, lifted so its low edge clears the plate by `Rise` (KPS's tiles stand about 3 mm proud), so nothing sits inside the plate (checked 1 Nov: 0 penetrating pairs, the lowest disc point 6.6 mm clear); `Info` reports the average dial and how many cells see the sun square-on. `Kind` 'holes': a hole of `Dmin` to `Dmax` per cell held under the pitch minus `Web`, as circles on the surface, and with `Plate` on the surface thickened and the holes cut out (a boolean per hole; slow past a few thousand). Outputs `Tiles`, `Hinges`, `HoleCrvs`, `PlateB`, `Planes`, `Tones`, `Csv` (the `-tiles.csv` columns, or hole, col, row, x, y, z, d, tone), `Count`, `Info`. The Ombrae attribution at the top of this file applies. `FlipN` and `FlipUV` as in the units component. **Run in Rhino 8 on 1 November 2026** (tiles and holes from a photograph on a bowed face, and the cut plate; see below).

## Run in Rhino 8, 1 November 2026: the five `*_on_surface.py` generators

Run through the Rhino MCP (a Rhino 8 started by `spawn_slot`, each script exec'd with Grasshopper-style inputs in a dict, outputs baked to layers, overlaps checked with `Brep.CreateBooleanIntersection` volumes over bounding-box pairs, screenshots by `CaptureToBitmap`). Nothing below was checked in a real Grasshopper canvas yet: the scripts ran as plain Python 3 inside Rhino, which is the same RhinoCommon but not the GhPython component's own input casting.

| Component | Cases run | Result | Fixed on the way |
|---|---|---|---|
| `bricks_on_surface.py` | an arc wall (12 courses, attractor field, turn 20°); a round tower (24 courses, wave corbel 300 mm, twist 40°); a polyline with a 90° and a 135° kink; a closed square (10 courses, corbel 150 mm); a leaning bulging surface (21 courses) | 222 / 824 / 180 / 324 / 262 bricks; **0 overlapping bricks** on every case after the fix; the arc wall's `Csv` read back by `robot_from_csv.py` puts every box on its brick to 0.0 mm | the squint cuts were mirrored on a left-facing wall (the laying frame's x ran backwards when its z was flipped to the face): 48 wedge overlaps of 215,000 mm³ at the kinks, now none |
| `pavers_on_surface.py` | Roche: 12 × 8 m, 400 mm pavers, five tree points, `Cull` 0.9, a path kept 700 mm each side; Keio: an L-shaped boundary, the five holes, the Keio photograph as `Image`, dithered; a sloping surface, grid spun 20°, radial, nearest level | 370 pavers with 181 left out and 31 kept on the path; 444 pavers in five types (22 / 95 / 145 / 108 / 74) with 20 trees and 346 grasses; 201 pavers each at its own height | a whole paver with a corner exactly on the boundary was counted as cut (`Contains` returns Coincident) |
| `units_on_surface.py` | umbrella, iris, louvre on a bowed 4 × 2.4 m face at 400 mm pitch; drives: a low sun sweeping east to west (umbrella), pulse over a radial tone (iris), a walker 1.5 m in front (louvre) | 77 units each; on the bowed face the left-hand unit peaks at the east sun and the right-hand at the west, each on its own normal; iris ring turn 0 to 55.6°; louvre rod 272 to 286 mm; a strut set too short reports 84 unreachable states instead of hiding them | the grid read the surface's u as "along" even when u ran up the face (rows and columns swapped, a picture turned on its side): now read from the surface; `FlipN` added since the test face's normal pointed away from the sun |
| `ribs_on_surface.py` | a 1.8 m sphere at 150 mm along x with the back plane 200 mm behind; the bowed surface at 250 mm along z | 11 ribs, nest 17 m; 10 ribs, depths 300 to 550 mm | nothing |
| `tiles_on_surface.py` | tiles from the Keio photograph at 80 mm on the bowed face; holes from it at 100 mm; a 250 mm hole grid with `Plate` on | 1,581 tiles, dial 0.41; 1,025 holes; the plate boolean held (193 faces) | the same u/v orientation fix as the units |

### Inside real GhPython components, and the five `.ghx` files (same day)

Each generator was then built as a **legacy GhPython Script component** (`ZuiPythonComponent`, IronPython 2.7) by script on a live canvas, with every input added by name, sliders, toggles, panels and geometry parameters wired to it, solved, and saved: `bricks_on_surface.ghx`, `pavers_on_surface.ghx`, `units_on_surface.ghx`, `ribs_on_surface.ghx`, `tiles_on_surface.ghx` (open any in Rhino 8's Grasshopper; the sliders are the inputs in the docstring at their defaults, and `Geo` is an internalised test curve, surface or sphere you replace with your own). All five solve with the same counts as the Python 3 runs (222 bricks, 384 pavers, 77 units, 11 ribs, 1,581 tiles).

What the component changed, and what was fixed for it:

- **Geometry arrives as a Guid.** The legacy component's hint list has no Curve, Surface or Brep, so a geometry input with no hint hands the script the Guid of a ghdoc object. Every script now has `geo()` at its inputs: RhinoCommon as it is, a GH goo by its `Value`, a Guid through `rhinoscriptsyntax` coercion. Leave `Geo`, `Field`, `Keep`, `Walk`, `Centre` on **no type hint**; set `float` → *double*, `int`, `bool`, `str` → *string*, `Point3d`, `Vector3d` on the rest; list inputs (`Holes`, `Field`, `Keep`, `Sun`, `Walk`) on **List Access**.
- **A panel gives text.** `Holes` typed into a panel as "375, 300, 200, 150, 0" failed the `float` hint; the script now reads a typed string itself, and the `.ghx` feeds it from a Number parameter.
- IronPython 2.7 ran all five without change (no f-strings, `from __future__ import division`).

Also run (same day): the four older CSV readers on the browser's exports in `dev-tools/gh-run-csvs/` (see each reader's section), and the **browser against the generator**: the browser's Gantenbein panel (`gantenbein-bricks.csv`, 2,400 mm with a 158 mm frame, 12 mm joint, 30 courses) laid again by `bricks_on_surface.py` on a line of the laid span with `Lay` 'centred' and the same joint gives the same 255 bricks with a worst centre or length difference of **0.00 mm**. The two rules are now both in the generator: `Lay` 'flush' (joint to joint with closers, the browser's rule under a plan) and 'centred' (whole bricks centred, no closers, the browser's freestanding panel).

## Worked examples for the review (1 November 2026)

`examples/` holds four precedents built on these generators, each a `.3dm`, a `.ghx` with the component wired and a note on the canvas, a `.png` and the CSVs: the **Keio University roof garden** (slabs in five hole types from the photograph), the **Roche pocket park** (paving thinned toward the trees, paths kept), **Gantenbein Winery** (the browser's panel from its CSV beside a 12 m generator wall with its robot list and KUKA program) and Dieste's **Church of Christ the Worker** (two serpentine walls and a catenary vault). `examples/README.md` says how to open and change them and what they leave out.

## The assembly: walls, vault and skin from one definition (3 November 2026)

`assembly.py` chains the generators into a building piece and `assembly.ghx` wires it with sliders: `Plan` (the first wall's plan curve) and `Span` or `Plan2` (the second) go to `bricks_on_surface.py` twice; the wall tops (the plan curves at the top of the top course, moved to each wall's OUTER face) go to `vault_between_walls.py`; the vault goes to `units_on_surface.py` or `tiles_on_surface.py` (`Skin`, `Where` vault | walls | both). It runs the other scripts from `Folder` with their inputs in a fresh namespace, so every rule lives once. Two rules of its own: the rib depth is held so the foot, cut flat where the arch leans, stays on the wall (`foot_width`), and when the units' frames or mechanisms run into the ribs the skin is stood off the shell by `Standoff` (125 mm, the mechanism's depth) on whichever side and facing clear the ribs (`ribs_hit`, a point-in-solid count). Outputs: the two walls' bricks, robot lists and KRL; the ribs, the vault and its schedule; the skin and its table; `Info`. **Run in Rhino 8 on 3 November** on the nave example (see `examples/README.md`): 0 overlapping bricks, every rib foot on its wall, 0 skin vertices inside a rib. Found on the way: `vault_between_walls.py` reassigned its own `solid()` helper inside the rib loop, so only the first rib ever built; fixed. The `.ghx` was written by script and then opened on a canvas and solved on 3 Nov (18 s, every output filled: 1,485 + 1,050 bricks, 21 ribs, 5,920 skin parts, no runtime messages); the first output must be the component's own `out` stream or the first result is lost. The walls stand vertical and the vault carries no bricks.

## A roof between two walls (1 November 2026)

`vault_between_walls.py` spans a roof between two wall curves you drew (`A`, `B`: their tops, or their plan lines): an arch rib at every `Pitch` along `A`, each a circular `arc`, a `catenary` (the hanging-chain line turned over, so a brick vault of that line stands in compression, as Dieste's do) or a `pointed` arch of two arcs, with `Rise` at the crown, `Depth` under the arch line and `T` thick, and whatever of the rib would hang below the springing line cut off so its underside bears flat on the wall top (checked 1 Nov on serpentine walls: 0 penetrations into the top courses, undersides exactly at the wall top); `Match` pairs a point on `A` with `B` by length fraction or by the closest point. Outputs `Ribs`, `Arches`, `Vault` (the surface lofted through the arches; it can go on to `tiles_on_surface.py`, or to `ribs_on_surface.py` along the span for brick rings), `Nest` with `Labels`, `Csv` (rib, position, span, rise, arch length, heights above the chord at N stations), `Count`, `Info`. **Run in Rhino 8 on 1 November 2026**: a straight wall and a bowed one 6 m apart, all three profiles, 16 ribs each, the loft holding; and as a GhPython component (`vault_between_walls.ghx`).

`ribs_on_surface.py` gained `Pair`: the ribs nested in pairs head to tail in one strip each (`Strips`), with the pairs' waste in `Info`. A pair whose depths add up to the strip wastes nothing, which is the browser's zero-waste rule; on a form you modelled the waste is reported rather than designed away (24 % on a sphere, 30 % on a bowed face).

## Pavers from the placement list (30 October 2026)

`pavers_from_csv.py` rebuilds a **Pavers** field (or a facade of Nested modules: set `Upright` to stand it in world XZ with depths toward -Y) from the `-pavers.csv` Pattern Studio exports (one row per paver:
type, colour, cut, centre, area, height and the outline as `x y` pairs). Inputs `Csv`, `Joint`, `Plane`, `Go`;
outputs `Pavers` (one solid per paver at its type's height), `Outlines`, `Types`, `Colours` (wire to a Custom
Preview), `Count`, `Info`. Nothing is re-solved. **Run in Rhino 8 on 1 November 2026** on the browser's `berlin-pavers.csv` (205 panels, four types, standing) and `little-island-pavers.csv` (124 pavers, five heights, flat).

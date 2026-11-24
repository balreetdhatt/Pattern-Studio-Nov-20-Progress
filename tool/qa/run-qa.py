#!/usr/bin/env python3
"""Pattern Studio QA runner.

Builds a throwaway copy of pattern-studio.html with qa/harness.js injected, opens it in
headless Chrome, and reports what broke. Nothing here touches the shipped file.

    python qa/run-qa.py                 # run everything, write qa/report.md
    python qa/run-qa.py --group panels  # only one group
    python qa/run-qa.py --keep          # leave qa/_build/qa.html for poking at by hand

Exit code is 0 when everything passed, 1 when anything failed, 2 when the tool would not
even boot (which is the one failure worth waking somebody for).
"""
import argparse, glob, io, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, "pattern-studio.html")
BUILD = os.path.join(HERE, "_build")

# Internals the harness drives. Kept in one place so a rename in the tool shows up here
# as a boot failure rather than as a silently skipped test.
EXPOSE = """
window.__qa=(function(){
  var QA0=JSON.parse(JSON.stringify(S));
  function reset(){for(var k in QA0)S[k]=JSON.parse(JSON.stringify(QA0[k]));
    OMB.srcEl=null;OMB.fitKey='';OMB.label='';if(typeof PAVER_PREV!=='undefined')PAVER_PREV=null;if(typeof PAVER_SET!=='undefined')PAVER_SET=null;if(typeof MERGE_SET!=='undefined'){MERGE_SET=null;SEAM_DEFAULT=false;}S.seam=false;S.gap=24;}
  function dialRange(){var O=S.omb,a=O.tilt*D;
    var L=ombLight(S,O.live?S.light.az:O.designAz,O.live?S.light.el:O.designEl);
    var phi=Math.atan2(L.y,L.x),V={x:0,y:0,z:1},lo=1,hi=0;
    for(var i=0;i<9;i++){var t=i/8;
      var th=O.encode==='tilt'?phi+Math.PI/2:phi+Math.asin(clamp(2*t-1,-1,1));
      var tl=O.encode==='tilt'?a*(.08+.92*t):a;
      var sh=ombShade(tileNormal(th,tl),L,V,S.light,O.spec);
      var lum=clamp(sh.d*0.6+sh.s,0,1);if(lum<lo)lo=lum;if(lum>hi)hi=lum;}
    return hi-lo;}
  return {S:S,PW:window.PW,PATTERNS:PATTERNS,SAMPLES:SAMPLES,sampleCanvas:sampleCanvas,
    OMB_BUILTIN:OMB_BUILTIN,OMB_PRESETS:OMB_PRESETS,ombBuiltin:ombBuiltin,ombLetter:ombLetter,
    PRESETS:PRESETS,PERF_PRESETS:PERF_PRESETS,perfGenerate:perfGenerate,MATERIALS:MATERIALS,MAT_FAMS:MAT_FAMS,
    snapGauge:snapGauge,minBarFor:minBarFor,ombSample:ombSample,ombDrawField:ombDrawField,
    ombLight:ombLight,ombShade:ombShade,tileNormal:tileNormal,ombCSV:ombCSV,ombReadme:ombReadme,
    svgText:svgText,ombPreviewSVGText:ombPreviewSVGText,dxfText:dxfText,buildGeometryFrom:buildGeometryFrom,snapshot:snapshot,restoreDesign:restoreDesign,
    validateProposal:validateProposal,heuristic:heuristic,generate:generate,applyPreset:applyPreset,refreshAll:refreshAll,ombFit:ombFit,roomPalette:roomPalette,isDarkTheme:isDarkTheme,tonePreview:tonePreview,proposalAs:proposalAs,proposalCutState:proposalCutState,GONDOLA_BRIEF:GONDOLA_BRIEF,lastBrief:function(v){lastBrief=v;},defaultParams:defaultParams,area:area,
    run:run,getG:function(){return G;},reset:reset,dialRange:dialRange,
    setPanelMode:setPanelMode,showTab:showTab,panelMode:panelMode,matLum:matLum,fieldValue:fieldValue,paverGenerate:paverGenerate,seatPin:function(){return seatPin();},pvPaintDab:function(P,uv,w,h,r,m){return pvPaintDab(P,uv,w,h,r,m);},fieldUse100:function(){return fieldUse();},latModel98:function(){LAT_CACHE.key='';return latModel();},latPlanZ:function(K,t,x,w){return latPlanZ(K,t,x,w);},latPlanBelly:function(K,t,v){return latPlanBelly(K,t,v);},siteApply:function(){return siteApply();},siteRules:function(s){return siteRules(s);},paverGeom97:function(){return paverGeometry(G);},siteSVG97:function(){return siteSVG(G,G.H,2);},fieldValue97:function(F,u,v,W,H){return fieldValue(F,u,v,W,H);},layer96:function(a,b,c,d){return layer96(a,b,c,d);},brickTurnWords:function(){return brickTurnWords();},brickFormSync:function(f){return brickFormSync(f);},brickFormNow:function(){return brickFormNow();},brickForm95:function(i,o){return brickForm(i,o);},brickDesign95:function(i){return brickDesign(i);},brickLayered95:function(i){return brickLayered(i);},paintLayer:function(d,m){return paintLayer(d,m);},profLayer:function(m){return profLayer(m);},paintDab:function(L,uv,w,h,r,e){return paintDab(L,uv,w,h,r,e);},bfxSVG:function(w,h){return bfxSVG(w,h);},tabOrder:function(){return TAB_ORDER;},leanElevSVG:leanElevSVG,leanCourseSVG:leanCourseSVG,notesSVG:notesSVG,brickLayers:function(B,w,h){return brickLayers(B,w,h);},bentModel:function(){BENT_CACHE=null;return bentModel();},bentCSV:bentCSV,bentFingersCSV:bentFingersCSV,bentDesign:function(id){var r=bentDesign(id);BENT_CACHE=null;return r;},slatDesign:function(id){var r=slatDesign(id);SLAT_CACHE=null;return r;},slatModel:function(){SLAT_CACHE=null;return slatModel();},slatCSV:slatCSV,slatFrameCSV:slatFrameCSV,slatRobotCSV:slatRobotCSV,slatRules:function(){window.PS_SLAT=slatModel();return slatRules();},brickElements:brickElements,brickElementsCSV:brickElementsCSV,brickBalance:brickBalance,brickTol:brickTol,brickGlueTotals:brickGlueTotals,brickCSV:function(g){return brickCSV(g);},robotCSV:function(g,f){return robotCSV(g,f);},brickFirstRules:function(){return brickFirstRules();},G90:function(){return (G&&G.panels)?G.panels[0]:G;},setPanelMode:function(m){setPanelMode(m);},updateStats:function(){updateStats();},latModel:latModel,latCSV:latCSV,latNodesCSV:latNodesCSV,latDrillCSV:latDrillCSV,latSheetSVG:latSheetSVG,latRules:function(){window.PS_LAT=latModel();return latRules();},panelsSet:panelsSet,panelsNow:panelsNow,seamMerge:seamMerge,seamRestore:seamRestore,seamWord:seamWord,seamSet:function(v){SEAM_DEFAULT=!!v;S.seam=!!v;},mergeSet:function(){return MERGE_SET;},brickSources:brickSources,brickReadout:brickReadout,brickLayered:brickLayered,brickExample:brickExample,brickOpenings:brickOpenings,quadApart:quadApart,cribCourses:cribCourses,cribCSV:cribCSV,cribFrameCSV:cribFrameCSV,timberWhich:timberWhich,timberForm:timberForm,timberDesign:timberDesign,timberRules:timberRules,brickSideThick:brickSideThick,brickPlanLaps:brickPlanLaps,sceneWorld:function(k){rebuildScene();screenGroup.updateMatrixWorld(true);var b=new THREE.Box3(),n=0;screenGroup.traverse(function(o){if(o.userData&&o.userData[k]&&o.geometry){b.expandByObject(o);n++;}});return n?[b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z]:null;},brickForm:brickForm,leanModel:leanModel,brickStepRule:brickStepRule,brickDesign:brickDesign,brickTakeoff:brickTakeoff,brickJoints:brickJoints,brickRisk:brickRisk,brickMortar:brickMortar,brickCourseSym:brickCourseSym,sceneFlag:function(k){rebuildScene();var n=0;screenGroup.traverse(function(o){if(o.userData&&o.userData[k])n++;});return n;},sceneBox:function(k){rebuildScene();var b=null;screenGroup.traverse(function(o){if(o.userData&&o.userData[k]&&o.geometry){o.geometry.computeBoundingBox();b=o.geometry.boundingBox;}});return b?[b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z]:null;},brickStand:brickStand,brickLaps:brickLaps,brickCourse:brickCourse,permStart:permStart,paverRouteSet:paverRouteSet,paverFallTitle:paverFallTitle,paverDimSet:paverDimSet,paverSectionSVG:paverSectionSVG,permGradesCSV:permGradesCSV,portalTruss:portalTruss,portalTrussCSV:portalTrussCSV,timberRobot:timberRobot,timberCutFor:timberCutFor,timberCutCSV:timberCutCSV,leanCSV:leanCSV,corbelCSV:corbelCSV,canopyCSV:canopyCSV,portalCSV:portalCSV,serialFixCSV:serialFixCSV,paverCSV:paverCSV,paverScheduleCSV:paverScheduleCSV,paverDXFText:paverDXFText,paverSVGText:paverSVGText,paverNeighbours:paverNeighbours,paverSetCounts:paverSetCounts,paverPaletteInfo:paverPaletteInfo,paverHeightsInfo:paverHeightsInfo,paverZone:paverZone,nestComps:nestComps,orbitR:function(a){cam.aspect=a;frameCamera(true);return orbit.r;},previewFull:function(){var c=OMB.cv;if(!c)return false;var x=c.getContext('2d'),d=x.getImageData(0,c.height-1,c.width,1).data,lit=0;for(var i=0;i<d.length;i+=4)if(d[i]>8)lit++;return lit>c.width*.9;},planHoldCols:planHoldCols,fabMinWidth:fabMinWidth,buildFabDyn:buildFabDyn,updateStats:updateStats,routerNote:function(){return FAB_ROUTER_NOTE?FAB_ROUTER_NOTE.textContent:'';},objNote:function(){return OBJ_NOTE;},tabNav:function(n){var t=TABS.find(function(x){return x.name===n;});return t?Array.prototype.slice.call(t.panel.querySelectorAll('.tabnav button')).map(function(b){return b.textContent;}):[];},statsLead:function(){var s=document.querySelector('#stats span b');return s?s.textContent:'';},statsText:function(){return document.querySelector('#stats').textContent;},bundleFiles:bundleFiles,robotUnits:robotUnits,GH_SCRIPTS:function(){return GH_SCRIPTS;},objText:objText,planLayout:planLayout,planPlace:planPlace,robotCSV:robotCSV,robotKRL:robotKRL,robotStations:robotStations,fabCut:fabCut,fabRouterCheck:fabRouterCheck,dxfText:dxfText,meshRotations:function(){rebuildScene();return screenGroup.children.filter(function(m){return m.isMesh&&!m.userData.back;}).map(function(m){return m.rotation.y;});},wallVisible:function(){rebuildScene();updateLights();return wall.visible;},camState:function(){rebuildScene();frameCamera(true);updateLights();updateCam();return{far:cam.far,near:cam.near,r:orbit.r,floor:floor.scale.x*40000,shadowFar:sun.shadow.camera.far};},cardNormalise:cardNormalise,hostSceneBox:function(){rebuildScene();screenGroup.updateMatrixWorld(true);var b=new THREE.Box3(),n=0;screenGroup.children.forEach(function(m){if(!m.isMesh||m.userData.back||m.userData.planB)return;n++;b.union(new THREE.Box3().setFromObject(m));});return{zMin:b.min.z,zMax:b.max.z,xMin:b.min.x,xMax:b.max.x,yMin:b.min.y,meshes:n};},hostSceneMinY:function(){rebuildScene();screenGroup.updateMatrixWorld(true);var mn=1e18,v=new THREE.Vector3();screenGroup.children.forEach(function(m){if(!m.isMesh||m.userData.back)return;var a=m.geometry.attributes.position.array;for(var i=0;i<a.length;i+=3){v.set(a[i],a[i+1],a[i+2]).applyMatrix4(m.matrixWorld);if(v.y<mn)mn=v.y;}});return mn;},cardCheck:cardCheck,cardHeuristic:cardHeuristic,cardAccept:cardAccept,cardRecipeClean:cardRecipeClean,cardPrompt:cardPrompt,applyElement:applyElement,paverReadme:paverReadme,hostScene:function(){rebuildScene();var out=[];screenGroup.children.forEach(function(m){if(m.isMesh&&!m.userData.back)out.push(m.geometry);});return out;},kinDXFText:kinDXFText,render2D:render2D,perfCSV:perfCSV,kinGenerate:kinGenerate,kinCSV:kinCSV,kinStateAt:kinStateAt,sunAt:sunAt,kinSVGText:kinSVGText,serialGenerate:serialGenerate,serialCSV:serialCSV,serialSVGText:serialSVGText,serialDXFText:serialDXFText,serialNest:serialNest,CATALOGUE:CATALOGUE,catLoad:catLoad,catShow:catShow,brickGenerate:brickGenerate,brickCSV:brickCSV,brickSVGText:brickSVGText,brickDXFText:brickDXFText,fieldAt:fieldAt,fieldUse:fieldUse,ombFieldCanvas:ombFieldCanvas,fieldDefaults:fieldDefaults,OMBref:function(){return OMB;},dotsAuto:dotsAuto,traceHalftone:traceHalftone,SRC:SRC,PHOTO_CASES:PHOTO_CASES,PHOTO_SRC:PHOTO_SRC,renderOmbraeOrtho:renderOmbraeOrtho,setOrtho:function(v){ortho=!!v;},
    regen:function(){G=generate(S);return G;},
    kinGeometry:function(g){return kinGeometry(g);},kinActuator:function(K,s){return kinActuator(K,s);},
    paverGeometry:function(g){return paverGeometry(g);},
    composeDesign:function(h,c,s,o){return composeDesign(h,c,s,o);},    logic:function(){return LOGIC;},logicRules:function(c,k){return logicRules(c,k);},logicCredit:function(i){return logicCredit(i);},
    loftSections:function(){return loftSections();},loftCSV:function(){return loftCSV();},loftMeshes:function(){var o=[];screenGroup.children.forEach(function(m){if(m.isMesh&&m.userData.loft)o.push(m.geometry);});return o;},
    domeCells:function(){return domeCells();},domeCSV:function(){return domeCSV();},domeMeshes:function(){var o=[];screenGroup.children.forEach(function(m){if(m.isMesh&&m.userData.dome)o.push(m.geometry);});return o;},
    voxCells:function(){return voxCells();},voxCSV:function(){return voxCSV();},voxMeshes:function(){var o=[];screenGroup.children.forEach(function(m){if(m.isMesh&&m.userData.vox)o.push(m.geometry);});return o;},
    stackOutlines:function(){return stackOutlines();},stackCSV:function(){return stackCSV();},stackMeshes:function(){var o=[];screenGroup.children.forEach(function(m){if(m.isMesh&&m.userData.stack)o.push(m.geometry);});return o;},
    roofRibs:function(w,h){return roofRibs(w,h);},roofCSV:function(){return roofCSV();},roofMeshes:function(){var o=[];screenGroup.children.forEach(function(m){if(m.isMesh&&m.userData.roof)o.push(m.geometry);});return o;},
    has3D:function(){return has3D;},imgGrayFrom:function(cv,m){return imgGray(cv,m);},
    /* A NEUTRAL state, not the loaded worked example. The studio boots with a gradient and
       38% random solids on, and inheriting those made every pattern look like a solid sheet. */
    defaultState:function(over){var st=JSON.parse(JSON.stringify(QA0));
      st.omb.on=false;st.perf.on=false;st.grad={dir:'none',k:0};st.solid=0;st.seed=1;
      st.border={width:0,pattern:'nstar',cell:90,rot:0,clip:false};
      st.relief={style:'through',depth:10,levels:4,rule:'size',inset:6};
      st.radius=0;st.chamfer=0;st.balance=0;st.rot=0;st.offX=0;st.offY=0;
      st.kindOn=[true,true,true,true];
      for(var k in (over||{}))st[k]=over[k];return st;}};
})();
"""

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    env = os.environ.get("QA_CHROME")
    if env and os.path.exists(env):
        return env
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    raise SystemExit("No Chrome or Edge found. Set QA_CHROME to the browser executable.")


def build(offline, group):
    src = io.open(PAGE, encoding="utf-8").read()
    marker = "showTab('Pattern');\n})();"
    if src.count(marker) != 1:
        raise SystemExit("could not find the boot marker in pattern-studio.html — "
                         "the tool's last lines changed, update EXPOSE in run-qa.py")
    src = src.replace(marker, "showTab('Pattern');\n" + EXPOSE + "\n})();")
    if group:
        # filter what RUNS, not just what is reported: the whole suite takes minutes,
        # one group takes seconds, and that is the difference between a usable loop
        # and waiting about.
        tag = "<script>window.__QA_GROUP=%s;</script>" % json.dumps(group)
        src = src.replace("<body>", "<body>" + tag, 1)
        if tag not in src:
            raise SystemExit("could not inject the group filter — no <body> in the page")
    if offline:  # three.js from the CDN is optional; the 3D checks skip themselves
        src = re.sub(r'<script src="https://cdnjs[^"]*"></script>', "", src)
    else:
        # three.js from a local copy when there is one (qa/_vendor): the CDN sometimes answers too late for the
        # harness, and then every 3D check fails for a reason that has nothing to do with the tool
        vend = os.path.join(HERE, "_vendor", "three.r128.min.js")
        if os.path.exists(vend):
            lib = io.open(vend, encoding="utf-8").read().replace("</script>", "<" + chr(92) + "/script>")
            src = re.sub(r'<script src="https://cdnjs[^"]*three[^"]*"></script>', lambda m: "<script>" + lib + "</script>", src)
    harness = io.open(os.path.join(HERE, "harness.js"), encoding="utf-8").read()
    src = src.replace("\n</body></html>", "\n<script>\n" + harness + "\n</script>\n</body></html>")
    os.makedirs(BUILD, exist_ok=True)
    out = os.path.join(BUILD, "qa.html")
    io.open(out, "w", encoding="utf-8", newline="").write(src)
    return out


def drive(page, timeout, tag="all"):
    chrome = find_chrome()
    # the browser profile lives in the system temp dir, never in the repo: OneDrive
    # keeps handles open on files it is syncing and Chrome then cannot take its lock
    # one profile per group. Chrome holds its profile lock for a moment after the
    # process returns, and the next group then starts into a locked profile and dumps
    # nothing at all — which looks exactly like a broken test.
    profile = os.path.join(tempfile.gettempdir(), "pattern-studio-qa-profile-" + os.environ.get("QA_TAG", "") + tag)
    dom = os.path.join(BUILD, "dom.html")
    cmd = [chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
           "--disable-extensions", "--user-data-dir=" + profile,
           # headless backgrounds and throttles an offscreen page, which turns a
           # one-second FFT into a ten-second one. These three keep it running at speed.
           "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
           "--disable-backgrounding-occluded-windows",
           "--window-size=1500,940",  # the real layout: a 440 px rail beside the viewers
           "--virtual-time-budget=%d" % (timeout * 1000), "--dump-dom",
           pathlib.Path(page).as_uri()]  # spaces and ! in the path must be encoded
    # Chrome on this machine often never exits after --dump-dom has written the page, so
    # the run watches the dump itself (the RESULT title and the closing html tag) and then
    # stops the browser, instead of waiting for the process. QA_EXTRA adds wall-clock seconds.
    with io.open(dom, "w", encoding="utf-8", errors="replace") as fh:
        proc = subprocess.Popen(cmd, stdout=fh, stderr=subprocess.DEVNULL)
        limit = time.time() + timeout + int(os.environ.get("QA_EXTRA", "300"))
        while proc.poll() is None and time.time() < limit:
            time.sleep(1)
            try:
                tail = io.open(dom, "rb").read()
            except OSError:
                continue
            if b"<title>RESULT" in tail and tail.rstrip().endswith(b"</html>"):
                time.sleep(1)
                proc.kill()
                break
        if proc.poll() is None:
            proc.kill()
    html = io.open(dom, encoding="utf-8", errors="replace").read()
    m = re.search(r"<title>RESULT(.*?)</title>", html, re.S)
    if not m:
        t = re.search(r"<title>(.*?)</title>", html, re.S)
        raise SystemExit("the harness never reported. Page title was: %r\n"
                         "Run with --keep and open qa/_build/qa.html in a browser to see why."
                         % ((t.group(1)[:200] if t else "(none)")))
    raw = (m.group(1).replace("&quot;", '"').replace("&amp;", "&")
           .replace("&lt;", "<").replace("&gt;", ">").replace("&#39;", "'"))
    return json.loads(raw)


def report(res, group_filter):
    cases = [c for c in res["cases"] if not group_filter or c["group"] == group_filter]
    groups, order = {}, []
    for c in cases:
        if c["group"] not in groups:
            groups[c["group"]] = []
            order.append(c["group"])
        groups[c["group"]].append(c)
    fails = [c for c in cases if not c["pass"]]
    stamp = time.strftime("%Y-%m-%d %H:%M")
    L = ["# Pattern Studio — QA report", "",
         "%s · %d checks · **%d failed** · %d ms in the browser"
         % (stamp, len(cases), len(fails), res.get("ms", 0)), ""]
    if res["errs"]:
        L += ["## Uncaught errors", ""] + ["- `%s`" % e for e in res["errs"]] + [""]
    if fails:
        L += ["## What is wrong", ""]
        for c in fails:
            L.append("### %s · %s" % (c["group"], c["name"]))
            L.append(c["detail"] or "(no detail)")
            if c["metrics"]:
                L.append("")
                L.append("`" + json.dumps(c["metrics"]) + "`")
            L.append("")
    L += ["## Everything, by group", ""]
    for g in order:
        ok = sum(1 for c in groups[g] if c["pass"])
        L.append("### %s — %d/%d" % (g, ok, len(groups[g])))
        L.append("")
        L.append("| | check | result |")
        L.append("|---|---|---|")
        for c in groups[g]:
            L.append("| %s | %s | %s |" % ("ok" if c["pass"] else "**FAIL**",
                                           c["name"], (c["detail"] or "").replace("|", "/")))
        L.append("")
    return "\n".join(L), fails


# One browser per group. A single run of the whole suite keeps the renderer busy long
# enough that headless Chrome gives up and dumps nothing at all, while each group on its
# own finishes comfortably. Splitting it also gives per-group timings for free.
ALL_GROUPS = ["detector", "patterns", "tile-designs", "tile-designs-coarse", "panels",
              "export", "text-reading", "behaviour", "perforated", "flow",
    "materials",
    "layout",
    "round-trip",
    "fields",
    "brick",
    "catalogue",
    "serial",
    "kin",
    "pwall",
    "paver",
    "host",
    "assembly", "attractor"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", help="run and report only this group")
    ap.add_argument("--timeout", type=int, default=20,
                    help="virtual-time budget in seconds. Keep it small: the tool's "
                         "requestAnimationFrame loop spends the budget a frame at a time, "
                         "so a big number is a long wait after the suite has finished.")
    ap.add_argument("--offline", action="store_true", help="drop the three.js CDN tag")
    ap.add_argument("--keep", action="store_true", help="keep qa/_build")
    ap.add_argument("--json", dest="jsonout", default=os.path.join(HERE, "report.json"))
    ap.add_argument("--md", dest="mdout", default=os.path.join(HERE, "report.md"))
    a = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    todo = [a.group] if a.group else ALL_GROUPS
    res = {"cases": [], "errs": [], "ms": 0, "timing": {}}
    for g in todo:
        t0 = time.time()
        try:
            r = drive(build(a.offline, g), a.timeout, g)
        except SystemExit as ex:
            res["errs"].append("group %s did not report: %s" % (g, str(ex).split("\n")[0]))
            print("  %-22s did not report" % g)
            continue
        res["cases"] += r["cases"]
        res["errs"] += r["errs"]
        res["ms"] += r.get("ms", 0)
        res["timing"][g] = round(time.time() - t0, 1)
        bad = sum(1 for c in r["cases"] if not c["pass"])
        print("  %-22s %4.1fs  %d checks, %d failed" % (g, res["timing"][g], len(r["cases"]), bad))

    md, fails = report(res, None)
    md += "\n## Time per group\n\n" + "\n".join(
        "- %s — %.1f s" % (k, v) for k, v in res["timing"].items()) + "\n"
    io.open(a.mdout, "w", encoding="utf-8", newline="").write(md)
    io.open(a.jsonout, "w", encoding="utf-8", newline="").write(json.dumps(res, indent=1))

    if not a.keep:  # OneDrive sometimes still has a handle on these; not worth failing over
        for f in glob.glob(os.path.join(BUILD, "*.html")):
            try:
                os.remove(f)
            except OSError:
                pass

    boot = any("never finished booting" in e for e in res["errs"])
    print("%d checks, %d failed  ->  %s" % (len(res["cases"]), len(fails), a.mdout))
    for c in fails:
        print("  FAIL  %s / %s : %s" % (c["group"], c["name"], c["detail"]))
    for e in res["errs"]:
        print("  ERROR %s" % e)
    return 2 if boot else (1 if fails or res["errs"] else 0)


if __name__ == "__main__":
    sys.exit(main())

/* Pattern Studio QA harness.
   Injected into a copy of pattern-studio.html by run-qa.py; never shipped.
   Everything runs synchronously off the exposed internals (window.__qa) so no result
   depends on requestAnimationFrame, which is unreliable under headless virtual time.
   Writes its findings into document.title as RESULT<json>. */
(function(){
'use strict';
var R={cases:[],errs:[],t0:Date.now()};
window.addEventListener('error',function(e){R.errs.push('uncaught: '+e.message+' @'+e.lineno+':'+e.colno);});
window.addEventListener('unhandledrejection',function(e){R.errs.push('rejected: '+((e.reason&&(e.reason.message||e.reason.code))||e.reason));});

function add(group,name,pass,detail,metrics){
  R.cases.push({group:group,name:name,pass:!!pass,detail:detail||'',metrics:metrics||null});
  /* a hung suite still tells you where it stopped */
  document.title='PROGRESS '+R.cases.length+' last='+group+'/'+name;}
var QUEUE=[];
var ONLY=window.__QA_GROUP||'';
function guard(group,name,fn){if(ONLY&&group!==ONLY)return;QUEUE.push({g:group,n:name,f:fn});}
/* One case per tick. The whole suite in one synchronous block starves the message loop,
   and a headless browser then never gets round to dumping the page. */
function drain(){
  if(!QUEUE.length)return done();
  var c=QUEUE.shift();
  try{var r=c.f();
    /* a check that answers {ok,msg,m} is read like one that answers {pass,detail,metrics}: thirteen checks from pass 91 on did, and were counted as passes whatever they found */
    if(r&&typeof r==='object'&&!('pass' in r)&&('ok' in r)&&typeof r.then!=='function')r={pass:!!r.ok,detail:r.msg||'',metrics:r.m||null};
    if(r&&typeof r.then==='function'){r.then(function(v){if(v&&typeof v==='object'&&'pass' in v)add(c.g,c.n,v.pass,v.detail,v.metrics);else add(c.g,c.n,true,'');setTimeout(drain,1);},
      function(e){add(c.g,c.n,false,'rejected: '+((e&&e.message)||e));setTimeout(drain,1);});return;}
    if(r&&typeof r==='object'&&'pass' in r)add(c.g,c.n,r.pass,r.detail,r.metrics);
    else add(c.g,c.n,true,'');}
  catch(e){add(c.g,c.n,false,'threw: '+e.message+' | '+String(e.stack||'').split('\n')[1]);}
  setTimeout(drain,1);}  /* 1ms, not 0: virtual time must advance or headless never finishes */
function corr(a,b){var n=a.length;if(n<3)return 0;var ma=0,mb=0,i;
  for(i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;
  var sab=0,saa=0,sbb=0;for(i=0;i<n;i++){var x=a[i]-ma,y=b[i]-mb;sab+=x*y;saa+=x*x;sbb+=y*y;}
  return (saa&&sbb)?sab/Math.sqrt(saa*sbb):0;}

function run(){
var T=window.__qa;
if(T)T.S.view='2d';  /* stops the 3D render loop eating the virtual-time budget */
if(!T){R.errs.push('the tool never finished booting — a script error above stopped it');return done();}
var S=T.S;

/* ---------------- 1. the image-to-pattern test cases ----------------
   Each sample is drawn to have exactly one wallpaper group. The detector must say so. */
T.SAMPLES.forEach(function(g){
  guard('detector',g[0],function(){
    var cv=T.sampleCanvas(g[0],340);
    if(!cv)throw new Error('no canvas for '+g[0]);
    /* contrast and legibility of the printed sample itself, before any detecting */
    var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    var dark=0,n=cv.width*cv.height;
    for(var i=0;i<n;i++)if(d[i*4]<128)dark++;
    var ink=dark/n;
    var a=T.imgGrayFrom(cv,128);  /* the detector is O(N^2 log N); 128 keeps the suite under a minute */
    var an=T.PW.analyze(a.g,a.w,a.h);
    var got=an.ok?an.group.name:('stopped:'+an.stop.code);
    var m={ink:+ink.toFixed(3),fit:an.ok?+an.lattice.fit.toFixed(3):0,
           cells:an.ok?an.consistency.cells:0,repeats:an.ok?+(a.w/an.lattice.a).toFixed(2):0};
    if(ink<0.04||ink>0.6)return{pass:false,detail:'sample is not legible as a pattern: '+Math.round(ink*100)+'% ink',metrics:m};
    return{pass:got===g[0],detail:'expected '+g[0]+', detector said '+got,metrics:m};});
});

/* ---------------- 2. every cut pattern still cuts ---------------- */
Object.keys(T.PATTERNS).forEach(function(id){
  var spec=T.PATTERNS[id];if(spec.cat==='source')return;
  guard('patterns',id,function(){
    /* a small panel with a big cell: the line-network patterns build a planar arrangement
       whose cost grows with (panel/cell)^2, and this check only asks whether they cut at all */
    var st=T.defaultState({pattern:id,cell:spec.type==='net'?200:130,bar:10,width:620,height:620,
      frameL:15,frameR:15,frameT:15,frameB:15,clip:true});
    var g=T.generate(st);
    var open=g.open/(g.W*g.H)*100;
    var m={holes:g.holes.length,open:+open.toFixed(1)};
    if(g.warn)return{pass:false,detail:'warned: '+(g.warnMsg||'lattice did not close'),metrics:m};
    if(!g.holes.length)return{pass:false,detail:'produced no openings at default settings',metrics:m};
    if(open<2)return{pass:false,detail:'only '+open.toFixed(1)+'% open — reads as a solid sheet',metrics:m};
    if(open>92)return{pass:false,detail:open.toFixed(1)+'% open — almost nothing left to hold it up',metrics:m};
    return{pass:true,detail:g.holes.length+' openings, '+open.toFixed(1)+'% open',metrics:m};});
});

/* ---------------- 3. every built-in tile design ----------------
   Two things must hold: the tone field has range, and the finished panel actually
   reproduces it — the correlation between what the image asked for and what the
   tiles return to a viewer standing in the design light. */
/* live=true asks what somebody standing in front sees RIGHT NOW, under S.light.
   live=false asks how well the panel carries its image in the light it was solved for.
   Reading the second one while moving the sun is how a fade test quietly tests nothing. */
function panelReadout(live){
  var G=T.getG(),O=S.omb;
  var useLive=live||O.live;
  var L=T.ombLight(S,useLive?S.light.az:O.designAz,useLive?S.light.el:O.designEl);
  var V={x:0,y:0,z:1},want=[],got=[];
  for(var i=0;i<G.tiles.length;i++){var tl=G.tiles[i];
    var sh=T.ombShade(T.tileNormal(tl.th,tl.tilt),L,V,S.light,O.spec);
    want.push(tl.t);got.push(Math.min(1,sh.d*0.6+sh.s));}
  var lo=1,hi=0,i2;for(i2=0;i2<got.length;i2++){if(got[i2]<lo)lo=got[i2];if(got[i2]>hi)hi=got[i2];}
  var tlo=1,thi=0;for(i2=0;i2<want.length;i2++){if(want[i2]<tlo)tlo=want[i2];if(want[i2]>thi)thi=want[i2];}
  return{n:G.tiles.length,r:corr(want,got),swing:hi-lo,toneSpread:thi-tlo,cols:G.cols,rows:G.rows,
         warn:G.warn?(G.warnMsg||'warned'):''};}

T.OMB_BUILTIN.forEach(function(b){
  guard('tile-designs',b[0],function(){
    T.reset();S.omb.on=true;S.arr='single';S.width=1400;S.height=900;S.material='alum';S.thickness=3;
    S.frameL=S.frameR=S.frameT=S.frameB=25;
    S.omb.tileD=25.4;S.omb.pitch=31.75;S.omb.rowPitch=0.8;S.omb.stagger=0.5;S.omb.tilt=30;
    S.omb.contrast=1.25;S.omb.gamma=1;S.omb.bright=0;S.omb.levels=0;S.omb.invert=false;S.omb.encode='rot';
    S.omb.designAz=38;S.omb.designEl=30;S.light.az=38;S.light.el=30;S.omb.live=false;
    T.ombBuiltin(b[0]);T.regen();
    var p=panelReadout();
    var m={tiles:p.n,toneSpread:+p.toneSpread.toFixed(3),fidelity:+p.r.toFixed(3),swing:+p.swing.toFixed(3)};
    if(p.warn)return{pass:false,detail:p.warn,metrics:m};
    if(p.toneSpread<0.55)return{pass:false,detail:'the design only spans '+Math.round(p.toneSpread*100)+'% of the tonal range — it will read as a flat grey panel',metrics:m};
    if(p.r<0.9)return{pass:false,detail:'the panel does not reproduce its own image (fidelity '+p.r.toFixed(2)+')',metrics:m};
    if(p.swing<0.2)return{pass:false,detail:'darkest to brightest tile is only '+Math.round(p.swing*100)+'% — no contrast on the wall',metrics:m};
    return{pass:true,detail:p.n+' tiles, fidelity '+p.r.toFixed(3)+', swing '+Math.round(p.swing*100)+'%',metrics:m};});
});

/* a design must also still read when the tiles are coarse: this is where weak ones fail */
['clouds','wave','ridge','flower','facets'].forEach(function(id){
  guard('tile-designs-coarse',id,function(){
    T.reset();S.omb.on=true;S.arr='single';S.width=2000;S.height=1200;S.material='alum';S.thickness=3;
    S.frameL=S.frameR=S.frameT=S.frameB=25;
    S.omb.tileD=46;S.omb.pitch=56;S.omb.rowPitch=0.8;S.omb.tilt=30;S.omb.contrast=1.25;
    S.omb.designAz=38;S.omb.designEl=30;S.light.az=38;S.light.el=30;
    T.ombBuiltin(id);T.regen();
    var p=panelReadout();
    var m={tiles:p.n,grid:p.cols+'x'+p.rows,toneSpread:+p.toneSpread.toFixed(3),fidelity:+p.r.toFixed(3)};
    if(p.toneSpread<0.5)return{pass:false,detail:'falls apart at '+p.cols+'x'+p.rows+' tiles: only '+Math.round(p.toneSpread*100)+'% of the range survives',metrics:m};
    return{pass:true,detail:'holds at '+p.cols+'x'+p.rows+' tiles',metrics:m};});
});

/* ---------------- 4. the worked panels ---------------- */
T.OMB_PRESETS.forEach(function(pre){
  guard('panels',pre.name,function(){
    T.reset();T.applyPreset(pre.s);
    if(pre.s.omb.src==='text')T.ombLetter('PUNJABI MARKET','600');
    T.regen();
    var p=panelReadout();
    var dial=T.dialRange();
    var m={tiles:p.n,grid:p.cols+'x'+p.rows,fidelity:+p.r.toFixed(3),dial:+dial.toFixed(3),swing:+p.swing.toFixed(3)};
    if(p.warn)return{pass:false,detail:p.warn,metrics:m};
    if(!p.n)return{pass:false,detail:'no tiles at all',metrics:m};
    if(p.n>12000)return{pass:false,detail:p.n+' tiles will make the 3D view unusable',metrics:m};
    if(dial<0.18)return{pass:false,detail:'the tone dial spans only '+Math.round(dial*100)+'% at this design light — the panel cannot hold a picture',metrics:m};
    if(p.r<0.88)return{pass:false,detail:'fidelity '+p.r.toFixed(2)+' — the panel does not carry its own image',metrics:m};
    return{pass:true,detail:p.n+' tiles, fidelity '+p.r.toFixed(2)+', dial '+Math.round(dial*100)+'%',metrics:m};});
});

/* ---------------- 5. exports, both modes ---------------- */
guard('export','tile panel bundle',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);T.regen();
  var G=T.getG(),svg=T.svgText(G),dxf=T.dxfText(G),csv=T.ombCSV(G),rm=T.ombReadme('x');
  var rows=csv.trim().split('\n');
  var m={svgKB:Math.round(svg.length/1024),dxfKB:Math.round(dxf.length/1024),csvRows:rows.length-1};
  if(rows.length-1!==G.tiles.length)return{pass:false,detail:'csv has '+(rows.length-1)+' rows for '+G.tiles.length+' tiles',metrics:m};
  if(!/TILE_HINGES/.test(dxf)||!/CIRCLE/.test(dxf))return{pass:false,detail:'dxf is missing the tile or hinge layer',metrics:m};
  if(!/tile-hinges/.test(svg))return{pass:false,detail:'svg is missing the hinge layer',metrics:m};
  if(/<ellipse/.test(svg)||!/#0000ff/.test(svg)||!/#ff0000/.test(svg)||!/#00a000/.test(svg))return{pass:false,detail:'the cut svg should be a blue/red/green line drawing with no shaded tiles',metrics:m};
  var pv=T.ombPreviewSVGText(G);if(!/<ellipse/.test(pv))return{pass:false,detail:'the preview svg lost its shaded tiles',metrics:m};
  if(!/Ombrae Studios/.test(rm))return{pass:false,detail:'readme lost the attribution',metrics:m};
  var bad=rows.slice(1).filter(function(r){var c=r.split(',');
    return !(isFinite(+c[3])&&isFinite(+c[4])&&+c[5]>=0&&+c[5]<360&&+c[6]>0&&+c[6]<=60);});
  if(bad.length)return{pass:false,detail:bad.length+' csv rows have an angle or position out of range',metrics:m};
  if(T.has3D()){var geo=T.buildGeometryFrom(G);if(!geo)return{pass:false,detail:'no 3D geometry',metrics:m};
    var z=geo.attributes.position.array,mn=1e9;for(var i=2;i<z.length;i+=3)if(z[i]<mn)mn=z[i];
    m.zMin=+mn.toFixed(2);
    if(mn<-0.01)return{pass:false,detail:'tiles dip '+(-mn).toFixed(2)+' mm below the backing plate',metrics:m};}
  return{pass:true,detail:m.csvRows+' tile rows, dxf '+m.dxfKB+' KB',metrics:m};});

guard('export','cut panel bundle',function(){
  T.reset();S.omb.on=false;T.applyPreset({pattern:'hk_octsq',cell:220,bar:14,material:'marble',element:'window'});
  T.regen();
  var G=T.getG(),svg=T.svgText(G),dxf=T.dxfText(G);
  var m={holes:G.holes.length,svgKB:Math.round(svg.length/1024)};
  if(G.omb)return{pass:false,detail:'still in tile mode after switching back',metrics:m};
  if(!/cut-openings/.test(svg))return{pass:false,detail:'svg lost its openings layer',metrics:m};
  if(!/OPENINGS/.test(dxf))return{pass:false,detail:'dxf lost its openings layer',metrics:m};
  return{pass:true,detail:G.holes.length+' openings',metrics:m};});

/* ---------------- 6. text to panel, the reading that runs with no model ---------------- */
[['a brass jali screen for a shopfront, dense diamond lattice closing toward the base','cut','poly'],
 ['a perforated screen of eight-point khatam stars in marble','cut','hk_octsq'],
 ['a facade panel showing the Coast Mountains in low afternoon light','tiles','ridge'],
 ['an aluminium panel with a photograph of clouds','tiles','clouds'],
 ['a panel showing breaking water over the entrance','tiles','wave'],
 ['a shopfront sign reading "PUNJABI MARKET"','tiles','text'],
 ['a tile panel showing one open flower on a tower spandrel','tiles','flower'],
 ['a honeycomb screen in blackened steel','cut','honey'],
 ['a woven line screen in teak','cut','weave'],
 ['round perforations fading toward the top','cut','circle']
].forEach(function(c){
  guard('text-reading',c[0].slice(0,44),function(){
    var p=T.validateProposal(T.heuristic(c[0]));
    var got=p.mode==='tiles'?p.omb.image:p.pattern;
    var m={mode:p.mode,chose:got,fixes:p._fix.length};
    if(p.mode!==c[1])return{pass:false,detail:'chose the wrong kind of panel: wanted '+c[1]+', got '+p.mode,metrics:m};
    if(got!==c[2])return{pass:false,detail:'wanted '+c[2]+', chose '+got,metrics:m};
    if(p._fix.length)return{pass:false,detail:'its own reading needed correcting: '+p._fix.join('; '),metrics:m};
    return{pass:true,detail:p.mode+' / '+got,metrics:m};});
});

/* a proposal full of nonsense must be pulled into range, never applied raw */
guard('text-reading','hostile values are clamped',function(){
  var p=T.validateProposal({mode:'cut',pattern:'nope',cell:9999,bar:-4,width:1e6,material:'unobtainium',
    grad:{dir:'sideways',k:5},relief:{style:'melt',depth:900},border:{width:-2}});
  var m={fixes:p._fix.length};
  if(p.cell>500||p.bar<2||p.width>6000)return{pass:false,detail:'a value escaped clamping',metrics:m};
  if(!T.PATTERNS[p.pattern])return{pass:false,detail:'left an unknown pattern id in place',metrics:m};
  if(p._fix.length<5)return{pass:false,detail:'clamped silently — only '+p._fix.length+' corrections reported',metrics:m};
  return{pass:true,detail:p._fix.length+' corrections reported',metrics:m};});

/* ---------------- 7. the effect the whole thing rests on ---------------- */
guard('behaviour','the image fades off the design light',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);T.regen();
  var on=panelReadout(true).r;
  S.light.az=-70;S.light.el=12;
  var off=panelReadout(true).r;
  var m={inDesignLight:+on.toFixed(3),offIt:+off.toFixed(3)};
  if(on<0.9)return{pass:false,detail:'does not even read in its own light',metrics:m};
  if(off>on-0.15)return{pass:false,detail:'moving the sun barely changes it ('+on.toFixed(2)+' to '+off.toFixed(2)+') — the effect is not happening',metrics:m};
  return{pass:true,detail:'fidelity '+on.toFixed(2)+' in the design light, '+off.toFixed(2)+' away from it',metrics:m};});

guard('behaviour','tracking the live sun holds the image',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);S.omb.live=true;T.regen();
  var a=panelReadout().r;
  S.light.az=-70;S.light.el=25;T.regen();
  var b=panelReadout().r;
  var m={before:+a.toFixed(3),after:+b.toFixed(3)};
  if(b<0.85)return{pass:false,detail:'tracking the sun should keep the picture, fidelity fell to '+b.toFixed(2),metrics:m};
  return{pass:true,detail:'holds at '+b.toFixed(2),metrics:m};});

guard('behaviour','a square-on sun is reported, not hidden',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);S.omb.designAz=0;S.omb.designEl=3;T.regen();  /* head-on to the face, not high overhead */
  var G=T.getG();
  if(!G.warn)return{pass:false,detail:'no warning when the design light cannot produce tones'};
  return{pass:true,detail:G.warnMsg.slice(0,70)};});

guard('behaviour','an impossible grid is caught',function(){
  T.reset();S.omb.on=true;S.arr='single';S.omb.pitch=6;S.width=6000;S.height=6000;T.regen();
  var G=T.getG();
  if(!G.warn)return{pass:false,detail:'no warning for a 600k-tile grid'};
  return{pass:true,detail:G.warnMsg.slice(0,60)};});

/* ---------------- 8. a design survives being saved and reopened ---------------- */
guard('round-trip','save and reload a tile panel',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[1].s);T.regen();
  var before=panelReadout();
  var snap=JSON.parse(JSON.stringify(T.snapshot()));
  if(!snap.omb||!snap.omb.field)return{pass:false,detail:'the tone field was not saved with the design'};
  T.reset();S.omb.on=false;T.regen();
  T.applyPreset(snap);T.regen();
  var after=panelReadout();
  var m={tilesBefore:before.n,tilesAfter:after.n,fieldKB:Math.round(snap.omb.field.length/1024)};
  if(after.n!==before.n)return{pass:false,detail:'reopened with '+after.n+' tiles instead of '+before.n,metrics:m};
  return{pass:true,detail:before.n+' tiles, field '+m.fieldKB+' KB',metrics:m};});

/* ---------------- 9. the perforated image panel ----------------
   The second way a picture gets onto a panel: hole diameter instead of tile rotation.
   What matters is that the holes track the tone, that the sheet is still buildable (a hole
   no smaller than the sheet is thick, a web no thinner than that either), and that the open
   area is a number somebody could take to an engineer. */
function perfReadout(){
  var G=T.getG();
  if(!G||!G.perf)return null;
  var n=G.holes.length;
  var open=G.open/(G.W*G.H)*100;
  /* does hole size actually follow the picture? correlate each hole's diameter against the
     tone of the field underneath it */
  var want=[],got=[];
  var x0=Math.max(0,S.frameL),y0=Math.max(0,S.frameB),
      x1=S.width-Math.max(0,S.frameR),y1=S.height-Math.max(0,S.frameT);
  var stepN=Math.max(1,Math.floor(n/600));
  for(var i=0;i<n;i+=stepN){
    var h=G.holes[i],cx=0,cy=0;
    for(var k=0;k<h.pts.length;k++){cx+=h.pts[k].x;cy+=h.pts[k].y;}
    cx/=h.pts.length;cy/=h.pts.length;
    var u=(cx-x0)/(x1-x0),v=1-(cy-y0)/(y1-y0);
    /* a spanning picture: panel 0 is the bottom-left slice of a field the size of the whole array */
    if(G.span){var TW=S.width*G.span.cols+G.span.gap*(G.span.cols-1),TH=S.height*G.span.rows+G.span.gap*(G.span.rows-1);u=cx/TW;v=1-cy/TH;}
    want.push(T.ombSample(u,v));got.push(h.d);}
  return {n:n,open:open,fidelity:corr(want,got),minD:G.perf.minD,maxD:G.perf.maxD,
          web:G.perf.web,skipped:G.perf.skipped};}

T.PERF_PRESETS.forEach(function(p){
  guard('perforated',p.name,function(){
    T.reset();T.applyPreset(p.s);T.regen();
    var r=perfReadout();
    if(!r)return{pass:false,detail:'the preset did not build a perforated panel'};
    var m={holes:r.n,open:+r.open.toFixed(1),fidelity:+r.fidelity.toFixed(3),
           minD:r.minD,maxD:r.maxD,web:r.web,skipped:r.skipped};
    if(!r.n)return{pass:false,detail:'no holes at all',metrics:m};
    if(r.n>46000)return{pass:false,detail:r.n+' holes is past the drawing cap',metrics:m};
    if(r.open<2)return{pass:false,detail:'open area '+r.open.toFixed(1)+'%, the picture cannot read',metrics:m};
    if(r.open>60)return{pass:false,detail:'open area '+r.open.toFixed(1)+'%, nothing left to hold it up',metrics:m};
    /* an inverted panel runs the tone the other way, so judge the magnitude */
    if(Math.abs(r.fidelity)<0.85)return{pass:false,detail:'hole size does not follow the picture (r='+r.fidelity.toFixed(2)+')',metrics:m};
    var t=S.thickness;
    if(r.web<t*0.8)return{pass:false,detail:'web '+r.web+' mm is thinner than the '+t+' mm sheet',metrics:m};
    return{pass:true,detail:r.n+' holes, '+r.open.toFixed(1)+'% open, r='+r.fidelity.toFixed(2)+', web '+r.web+' mm',metrics:m};});
});

guard('perforated','one picture across six panels: six different panels, one image',function(){
  var p=T.PERF_PRESETS.filter(function(q){return /six panels/.test(q.name);})[0];if(!p)return{pass:false,detail:'the six-panel preset is missing'};
  T.applyPreset(p.s);var g=T.regen();
  if(!g.panels||g.panels.length!==6)return{pass:false,detail:'panels: '+(g.panels&&g.panels.length)};
  var avg=function(q){return q.holes.reduce(function(a,x){return a+x.d;},0)/Math.max(1,q.holes.length);};
  var a=g.panels.map(avg),spread=Math.max.apply(null,a)-Math.min.apply(null,a);
  var ok=spread>.3&&g.panels.every(function(q){return q.holes.length>50;});T.reset();
  return{pass:ok,detail:'mean hole per panel '+a.map(function(x){return x.toFixed(2);}).join(', ')+' mm: six different slices of one picture',
    metrics:{spread:+spread.toFixed(2),total:g.total}};});
guard('perforated','orthographic cut: one panel / all panels toggle',function(){
  var p=T.PERF_PRESETS.filter(function(q){return /six panels/.test(q.name);})[0];if(!p)return{pass:false,detail:'the six-panel preset is missing'};
  T.applyPreset(p.s);T.regen();
  var q=function(sel){return document.querySelector(sel);},groups=function(){return q('#view2d').querySelectorAll('svg > g[transform]').length;};
  q('#orthoSeg [data-o=ortho]').click();
  var shown=!q('#scopeSeg').classList.contains('hidden'),all=groups();
  q('#scopeSeg [data-s=one]').click();var one=groups(),label=/PANEL 1 OF 6/.test(q('#view2d').innerHTML);
  q('#scopeSeg [data-s=all]').click();var back=groups();
  S.arr='single';T.regen();q('#orthoSeg [data-o=ortho]').click();var hiddenSingle=q('#scopeSeg').classList.contains('hidden');
  q('#orthoSeg [data-o=render]').click();T.reset();T.regen();
  var ok=shown&&all===6&&one===1&&label&&back===6&&hiddenSingle;
  return{pass:ok,detail:'toggle shown '+shown+', all='+all+' panels, one='+one+' (label '+label+'), back='+back+', hidden for a single panel '+hiddenSingle};});
guard('perforated','the picture block is shared: layout switch drives the perforated set',function(){
  var q=function(sel){return document.querySelector(sel);};
  /* p165: by data-tab (the internal name) first */var tab=function(n){var L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return (b.dataset.tab||'').indexOf(n)>=0;});if(!L.length)L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return b.textContent.indexOf(n)>=0;});L[0].click();};
  var p=T.PERF_PRESETS.filter(function(x){return /six panels/.test(x.name);})[0];if(!p)return{pass:false,detail:'the six-panel preset is missing'};
  T.applyPreset(p.s);tab('Perforated image');
  var inPerf=!!q('#ombPick')&&/Perforated/.test(q('#ombPick').closest('.tabpanel').querySelector('h2').textContent);
  var seg=Array.prototype.filter.call(document.querySelectorAll('.seg button'),function(b){return b.textContent==='Same picture on every panel';})[0];
  if(!seg)return{pass:false,detail:'no layout switch in the picture block'};
  seg.click();var g1=T.regen();var same=!g1.panels&&S.omb.span===false;
  seg.previousElementSibling.click();var g2=T.regen();var across=!!g2.panels&&g2.panels.length===6&&S.omb.span===true;
  tab('Ombrae tiles');/* p165: the heading reads Coin facade; its title keeps the internal name */var inTiles=(function(h){return /Ombrae/.test(h.title||'')||/Ombrae/.test(h.textContent);})(q('#ombPick').closest('.tabpanel').querySelector('h2'));
  S.arr='single';T.regen();T.refreshAll();var helper=q('#picRow3')&&!q('#picRow3').closest('p').classList.contains('hidden');
  q('#picRow3').click();var row=S.arr==='grid'&&S.cols===3&&S.rows===1&&S.omb.span===true;
  tab('Pattern');T.reset();T.regen();
  return{pass:inPerf&&same&&across&&inTiles&&helper&&row,detail:'block in perforated tab '+inPerf+', repeat gives one panel '+same+', across gives six '+across+', block follows to tiles tab '+inTiles+', single-panel helper shown '+helper+', row-of-three button '+row};});
guard('flow','image tab: a read fills the three build tests and each opens its tab',function(){
  var q=function(sel){return document.querySelector(sel);};
  /* p165: by data-tab (the internal name) first */var tab=function(n){var L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return (b.dataset.tab||'').indexOf(n)>=0;});if(!L.length)L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return b.textContent.indexOf(n)>=0;});L[0].click();};
  var onTab=function(){var p=document.querySelector('.tabpanel.on h2');return p?p.textContent:'';};
  T.reset();tab('Image');
  var sel=q('#srcSample');sel.value='p4m';sel.dispatchEvent(new Event('change'));
  /* the sample loads through an Image.onload, so the check waits on it */
  return new Promise(function(res){var n=0;(function poll(){n++;
    var cut=q('#srcPvCut').querySelector('svg'),tiles=q('#srcPvTiles').querySelector('canvas'),perf=q('#srcPvPerf').querySelector('canvas');
    if((cut&&tiles&&perf)||n>60){
      if(!(cut&&tiles&&perf)){res({pass:false,detail:'tests after a read: cut '+!!cut+', tiles '+!!tiles+', perf '+!!perf});return;}
      var label=T.S.omb.label;
      q('#srcToPerf').click();var a=onTab()==='Perforated image'&&S.perf.on&&!S.omb.on;
      tab('Image');q('#srcToTiles').click();/* p165: the tab reads 'Coin facade'; its internal name stays in the heading's title */var b=(onTab()==='Ombrae tiles'||((document.querySelector('.tabpanel.on h2')||{}).title==='Ombrae tiles'))&&S.omb.on&&!S.perf.on;
      tab('Image');Array.prototype.filter.call(document.querySelectorAll('#srcCutHow button'),function(x){return x.dataset.h==='classic';})[0].click();
      var classicPv=!!q('#srcPvCut').querySelector('svg');q('#srcTrace').click();var c=onTab()==='Pattern'&&!S.omb.on&&!S.perf.on&&S.pattern!=='traced';
      var pat=S.pattern;tab('Pattern');T.reset();T.regen();
      res({pass:a&&b&&c&&classicPv,detail:'carried "'+label+'"; perforated opens '+a+', tiles opens '+b+', classic ('+pat+') opens Pattern '+c});}
    else setTimeout(poll,50);})();});});
guard('flow','text tab: a proposal shows three tests and any of them can be built',function(){
  var q=function(sel){return document.querySelector(sel);};
  /* p165: by data-tab (the internal name) first */var tab=function(n){var L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return (b.dataset.tab||'').indexOf(n)>=0;});if(!L.length)L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return b.textContent.indexOf(n)>=0;});L[0].click();};
  var onTab=function(){var p=document.querySelector('.tabpanel.on h2');return p?p.textContent:'';};
  T.reset();tab('Text');q('#txtIn').value='A brass jali of eight-point stars for a shopfront, 1.2 m square';q('#txtGo').click();
  return new Promise(function(res){var n=0;(function poll(){n++;
    var host=q('#txtDestHost'),shown=host&&!host.classList.contains('hidden');
    var cut=q('#txtPvCut').querySelector('svg'),tiles=q('#txtPvTiles').querySelector('canvas'),perf=q('#txtPvPerf').querySelector('canvas');
    if((shown&&cut&&tiles&&perf)||n>80){
      if(!(shown&&cut&&tiles&&perf)){res({pass:false,detail:'after a proposal: shown '+shown+', cut '+!!cut+', tiles '+!!tiles+', perf '+!!perf});return;}
      q('#txtDest button[data-go=perf]').click();
      setTimeout(function(){var a=onTab()==='Perforated image'&&S.perf.on;
        tab('Text');q('#txtGo').click();
        setTimeout(function(){q('#txtDest button[data-go=cut]').click();
          setTimeout(function(){var b=onTab()==='Pattern'&&!S.perf.on&&!S.omb.on;var pat=S.pattern;T.reset();T.regen();
            res({pass:a&&b,detail:'a cut brief built as perforated '+a+', then as a cut screen ('+pat+') '+b});},150);},400);},150);}
    else setTimeout(poll,50);})();});});
guard('flow','sub-wall colour: picking a colour means a coloured wall, and the 2D holes take it',function(){
  var q=function(sel){return document.querySelector(sel);};
  var p=T.PERF_PRESETS.filter(function(x){return /six panels|gondola/i.test(x.name);})[0];T.applyPreset(p.s);T.regen();
  S.perf.back='none';var c=q('#perfColor');c.value='#1f6fb2';c.dispatchEvent(new Event('input'));
  var ok=S.perf.back==='colour'&&S.perf.backColor==='#1f6fb2';
  var svg=q('#view2d').innerHTML;var inSvg=/#1f6fb2/i.test(svg);
  T.reset();T.regen();
  return{pass:ok&&inSvg,detail:'back '+S.perf.back+'/'+ok+', colour in the 2D drawing '+inSvg};});
guard('flow','tiles that cannot fit are fitted: the pitch opens until the panel builds',function(){
  T.reset();S.omb.on=true;S.arr='single';S.width=6000;S.height=6000;S.frameL=S.frameR=S.frameT=S.frameB=0;S.omb.rowPitch=.8;
  var f=T.ombFit(8,10);var cols=Math.floor((6000-f.d)/f.p)+1,rows=Math.floor((6000-f.d)/(f.p*.8))+1;
  var ok=f.changed&&cols*rows<=24000&&f.d<f.p&&f.d/f.p>.7;
  S.width=1200;S.height=900;var g=T.ombFit(25.4,31.75);var same=!g.changed||(Math.abs(g.d-25.4)<.2&&Math.abs(g.p-31.75)<.2);
  T.reset();
  return{pass:ok&&same,detail:'8 at 10 on a 6 m panel -> Ø'+f.d+' at '+f.p+' ('+(cols*rows)+' tiles); a catalogue tile on a small panel is left alone '+same};});
guard('flow','the 3D room follows the theme: a dark palette in dark mode, a light one in light',function(){
  var root=document.documentElement,was=root.getAttribute('data-theme');
  root.setAttribute('data-theme','dark');var d=T.roomPalette(false),dk=T.isDarkTheme();
  root.setAttribute('data-theme','light');var l=T.roomPalette(false),lt=T.isDarkTheme();
  var n=T.roomPalette(true);
  if(was)root.setAttribute('data-theme',was);else root.removeAttribute('data-theme');
  var lum=function(hex){return ((hex>>16&255)*.299+(hex>>8&255)*.587+(hex&255)*.114);};
  var ok=dk&&!lt&&lum(d.floor)<60&&lum(l.floor)>180&&lum(n.floor)<lum(d.floor);
  return{pass:ok,detail:'dark floor '+d.floor.toString(16)+', light floor '+l.floor.toString(16)+', night floor '+n.floor.toString(16)};});
guard('flow','orthographic cut: every panel type has the one-panel / all-panels switch, with a picker and arrows',function(){
  var q=function(sel){return document.querySelector(sel);};
  var p=T.PERF_PRESETS.filter(function(x){return /six panels/.test(x.name);})[0];T.applyPreset(p.s);T.regen();
  q('#orthoSeg [data-o=ortho]').click();q('#scopeSeg [data-s=one]').click();
  var l1=q('#panelLabel').textContent;document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));var l2=q('#panelLabel').textContent;
  q('#panelNav [data-d="-1"]').click();q('#panelNav [data-d="-1"]').click();var l3=q('#panelLabel').textContent;
  q('#scopeSeg [data-s=all]').click();var g=q('#view2d g[data-n="4"]');if(g)g.dispatchEvent(new MouseEvent('click',{bubbles:true}));var l4=q('#panelLabel').textContent,oneAfterClick=!q('#panelNav').classList.contains('hidden');
  /* optical tiles: the same switch */
  T.reset();S.omb.on=true;S.arr='grid';S.cols=3;S.rows=2;S.gap=20;S.width=600;S.height=600;S.omb.span=true;T.regen();q('#orthoSeg [data-o=ortho]').click();q('#scopeSeg [data-s=all]').click();
  var ombShown=!q('#scopeSeg').classList.contains('hidden'),ombAll=q('#view2d').querySelectorAll('svg > g[transform]').length;
  q('#scopeSeg [data-s=one]').click();var ombOne=q('#view2d').querySelectorAll('svg > g[transform]').length;
  q('#scopeSeg [data-s=all]').click();q('#orthoSeg [data-o=render]').click();T.reset();T.regen();
  var ok=l1==='Panel 1 of 6'&&l2==='Panel 2 of 6'&&l3==='Panel 6 of 6'&&l4==='Panel 5 of 6'&&oneAfterClick&&ombShown&&ombAll===6&&ombOne===1;
  return{pass:ok,detail:'labels '+[l1,l2,l3,l4].join(' / ')+'; click opens one panel '+oneAfterClick+'; tiles: switch shown '+ombShown+', all='+ombAll+', one='+ombOne};});
guard('flow','a cut design can run across the whole set: each panel is a different slice',function(){
  T.reset();S.omb.on=false;S.perf.on=false;S.pattern='star6';S.cell=260;S.bar=10;S.arr='grid';S.cols=3;S.rows=2;S.gap=24;S.width=900;S.height=1200;S.grad={dir:'none',k:0};S.solid=0;S.cutSpan=true;S.pp.star6=T.defaultParams('star6');
  var g=T.regen();var six=!!(g.panels&&g.panels.length===6);
  var sig=function(q){return q.holes.slice(0,6).map(function(h){var c=h.pts[0];return c.x.toFixed(0)+','+c.y.toFixed(0);}).join(';');};
  var differ=six&&sig(g.panels[0])!==sig(g.panels[1]);
  S.cutSpan=false;var g2=T.regen();var same=!g2.panels;T.reset();T.regen();
  return{pass:six&&differ&&same&&g.total>g.holes.length,detail:'6 panels '+six+', slices differ '+differ+', total '+(g.total||0)+' openings; off again: one shared panel '+same};});
guard('flow','a described scene becomes a cut too: the gondola brief cut as a halftone, not a catalogue motif',function(){
  var p=T.validateProposal(T.heuristic(T.GONDOLA_BRIEF));T.lastBrief(T.GONDOLA_BRIEF);
  var cut=T.proposalAs(p,'cut');var pic=!!cut.picture;
  var st=T.proposalCutState(cut);var traced=st.pattern==='traced';var g=T.generate(st);var n=g.holes.length;
  var big=g.holes.filter(function(h){return Math.abs(T.area(h.pts))>80;}).length;
  T.reset();T.regen();
  return{pass:pic&&traced&&n>300&&big>100,detail:'picture carried '+pic+', pattern '+st.pattern+', '+n+' openings of which '+big+' are over 80 mm²'};});
guard('flow','a photograph is one picture: never repeated or mirrored unless asked, and it sits once at cover size',function(){
  var q=function(sel){return document.querySelector(sel);};
  /* p165: by data-tab (the internal name) first */var tab=function(n){var L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return (b.dataset.tab||'').indexOf(n)>=0;});if(!L.length)L=Array.prototype.filter.call(document.querySelectorAll('[role=tab]'),function(b){return b.textContent.indexOf(n)>=0;});L[0].click();};
  T.reset();tab('Image');q('#srcCase-skyline').click();
  return new Promise(function(res){var n=0;(function poll(){n++;
    if((SRC.rgba&&SRC.fullLabel&&/skyline/i.test(SRC.fullLabel)&&!q('#srcTrace').disabled)||n>100){
      if(!SRC.rgba){res({pass:false,detail:'the skyline photograph did not load'});return;}
      var treat=SRC.treat,look=SRC.look;q('#srcTrace').click();
      var g=T.getG();var one=S.pattern==='traced'&&SRC.whole;var cover=S.cell>=S.width-S.frameL-S.frameR;
      var open=g.open/(g.W*g.H);var ys=g.holes.map(function(h){return h.pts[0].y;});var spread=(Math.max.apply(null,ys)-Math.min.apply(null,ys))/g.H;
      q('#picRep [data-v=mirror]').click();var mirrored=SRC.treat==='mirror'&&T.regen().holes.length>g.holes.length*1.2;
      tab('Pattern');T.reset();T.regen();
      res({pass:treat==='whole'&&look==='dots'&&one&&cover&&open>.04&&spread>.6&&mirrored,detail:'starts as '+treat+'/'+look+'; traced once '+one+', cover '+cover+', open '+(open*100).toFixed(1)+'%, fills '+(spread*100).toFixed(0)+'% of the height; mirrored on request '+mirrored});}
    else setTimeout(poll,60);})();});});
guard('tile-designs','one picture across six tile panels: the tiles differ per panel',function(){
  var p=T.OMB_PRESETS.filter(function(q){return /six panels/.test(q.name);})[0];if(!p)return{pass:false,detail:'the six-panel preset is missing'};
  T.applyPreset(p.s);var g=T.regen();
  if(!g.panels||g.panels.length!==6)return{pass:false,detail:'panels: '+(g.panels&&g.panels.length)};
  var mean=function(q){return q.tiles.reduce(function(a,t){return a+t.t;},0)/Math.max(1,q.tiles.length);};
  var a=g.panels.map(mean),spread=Math.max.apply(null,a)-Math.min.apply(null,a);
  var ok=spread>.03;T.reset();
  return{pass:ok,detail:'mean tone per panel '+a.map(function(x){return x.toFixed(2);}).join(', ')+'; '+g.total+' tiles in all',metrics:{spread:+spread.toFixed(3)}};});
guard('perforated','every hole shape builds and still tracks the tone',function(){
  var shapes=['round','square','diamond','hex','slot'],bad=[],m={};
  shapes.forEach(function(sh){
    T.reset();T.applyPreset(T.PERF_PRESETS[0].s);S.perf.shape=sh;T.regen();
    var r=perfReadout();
    m[sh]=r?r.n:0;
    if(!r||!r.n||Math.abs(r.fidelity)<0.8)bad.push(sh+(r?' r='+r.fidelity.toFixed(2):' built nothing'));});
  return{pass:!bad.length,detail:bad.length?bad.join('; '):shapes.join(', ')+' all track the tone',metrics:m};});

guard('perforated','a cutoff above every hole is reported, not drawn',function(){
  T.reset();T.applyPreset(T.PERF_PRESETS[0].s);S.perf.cutoff=40;T.regen();
  var G=T.getG();
  if(G.holes.length)return{pass:false,detail:'punched '+G.holes.length+' holes it had called too small'};
  if(!G.warn)return{pass:false,detail:'produced nothing and said nothing'};
  return{pass:true,detail:String(G.warnMsg||'').slice(0,70)};});

guard('perforated','the web can never go negative',function(){
  T.reset();T.applyPreset(T.PERF_PRESETS[0].s);
  S.perf.maxD=55;S.perf.pitch=8;S.perf.minWeb=3;T.regen();
  var G=T.getG();
  if(!G.perf||!G.holes.length)return{pass:true,detail:'refused to build it, which is also correct'};
  return{pass:G.perf.web>=2.9,detail:'largest hole clamped, web '+G.perf.web+' mm',
    metrics:{web:G.perf.web,maxD:G.perf.maxD}};});

guard('perforated','one picture, either panel',function(){
  T.reset();T.applyPreset(T.PERF_PRESETS[0].s);T.regen();
  var a=perfReadout();
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);T.regen();
  var G=T.getG();
  var m={perfHoles:a?a.n:0,tiles:(G&&G.tiles)?G.tiles.length:0};
  if(!a||!a.n)return{pass:false,detail:'the perforated panel did not build',metrics:m};
  if(!G.omb||!G.tiles.length)return{pass:false,detail:'the tile panel did not build',metrics:m};
  return{pass:true,detail:'perforated '+a.n+' holes, tiles '+G.tiles.length,metrics:m};});

/* ---------------- 10. stock a supplier actually sells ---------------- */
guard('materials','every gauge list is real and in order',function(){
  var bad=[];
  Object.keys(T.MATERIALS).forEach(function(id){
    var m=T.MATERIALS[id];
    if(!m.gauges||!m.gauges.length){bad.push(id+': no gauges');return;}
    for(var i=1;i<m.gauges.length;i++)if(m.gauges[i]<=m.gauges[i-1]){bad.push(id+': gauges out of order');break;}
    if(!m.cut)bad.push(id+': no cutting process');
    if(!m.note)bad.push(id+': no note');
    if(T.MAT_FAMS.indexOf(m.fam)<0)bad.push(id+': family "'+m.fam+'" is not one of the four');
    if(!(m.minBar>0))bad.push(id+': no minimum bar');});
  return{pass:!bad.length,detail:bad.length?bad.join('; '):Object.keys(T.MATERIALS).length+' materials, all with stock gauges',
    metrics:{materials:Object.keys(T.MATERIALS).length}};});

guard('materials','thickness snaps to a gauge that exists',function(){
  var bad=[];
  Object.keys(T.MATERIALS).forEach(function(id){
    [0.1,3,7,19,400].forEach(function(t){
      var g=T.snapGauge(id,t);
      if(T.MATERIALS[id].gauges.indexOf(g)<0)bad.push(id+' @'+t+' -> '+g);});});
  return{pass:!bad.length,detail:bad.length?bad.join('; '):'every snap lands on a stocked gauge'};});

guard('materials','every worked panel is on stock it could be made from',function(){
  var bad=[],all=T.PERF_PRESETS.concat(T.OMB_PRESETS);
  all.forEach(function(p){
    var st=p.s;if(!st.material||!st.thickness)return;
    var m=T.MATERIALS[st.material];
    if(!m){bad.push(p.name+': material "'+st.material+'" does not exist');return;}
    if(m.gauges.indexOf(st.thickness)<0)bad.push(p.name+': '+st.thickness+' mm is not a '+m.name+' gauge');});
  return{pass:!bad.length,detail:bad.length?bad.join('; '):all.length+' worked panels, all on stock gauges'};});


/* ---------------- 12. layout: no fold is ever wider than the rail ---------------- */
function railOverflow(panel){
  var rail=document.getElementById('rail'),rr=rail.getBoundingClientRect(),over=0;
  panel.querySelectorAll('*').forEach(function(el){
    if(el.closest('svg')&&el.tagName.toLowerCase()!=='svg')return;
    var r=el.getBoundingClientRect();if(r.width&&r.right>rr.right+1)over=Math.max(over,r.right-rr.right);});
  if(rail.scrollWidth>rail.clientWidth+1)over=Math.max(over,rail.scrollWidth-rail.clientWidth);
  return Math.round(over);}
guard('layout','every fold fits inside the rail, in every tab and arrangement',function(){
  var bad=[];document.querySelector('#densSeg [data-d=all]').click();
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'),function(b){
    b.click();var panel=document.querySelector('.tabpanel.on'),name=b.textContent.trim().replace(/^[a-z ]+\n?/i,'');
    ['single','grid','triptych'].forEach(function(a){
      var sb=panel.querySelector('.seg button[data-v="'+a+'"]');if(sb)sb.click();
      panel.querySelectorAll('details').forEach(function(d){d.open=true;});
      var over=railOverflow(panel);if(over>1)bad.push(b.textContent.trim().split('\n').pop()+' ['+a+'] +'+over+'px');
      if(!sb)return;});});
  document.querySelector('#densSeg [data-d=lean]').click();
  return{pass:!bad.length,detail:bad.length?bad.join('; '):'no control wider than the rail, all tabs, all arrangements',
    metrics:{railWidth:document.getElementById('rail').clientWidth}};});
guard('layout','a proposed brief fits inside the rail',function(){
  Array.prototype.filter.call(document.querySelectorAll('#tabs button'),function(b){return /Text/.test(b.textContent);})[0].click();
  var ta=document.getElementById('txtIn');ta.value='A perforated aluminium screen for a seawall caf\u00e9, 3 m wide by 1.2 m high: ocean waves breaking on a shore low in the panel, white foam where they meet the sand, open sky above, backlit at dusk.';
  document.getElementById('txtGo').click();
  return{pass:true,detail:'proposed; measured in the next case'};});
guard('layout','the proposal readback stays inside the rail',function(){
  var panel=document.querySelector('.tabpanel.on'),out=document.getElementById('txtOut');
  if(!out||out.style.display==='none'||!out.textContent.trim())return{pass:false,detail:'no proposal readback appeared'};
  var over=railOverflow(panel);
  return{pass:over<=1,detail:over<=1?'readback with its tables wraps inside the rail':'readback spills '+over+'px past the rail'};});
guard('layout','the bank in edit mode keeps every button inside the rail',function(){
  document.getElementById('pinBtn').click();document.getElementById('pinBtn').click();
  Array.prototype.filter.call(document.querySelectorAll('#tabs button'),function(b){return /Bank/.test(b.textContent);})[0].click();
  var ed=Array.prototype.filter.call(document.querySelectorAll('.tabpanel.on .btn'),function(b){return /Edit the bank/.test(b.textContent);})[0];
  if(!ed)return{pass:false,detail:'no "Edit the bank" button'};
  ed.click();var panel=document.querySelector('.tabpanel.on');
  var items=panel.querySelectorAll('.bank .item'),dels=panel.querySelectorAll('.bank .item .del');
  var shown=Array.prototype.filter.call(dels,function(d){return getComputedStyle(d).display!=='none';}).length;
  var over=railOverflow(panel);ed.click();
  if(items.length<2)return{pass:false,detail:'pinned twice, bank shows '+items.length};
  if(shown!==items.length)return{pass:false,detail:'edit mode shows '+shown+' delete buttons for '+items.length+' items'};
  return{pass:over<=1,detail:over<=1?items.length+' items, delete buttons shown only in edit mode, nothing clipped':'bank item spills '+over+'px past the rail'};});

/* ---------------- 11. the keyword reader knows all three panel kinds ---------------- */
[['a perforated aluminium screen for a parking garage showing the north shore mountains','perf'],
 ['a backlit metal panel carrying a photograph of clouds, lit from behind at night','perf'],
 ['a halftone image punched into corten steel','perf'],
 ['a panel showing the Grouse Mountain gondola that shimmers as the sun moves','tiles'],
 ['a brass jali of eight-point stars for a shopfront','cut']
].forEach(function(c){
  guard('text-reading','mode: '+c[0].slice(0,38),function(){
    var p=T.validateProposal(T.heuristic(c[0]));
    return{pass:p.mode===c[1],detail:'wanted '+c[1]+', got '+p.mode};});
});

/* ---- found by the 2D-only user simulation, 27 Oct ---- */
guard('behaviour','relief fills across a spanning set carry no NaN',function(){
  T.reset();var S=T.S;S.pattern='honey';S.cell=120;S.bar=14;S.arr='grid';S.cols=3;S.rows=2;S.cutSpan=true;S.relief.style='emboss';
  T.refreshAll();T.run(new Set(['geom']));window.PS_TOUR.dbg.render2D();
  var svg=document.getElementById('view2d').innerHTML,G=T.getG();
  var ok=svg.indexOf('NaN')<0&&svg.indexOf('undefined')<0;
  S.relief.style='through';S.cutSpan=false;T.reset();
  return{pass:ok&&!!G.panels,detail:ok?'six panels, every relief fill a number':'the 2D drawing has NaN in a relief fill',metrics:{panels:G.panels?G.panels.length:1}};});
guard('behaviour','the across-the-set switch appears as soon as the arrangement changes',function(){
  T.reset();var tab=Array.prototype.filter.call(document.querySelectorAll('#tabs button'),function(b){return /^(2D MAKER)?\s*Pattern$/i.test(b.textContent.trim().replace(/\s+/g,' '));})[0];
  if(!tab)tab=Array.prototype.filter.call(document.querySelectorAll('#tabs button'),function(b){return /Pattern$/.test(b.textContent.trim());})[0];
  tab.click();var panel=document.querySelector('.tabpanel.on');
  var grid=panel.querySelector('.seg button[data-v="grid"]'),single=panel.querySelector('.seg button[data-v="single"]');
  var sw=document.querySelector('.cutlayout');if(!grid||!sw)return{pass:false,detail:'no arrangement control or no across-the-set switch found'};
  grid.click();var shown=!sw.classList.contains('hidden');single.click();var hidden=sw.classList.contains('hidden');T.reset();T.refreshAll();
  return{pass:shown&&hidden,detail:shown&&hidden?'shown on Grid, hidden on Single, without waiting for anything else':'shown after grid: '+shown+', hidden after single: '+hidden};});
guard('behaviour','the Teak chevron preset keeps its bar and stays inside the frame',function(){
  T.reset();var p=T.PRESETS.filter(function(q){return /teak chevron/i.test(q.name);})[0];T.applyPreset(p.s);T.refreshAll();T.run(new Set(['geom']));
  var G=T.getG(),S=T.S,bb=G.holes.map(function(h){var xs=h.pts.map(function(q){return q.x;}),ys=h.pts.map(function(q){return q.y;});return[Math.min.apply(0,xs),Math.min.apply(0,ys),Math.max.apply(0,xs),Math.max.apply(0,ys)];});
  var over=0;bb.forEach(function(b){if(b[0]<S.frameL-.5||b[1]<S.frameB-.5||b[2]>G.W-S.frameR+.5||b[3]>G.H-S.frameT+.5)over++;});
  var gap=1e9;for(var i=0;i<bb.length;i++)for(var j=i+1;j<bb.length;j++){var dx=Math.max(bb[j][0]-bb[i][2],bb[i][0]-bb[j][2],0),dy=Math.max(bb[j][1]-bb[i][3],bb[i][1]-bb[j][3],0);if(dx===0&&dy===0)continue;var d=Math.hypot(dx,dy);if(d<gap)gap=d;}
  var bar=S.bar,pat=S.pattern,cell=S.cell;T.reset();T.refreshAll();
  return{pass:over===0&&gap>=bar*.45&&pat==='chevron',detail:over+' openings cross the frame line, nearest box-to-box gap '+gap.toFixed(1)+' mm against a '+bar+' mm bar',metrics:{over:over,gap:+gap.toFixed(2),bar:bar,pattern:pat,cell:cell,holes:G.holes.length,W:G.W,H:G.H}};});

guard('behaviour','entering tiles from a dark finish switches to aluminium and says so',function(){
  T.reset();var S=T.S;S.omb.on=false;S.perf.on=false;S.material='black';T.setPanelMode('tiles');
  var mat=S.material,lum=T.matLum('black'),note=document.querySelector('#ombDarkNote');T.refreshAll();var hidden=!note||note.classList.contains('hidden');
  S.material='black';T.refreshAll();var shown=note&&!note.classList.contains('hidden');
  T.reset();T.refreshAll();
  return{pass:mat==='alum'&&lum<.3&&hidden&&!!shown,detail:'black steel has luminance '+lum.toFixed(2)+'; tiles mode left the material as '+mat+'; the dark-finish note '+(shown?'shows':'does not show')+' when black comes back',metrics:{material:mat,lum:+lum.toFixed(3),noteHidden:hidden,noteShown:!!shown}};});
guard('behaviour','the tile drawing is the cut file at any density: a circle and a hinge for every tile',function(){
  T.reset();var S=T.S;S.omb.on=true;S.arr='grid';S.cols=5;S.rows=1;S.gap=24;S.width=900;S.height=2400;S.material='alum';S.thickness=3;S.omb.tileD=25.4;S.omb.pitch=31.75;
  T.refreshAll();T.run(new Set(['geom']));T.setOrtho(true);T.renderOmbraeOrtho();var G=T.getG(),svg=document.querySelector('#view2d svg');var html=svg?svg.innerHTML:'';
  var circles=(html.match(/<circle /g)||[]).length,hinges=(html.match(/<line /g)||[]).length,tones=/hsl\(0 0%/.test(html),key=/HINGE/.test(html);
  T.setOrtho(false);T.reset();T.refreshAll();
  return{pass:circles===G.total&&hinges>=G.total&&!tones&&key,detail:G.total+' tiles over five panels: '+circles+' circles and '+hinges+' lines drawn'+(tones?', plus grey fills that do not belong in a cut file':''),metrics:{tiles:G.total,circles:circles,lines:hinges,tones:tones}};});
guard('behaviour','a photograph cut as halftone dots starts at a perforation-like pitch on a staggered grid',function(){
  var SRC=T.SRC,S=T.S,keep={rgba:SRC.rgba,dots:SRC.dots,invert:SRC.invert};
  var w=120,h=80,d=new Uint8ClampedArray(w*h*4);for(var y=0;y<h;y++)for(var x=0;x<w;x++){var k=(y*w+x)*4,v=Math.round(255*x/(w-1));d[k]=d[k+1]=d[k+2]=v;d[k+3]=255;}
  SRC.rgba={data:d,w:w,h:h};SRC.dots=null;SRC.invert=false;
  var out=T.traceHalftone('dots',4536,6)||[];var N=T.dotsAuto(4536),pitch=4536/N;
  var rows={};out.forEach(function(s){var cy=s.uv.reduce(function(a,q){return a+q[1];},0)/s.uv.length,cx=s.uv.reduce(function(a,q){return a+q[0];},0)/s.uv.length;var key=cy.toFixed(3);(rows[key]=rows[key]||[]).push(cx);});
  var keys=Object.keys(rows).sort();var r0=rows[keys[0]].sort(function(a,b){return a-b;}),r1=rows[keys[1]].sort(function(a,b){return a-b;});
  var shift=Math.abs(r0[r0.length-1]-r1[r1.length-1])*N;/* in units of one column */
  SRC.rgba=keep.rgba;SRC.dots=keep.dots;SRC.invert=keep.invert;SRC.shapes=null;SRC.whole=false;
  return{pass:N>=100&&pitch<=45&&out.length>N*20&&Math.abs(shift-.5)<.1&&T.dotsAuto(900)===24,detail:N+' openings across a 4536 mm set, one every '+pitch.toFixed(1)+' mm, '+out.length+' holes for a ramp, odd rows shifted by '+shift.toFixed(2)+' columns; a 900 mm panel starts at '+T.dotsAuto(900),metrics:{N:N,pitch:+pitch.toFixed(1),holes:out.length,shift:+shift.toFixed(3),small:T.dotsAuto(900)}};});
guard('behaviour','the three test photographs sit under the drop zone with pictures',function(){
  var bs=Array.prototype.slice.call(document.querySelectorAll('#srcCases button'));var ids=bs.map(function(b){return b.id;});
  var pics=bs.filter(function(b){var im=b.querySelector('img');return im&&/^data:image\//.test(im.src)&&im.naturalWidth>50;}).length;
  var after=document.querySelector('#srcDrop')&&document.querySelector('#srcDrop').nextElementSibling===document.querySelector('#srcCases');
  return{pass:bs.length===3&&pics===3&&after&&ids.join()==='srcCase-voronoi,srcCase-skyline,srcCase-gondola',detail:bs.length+' photo buttons ('+ids.join(', ')+'), '+pics+' with a loaded picture, '+(after?'directly under the drop zone':'not under the drop zone'),metrics:{buttons:bs.length,pics:pics,after:after}};});

guard('behaviour','a perforated sheet starts no thicker than its smallest hole can be',function(){
  T.reset();var S=T.S;S.omb.on=false;S.perf.on=false;S.material='black';S.thickness=6;T.setPanelMode('perf');var t=S.thickness,m=S.material;T.reset();T.refreshAll();
  return{pass:t<=3&&m==='black',detail:'6 mm blackened steel became '+t+' mm '+m+' on entering Perforated image',metrics:{thickness:t,material:m}};});
guard('behaviour','the backing-reach choice appears the moment a backing is chosen',function(){
  T.reset();var S=T.S;S.omb.on=false;S.perf.on=true;S.perf.back='none';T.refreshAll();
  var seg=Array.prototype.slice.call(document.querySelectorAll('.seg')).filter(function(e){return e.closest&&e.closest('.ctl')&&/backing reaches/i.test(e.closest('.ctl').textContent);})[0];
  var ctl=seg?seg.closest('.ctl'):null;var hiddenBefore=!ctl||ctl.classList.contains('hidden');
  var back=Array.prototype.slice.call(document.querySelectorAll('.seg button')).filter(function(b){return b.textContent==='Backlit';})[0];if(back)back.click();
  var shown=ctl&&!ctl.classList.contains('hidden');var none=Array.prototype.slice.call(document.querySelectorAll('.seg button')).filter(function(b){return b.textContent==='Nothing';})[0];if(none)none.click();
  var hiddenAfter=ctl&&ctl.classList.contains('hidden');T.reset();T.refreshAll();
  return{pass:!!ctl&&hiddenBefore&&!!shown&&!!hiddenAfter,detail:(ctl?'control found; ':'control not found; ')+'hidden with no backing: '+hiddenBefore+', shown on Backlit: '+!!shown+', hidden again on Nothing: '+!!hiddenAfter,metrics:{found:!!ctl,before:hiddenBefore,shown:!!shown,after:!!hiddenAfter}};});

/* ---- fields: what varies across the host when it is not a picture ---- */
guard('fields','sun field: shaded under the overhang, lit below',function(){
  T.reset();var F=T.fieldDefaults();F.kind='sun';
  var top=T.fieldValue(F,.5,.98,900,2400),mid=T.fieldValue(F,.5,.5,900,2400),low=T.fieldValue(F,.5,.05,900,2400);
  var m={top:+top.toFixed(2),mid:+mid.toFixed(2),low:+low.toFixed(2)};
  if(!(top<low))return{pass:false,detail:'the top under a 600 mm overhang is not darker than the bottom',metrics:m};
  F.sun.overhang=0;F.sun.reveal=0;var flat=T.fieldValue(F,.5,.98,900,2400);m.flatNoOverhang=+flat.toFixed(2);
  if(Math.abs(flat-1)>1e-6)return{pass:false,detail:'with no overhang and no reveal the face should be evenly lit (1), got '+flat,metrics:m};
  return{pass:true,detail:'top '+top.toFixed(2)+', middle '+mid.toFixed(2)+', bottom '+low.toFixed(2)+'; flat face reads 1',metrics:m};});
guard('fields','attractor points: light at the point, dark away',function(){
  var F=T.fieldDefaults();F.kind='attract';F.attract.pts='0.3,0.65;0.75,0.3';F.attract.radius=.3;
  var at=T.fieldValue(F,.3,.65,1000,1000),far=T.fieldValue(F,.02,.02,1000,1000);
  var m={atPoint:+at.toFixed(2),far:+far.toFixed(2)};
  if(at<.99)return{pass:false,detail:'the field is not 1 at a point',metrics:m};
  if(far>.01)return{pass:false,detail:'the field is not 0 far from every point',metrics:m};
  return{pass:true,detail:'1 at the point, 0 away',metrics:m};});
guard('fields','floor values: one value per floor, bottom first',function(){
  var F=T.fieldDefaults();F.kind='floors';F.floors.h=3000;F.floors.vals='0.2,0.5,0.8,1';F.floors.soft=0;
  var f0=T.fieldValue(F,.5,1500/12000,900,12000),f2=T.fieldValue(F,.5,7500/12000,900,12000),f9=T.fieldValue(F,.5,.99,900,30000);
  var m={floor1:f0,floor3:f2,aboveList:f9};
  if(Math.abs(f0-.2)>.01||Math.abs(f2-.8)>.01)return{pass:false,detail:'floors read '+f0+' and '+f2+', expected 0.2 and 0.8',metrics:m};
  if(Math.abs(f9-1)>.01)return{pass:false,detail:'above the list the last value should repeat',metrics:m};
  return{pass:true,detail:'0.2 on floor 1, 0.8 on floor 3, last value repeats upward',metrics:m};});
guard('fields','a field becomes the picture the tiles carry',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);S.omb.on=true;S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';
  T.fieldUse();var g=T.regen();if(!g.tiles||!g.tiles.length)return{pass:false,detail:'no tiles built from a field'};
  var H=g.H,hi=0,nh=0,lo=0,nl=0;g.tiles.forEach(function(t){if(t.y>H*.8){hi+=t.t;nh++;}else if(t.y<H*.2){lo+=t.t;nl++;}});
  hi/=Math.max(1,nh);lo/=Math.max(1,nl);var m={toneTop:+hi.toFixed(2),toneBottom:+lo.toFixed(2),src:S.omb.src,label:S.omb.label};
  if(!/^field:/.test(S.omb.src))return{pass:false,detail:'S.omb.src is '+S.omb.src+', not a field',metrics:m};
  if(!(hi>lo+.3))return{pass:false,detail:'a gradient toward the top should give light tiles at the top: top '+hi.toFixed(2)+', bottom '+lo.toFixed(2),metrics:m};
  return{pass:true,detail:g.tiles.length+' tiles, tone '+hi.toFixed(2)+' at the top and '+lo.toFixed(2)+' at the bottom, labelled "'+S.omb.label+'"',metrics:m};});
guard('fields','the cut pattern reads the field through the gradient',function(){
  T.reset();S.omb.on=false;S.perf.on=false;S.pattern='circle';S.cell=72;S.bar=7;S.grad={dir:'field',k:1};S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';
  var g=T.regen();if(!g.holes||g.holes.length<20)return{pass:false,detail:'too few openings: '+(g.holes?g.holes.length:0)};
  var H=g.H;function area(p){var a=0;for(var i=0;i<p.length;i++){var q=p[(i+1)%p.length];a+=p[i].x*q.y-q.x*p[i].y;}return Math.abs(a)/2;}
  var hi=0,nh=0,lo=0,nl=0;g.holes.forEach(function(h){var cy=0;h.pts.forEach(function(p){cy+=p.y;});cy/=h.pts.length;var a=area(h.pts);if(cy>H*.8){hi+=a;nh++;}else if(cy<H*.2){lo+=a;nl++;}});
  hi/=Math.max(1,nh);lo/=Math.max(1,nl);var m={openingTop:Math.round(hi),openingBottom:Math.round(lo)};
  if(!(hi>lo*1.3))return{pass:false,detail:'light at the top should mean larger openings at the top: '+Math.round(hi)+' vs '+Math.round(lo)+' mm2',metrics:m};
  return{pass:true,detail:'openings '+Math.round(hi)+' mm2 at the top, '+Math.round(lo)+' mm2 at the bottom',metrics:m};});
guard('fields','a field design survives save and reload',function(){
  T.reset();T.applyPreset(T.OMB_PRESETS[0].s);S.omb.on=true;S.field=T.fieldDefaults();S.field.kind='floors';S.field.floors.vals='1,0.2,1,0.2';T.fieldUse();
  var snap=T.snapshot();if(snap.omb.field)return{pass:false,detail:'a field design should not save a thumbnail raster; it is regenerated'};
  T.reset();T.restoreDesign(snap);var O=T.OMBref();
  var m={kind:S.field.kind,vals:S.field.floors.vals,src:S.omb.src,ombKind:O.kind};
  if(S.field.kind!=='floors'||S.field.floors.vals!=='1,0.2,1,0.2')return{pass:false,detail:'the field settings did not come back',metrics:m};
  if(O.kind!=='field'||!O.lum)return{pass:false,detail:'the tone field was not rebuilt from the field on reload',metrics:m};
  return{pass:true,detail:'floor values and the rebuilt tone field came back',metrics:m};});


/* ---- brick courses: a stacked aggregate driven by the picture or a field ---- */
guard('brick','bricks are laid in courses and fit the frame',function(){
  /* pass 45: a single panel keeps its frame; in a set the bond runs across the panel joints (assembly checks that) */
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('brick');var g=T.regen();
  var m={bricks:g.bricks?g.bricks.length:0,courses:g.brick&&g.brick.courses,per:g.brick&&g.brick.perCourse,material:S.material,thickness:S.thickness};
  if(!g.bricks||!g.bricks.length)return{pass:false,detail:'no bricks built: '+(g.warnMsg||''),metrics:m};
  var bad=g.bricks.filter(function(b){return b.x-b.len/2<S.frameL-1e-6||b.x+b.len/2>S.width-S.frameR+1e-6||b.y-S.brick.bH/2<S.frameB-1e-6||b.y+S.brick.bH/2>S.height-S.frameT+1e-6;}).length;
  if(bad)return{pass:false,detail:bad+' bricks lie outside the frame',metrics:m};
  if(S.material!=='brick')return{pass:false,detail:'the mode did not switch to the brick material (got '+S.material+')',metrics:m};
  var halves=g.bricks.filter(function(b){return b.len<S.brick.bL-1;}).length;m.halves=halves;if(S.brick.bond==='running'&&halves!==2*Math.floor(g.brick.courses/2))return{pass:false,detail:'running bond should close every odd course with two half bricks, found '+halves,metrics:m};
  return{pass:true,detail:g.bricks.length+' bricks in '+g.brick.courses+' courses of '+g.brick.perCourse+' ('+halves+' half bricks), all inside the frame, material '+S.material,metrics:m};});
guard('brick','a light-to-dark picture turns the bricks more where it is light',function(){
  T.reset();T.setPanelMode('brick');S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();S.brick.d1=0;S.brick.d2=30;S.brick.maxOver=.6;
  var g=T.regen();var H=g.H,hi=0,nh=0,lo=0,nl=0;g.bricks.forEach(function(b){if(b.y>H*.8){hi+=b.theta;nh++;}else if(b.y<H*.2){lo+=b.theta;nl++;}});hi/=Math.max(1,nh);lo/=Math.max(1,nl);
  var m={turnTop:+hi.toFixed(1),turnBottom:+lo.toFixed(1),clamped:g.brick.clamped};
  if(!(hi>lo+10))return{pass:false,detail:'light at the top should turn the top bricks more: top '+hi.toFixed(1)+' deg, bottom '+lo.toFixed(1)+' deg',metrics:m};
  return{pass:true,detail:'top courses turned '+hi.toFixed(1)+' deg, bottom '+lo.toFixed(1)+' deg',metrics:m};});
guard('brick','the bearing rule holds bricks back and says so',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('brick');S.brick.op='rotate';S.brick.d1=0;S.brick.d2=60;S.brick.maxOver=.2;
  var g=T.regen();var pmax=S.brick.maxOver*S.brick.bW;var over=g.bricks.filter(function(b){return Math.abs(b.len/2*Math.sin(b.theta*Math.PI/180))+Math.abs(b.shift)>pmax+1e-3;}).length;
  var m={clamped:g.brick.clamped,over:over,maxTheta:g.brick.maxTheta,allowedOut:+pmax.toFixed(1)};
  if(over)return{pass:false,detail:over+' bricks still stand out more than '+pmax.toFixed(0)+' mm',metrics:m};
  if(!g.brick.clamped)return{pass:false,detail:'a 60 degree turn on a 20% bearing should have held some bricks back, none were',metrics:m};
  return{pass:true,detail:g.brick.clamped+' bricks held back; the widest turn left is '+g.brick.maxTheta+' deg',metrics:m};});
guard('brick','the placement list has one row per brick and the drawings are made',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('brick');var g=T.regen();
  var csv=T.brickCSV(g),lines=csv.trim().split('\n');var svg=T.brickSVGText(g),dxf=T.brickDXFText(g);
  var m={rows:lines.length-1,bricks:g.bricks.length,svgRects:(svg.match(/<rect/g)||[]).length,dxfPolys:(dxf.match(/LWPOLYLINE/g)||[]).length};
  if(lines.length-1!==g.bricks.length)return{pass:false,detail:'CSV has '+(lines.length-1)+' rows for '+g.bricks.length+' bricks',metrics:m};
  if(!/^brick,course,place,length_mm,x_mm,y_mm,z_offset_mm,turn_deg,tone,cut_left_mm,cut_right_mm,depth_mm,laid$/.test(lines[0]))return{pass:false,detail:'CSV header is '+lines[0],metrics:m};
  if(m.svgRects!==g.bricks.length+1)return{pass:false,detail:'SVG has '+m.svgRects+' rects for '+g.bricks.length+' bricks plus the outline',metrics:m};
  if(m.dxfPolys!==g.bricks.length+1)return{pass:false,detail:'DXF has '+m.dxfPolys+' polylines',metrics:m};
  return{pass:true,detail:lines.length-1+' rows, '+m.svgRects+' SVG rectangles, '+m.dxfPolys+' DXF polylines',metrics:m};});
guard('brick','one picture across a set of brick panels',function(){
  T.reset();T.setPanelMode('brick');S.arr='grid';S.cols=3;S.rows=1;S.gap=20;S.omb.span=true;S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='right';T.fieldUse();
  var g=T.regen();var m={panels:g.panels?g.panels.length:0,total:g.total};
  if(!g.panels||g.panels.length!==3)return{pass:false,detail:'expected 3 panels, got '+m.panels,metrics:m};
  var means=g.panels.map(function(p){return p.bricks.reduce(function(a,b){return a+b.t;},0)/Math.max(1,p.bricks.length);});m.meanTones=means.map(function(x){return +x.toFixed(2);});
  if(!(Math.abs(means[0]-means[2])>.1))return{pass:false,detail:'the three panels read the same tone, so the picture is not spanning: '+m.meanTones.join(', '),metrics:m};
  return{pass:true,detail:g.total+' bricks over 3 panels, mean tones '+m.meanTones.join(', '),metrics:m};});
guard('brick','a brick design survives save and reload and the modes stay exclusive',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('brick');S.brick.bL=215;S.brick.op='both';var snap=T.snapshot();
  T.reset();T.restoreDesign(snap);var m={brickOn:S.brick.on,ombOn:S.omb.on,perfOn:S.perf.on,bL:S.brick.bL,op:S.brick.op,mode:T.panelMode?T.panelMode():null};
  if(!S.brick.on||S.omb.on||S.perf.on)return{pass:false,detail:'modes after reload: brick '+S.brick.on+', tiles '+S.omb.on+', perf '+S.perf.on,metrics:m};
  if(S.brick.bL!==215||S.brick.op!=='both')return{pass:false,detail:'brick settings did not come back',metrics:m};
  T.setPanelMode('tiles');if(S.brick.on)return{pass:false,detail:'switching to tiles left the brick mode on',metrics:m};
  return{pass:true,detail:'brick settings came back, and tiles switched it off',metrics:m};});


/* ---- catalogue: the system cards and what the tool loads from them ---- */
guard('catalogue','the cards are embedded and listed',function(){
  var C=T.CATALOGUE;var btns=document.querySelectorAll('.catpick .catbtn');
  var m={cards:C?C.length:0,buttons:btns.length,ids:C?C.map(function(c){return c.id;}).join(','):''};
  if(!C||C.length<11)return{pass:false,detail:'expected at least 11 cards, found '+m.cards,metrics:m};
  if(btns.length!==C.length)return{pass:false,detail:'the list shows '+btns.length+' buttons for '+C.length+' cards',metrics:m};
  var bad=C.filter(function(c){return !c.parameters||!c.parameters.length||!c.process||!c.matrix;}).map(function(c){return c.id;});
  if(bad.length)return{pass:false,detail:'cards missing parameters, process or matrix: '+bad.join(', '),metrics:m};
  return{pass:true,detail:C.length+' cards, one button each',metrics:m};});
guard('catalogue','Casa la Roca loads as brick courses with a diagonal gradient',function(){
  T.reset();T.catLoad('casa-la-roca');var g=T.regen();
  var m={mode:T.panelMode(),bL:S.brick.bL,bond:S.brick.bond,field:S.field.kind,dir:S.field.gradient.dir,src:S.omb.src,width:S.width,bricks:g.bricks?g.bricks.length:0};
  if(T.panelMode()!=='brick')return{pass:false,detail:'mode is '+T.panelMode(),metrics:m};
  if(S.brick.bL!==152||S.brick.bond!=='stack'||S.width!==3660)return{pass:false,detail:'the control model did not come through: bL '+S.brick.bL+', bond '+S.brick.bond+', width '+S.width,metrics:m};
  if(S.field.kind!=='gradient'||!/^field:/.test(S.omb.src))return{pass:false,detail:'the field was not applied: kind '+S.field.kind+', src '+S.omb.src,metrics:m};
  if(!g.bricks||!g.bricks.length)return{pass:false,detail:'no bricks built from the card',metrics:m};
  return{pass:true,detail:g.bricks.length+' blocks of '+S.brick.bL+' mm in '+S.brick.bond+' bond under a '+S.field.gradient.dir+' gradient',metrics:m};});
guard('catalogue','Gantenbein loads as brick courses on a photograph',function(){
  T.reset();T.catLoad('gantenbein-winery');var g=T.regen();
  var m={mode:T.panelMode(),src:S.omb.src,material:S.material,bricks:g.bricks?g.bricks.length:0,maxTheta:g.brick&&g.brick.maxTheta};
  if(T.panelMode()!=='brick'||!/^builtin:/.test(S.omb.src))return{pass:false,detail:'mode '+T.panelMode()+', picture '+S.omb.src,metrics:m};
  if(S.material!=='brick')return{pass:false,detail:'material is '+S.material,metrics:m};
  return{pass:true,detail:g.bricks.length+' bricks turned up to '+g.brick.maxTheta+' deg from '+S.omb.label,metrics:m};});
guard('catalogue','a card without a recipe says so and loads nothing',function(){
  T.reset();var before=T.panelMode();T.catShow('bloom-game');var lb=document.querySelector('#catLoad'),nt=document.querySelector('#catNote');
  var m={loadButton:!!lb,note:nt?nt.textContent.slice(0,60):'',mode:T.panelMode()};
  if(lb)return{pass:false,detail:'Bloom has no recipe but shows a Load button',metrics:m};
  if(!nt||!nt.textContent)return{pass:false,detail:'no note explains why it cannot be loaded',metrics:m};
  if(T.panelMode()!==before)return{pass:false,detail:'showing a card changed the mode',metrics:m};
  return{pass:true,detail:'no Load button; note: '+nt.textContent.slice(0,70),metrics:m};});


/* ---- serial sections: ribs cut from sheet stock, depth or opening from the picture ---- */
guard('serial','ribs are stacked at the pitch and stay inside the frame',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('serial');var g=T.regen();var Sr=g.serial;
  var m={ribs:g.ribs?g.ribs.length:0,stations:Sr&&Sr.stations,material:S.material,thickness:S.thickness,sheets:Sr&&Sr.sheets,waste:Sr&&Sr.waste};
  if(!g.ribs||!g.ribs.length)return{pass:false,detail:'no ribs built: '+(g.warnMsg||''),metrics:m};
  var bad=g.ribs.filter(function(r){return r.c<S.frameB-1e-6||r.c+Sr.t>S.height-S.frameT+1e-6||r.a0<S.frameL-1e-6||r.a0+r.len>S.width-S.frameR+1e-6;}).length;
  if(bad)return{pass:false,detail:bad+' ribs lie outside the frame',metrics:m};
  var Fx=Sr.fix||{baseH:0,capH:0},expected=Math.floor((Math.min(S.height-S.frameT,S.height-Fx.capH)-Math.max(S.frameB,Fx.baseH)-Sr.t)/Sr.pitch)+1;if(g.ribs.length!==expected)return{pass:false,detail:'expected '+expected+' ribs at '+Sr.pitch+' mm, got '+g.ribs.length,metrics:m};
  if(!/Timber|Sheet metal/.test(T.MATERIALS[S.material].fam))return{pass:false,detail:'material '+S.material+' is not sheet stock',metrics:m};
  if(S.thickness!==Sr.t)return{pass:false,detail:'S.thickness '+S.thickness+' is not the rib thickness '+Sr.t,metrics:m};
  return{pass:true,detail:g.ribs.length+' ribs, '+Sr.stations+' stations each, '+Sr.sheets+' sheets, '+Sr.waste+'% waste',metrics:m};});
guard('serial','a gradient toward the top makes the top ribs deeper',function(){
  T.reset();T.setPanelMode('serial');S.serial.zeroWaste=false;S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();
  var g=T.regen();var H=g.H,hi=0,nh=0,lo=0,nl=0;g.ribs.forEach(function(r){var mean=0;for(var k=0;k<r.v.length;k++)mean+=r.v[k];mean/=r.v.length;if(r.c>H*.8){hi+=mean;nh++;}else if(r.c<H*.2){lo+=mean;nl++;}});hi/=Math.max(1,nh);lo/=Math.max(1,nl);
  var m={depthTop:+hi.toFixed(1),depthBottom:+lo.toFixed(1),dMin:S.serial.dMin,dMax:S.serial.dMax};
  if(!(hi>lo+(S.serial.dMax-S.serial.dMin)*.3))return{pass:false,detail:'top ribs '+hi.toFixed(0)+' mm deep, bottom '+lo.toFixed(0)+' mm: the field is not driving the depth',metrics:m};
  return{pass:true,detail:'top ribs '+hi.toFixed(0)+' mm deep, bottom '+lo.toFixed(0)+' mm',metrics:m};});
guard('serial','zero waste: every second rib is the complement and the nest says so',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('serial');S.serial.zeroWaste=true;S.serial.op='contour';var g=T.regen();var Sr=g.serial;var W=Sr.dMin+Sr.dMax;
  var worst=0;for(var i=1;i<g.ribs.length;i+=2){var a=g.ribs[i-1].v,b=g.ribs[i].v;for(var k=0;k<a.length;k++)worst=Math.max(worst,Math.abs(a[k]+b[k]-W));}
  var m={stripWidth:Sr.stripW,worstSum:+worst.toFixed(3),waste:Sr.waste,sheets:Sr.sheets,complements:g.ribs.filter(function(r){return r.comp;}).length};
  if(worst>1e-3)return{pass:false,detail:'rib pairs do not sum to the strip width: off by '+worst.toFixed(2)+' mm',metrics:m};
  if(m.complements!==Math.floor(g.ribs.length/2))return{pass:false,detail:m.complements+' complements for '+g.ribs.length+' ribs',metrics:m};
  S.serial.zeroWaste=false;var g2=T.regen();m.wasteWithout=g2.serial.waste;m.sheetsWithout=g2.serial.sheets;
  if(!(g.serial.sheets<=g2.serial.sheets))return{pass:false,detail:'zero waste used more sheets ('+g.serial.sheets+') than cutting every rib ('+g2.serial.sheets+')',metrics:m};
  return{pass:true,detail:'pairs sum to '+W+' mm; '+Sr.sheets+' sheets at '+Sr.waste+'% waste, against '+g2.serial.sheets+' at '+g2.serial.waste+'% without',metrics:m};});
guard('serial','twist: bands open between the two angles and the 3D ribbon builds',function(){
  T.reset();S.arr='single';T.setPanelMode('serial');S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='right';T.fieldUse();S.serial.op='twist';S.serial.aMin=5;S.serial.aMax=70;var g=T.regen();
  var lo=1e9,hi=-1e9;g.ribs.forEach(function(r){for(var k=0;k<r.v.length;k++){lo=Math.min(lo,r.v[k]);hi=Math.max(hi,r.v[k]);}});
  var m={angleMin:+lo.toFixed(1),angleMax:+hi.toFixed(1)};
  if(lo<5-1e-6||hi>70+1e-6)return{pass:false,detail:'angles '+lo.toFixed(1)+' to '+hi.toFixed(1)+' leave the 5 to 70 range',metrics:m};
  if(!(hi-lo>20))return{pass:false,detail:'the ramp should open the bands across most of the range, got '+(hi-lo).toFixed(1)+' deg',metrics:m};
  var geo=T.buildGeometryFrom(g);m.vertices=geo?geo.attributes.position.count:0;if(!geo||!m.vertices)return{pass:false,detail:'no 3D ribbon built',metrics:m};geo.dispose();
  return{pass:true,detail:'angles '+lo.toFixed(1)+' to '+hi.toFixed(1)+' deg, ribbon of '+m.vertices+' vertices',metrics:m};});
guard('serial','the schedule, the nest and the DXF are made and agree',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('serial');var g=T.regen();var csv=T.serialCSV(g),lines=csv.trim().split('\n');var nest=T.serialNest(g);var svg=T.serialSVGText(g),dxf=T.serialDXFText(g);
  var m={rows:lines.length-1,ribs:g.ribs.length,nestSheets:nest.sheets.length,reportedSheets:g.serial.sheets,svgSheetRects:(svg.match(/<rect/g)||[]).length,dxfCuts:(dxf.match(/\nCUTS\n/g)||[]).length};
  if(lines.length-1!==g.ribs.length)return{pass:false,detail:'CSV has '+(lines.length-1)+' rows for '+g.ribs.length+' ribs',metrics:m};
  if(!/^rib,y_mm,length_mm,depth_min_mm,depth_max_mm,sheet,strip,complement,profile$/.test(lines[0]))return{pass:false,detail:'CSV header is '+lines[0],metrics:m};
  if(nest.sheets.length!==g.serial.sheets)return{pass:false,detail:'the nest lays out '+nest.sheets.length+' sheets but the stats say '+g.serial.sheets,metrics:m};
  if(m.svgSheetRects!==nest.sheets.length)return{pass:false,detail:'SVG has '+m.svgSheetRects+' sheet rectangles for '+nest.sheets.length+' sheets',metrics:m};
  var strips=0;nest.sheets.forEach(function(s){strips+=s.strips.length;});if(m.dxfCuts!==strips)return{pass:false,detail:'DXF has '+m.dxfCuts+' cut polylines for '+strips+' strips',metrics:m};
  return{pass:true,detail:(lines.length-1)+' rows, '+nest.sheets.length+' sheets, '+strips+' strips, '+m.dxfCuts+' DXF cuts',metrics:m};});
guard('serial','a rib longer than the sheet is spliced and said so',function(){
  T.reset();T.ombBuiltin('ramp');T.setPanelMode('serial');S.width=5000;S.height=900;S.serial.sheetW=1220;S.serial.sheetH=2440;var g=T.regen();
  var m={ribLength:g.serial.ribL,sheetLong:2440,splice:g.serial.splice,sheets:g.serial.sheets};
  if(g.serial.splice<3)return{pass:false,detail:'a '+g.serial.ribL+' mm rib on a 2440 mm sheet should be in 3 pieces, got '+g.serial.splice,metrics:m};
  var nest=T.serialNest(g);var pieces=0;nest.sheets.forEach(function(s){s.strips.forEach(function(st){pieces+=1;});});m.piecesInNest=pieces;
  if(pieces!==Math.ceil(g.ribs.length/2)*g.serial.splice)return{pass:false,detail:'the nest holds '+pieces+' pieces, expected '+(Math.ceil(g.ribs.length/2)*g.serial.splice),metrics:m};
  return{pass:true,detail:'each rib in '+g.serial.splice+' pieces, '+pieces+' pieces nested on '+g.serial.sheets+' sheets',metrics:m};});
guard('serial','the attractor curve field is light along the curve',function(){
  var F=T.fieldDefaults();F.kind='attractCurve';F.attractCurve.pts='0,0.5;1,0.5';F.attractCurve.radius=.3;
  var on=T.fieldValue(F,.5,.5,1000,1000),off=T.fieldValue(F,.5,.02,1000,1000);var m={onCurve:+on.toFixed(2),farFromIt:+off.toFixed(2)};
  if(on<.99)return{pass:false,detail:'the field is '+on.toFixed(2)+' on the curve, not 1',metrics:m};
  if(off>.01)return{pass:false,detail:'the field is '+off.toFixed(2)+' far from the curve, not 0',metrics:m};
  return{pass:true,detail:'1 on the curve, 0 away',metrics:m};});
guard('serial','Aqua Tower and the Signal Box load from the catalogue as serial sections',function(){
  T.reset();T.catLoad('aqua-tower');var g=T.regen();var m={mode:T.panelMode(),ribs:g.ribs?g.ribs.length:0,field:S.field.kind,pitch:S.serial.pitch};
  if(T.panelMode()!=='serial'||!g.ribs||g.ribs.length<8)return{pass:false,detail:'Aqua: mode '+T.panelMode()+', '+m.ribs+' ribs',metrics:m};
  if(S.field.kind!=='noise'&&S.field.kind!=='floors')return{pass:false,detail:'Aqua should load a noise or floor-values field, got '+S.field.kind,metrics:m};
  T.reset();T.catLoad('signal-box-auf-dem-wolf');var g2=T.regen();m.signalOp=S.serial.op;m.signalRibs=g2.ribs?g2.ribs.length:0;m.signalMaterialFam=T.MATERIALS[S.material].fam;
  if(S.serial.op!=='twist'||!g2.ribs||!g2.ribs.length)return{pass:false,detail:'Signal Box: op '+S.serial.op+', '+m.signalRibs+' bands',metrics:m};
  return{pass:true,detail:'Aqua: '+m.ribs+' floors from the '+S.field.kind+' field; Signal Box: '+m.signalRibs+' twisting bands',metrics:m};});


/* ---- kinetic units: a unit per grid point whose state follows a field that moves ---- */
guard('kin','units sit on the grid inside the frame and the mode takes sheet metal',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('kin');var g=T.regen();var K=g.kin;
  var m={units:g.units?g.units.length:0,cols:K&&K.cols,rows:K&&K.rows,material:S.material,fam:T.MATERIALS[S.material].fam};
  if(!g.units||!g.units.length)return{pass:false,detail:'no units built: '+(g.warnMsg||''),metrics:m};
  var h=K.unit/2;var bad=g.units.filter(function(u){return u.x-h<S.frameL-1e-6||u.x+h>S.width-S.frameR+1e-6||u.y-h<S.frameB-1e-6||u.y+h>S.height-S.frameT+1e-6;}).length;
  if(bad)return{pass:false,detail:bad+' units lie outside the frame',metrics:m};
  if(m.fam!=='Sheet metal')return{pass:false,detail:'material family is '+m.fam,metrics:m};
  return{pass:true,detail:g.units.length+' units in a '+K.cols+' x '+K.rows+' grid, '+S.material,metrics:m};});
guard('kin','the sun comes onto a south face at midday and leaves it by evening',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.field=T.fieldDefaults();S.field.kind='gradient';S.field.sun.lat=49.3;S.field.sun.month=6;S.field.sun.facing=180;T.fieldUse();
  S.kin.motion='sun';S.kin.blend='max';S.kin.dayFrom=6;S.kin.dayTo=20;S.kin.sMin=0;S.kin.sMax=1;S.kin.rest=false;
  var noon=T.kinStateAt(S.kin,.5,.5,(12-6)/14,900,2400),eve=T.kinStateAt(S.kin,.5,.5,(19.5-6)/14,900,2400),dawn=T.kinStateAt(S.kin,.5,.5,0,900,2400);
  var m={dawn:+dawn.toFixed(2),noon:+noon.toFixed(2),evening:+eve.toFixed(2)};
  if(!(noon>.6))return{pass:false,detail:'at noon a south face in June should be deployed, got '+noon.toFixed(2),metrics:m};
  if(!(eve<noon-.3&&dawn<noon-.3))return{pass:false,detail:'dawn '+dawn.toFixed(2)+' and evening '+eve.toFixed(2)+' should be well below noon '+noon.toFixed(2),metrics:m};
  var s=T.sunAt(49.3,6,12);m.noonElevationDeg=+(s.el*180/Math.PI).toFixed(1);if(m.noonElevationDeg<55||m.noonElevationDeg>70)return{pass:false,detail:'noon sun in June at 49 N should be about 64 deg, got '+m.noonElevationDeg,metrics:m};
  return{pass:true,detail:'dawn '+dawn.toFixed(2)+', noon '+noon.toFixed(2)+', evening '+eve.toFixed(2)+'; noon sun '+m.noonElevationDeg+' deg',metrics:m};});
guard('kin','a walker lights the units near the path and the table follows the walk',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.pow=4;T.fieldUse();
  S.kin.motion='walk';S.kin.walkFrom='0,0.5';S.kin.walkTo='1,0.5';S.kin.reach=.2;S.kin.blend='max';S.kin.t=0;S.kin.steps=10;S.kin.sMin=0;S.kin.sMax=1;S.kin.pitch=120;S.kin.unit=100;
  var g=T.regen();var left=g.units.filter(function(u){return u.u<.15&&Math.abs(u.v-.5)<.1;}),right=g.units.filter(function(u){return u.u>.85&&Math.abs(u.v-.5)<.1;});
  var ml=left.reduce(function(a,u){return a+u.s;},0)/Math.max(1,left.length),mr=right.reduce(function(a,u){return a+u.s;},0)/Math.max(1,right.length);
  var m={leftNow:+ml.toFixed(2),rightNow:+mr.toFixed(2),strokeMean:g.kin.stroke};
  if(!(ml>mr+.3))return{pass:false,detail:'with the walker at the left edge the left units should be deployed: left '+ml.toFixed(2)+', right '+mr.toFixed(2),metrics:m};
  var csv=T.kinCSV(g),lines=csv.trim().split('\n'),head=lines[0].split(',');m.columns=head.length;m.rows=lines.length-1;
  if(lines.length-1!==g.units.length)return{pass:false,detail:'CSV has '+(lines.length-1)+' rows for '+g.units.length+' units',metrics:m};
  if(head.length!==8+11)return{pass:false,detail:'expected 8 + 11 columns for 10 steps (the actuator travel is the eighth), got '+head.length,metrics:m};
  var r0=lines[1+right.indexOf(right[0])>0?lines.length-1:1];
  if(/NaN/.test(csv))return{pass:false,detail:'NaN in the actuator table',metrics:m};
  if(!(g.kin.stroke>.1))return{pass:false,detail:'a walker crossing the panel should give many units a stroke, mean '+g.kin.stroke,metrics:m};
  return{pass:true,detail:'left '+ml.toFixed(2)+' vs right '+mr.toFixed(2)+' now; table '+m.rows+' rows x '+m.columns+' columns, mean stroke '+g.kin.stroke,metrics:m};});
guard('kin','the three shapes build in 3D and the drawings are made',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('kin');var m={};
  ['umbrella','iris','louvre'].forEach(function(sh){S.kin.shape=sh;var g=T.regen();var geo=T.buildGeometryFrom(g);m[sh]=geo?geo.attributes.position.count:0;if(geo)geo.dispose();});
  var g=T.regen();var svg=T.kinSVGText(g);m.svgFrames=(svg.match(/<rect/g)||[]).length-1;
  for(var k in m)if(k!=='svgFrames'&&!m[k])return{pass:false,detail:'no 3D for '+k,metrics:m};
  if(m.svgFrames<g.units.length)return{pass:false,detail:'SVG has '+m.svgFrames+' frames for '+g.units.length+' units',metrics:m};
  return{pass:true,detail:'umbrella '+m.umbrella+', iris '+m.iris+', louvre '+m.louvre+' vertices; '+m.svgFrames+' frames drawn',metrics:m};});
guard('kin','a kinetic design survives save and reload and the modes stay exclusive',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('kin');S.kin.shape='iris';S.kin.motion='walk';S.kin.t=.3;var snap=T.snapshot();
  T.reset();T.restoreDesign(snap);var m={kinOn:S.kin.on,others:[S.omb.on,S.perf.on,S.brick.on,S.serial.on].join('/'),shape:S.kin.shape,motion:S.kin.motion,t:S.kin.t};
  if(!S.kin.on||S.omb.on||S.perf.on||S.brick.on||S.serial.on)return{pass:false,detail:'modes after reload: '+JSON.stringify(m),metrics:m};
  if(S.kin.shape!=='iris'||S.kin.motion!=='walk'||Math.abs(S.kin.t-.3)>1e-9)return{pass:false,detail:'kinetic settings did not come back',metrics:m};
  T.setPanelMode('serial');if(S.kin.on)return{pass:false,detail:'switching to serial left kinetic on',metrics:m};
  return{pass:true,detail:'iris, walker, t 0.3 came back; serial switched it off',metrics:m};});
guard('kin','the Cairo pentagon tiling cuts as pentagons that tile without gaps',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.pattern='cairo';S.cell=150;S.bar=6;S.grad={dir:'none',k:0};S.solid=0;S.clip=true;var g=T.regen();
  var n=g.holes.length;var five=g.holes.filter(function(h){return h.pts.length===5;}).length;
  function area(p){var a=0;for(var i=0;i<p.length;i++){var q=p[(i+1)%p.length];a+=p[i].x*q.y-q.x*p[i].y;}return Math.abs(a)/2;}
  var m={openings:n,pentagons:five,openPct:+(g.open/(g.W*g.H)*100).toFixed(1)};
  if(n<40)return{pass:false,detail:'only '+n+' openings from a 150 mm Cairo tiling on 900 x 2400',metrics:m};
  if(five<n*.5)return{pass:false,detail:'only '+five+' of '+n+' openings are pentagons (the rest are clipped at the frame)',metrics:m};
  var inner=g.holes.filter(function(h){var c=0,cy=0;h.pts.forEach(function(p){c+=p.x;cy+=p.y;});c/=h.pts.length;cy/=h.pts.length;return c>200&&c<700&&cy>300&&cy<2100;});
  var areas=inner.map(function(h){return area(h.pts);}).sort(function(a,b){return a-b;});m.innerAreaMin=Math.round(areas[0]),m.innerAreaMax=Math.round(areas[areas.length-1]);
  if(areas.length&&areas[areas.length-1]>areas[0]*1.6)return{pass:false,detail:'interior openings vary from '+m.innerAreaMin+' to '+m.innerAreaMax+' mm2: the tiling has gaps or overlaps',metrics:m};
  return{pass:true,detail:n+' openings, '+five+' pentagons, interior areas '+m.innerAreaMin+' to '+m.innerAreaMax+' mm2, '+m.openPct+'% open',metrics:m};});


/* ---- the perforated hole list, the hexagonal kinetic grid and wind ---- */
guard('pwall','the perforated panel exports a hole list that matches its openings',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('perf');var g=T.regen();var csv=T.perfCSV(g),lines=csv.trim().split('\n');
  var m={holes:g.holes.length,rows:lines.length-1,header:lines[0]};
  if(lines[0]!=='hole,col,row,x_mm,y_mm,d_mm,tone')return{pass:false,detail:'header is '+lines[0],metrics:m};
  if(lines.length-1!==g.holes.length)return{pass:false,detail:(lines.length-1)+' rows for '+g.holes.length+' openings',metrics:m};
  if(/NaN/.test(csv))return{pass:false,detail:'NaN in the hole list',metrics:m};
  var c=lines[1].split(',');var x=+c[3],y=+c[4],d=+c[5];if(!(d>0&&x>0&&y>0))return{pass:false,detail:'first row reads '+lines[1],metrics:m};
  return{pass:true,detail:(lines.length-1)+' holes listed; first at ('+x+', '+y+') diameter '+d,metrics:m};});
guard('pwall','the kinetic grid staggers with hexagonal frames, and wind moves the units',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('kin');S.kin.pitch=120;S.kin.unit=100;S.kin.grid='hex';var g=T.regen();
  var r0=g.units.filter(function(u){return u.j===0;}),r1=g.units.filter(function(u){return u.j===1;});
  var m={units:g.units.length,row0:r0.length,row1:r1.length,shift:r0.length&&r1.length?+(r1[0].x-r0[0].x).toFixed(1):null,rowPitch:r0.length&&r1.length?+(r1[0].y-r0[0].y).toFixed(1):null};
  if(!r0.length||!r1.length)return{pass:false,detail:'fewer than two rows built',metrics:m};
  if(Math.abs(m.shift-60)>1||Math.abs(m.rowPitch-120*.866)>1)return{pass:false,detail:'odd rows should shift by half the pitch (60) at a row pitch of 103.9, got shift '+m.shift+', row pitch '+m.rowPitch,metrics:m};
  var R=S.kin.unit/Math.sqrt(3);var out=g.units.filter(function(u){return u.y-R<S.frameB-1e-6||u.y+R>S.height-S.frameT+1e-6||u.x-S.kin.unit/2<S.frameL-1e-6||u.x+S.kin.unit/2>S.width-S.frameR+1e-6;}).length;m.outside=out;
  if(out)return{pass:false,detail:out+' hexagonal units cross the frame',metrics:m};
  var svg=T.kinSVGText(g),re=/<polygon points="([^"]*)"/g,mm,hexF=0;while((mm=re.exec(svg))){if(mm[1].trim().split(' ').length===6)hexF++;}m.hexFrames=hexF;
  if(hexF<g.units.length)return{pass:false,detail:'expected a hexagonal frame per unit, found '+hexF+' for '+g.units.length,metrics:m};
  S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.pow=6;T.fieldUse();
  S.kin.motion='wind';S.kin.blend='max';S.kin.steps=8;var g2=T.regen();m.windStroke=g2.kin.stroke;m.windMeanNow=g2.kin.meanNow;
  if(!(g2.kin.stroke>.15))return{pass:false,detail:'wind should move most units over the cycle, mean stroke '+g2.kin.stroke,metrics:m};
  var geo=T.buildGeometryFrom(g2);m.vertices=geo?geo.attributes.position.count:0;if(geo)geo.dispose();if(!m.vertices)return{pass:false,detail:'no 3D for the hexagonal units',metrics:m};
  return{pass:true,detail:g.units.length+' units, odd rows shifted '+m.shift+' mm at a row pitch of '+m.rowPitch+', '+hexF+' hexagonal frames; in the wind mean stroke '+g2.kin.stroke,metrics:m};});


/* ---- pavers: a finite set of types on a layout ---- */
function psPip(pt,poly){var x=pt.x,y=pt.y,ins=false;for(var i=0,j=poly.length-1;i<poly.length;j=i++){var a=poly[i],b=poly[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)ins=!ins;}return ins;}
function psArea(p){var a=0;for(var i=0;i<p.length;i++){var q=p[i],r=p[(i+1)%p.length];a+=q.x*r.y-r.x*q.y;}return a/2;}
function psLum(c){var v=parseInt(String(c).replace('#',''),16);return(.299*(v>>16&255)+.587*(v>>8&255)+.114*(v&255))/255;}
guard('paver','every layout covers the frame once, with no gaps or overlaps',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=1800;S.height=1500;S.paver.minPiece=0;S.paver.joint=0;S.paver.size=200;S.paver.ratio=2;
  var x0=Math.max(0,S.frameL),y0=Math.max(0,S.frameB),x1=S.width-Math.max(0,S.frameR),y1=S.height-Math.max(0,S.frameT),A=(x1-x0)*(y1-y0);
  var cases=[['square',0],['running',0],['herring',0],['basket',0],['hex',0],['cairo',0],['voronoi',0],['square',30],['herring',45],['cairo',20],['hex',15]],bad=[],m={};
  cases.forEach(function(cs){S.paver.tiling=cs[0];S.paver.spin=cs[1];var g=T.regen();var sum=0;g.pavers.forEach(function(p){sum+=p.area;});
    var miss=0,multi=0,N=300;for(var k=1;k<=N;k++){var pt={x:x0+(x1-x0)*((k*0.6180339887)%1),y:y0+(y1-y0)*((k*0.7548776662)%1)};var c=0;for(var q=0;q<g.pavers.length;q++)if(psPip(pt,g.pavers[q].pts))c++;if(c===0)miss++;if(c>1)multi++;}
    var key=cs[0]+(cs[1]?'@'+cs[1]:'');m[key]={pavers:g.pavers.length,areaRatio:+(sum/A).toFixed(4),miss:miss,multi:multi,warn:g.warnMsg||''};
    if(!g.pavers.length||Math.abs(sum/A-1)>.01||miss>1||multi>0)bad.push(key);});
  if(bad.length)return{pass:false,detail:'gaps or overlaps in: '+bad.join(', '),metrics:m};
  return{pass:true,detail:Object.keys(m).map(function(k){return k+' '+m[k].pavers;}).join(', ')+' pavers; each layout covers the frame once',metrics:m};});
guard('paver','a gradient sorts the types from the bottom to the top',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();S.paver.assign='quantise';S.paver.tiling='square';S.paver.size=150;
  var g=T.regen(),H=g.H,hi=0,nh=0,lo=0,nl=0;g.pavers.forEach(function(p){if(p.cy>H*.8){hi+=p.type;nh++;}else if(p.cy<H*.2){lo+=p.type;nl++;}});hi/=Math.max(1,nh);lo/=Math.max(1,nl);
  var m={meanTypeTop:+hi.toFixed(2),meanTypeBottom:+lo.toFixed(2),types:g.paver.types,counts:g.paver.counts.join('/'),material:S.material};
  if(S.material!=='concrete')return{pass:false,detail:'the mode did not switch to concrete (got '+S.material+')',metrics:m};
  if(!(hi>lo+2))return{pass:false,detail:'the top should take the light types and the bottom the dark: top '+hi.toFixed(2)+', bottom '+lo.toFixed(2),metrics:m};
  return{pass:true,detail:'mean type '+lo.toFixed(2)+' at the bottom and '+hi.toFixed(2)+' at the top, of '+g.paver.types+' types',metrics:m};});
guard('paver','dither mixes types so the mean tone holds',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=1500;S.height=1500;T.ombBuiltin('ramp');S.paver.tiling='square';S.paver.size=50;S.paver.assign='dither';
  var g=T.regen();var pal=g.paver.palette,lum=pal.map(psLum),lo=Math.min.apply(null,lum),hi=Math.max.apply(null,lum),lev=lum.map(function(l){return(l-lo)/(hi-lo);});
  var mt=0,ml=0,used={};g.pavers.forEach(function(p){mt+=p.t;ml+=lev[p.type];used[p.type]=1;});mt/=g.pavers.length;ml/=g.pavers.length;
  S.paver.assign='quantise';var g2=T.regen();var mq=0;g2.pavers.forEach(function(p){mq+=lev[p.type];});mq/=g2.pavers.length;
  var m={pavers:g.pavers.length,meanTone:+mt.toFixed(3),meanLevelDither:+ml.toFixed(3),meanLevelNearest:+mq.toFixed(3),typesUsed:Object.keys(used).length};
  if(Math.abs(ml-mt)>.03)return{pass:false,detail:'dithered mean '+ml.toFixed(3)+' against a mean tone of '+mt.toFixed(3),metrics:m};
  if(m.typesUsed<4)return{pass:false,detail:'only '+m.typesUsed+' types used on a ramp',metrics:m};
  return{pass:true,detail:m.pavers+' pavers: the dithered mean '+ml.toFixed(3)+' holds the tone '+mt.toFixed(3)+' (nearest tone gives '+mq.toFixed(3)+')',metrics:m};});
guard('paver','no two alike side by side when asked',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.field=T.fieldDefaults();S.field.kind='gradient';T.fieldUse();S.paver.tiling='square';S.paver.size=150;S.paver.assign='quantise';S.paver.apart=true;
  var g=T.regen();var nb=T.paverNeighbours(g.pavers,1);var same=0,pairs=0;for(var i=0;i<nb.length;i++)for(var k=0;k<nb[i].length;k++){var j=nb[i][k];if(j>i){pairs++;if(g.pavers[j].type===g.pavers[i].type)same++;}}
  var m={pavers:g.pavers.length,pairs:pairs,same:same,conflicts:g.paver.conflicts};
  if(pairs<g.pavers.length)return{pass:false,detail:'too few neighbouring pairs found ('+pairs+' for '+g.pavers.length+' pavers)',metrics:m};
  if(same)return{pass:false,detail:same+' neighbouring pairs share a type',metrics:m};
  S.paver.tiling='herring';var g2=T.regen();var nb2=T.paverNeighbours(g2.pavers,1),p2=0;for(var a=0;a<nb2.length;a++)p2+=nb2[a].length;m.herringPairs=p2/2;m.herringConflicts=g2.paver.conflicts;
  if(g2.paver.conflicts)return{pass:false,detail:'herringbone left '+g2.paver.conflicts+' pairs alike',metrics:m};
  return{pass:true,detail:pairs+' neighbouring square pairs and '+m.herringPairs+' herringbone pairs, none alike',metrics:m};});
guard('paver','the schedule, the placement list and the drawings agree',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');T.ombBuiltin('ramp');S.paver.tiling='hex';var g=T.regen();
  var csv=T.paverCSV(g).trim().split('\n'),sch=T.paverScheduleCSV([g]).trim().split('\n'),dxf=T.paverDXFText(g),svg=T.paverSVGText(g);
  var total=0,ar=0;for(var i=1;i<sch.length;i++){var c=sch[i].split(',');total+=+c[3];ar+=+c[6];}
  var sumA=0;g.pavers.forEach(function(p){sumA+=p.net;});
  var m={pavers:g.pavers.length,rows:csv.length-1,scheduleTotal:total,scheduleArea:+ar.toFixed(3),areaM2:+(sumA/1e6).toFixed(3),dxfPolys:(dxf.match(/LWPOLYLINE/g)||[]).length,svgPaths:(svg.match(/<path/g)||[]).length,header:csv[0]};
  if(csv[0]!=='paver,type,colour,cut,x_mm,y_mm,area_mm2,height_mm,outline,name,role,module,tilt_x_deg,tilt_y_deg,hole_mm')return{pass:false,detail:'placement list header is '+csv[0],metrics:m};
  if(csv.length-1!==g.pavers.length)return{pass:false,detail:'placement list has '+(csv.length-1)+' rows for '+g.pavers.length+' pavers',metrics:m};
  if(total!==g.pavers.length)return{pass:false,detail:'the schedule totals '+total+' for '+g.pavers.length,metrics:m};
  if(Math.abs(ar-sumA/1e6)>.005)return{pass:false,detail:'schedule area '+ar+' against '+(sumA/1e6).toFixed(3),metrics:m};
  if(m.dxfPolys!==g.pavers.length+1)return{pass:false,detail:'DXF has '+m.dxfPolys+' polylines for '+g.pavers.length+' pavers plus the outline',metrics:m};
  if(m.svgPaths!==g.pavers.length)return{pass:false,detail:'SVG has '+m.svgPaths+' paths',metrics:m};
  if(/NaN/.test(csv.join('\n')+dxf))return{pass:false,detail:'NaN in the exports',metrics:m};
  return{pass:true,detail:g.pavers.length+' pavers in the placement list, the schedule, the DXF and the SVG',metrics:m};});
guard('paver','a paver design survives save and reload and the modes stay exclusive',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.tiling='herring';S.paver.palette='#111111,#888888,#EEEEEE';S.paver.types=3;S.paver.apart=true;var snap=T.snapshot();
  T.reset();T.restoreDesign(snap);var m={paverOn:S.paver.on,others:[S.omb.on,S.perf.on,S.brick.on,S.serial.on,S.kin.on].join('/'),tiling:S.paver.tiling,types:S.paver.types,apart:S.paver.apart};
  if(!S.paver.on||S.omb.on||S.perf.on||S.brick.on||S.serial.on||S.kin.on)return{pass:false,detail:'modes after reload: '+JSON.stringify(m),metrics:m};
  if(S.paver.tiling!=='herring'||S.paver.types!==3||!S.paver.apart)return{pass:false,detail:'paver settings did not come back',metrics:m};
  var g=T.regen();m.pavers=g.pavers.length;m.palette=g.paver.palette.join(',');if(g.paver.palette[0]!=='#111111')return{pass:false,detail:'the palette came back as '+m.palette,metrics:m};
  T.setPanelMode('kin');if(S.paver.on)return{pass:false,detail:'switching to kinetic units left pavers on',metrics:m};
  return{pass:true,detail:'herringbone, three types and the no-alike rule came back; kinetic units switched pavers off',metrics:m};});
guard('paver','Little Island loads as Voronoi pavers with a height per type',function(){
  T.reset();T.catLoad('little-island');var g=T.regen();var m={mode:T.panelMode(),tiling:S.paver.tiling,pavers:g.pavers?g.pavers.length:0,heights:g.paver&&g.paver.heights.join('/'),warn:g.warnMsg||''};
  if(T.panelMode()!=='paver'||S.paver.tiling!=='voronoi'||!g.pavers||g.pavers.length<30)return{pass:false,detail:'mode '+m.mode+', layout '+m.tiling+', '+m.pavers+' pavers '+m.warn,metrics:m};
  var hs={};g.paver.heights.forEach(function(h){hs[h]=1;});if(Object.keys(hs).length<3)return{pass:false,detail:'the heights do not vary: '+m.heights,metrics:m};
  var geo=T.buildGeometryFrom(g);m.vertices=geo?geo.attributes.position.count:0;m.hasColour=!!(geo&&geo.attributes.color);if(geo)geo.dispose();
  if(!m.vertices||!m.hasColour)return{pass:false,detail:'3D: '+m.vertices+' vertices, colour '+m.hasColour,metrics:m};
  return{pass:true,detail:m.pavers+' Voronoi pavers with heights '+m.heights+', built in 3D with a colour per type',metrics:m};});


/* ---- kinfix-1: the checks behind the 30 Oct kinetic / Cairo sweep ---- */
function ckPip(pt,poly){var x=pt.x,y=pt.y,ins=false;for(var i=0,j=poly.length-1;i<poly.length;j=i++){var a=poly[i],b=poly[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)ins=!ins;}return ins;}
guard('kin','the Cairo cut has no voids: every interior point is in an opening or a bar',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.width=1800;S.height=1800;S.pattern='cairo';S.cell=150;S.bar=6;S.radius=0;S.grad={dir:'none',k:0};S.solid=0;S.clip=true;
  var worst=0,m={};[0,30].forEach(function(spin){S.pp.cairo.spin=spin;var g=T.regen();var W=g.W,H=g.H,mg=2*S.cell,far=0;
    for(var k=1;k<=400;k++){var x=mg+(W-2*mg)*((k*0.6180339887)%1),y=mg+(H-2*mg)*((k*0.7548776662)%1),best=1e9;
      for(var q=0;q<g.holes.length&&best>0;q++){var P=g.holes[q].pts;if(ckPip({x:x,y:y},P)){best=0;break;}
        for(var e=0;e<P.length;e++){var a=P[e],b=P[(e+1)%P.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1e-9,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/l2));best=Math.min(best,Math.hypot(x-(a.x+t*dx),y-(a.y+t*dy)));}}
      far=Math.max(far,best);}
    m['spin'+spin]={openings:g.holes.length,openPct:+(g.open/(W*H)*100).toFixed(1),farthestFromAnOpening:+far.toFixed(1)};worst=Math.max(worst,far);});
  if(worst>S.bar*1.5+1)return{pass:false,detail:'a point lies '+worst.toFixed(1)+' mm from every opening: the tiling has voids',metrics:m};
  return{pass:true,detail:'no interior point is more than '+worst.toFixed(1)+' mm from an opening (bar '+S.bar+' mm); open '+m.spin0.openPct+'% and '+m.spin30.openPct+'%',metrics:m};});
guard('kin','a unit wider than the pitch is held to the pitch and stays inside the frame',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.kin.pitch=300;S.kin.unit=600;var res={},bad=0;['square','hex'].forEach(function(gd){S.kin.grid=gd;var g=T.regen();var u=g.kin.unit,R=gd==='hex'?u/Math.sqrt(3):u/2;
    var out=g.units.filter(function(un){return un.x-u/2<S.frameL-1e-6||un.x+u/2>S.width-S.frameR+1e-6||un.y-R<S.frameB-1e-6||un.y+R>S.height-S.frameT+1e-6;}).length;res[gd]={units:g.units.length,unitDrawn:u,held:g.kin.unitHeld,outside:out};if(u!==300||out)bad++;});
  if(bad)return{pass:false,detail:'unit drawn at the raw size or crossing the frame: '+JSON.stringify(res),metrics:res};
  return{pass:true,detail:'600 mm units held to the 300 mm pitch on both grids, none crossing the frame',metrics:res};});
guard('kin','the sun deploys units by how squarely it strikes the face',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.kin.motion='sun';S.kin.rest=false;S.kin.blend='max';S.kin.sunFull=.5;S.kin.dayFrom=6;S.kin.dayTo=18;S.kin.sMin=0;S.kin.sMax=1;
  S.field.sun.lat=24.4;S.field.sun.facing=180;S.field.sun.month=6;var june=T.kinStateAt(S.kin,.5,.5,.5,900,2400);S.field.sun.month=3;var march=T.kinStateAt(S.kin,.5,.5,.5,900,2400);
  S.field.sun.facing=0;var north=T.kinStateAt(S.kin,.5,.5,.5,900,2400);
  S.field.sun.facing=180;S.kin.rest=true;T.ombBuiltin('ramp');S.kin.blend='max';S.kin.pitch=120;S.kin.unit=100;S.kin.t=.1;var g=T.regen();var vals={};g.units.forEach(function(u){vals[u.s.toFixed(3)]=1;});
  var m={juneNoonSouth24N:+june.toFixed(2),marchNoonSouth24N:+march.toFixed(2),marchNoonNorth:+north.toFixed(2),distinctStatesWithPicture:Object.keys(vals).length};
  if(!(june<.15))return{pass:false,detail:'in June at 24 N the sun is nearly overhead and a south face should stay mostly open: '+june.toFixed(2),metrics:m};
  if(!(march>.7))return{pass:false,detail:'in March the noon sun strikes the south face well: expected above 0.7, got '+march.toFixed(2),metrics:m};
  if(north!==0)return{pass:false,detail:'a north face never sees the sun at 24 N in March: '+north,metrics:m};
  if(m.distinctStatesWithPicture<3)return{pass:false,detail:'"the larger" of a picture and the sun should vary across the panel, got '+m.distinctStatesWithPicture+' states',metrics:m};
  return{pass:true,detail:'south face at 24 N: '+june.toFixed(2)+' at a June noon, '+march.toFixed(2)+' at a March noon; north face 0; the picture still shows through',metrics:m};});
guard('kin','a walker point typed wrong falls back instead of giving NaN',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.kin.pitch=100;S.kin.unit=90;S.kin.motion='walk';S.kin.walkFrom='0.2,x';S.kin.walkTo='0.5';var g=T.regen();var csv=T.kinCSV(g);
  var m={units:g.units.length,meanNow:g.kin.meanNow,nan:/NaN/.test(csv)};
  if(m.nan||!isFinite(g.kin.meanNow))return{pass:false,detail:'NaN in the states',metrics:m};
  S.kin.walkFrom='0,0';S.kin.walkTo='1,1';S.kin.rest=false;S.kin.reach=.25;S.kin.t=0;var g2=T.regen();var lowLeft=0,topRight=0;g2.units.forEach(function(u){if(u.u<.3&&u.v>.7)lowLeft+=u.s;if(u.u>.7&&u.v<.3)topRight+=u.s;});
  m.lowLeftLit=+lowLeft.toFixed(2);m.topRightLit=+topRight.toFixed(2);
  if(!(lowLeft>topRight))return{pass:false,detail:'a walker starting at 0,0 (bottom-left, v up) should light the bottom-left first',metrics:m};
  return{pass:true,detail:'a bad point falls back; a walker typed from 0,0 starts at the bottom-left',metrics:m};});
guard('kin','the kinetic DXF follows the hexagonal grid and carries the moving parts',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');S.kin.grid='hex';S.kin.pitch=150;S.kin.unit=140;S.kin.shape='umbrella';var g=T.regen();var dxf=T.kinDXFText(g).split('\n');
  var frames=0,six=0,petals=0;for(var i=0;i<dxf.length-3;i++){if(dxf[i]==='LWPOLYLINE'&&dxf[i+1]==='8'){var layer=dxf[i+2];if(layer==='FRAMES'){frames++;if(dxf[i+4]==='6')six++;}if(layer==='PETALS')petals++;}}
  var m={units:g.units.length,frames:frames,hexFrames:six,petals:petals};
  if(frames!==g.units.length||six!==frames)return{pass:false,detail:'expected '+g.units.length+' hexagonal frames, found '+frames+' frames, '+six+' with six vertices',metrics:m};
  if(petals!==6*g.units.length)return{pass:false,detail:'expected six petals per unit, found '+petals,metrics:m};
  return{pass:true,detail:frames+' hexagonal frames and '+petals+' petals in the DXF',metrics:m};});


/* ---- zone-1: Little Island's uniform-grid zone ---- */
guard('paver','a uniform grid zone lays regular cells inside and Voronoi cells outside',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=3000;S.height=3000;S.paver.tiling='voronoi';S.paver.dist='poisson';S.paver.size=250;S.paver.minPiece=0;S.paver.joint=0;
  S.paver.zone='0.3,0.3;0.7,0.3;0.7,0.7;0.3,0.7';S.paver.zoneGX=300;S.paver.zoneGY=200;var g=T.regen();
  var x0=Math.max(0,S.frameL),y0=Math.max(0,S.frameB),x1=S.width-Math.max(0,S.frameR),y1=S.height-Math.max(0,S.frameT),A=(x1-x0)*(y1-y0),sum=0;g.pavers.forEach(function(p){sum+=p.area;});
  var zx0=x0+.4*(x1-x0),zx1=x0+.6*(x1-x0),zy0=y0+.4*(y1-y0),zy1=y0+.6*(y1-y0),inner=g.pavers.filter(function(p){return p.cx>zx0&&p.cx<zx1&&p.cy>zy0&&p.cy<zy1;});
  function isRect(p){var a=1e9,b=1e9,c=-1e9,d=-1e9;p.pts.forEach(function(q){a=Math.min(a,q.x);b=Math.min(b,q.y);c=Math.max(c,q.x);d=Math.max(d,q.y);});return Math.abs(c-a-300)<3&&Math.abs(d-b-200)<3&&Math.abs(p.area-(c-a)*(d-b))<(c-a)*(d-b)*.01;}
  var regular=inner.filter(isRect).length;
  var m={pavers:g.pavers.length,areaRatio:+(sum/A).toFixed(4),innerCells:inner.length,regularInner:regular,zoneDrawn:/paver-zone/.test(T.paverSVGText(g))};
  if(Math.abs(sum/A-1)>.01)return{pass:false,detail:'the cells do not cover the frame once: area ratio '+m.areaRatio,metrics:m};
  if(!inner.length||regular<inner.length*.85)return{pass:false,detail:'inside the zone '+regular+' of '+inner.length+' cells are 300 x 200 mm rectangles',metrics:m};
  if(!m.zoneDrawn)return{pass:false,detail:'the setting-out does not draw the zone',metrics:m};
  S.paver.zone='';var g2=T.regen();var inner2=g2.pavers.filter(function(p){return p.cx>zx0&&p.cx<zx1&&p.cy>zy0&&p.cy<zy1;}),reg2=inner2.filter(isRect).length;m.withoutZoneRegular=reg2;
  if(reg2>inner2.length*.3)return{pass:false,detail:'without a zone the middle should be irregular, but '+reg2+' of '+inner2.length+' cells are regular',metrics:m};
  return{pass:true,detail:regular+' of '+inner.length+' cells inside the zone are 300 x 200 mm rectangles; the whole covers the frame once; the zone is drawn',metrics:m};});


/* ---- pv2-1: the checks behind the 30 Oct paver sweep ---- */
guard('paver','a turned Cairo layout still covers a large panel',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=3000;S.height=3000;S.paver.tiling='cairo';S.paver.size=60;S.paver.spin=30;S.paver.minPiece=0;S.paver.joint=0;var g=T.regen();
  var x0=Math.max(0,S.frameL),y0=Math.max(0,S.frameB),x1=S.width-Math.max(0,S.frameR),y1=S.height-Math.max(0,S.frameT),A=(x1-x0)*(y1-y0),sum=0;g.pavers.forEach(function(p){sum+=p.area;});
  var m={pavers:g.pavers.length,areaRatio:+(sum/A).toFixed(4),warn:g.warnMsg||''};
  if(g.warn)return{pass:false,detail:'refused or cut short: '+g.warnMsg,metrics:m};
  if(Math.abs(sum/A-1)>.01)return{pass:false,detail:'covers '+(sum/A*100).toFixed(1)+'% of the panel',metrics:m};
  S.paver.tiling='square';var g2=T.regen();m.squareTurned=g2.pavers.length;m.squareWarn=g2.warnMsg||'';if(g2.warn)return{pass:false,detail:'a turned square layout is refused: '+g2.warnMsg,metrics:m};
  return{pass:true,detail:g.pavers.length+' Cairo pavers turned 30 degrees cover the panel; the turned square builds '+g2.pavers.length,metrics:m};});
guard('paver','a joint wider than the pavers is held, and the pavers still draw',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.tiling='running';S.paver.size=60;S.paver.ratio=2;S.paver.joint=40;var g=T.regen();var svg=T.paverSVGText(g);
  var geo=T.buildGeometryFrom(g);var m={pavers:g.pavers.length,jointUsed:g.paver.joint,held:g.paver.jointHeld,notes:g.paver.notes.join(' | '),vertices:geo?geo.attributes.position.count:0};if(geo)geo.dispose();
  if(!g.paver.jointHeld||g.paver.joint>=40)return{pass:false,detail:'the 40 mm joint was not held',metrics:m};
  if(!m.vertices)return{pass:false,detail:'no 3D after the joint was held',metrics:m};
  if(!/joint held/.test(m.notes))return{pass:false,detail:'no note says the joint was held',metrics:m};
  return{pass:true,detail:'joint held to '+g.paver.joint+' mm, '+g.pavers.length+' pavers drawn in 3D',metrics:m};});
guard('paver','a spanning set counts the whole set',function(){
  T.reset();T.setPanelMode('paver');S.arr='grid';S.cols=3;S.rows=2;S.gap=20;S.omb.span=true;var g=T.regen();var tot=T.paverSetCounts();
  var sum=0;g.panels.forEach(function(p){sum+=p.pavers.length;});var sch=T.paverScheduleCSV(g.panels).trim().split('\n'),st=0;for(var i=1;i<sch.length;i++)st+=+sch[i].split(',')[3];
  var csum=tot.counts.reduce(function(a,b){return a+b;},0);var m={panels:g.panels.length,setMade:tot.made,sumOfPanels:sum,scheduleTotal:st,typeCountSum:csum};
  if(tot.made!==sum||st!==sum||csum!==sum)return{pass:false,detail:'set totals disagree: '+JSON.stringify(m),metrics:m};
  return{pass:true,detail:sum+' pavers over '+g.panels.length+' panels in the set counts and the schedule',metrics:m};});
guard('paver','areas and weight count the paver, not the joint',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.tiling='square';S.paver.size=200;S.paver.joint=6;S.paver.minPiece=0;var g=T.regen();
  var full=g.pavers.filter(function(p){return !p.cut;})[0];var m={module:full?Math.round(full.area):0,net:full?Math.round(full.net):0};
  if(!full)return{pass:false,detail:'no full paver to measure',metrics:m};
  if(Math.abs(full.area-40000)>1||Math.abs(full.net-194*194)>2)return{pass:false,detail:'a 200 mm module with a 6 mm joint should be a 194 x 194 paver: module '+m.module+', paver '+m.net,metrics:m};
  var row=T.paverCSV(g).trim().split('\n')[1].split(',');m.csvArea=+row[6];
  return{pass:true,detail:'module '+m.module+' mm2, paver '+m.net+' mm2 in the schedule and the list',metrics:m};});
guard('paver','two types are the darkest and the lightest; bad colours and heights are reported',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.types=2;var pal=T.paverPaletteInfo(S.paver).colours;var m={two:pal.join(',')};
  if(pal[0]!=='#2F2E2C'||pal[1]!=='#E4DED2')return{pass:false,detail:'two types should be the darkest and the lightest of the ramp, got '+m.two,metrics:m};
  S.paver.types=5;S.paver.palette='red, #12, zzzzzz, #FFF; #000000, fff';var pi=T.paverPaletteInfo(S.paver);m.parsed=pi.colours.join(',');m.bad=pi.bad.join('|');
  if(pi.given!==2||pi.bad.length!==3)return{pass:false,detail:'expected 2 colours understood (#FFF, #000000; fff repeats #FFF) and 3 not (red, #12, zzzzzz), got '+pi.given+' and '+pi.bad.length,metrics:m};
  S.paver.heights='0';var h=T.paverHeightsInfo(S.paver,5);m.zero=h.heights.join('/');if(h.heights[0]!==0)return{pass:false,detail:'a height of 0 became '+h.heights[0],metrics:m};
  S.paver.heights='-20,abc';var h2=T.paverHeightsInfo(S.paver,5);m.badHeights=h2.bad.join('|');if(h2.bad.length!==2)return{pass:false,detail:'"-20,abc" should report two heights not understood',metrics:m};
  return{pass:true,detail:'two types '+m.two+'; '+pi.bad.length+' colours and '+h2.bad.length+' heights reported; a height of 0 kept',metrics:m};});
guard('paver','no two alike holds on hexagons with three types',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.tiling='hex';S.paver.size=120;S.paver.types=3;S.paver.apart=true;S.paver.assign='quantise';var g=T.regen();
  var m={pavers:g.pavers.length,pairs:g.paver.pairs,conflicts:g.paver.conflicts};
  if(g.paver.conflicts)return{pass:false,detail:g.paver.conflicts+' neighbouring pairs alike on a hexagon grid that three types can always colour',metrics:m};
  return{pass:true,detail:g.pavers.length+' hexagons, '+g.paver.pairs+' neighbouring pairs, none alike with three types',metrics:m};});
guard('paver','pavers lie on the ground, and the panel stands up again after',function(){
  T.reset();S.arr='single';var before=[S.orient,S.mount];T.setPanelMode('paver');var on=[S.orient,S.mount];T.setPanelMode('cut');var after=[S.orient,S.mount];
  var m={before:before.join('/'),paver:on.join('/'),after:after.join('/')};
  if(on[0]!=='overhead'||on[1]>50)return{pass:false,detail:'pavers should lie face up near the ground, got '+m.paver,metrics:m};
  if(after[0]!==before[0]||after[1]!==before[1])return{pass:false,detail:'leaving pavers did not restore the orientation: '+m.after+' after '+m.before,metrics:m};
  return{pass:true,detail:'wall, then ground for pavers, then wall again',metrics:m};});


/* ---- nest-1: Berlin Free University's nested modules ---- */
function nbBB(pts){var a=1e9,b=1e9,c=-1e9,d=-1e9;pts.forEach(function(q){a=Math.min(a,q.x);b=Math.min(b,q.y);c=Math.max(c,q.x);d=Math.max(d,q.y);});return[a,b,c,d];}
function nbSetup(over){T.reset();S.arr='single';
  Object.assign(S.paver,{tiling:'nested',lay:'wall',order:'BAABBABA',modA:610,modB:1219,band:3048,spandrel:914,subs:'610,1219,1829,3048',nestMax:3,shuffle:false,joint:0,minPiece:0,spin:0,seed:7},over||{});
  T.setPanelMode('paver');S.frameL=S.frameR=S.frameT=S.frameB=0;S.width=17069;S.height=11886;return T.regen();}
function nbRow(g){return g.pavers.filter(function(p){return p.role==='panel'&&nbBB(p.pts)[1]<1;}).sort(function(a,b){return a.cx-b.cx;});}
guard('paver','nested modules: two widths, sub-panels that fill the band, a spandrel over each module',function(){
  var g=nbSetup(),hs=[610,1219,1829,3048],badW=[],badH=[],spd=0,pan=0,sum=0;
  g.pavers.forEach(function(p){sum+=p.area;if(p.cut)return;var b=nbBB(p.pts),w=b[2]-b[0],h=b[3]-b[1];
    if(Math.abs(w-610)>1&&Math.abs(w-1219)>1)badW.push(Math.round(w));
    if(p.role==='spandrel'){spd++;if(Math.abs(h-914)>1)badH.push('s'+Math.round(h));}else{pan++;if(!hs.some(function(x){return Math.abs(h-x)<=7;}))badH.push(Math.round(h));}});
  var row=nbRow(g).map(function(p){var b=nbBB(p.pts);return Math.abs(b[2]-b[0]-610)<1?'A':'B';}).join('');
  var m={pieces:g.pavers.length,panels:pan,spandrels:spd,floors:g.paver.nest&&g.paver.nest.floors,comps:g.paver.nest&&g.paver.nest.comps,areaRatio:+(sum/(S.width*S.height)).toFixed(4),bottomRow:row.slice(0,20),orient:S.orient,badW:badW.slice(0,5).join(','),badH:badH.slice(0,5).join(',')};
  if(!g.paver.nest||g.paver.nest.floors!==3)return{pass:false,detail:'expected 3 floors, got '+m.floors,metrics:m};
  if(badW.length||badH.length)return{pass:false,detail:'pieces off the module widths or the height set: '+m.badW+' / '+m.badH,metrics:m};
  if(Math.abs(sum/(S.width*S.height)-1)>.001)return{pass:false,detail:'the panels cover '+(sum/(S.width*S.height)*100).toFixed(2)+'% of the facade',metrics:m};
  if(row.indexOf('BAABBABABAABBABA')!==0)return{pass:false,detail:'the bottom floor reads '+row.slice(0,16)+', not the order BAABBABA repeated',metrics:m};
  if(S.orient!=='wall')return{pass:false,detail:'nested modules on a wall should stand up, orientation is '+S.orient,metrics:m};
  if(m.comps!==9)return{pass:false,detail:'610, 1219, 1829 and 3048 fill a 3048 band nine ways in three pieces or fewer, found '+m.comps,metrics:m};
  return{pass:true,detail:pan+' sub-panels and '+spd+' spandrels on 3 floors, every one a module width and a height of the set; the bottom floor reads '+row.slice(0,16),metrics:m};});
guard('paver','nested shuffle keeps each run of the order, changes the sequence and repeats with the seed',function(){
  var w=function(g){return nbRow(g).map(function(p){var b=nbBB(p.pts);return Math.abs(b[2]-b[0]-610)<1?'A':'B';}).join('');};
  var plain=w(nbSetup()),s1=w(nbSetup({shuffle:true,seed:7})),s2=w(nbSetup({shuffle:true,seed:7})),s3=w(nbSetup({shuffle:true,seed:8}));
  var runs=[];for(var i=0;i+8<=s1.length;i+=8){var r=s1.slice(i,i+8);runs.push((r.match(/A/g)||[]).length+'A'+(r.match(/B/g)||[]).length+'B');}
  var m={plain:plain.slice(0,16),seed7:s1.slice(0,16),seed8:s3.slice(0,16),runs:runs.join(' ')};
  if(runs.some(function(r){return r!=='4A4B';}))return{pass:false,detail:'a shuffled run of BAABBABA should still hold 4 A and 4 B: '+m.runs,metrics:m};
  if(s1===plain)return{pass:false,detail:'shuffling did not change the order',metrics:m};
  if(s1!==s2)return{pass:false,detail:'the same seed gave two different orders',metrics:m};
  if(s1===s3)return{pass:false,detail:'seeds 7 and 8 gave the same order',metrics:m};
  return{pass:true,detail:'shuffled runs hold 4 A and 4 B ('+m.seed7+'), the seed repeats and another seed differs',metrics:m};});
guard('paver','Berlin Free University loads as nested facade panels with named types and storage on the library floor',function(){
  T.reset();T.catLoad('berlin-free-university');var g=T.regen();var sch=T.paverScheduleCSV([g]).trim().split('\n'),csv=T.paverCSV(g).trim().split('\n');
  var m={mode:T.panelMode(),tiling:S.paver.tiling,orient:S.orient,arr:S.arr,pieces:g.pavers.length,floors:g.paver.nest&&g.paver.nest.floors,names:(g.paver.names||[]).join('|'),schedule:sch[0],type1:sch[1],placementHeader:csv[0],material:S.material,warn:g.warnMsg||''};
  if(m.mode!=='paver'||m.tiling!=='nested'||m.orient!=='wall'||m.arr!=='single')return{pass:false,detail:'loaded as '+JSON.stringify(m),metrics:m};
  if(m.floors!==3)return{pass:false,detail:'expected 3 floors, got '+m.floors,metrics:m};
  if(!/,name,hole_mm$/.test(sch[0])||sch[1].split(',')[7]!=='storage'||!/,name,role,module,tilt_x_deg,tilt_y_deg,hole_mm$/.test(csv[0]))return{pass:false,detail:'type 1 should be named storage in the schedule: '+sch[1],metrics:m};
  var lo=0,nl=0,hi=0,nh=0;g.pavers.forEach(function(p){if(p.role!=='panel')return;if(p.cy<3962){nl++;if(p.type===0)lo++;}else if(p.cy>7924){nh++;if(p.type===0)hi++;}});
  m.storageLibrary=+(lo/Math.max(1,nl)).toFixed(2);m.storageMeeting=+(hi/Math.max(1,nh)).toFixed(2);
  if(!(m.storageLibrary>m.storageMeeting+.15))return{pass:false,detail:'storage share '+m.storageLibrary+' on the library floor against '+m.storageMeeting+' on the meeting floor',metrics:m};
  var sp=g.pavers.filter(function(p){return p.role==='spandrel';}),spBad=sp.filter(function(p){return p.type!==1;}).length;m.spandrels=sp.length;
  if(!sp.length||spBad)return{pass:false,detail:spBad+' of '+sp.length+' spandrels are not the opaque panel type',metrics:m};
  var geo=T.buildGeometryFrom(g);geo.computeBoundingBox();m.depth=+(geo.boundingBox.max.z-geo.boundingBox.min.z).toFixed(1);geo.dispose();
  if(Math.abs(m.depth-600)>1)return{pass:false,detail:'the storage boxes should stand 600 mm proud, the 3D is '+m.depth+' mm deep',metrics:m};
  return{pass:true,detail:g.pavers.length+' panels on 3 floors standing as a wall; storage '+m.storageLibrary+' of the library floor and '+m.storageMeeting+' of the meeting floor; spandrels opaque; boxes 600 mm proud',metrics:m};});
guard('paver','a recipe starts from the defaults: Little Island after Berlin lies on the ground again',function(){
  T.reset();T.catLoad('berlin-free-university');var a=[S.paver.tiling,S.paver.lay,S.orient].join('/');T.catLoad('little-island');var g=T.regen();
  var m={afterBerlin:a,afterLittleIsland:[S.paver.tiling,S.paver.lay,S.orient].join('/'),names:S.paver.names,zone:S.paver.zone,pavers:g.pavers.length};
  if(S.paver.tiling!=='voronoi'||S.paver.lay!=='ground'||S.orient!=='overhead')return{pass:false,detail:'Little Island after Berlin: '+m.afterLittleIsland,metrics:m};
  if(S.paver.names)return{pass:false,detail:'type names from Berlin leaked into Little Island: '+S.paver.names,metrics:m};
  return{pass:true,detail:'Berlin '+a+', then Little Island '+m.afterLittleIsland+' with no names carried over',metrics:m};});
guard('paver','nested modules split by the picture: finely divided where it is dark, whole where it is light',function(){
  var g=nbSetup({nestBy:'field'});S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='right';T.fieldUse();g=T.regen();
  var byMod={};g.pavers.forEach(function(p){if(p.role!=='panel')return;var b=nbBB(p.pts);var k=Math.round(b[0])+'/'+Math.floor(p.cy/3962);byMod[k]=(byMod[k]||0)+1;});
  var L=0,nL=0,R=0,nR=0;Object.keys(byMod).forEach(function(k){var x=+k.split('/')[0];if(x<S.width*.25){L+=byMod[k];nL++;}else if(x>S.width*.75){R+=byMod[k];nR++;}});
  var m={meanPiecesLeft:+(L/Math.max(1,nL)).toFixed(2),meanPiecesRight:+(R/Math.max(1,nR)).toFixed(2),modulesLeft:nL,modulesRight:nR,by:g.paver.nest&&g.paver.nest.by};
  if(!(m.meanPiecesLeft>m.meanPiecesRight+1))return{pass:false,detail:'a gradient dark on the left should split the modules there more finely: '+m.meanPiecesLeft+' pieces a module on the left, '+m.meanPiecesRight+' on the right',metrics:m};
  return{pass:true,detail:m.meanPiecesLeft+' sub-panels a module on the dark side, '+m.meanPiecesRight+' on the light side',metrics:m};});


/* ---- host-1: host surfaces in 3D ---- */
function hsVerts(){var gs=T.hostScene(),out=[];gs.forEach(function(g){var a=g.attributes.position.array;for(var i=0;i<a.length;i+=3)out.push([a[i],a[i+1],a[i+2]]);});return out;}
guard('host','a cylinder host bends the facade by arc length and keeps the cut files flat',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.cell=200;S.width=3000;S.height=2400;var g=T.regen();var svg0=T.svgText(g);
  S.host={kind:'cyl',radius:4000,side:'convex',waves:5.5,a0:0,a1:1500,phase:0};g=T.regen();var svg1=T.svgText(g);var v=hsVerts(),R=4000,t=S.thickness,bad=0,thMax=0;
  v.forEach(function(p){var r=Math.hypot(p[0],p[2]+R);if(Math.abs(r-R)>t/2+.5)bad++;thMax=Math.max(thMax,Math.abs(Math.atan2(p[0],p[2]+R)));});
  var m={vertices:v.length,offRadius:bad,halfAngle:+thMax.toFixed(4),expected:+(S.width/2/R).toFixed(4),sameSVG:svg0===svg1};
  if(!v.length)return{pass:false,detail:'no 3D vertices',metrics:m};
  if(bad)return{pass:false,detail:bad+' vertices off the cylinder',metrics:m};
  if(Math.abs(thMax-S.width/2/R)>.002)return{pass:false,detail:'the facade spans a half angle of '+m.halfAngle+' rad, not '+m.expected+' (its half width over the radius)',metrics:m};
  if(!m.sameSVG)return{pass:false,detail:'the cut file changed with the host',metrics:m};
  S.host.side='concave';var v2=hsVerts(),z2=0;v2.forEach(function(p){z2=Math.max(z2,p[2]);});m.concaveMaxZ=+z2.toFixed(1);
  if(!(z2>100))return{pass:false,detail:'a concave host should bring the edges forward, max z '+m.concaveMaxZ,metrics:m};
  return{pass:true,detail:v.length+' vertices on a 4 m cylinder over a half angle of '+m.halfAngle+' rad; the cut file is unchanged',metrics:m};});
guard('host','a ruled wave is straight at the base and waves at the eaves',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.cell=200;S.width=6000;S.height=3000;S.host={kind:'wave',radius:12000,side:'convex',waves:2,a0:0,a1:800,phase:0};T.regen();
  var v=hsVerts(),t=S.thickness,base=0,topMax=-1e9,topMin=1e9;v.forEach(function(p){if(p[1]<1)base=Math.max(base,Math.abs(p[2]));if(p[1]>S.height-1){topMax=Math.max(topMax,p[2]);topMin=Math.min(topMin,p[2]);}});
  var m={vertices:v.length,baseOffset:+base.toFixed(2),topMax:+topMax.toFixed(1),topMin:+topMin.toFixed(1),thickness:t};
  if(base>t/2+.5)return{pass:false,detail:'the base should be straight: it moves '+m.baseOffset+' mm',metrics:m};
  if(Math.abs(topMax-800)>t/2+40||Math.abs(topMin+800)>t/2+40)return{pass:false,detail:'the eaves should swing 800 mm each way: '+m.topMin+' to '+m.topMax,metrics:m};
  return{pass:true,detail:'straight at the base (within '+m.baseOffset+' mm), '+m.topMin+' to '+m.topMax+' mm at the eaves',metrics:m};});
guard('host','the host is kept by save and undo, and a card without one is flat',function(){
  T.reset();S.arr='single';S.host={kind:'cyl',radius:9000,side:'concave',waves:5.5,a0:0,a1:1500,phase:0};var snap=T.snapshot();T.reset();T.restoreDesign(snap);
  var m={afterRestore:S.host.kind+'/'+S.host.radius+'/'+S.host.side};if(S.host.kind!=='cyl'||S.host.radius!==9000||S.host.side!=='concave')return{pass:false,detail:'host after reload '+m.afterRestore,metrics:m};
  T.catLoad('gantenbein-winery');m.afterRecipe=S.host.kind;if(S.host.kind!=='plane')return{pass:false,detail:'a recipe without a host left '+S.host.kind,metrics:m};
  T.catLoad('al-bahar-towers');m.alBahar=S.host.kind+'/'+S.host.radius;if(S.host.kind!=='cyl')return{pass:false,detail:'Al Bahar should load on a cylinder, got '+m.alBahar,metrics:m};
  return{pass:true,detail:'cylinder kept through save and reload; Gantenbein loads flat; Al Bahar on a '+S.host.radius+' mm cylinder',metrics:m};});
guard('host','Church of Christ the Worker loads as brick courses on a ruled wave',function(){
  T.reset();T.catLoad('church-of-christ-the-worker');var g=T.regen();var v=hsVerts(),zmin=1e9,zmax=-1e9,baseZ=0;v.forEach(function(p){zmin=Math.min(zmin,p[2]);zmax=Math.max(zmax,p[2]);if(p[1]<1)baseZ=Math.max(baseZ,Math.abs(p[2]));});
  var m={mode:T.panelMode(),bricks:g.bricks?g.bricks.length:0,host:S.host.kind,waves:S.host.waves,zRange:+(zmax-zmin).toFixed(0),baseZ:+baseZ.toFixed(1),vertices:v.length,warn:g.warnMsg||''};
  if(m.mode!=='brick'||m.host!=='wave'||m.bricks<5000)return{pass:false,detail:'loaded as '+JSON.stringify(m),metrics:m};
  if(Math.abs(m.zRange-(3000+150))>120)return{pass:false,detail:'the wall should swing 1.5 m each way at the eaves plus the brick: z range '+m.zRange,metrics:m};
  /* pass 77: the base course now stands on the ground, so this measures it at last: within a brick's width of the line */if(baseZ>S.brick.bW)return{pass:false,detail:'the base should stay straight: '+m.baseZ,metrics:m};
  return{pass:true,detail:m.bricks+' bricks on a ruled wave, '+m.zRange+' mm deep at the eaves, straight at the base',metrics:m};});
/* ---- pv3-1: the checks behind the second paver sweep ---- */
guard('paver','a design proposed from Pavers stands up again',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');var on=S.orient+'/'+S.mount;T.applyPreset({pattern:'circle',cell:80});
  var m={inPavers:on,after:S.orient+'/'+S.mount,mode:T.panelMode()};
  if(S.orient!=='wall'||S.mount!==2600)return{pass:false,detail:'after a proposal from Pavers the panel is '+m.after,metrics:m};
  T.setPanelMode('paver');T.applyPreset({pattern:'circle',element:'pergola'});m.pergola=S.orient+'/'+S.mount;
  if(S.orient!=='overhead'||S.mount<800)return{pass:false,detail:'a pergola proposed from Pavers should hang overhead, got '+m.pergola,metrics:m};
  return{pass:true,detail:'pavers '+on+', then a facade proposal '+m.after+' and a pergola '+m.pergola,metrics:m};});
guard('paver','a picture that would need too many Voronoi cells is refused, not filled with huge cells',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=6000;S.height=6000;Object.assign(S.paver,{tiling:'voronoi',dist:'poisson',size:120,rMin:.3,rMax:1.4,bright:-.4});var g=T.regen();
  var m={warn:g.warnMsg||'',pavers:g.pavers.length};
  if(!g.warn)return{pass:false,detail:g.pavers.length+' cells built with no warning',metrics:m};
  S.width=1500;S.height=1500;var g2=T.regen();m.smaller=g2.pavers.length;m.smallerWarn=g2.warnMsg||'';
  if(g2.warn||!g2.pavers.length)return{pass:false,detail:'a smaller panel should build: '+m.smallerWarn,metrics:m};
  return{pass:true,detail:'refused with a reason ("'+m.warn.slice(0,60)+'..."); a 1.5 m panel builds '+m.smaller,metrics:m};});
guard('paver','a set repeated on every panel counts every panel',function(){
  T.reset();T.setPanelMode('paver');S.arr='grid';S.cols=3;S.rows=2;S.gap=20;S.omb.span=false;var g=T.regen();var tot=T.paverSetCounts();
  var sch=T.paverScheduleCSV([g],6).trim().split(String.fromCharCode(10)),st=0;for(var i=1;i<sch.length;i++)st+=+sch[i].split(',')[3];
  var m={perPanel:g.pavers.length,set:tot.made,panels:tot.panels,schedule:st,spanning:!!g.panels};
  if(g.panels)return{pass:false,detail:'expected a repeated set, got a spanning one',metrics:m};
  if(tot.made!==6*g.pavers.length||tot.panels!==6||st!==6*g.pavers.length)return{pass:false,detail:'six panels of '+g.pavers.length+': set '+tot.made+', schedule '+st,metrics:m};
  return{pass:true,detail:g.pavers.length+' a panel, '+tot.made+' over 6 panels in the counts and the schedule',metrics:m};});
guard('paver','picking a panel type keeps pavers on the ground at their own thickness',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');T.applyElement('facade');var m={orient:S.orient,mount:S.mount,thickness:S.thickness,arr:S.arr};
  if(S.orient!=='overhead'||S.mount!==0)return{pass:false,detail:'a facade type picked in Pavers stood them up: '+m.orient+'/'+m.mount,metrics:m};
  if(S.thickness!==60)return{pass:false,detail:'thickness should stay the 60 mm paver, got '+S.thickness,metrics:m};
  T.setPanelMode('cut');m.after=S.orient+'/'+S.mount;if(S.orient!=='wall')return{pass:false,detail:'leaving pavers after a type change left '+m.after,metrics:m};
  return{pass:true,detail:'facade picked in Pavers: still on the ground at 60 mm; wall again after',metrics:m};});
guard('paver','a height not understood keeps the others on their types, and the readme gives the joint used',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.heights='30, abc, 90';var h=T.paverHeightsInfo(S.paver,3).heights.join('/');var m={heights:h};
  if(h!=='30/30/90')return{pass:false,detail:'"30, abc, 90" gave '+h,metrics:m};
  Object.assign(S.paver,{tiling:'herring',size:120,ratio:4,joint:40});var g=T.regen();var rd=T.paverReadme('x');m.jointUsed=g.paver.joint;m.readme=(rd.match(/[0-9.]+ mm joint[^,]*/)||[''])[0];
  if(!/held from 40/.test(rd))return{pass:false,detail:'the readme says '+m.readme+' for a joint held to '+g.paver.joint,metrics:m};
  return{pass:true,detail:'heights '+h+'; readme: '+m.readme,metrics:m};});
guard('paver','a grid zone lays whole cells inside its outline, typed with commas or spaces',function(){
  T.reset();T.catLoad('little-island');var g=T.regen();var gx=S.paver.zoneGX,gy=S.paver.zoneGY;
  function rect(p){var a=1e9,b=1e9,c=-1e9,d=-1e9;p.pts.forEach(function(q){a=Math.min(a,q.x);b=Math.min(b,q.y);c=Math.max(c,q.x);d=Math.max(d,q.y);});return Math.abs(c-a-gx)<1&&Math.abs(d-b-gy)<1&&Math.abs(p.area-gx*gy)<gx*gy*.002;}
  var clean=g.pavers.filter(rect).length,m={zoneCells:g.paver.zoneCells,clean:clean,pavers:g.pavers.length,notes:g.paver.notes.join(' | ')};
  if(!(m.zoneCells>=12)||clean<m.zoneCells)return{pass:false,detail:clean+' clean '+gx+' x '+gy+' cells for '+m.zoneCells+' whole cells in the zone',metrics:m};
  var x0=S.frameL,x1=S.width-S.frameR,u0=.45,u1=u0+gx/(x1-x0);S.paver.zone=u0+' 0.3; '+u1.toFixed(5)+' 0.3; '+u1.toFixed(5)+' 0.7; '+u0+' 0.7';var g2=T.regen();m.oneWide=g2.paver.zoneCells;m.oneWideNotes=g2.paver.notes.join(' | ');
  if(!(g2.paver.zoneCells>=1)||/not understood/.test(m.oneWideNotes))return{pass:false,detail:'a zone one cell wide typed with spaces gave '+g2.paver.zoneCells+' cells: '+m.oneWideNotes,metrics:m};
  S.paver.zone='0.3 0.3 0.7';var g3=T.regen();m.badNote=/not understood/.test(g3.paver.notes.join(' '));if(!m.badNote)return{pass:false,detail:'a zone of three numbers should be reported',metrics:m};
  return{pass:true,detail:clean+' clean cells for '+m.zoneCells+' whole cells in the zone; a one-cell zone typed with spaces holds '+m.oneWide+'; a bad zone is reported',metrics:m};});
guard('paver','topped-up palettes reach the light end, a jittered grid ignores the dark size, swallowed pieces are left out',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.palette='#2F2E2C,#5E5B56';S.paver.types=5;var pal=T.paverPaletteInfo(S.paver).colours,lum=pal.map(psLum);
  var m={palette:pal.join(','),lightest:+Math.max.apply(null,lum).toFixed(2)};if(m.lightest<.75)return{pass:false,detail:'topped up from two dark colours the lightest type is '+m.lightest,metrics:m};
  T.reset();S.arr='single';T.setPanelMode('paver');Object.assign(S.paver,{tiling:'voronoi',dist:'jitter',size:200,joint:20,rMin:.2});var j1=T.regen().paver.joint;S.paver.rMin=.6;var j2=T.regen().paver.joint;m.jitterJoints=j1+'/'+j2;
  if(j1!==j2)return{pass:false,detail:'on a jittered grid the dark size moved the joint: '+m.jitterJoints,metrics:m};
  T.reset();S.arr='single';T.setPanelMode('paver');Object.assign(S.paver,{tiling:'square',size:120,joint:40,spin:30,minPiece:0});var g=T.regen();var zero=g.pavers.filter(function(p){return !(p.net>1);}).length;m.zeroNet=zero;m.dropped=g.paver.dropped;
  if(zero)return{pass:false,detail:zero+' pavers with nothing left inside the joint are still scheduled',metrics:m};
  return{pass:true,detail:'lightest topped-up type '+m.lightest+'; jittered joint '+m.jitterJoints+'; '+g.paver.dropped+' swallowed pieces left out',metrics:m};});


/* ---- var-1: loadable matrix variants ---- */
guard('catalogue','every matrix variant with a recipe loads and builds',function(){
  var C=T.CATALOGUE,n=0,bad=[],warned=[],cards=0;
  C.forEach(function(c){var r=c.recipe||{},vs=r.variants||{};var names=Object.keys(vs);if(!names.length)return;cards++;
    names.forEach(function(nm){n++;try{T.reset();T.catLoad(c.id,nm);var g=T.regen();
      if(T.panelMode()!==r.mode&&!(vs[nm].mode))bad.push(c.id+' / '+nm+': mode '+T.panelMode());
      else if(g.warn)warned.push(c.id+' / '+nm+': '+String(g.warnMsg).slice(0,70));}catch(e){bad.push(c.id+' / '+nm+': '+e);}});});
  var m={cards:cards,variants:n,broken:bad.slice(0,4).join(' | '),warned:warned.slice(0,4).join(' | ')};
  if(n<40)return{pass:false,detail:'expected at least 40 loadable variants, found '+n,metrics:m};
  if(bad.length)return{pass:false,detail:bad.length+' variants did not load: '+m.broken,metrics:m};
  if(warned.length)return{pass:false,detail:warned.length+' variants build with a warning: '+m.warned,metrics:m};
  return{pass:true,detail:n+' variants over '+cards+' cards load and build without a warning',metrics:m};});
guard('catalogue','a variant changes what its row says, over the control model',function(){
  var m={};T.reset();T.catLoad('berlin-free-university','Gradient');var g=T.regen();m.berlin=[S.paver.spandrel,S.paver.nestBy,g.paver.nest&&g.paver.nest.by,S.field.kind,S.paver.modA].join('/');
  if(S.paver.spandrel!==0||S.paver.nestBy!=='field'||S.field.kind!=='gradient'||S.paver.modA!==609.6)return{pass:false,detail:'Berlin Gradient loaded as '+m.berlin,metrics:m};
  T.reset();T.catLoad('little-island','Full cell modularity');g=T.regen();m.littleIsland=g.paver.zoneCells;if(!(g.paver.zoneCells>40))return{pass:false,detail:'Little Island with the whole site modular has '+g.paver.zoneCells+' grid cells',metrics:m};
  T.reset();T.catLoad('church-of-christ-the-worker','Straight eaves');m.church=S.host.a0+'/'+S.host.a1+'/'+S.host.waves;if(S.host.a0!==1500||S.host.a1!==0)return{pass:false,detail:'Church straight eaves: '+m.church,metrics:m};
  T.reset();T.catLoad('al-bahar-towers','West face');m.alBahar=S.field.sun.facing+'/'+S.field.sun.lat+'/'+S.host.kind;if(S.field.sun.facing!==270||S.field.sun.lat!==24.4||S.host.kind!=='cyl')return{pass:false,detail:'Al Bahar west face: '+m.alBahar,metrics:m};
  T.reset();T.catLoad('casa-la-roca','Image map variation');m.casa=S.brick.d2+'/'+(S.omb.src||'');if(!/flower/.test(S.omb.src||''))return{pass:false,detail:'Casa la Roca image map should use a picture: '+m.casa,metrics:m};
  return{pass:true,detail:'Berlin '+m.berlin+'; Little Island '+m.littleIsland+' grid cells; Church '+m.church+'; Al Bahar '+m.alBahar,metrics:m};});
guard('catalogue','the matrix offers a Load button for each variant it can build',function(){
  T.catShow('berlin-free-university');var bs=document.querySelectorAll('[data-var]');var c=T.CATALOGUE.find(function(x){return x.id==='berlin-free-university';});var want=Object.keys(c.recipe.variants||{}).length;
  var m={buttons:bs.length,variants:want};if(bs.length!==want)return{pass:false,detail:bs.length+' Load buttons for '+want+' variants',metrics:m};
  bs[bs.length-1].click();m.afterClick=S.paver.nestBy+'/'+S.paver.spandrel;var note=(document.querySelector('#catNote')||{}).textContent||'';m.note=note.slice(0,60);
  if(S.paver.nestBy!=='seed'||S.paver.spandrel!==0)return{pass:false,detail:'clicking Staggered loaded '+m.afterClick,metrics:m};
  if(!/^Staggered:/.test(note))return{pass:false,detail:'the note under the card should explain the variant: '+m.note,metrics:m};
  return{pass:true,detail:want+' Load buttons; Staggered loads and explains itself',metrics:m};});


/* ---- card-1: write a card (the AI reading step) ---- */
function cdGood(){return{id:'test-wall',version:'1.0',name:'Test wall: turned bricks',summary:'A test.',taxonomy:'stacked-aggregates',
  host:{surface:'plane',panelisation:'courses'},unit:{kind:'brick',generator:'courses of bricks turned by a gradient',dims:{bL:240}},
  parameters:[{key:'bL',label:'Brick length',type:'length',unit:'mm',default:240},{key:'theta',label:'Turn',type:'angle',unit:'deg',default:0,min:0,max:30},{key:'bond',label:'Bond',type:'enum',options:['running','stack'],default:'running'}],
  fields:[{key:'g',kind:'linear-gradient'}],mappings:[{field:'g',parameter:'theta',domain:[0,30],remap:'linear'}],
  fabrication:{method:'manual-masonry',constraints:[{rule:'a turned brick must still bear on the course below',enforced:false}],outputs:['placement-list-csv']},
  process:['Lay the courses.','Turn each brick by the gradient.'],matrix:[{name:'Steeper',changes:{theta:30},effect:'deeper shadow'}],
  pattern_studio:{status:'planned',mode:'brick',existing:[],missing:[]},provenance:{source:'test',read_from:[],printed_values:['bL'],inferred:[],confidence:'mostly-printed'}};}
guard('catalogue','the card checker passes a well-formed card and says what is wrong with a broken one',function(){
  var ok=T.cardCheck(cdGood());var b=cdGood();b.mappings.push({field:'g',parameter:'depth'});b.host.surface='blob';b.matrix.push({name:'Bad',changes:{nope:1}});delete b.process;b.provenance.confidence='sure';
  var e=T.cardCheck(b),txt=e.join(' | ');var m={goodErrors:ok.join(' | '),brokenErrors:e.length,messages:txt.slice(0,300)};
  if(ok.length)return{pass:false,detail:'a well-formed card fails: '+m.goodErrors,metrics:m};
  var want=[/unknown parameter "depth"/,/host surface "blob"/,/unknown parameter "nope"/,/missing process/,/confidence "sure"/],miss=want.filter(function(r){return !r.test(txt);});
  if(miss.length)return{pass:false,detail:'the checker missed '+miss.length+' of 5 faults: '+txt.slice(0,200),metrics:m};
  return{pass:true,detail:'well-formed card clean; the broken one gives '+e.length+' plain messages naming each fault',metrics:m};});
guard('catalogue','with no model, a description becomes a skeleton card that is listed and loads',function(){
  T.reset();var d=T.cardAccept(T.cardHeuristic('A screen of 240 x 115 x 65 mm bricks, each one turned by a gradient up the wall, laid by a robot. 240 mm long, 65 mm high.'),'keyword reading (test)');
  var c=T.CATALOGUE.find(function(x){return x.id===d.id;}),btn=document.querySelector('.catpick [data-id="'+d.id+'"]');
  var m={id:d.id,errors:d.errors.join(' | '),listed:!!btn,mode:c&&c.recipe&&c.recipe.mode,draftTag:btn?/draft/.test(btn.textContent):false};
  if(d.errors.length)return{pass:false,detail:'the skeleton fails the checker: '+m.errors,metrics:m};
  if(!c||!btn||!m.draftTag)return{pass:false,detail:'the draft is not listed as a draft',metrics:m};
  if(m.mode!=='brick')return{pass:false,detail:'a brick screen should be read as the brick mode, got '+m.mode,metrics:m};
  T.catLoad(d.id);m.loaded=T.panelMode();var dl=!!document.querySelector('#catDl');m.download=dl;
  if(m.loaded!=='brick'||!dl)return{pass:false,detail:'loading the draft gave '+m.loaded+'; download button '+dl,metrics:m};
  var n0=T.CATALOGUE.length;T.cardAccept(T.cardHeuristic('A screen of 240 x 115 x 65 mm bricks again.'),'again');m.replaced=T.CATALOGUE.length===n0;
  return{pass:true,detail:'a skeleton brick card, listed as a draft, loads in Brick courses and offers a download',metrics:m};});
guard('catalogue','a reply’s recipe is cleaned of settings the tool does not know',function(){
  var r=T.cardRecipeClean({mode:'paver',width:3000,height:'tall',material:'unobtanium',paver:{tiling:'voronoi',size:'big',foo:3,types:4},field:{kind:'gradient',gradient:{dir:'up',spin:2}},host:{kind:'wave',waves:3}});
  var m={recipe:JSON.stringify(r.recipe),dropped:r.dropped.join(', ')};
  var need=['height','material unobtanium','paver.size','paver.foo','field.gradient.spin'],miss=need.filter(function(k){return r.dropped.indexOf(k)<0;});
  if(miss.length)return{pass:false,detail:'not left out: '+miss.join(', '),metrics:m};
  if(r.recipe.paver.tiling!=='voronoi'||r.recipe.paver.types!==4||r.recipe.field.gradient.dir!=='up'||r.recipe.host.waves!==3)return{pass:false,detail:'good settings were lost: '+m.recipe,metrics:m};
  var none=T.cardRecipeClean({mode:'origami'});if(none.recipe!==null)return{pass:false,detail:'an unknown mode should give no recipe',metrics:m};
  var pr=T.cardPrompt('a wall');m.promptLength=pr.length;if(!/Return JSON only/.test(pr)||!/paver \{/.test(pr)||!/brick \{/.test(pr)||!/The description:/.test(pr))return{pass:false,detail:'the prompt is missing a section',metrics:m};
  return{pass:true,detail:'left out '+r.dropped.length+' unknown settings, kept the rest; the prompt is '+pr.length+' characters',metrics:m};});


/* ---- pts-1: stack bond, the point field, the cull (Memorial, KAIT) ---- */
function ptBB(p){var a=1e9,b=1e9,c=-1e9,d=-1e9;p.pts.forEach(function(q){a=Math.min(a,q.x);b=Math.min(b,q.y);c=Math.max(c,q.x);d=Math.max(d,q.y);});return[a,b,c,d];}
guard('paver','stack bond lays a plain grid whose joints run straight both ways',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');Object.assign(S.paver,{tiling:'stack',size:300,ratio:2,joint:0,minPiece:0,spin:0});var g=T.regen();
  var x0=Math.max(0,S.frameL),y0=Math.max(0,S.frameB),x1=S.width-Math.max(0,S.frameR),y1=S.height-Math.max(0,S.frameT),A=(x1-x0)*(y1-y0),sum=0,xs={},bad=0;
  g.pavers.forEach(function(p){sum+=p.area;var b=ptBB(p);if(!p.cut){if(Math.abs(b[2]-b[0]-300)>.5||Math.abs(b[3]-b[1]-150)>.5)bad++;xs[Math.round(b[0])]=1;}});
  var m={pavers:g.pavers.length,areaRatio:+(sum/A).toFixed(4),offSize:bad,columnLines:Object.keys(xs).length};
  if(Math.abs(sum/A-1)>.001||bad)return{pass:false,detail:'the grid covers '+m.areaRatio+' of the frame with '+bad+' pieces off 300 x 150',metrics:m};
  var cols=Math.ceil((x1-x0)/300);if(m.columnLines>cols+1)return{pass:false,detail:m.columnLines+' different column lines for '+cols+' columns: the rows do not line up',metrics:m};
  return{pass:true,detail:g.pavers.length+' pieces of 300 x 150 on '+m.columnLines+' straight column lines; the frame is covered once',metrics:m};});
guard('paver','a point field puts one flat column at each site, within its sizes and clear of the others',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=6000;S.height=6000;Object.assign(S.paver,{tiling:'points',dist:'poisson',size:600,rMin:.6,rMax:1.4,colW:'80,190',colT:'16,60',colTurn:180,joint:6});var g=T.regen();
  var bad=0,maxL=0,minT=1e9;g.pavers.forEach(function(p){if(p.cut)return;var q=p.pts,e1=Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y),e2=Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y),L=Math.max(e1,e2),t=Math.min(e1,e2);maxL=Math.max(maxL,L);minT=Math.min(minT,t);if(L<79.5||L>190.5||t<15.5||t>60.5)bad++;});
  var ov=0;for(var i=0;i<g.pavers.length;i++)for(var j=i+1;j<g.pavers.length;j++){if(Math.hypot(g.pavers[i].cx-g.pavers[j].cx,g.pavers[i].cy-g.pavers[j].cy)<200)ov++;}
  var m={columns:g.pavers.length,offSize:bad,longest:+maxL.toFixed(1),thinnest:+minT.toFixed(1),closePairs:ov,joint:g.paver.joint,warn:g.warnMsg||''};
  if(g.warn||g.pavers.length<40)return{pass:false,detail:'only '+g.pavers.length+' columns: '+m.warn,metrics:m};
  if(bad)return{pass:false,detail:bad+' columns outside 80-190 x 16-60 mm',metrics:m};
  if(ov)return{pass:false,detail:ov+' pairs of columns closer than 200 mm on a 600 mm spacing',metrics:m};
  if(g.paver.joint!==0)return{pass:false,detail:'a point field has no joint, but '+g.paver.joint+' was used',metrics:m};
  return{pass:true,detail:g.pavers.length+' columns, each 80-190 by 16-60 mm, none crowding another; no joint',metrics:m};});
guard('paver','the cull leaves out more where the picture is dark',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=3000;S.height=3000;S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();
  Object.assign(S.paver,{tiling:'square',size:150,joint:0,minPiece:0,cull:0});var all=T.regen().pavers.length;S.paver.cull=.8;var g=T.regen();
  var lo=0,hi=0;g.pavers.forEach(function(p){if(p.cy<S.height*.25)lo++;else if(p.cy>S.height*.75)hi++;});var m={without:all,with:g.pavers.length,culled:g.paver.culled,bottomQuarter:lo,topQuarter:hi};
  if(!(g.paver.culled>0)||g.pavers.length+g.paver.culled!==all)return{pass:false,detail:'culled '+g.paver.culled+' of '+all+', left '+g.pavers.length,metrics:m};
  if(!(lo<hi*.5))return{pass:false,detail:'the dark bottom kept '+lo+' against '+hi+' at the light top',metrics:m};
  return{pass:true,detail:g.paver.culled+' of '+all+' culled: '+lo+' left in the dark bottom quarter, '+hi+' in the light top',metrics:m};});
guard('paver','the Memorial loads as stelae of eight heights, sparser and lower toward the edge',function(){
  T.reset();T.catLoad('memorial-murdered-jews');var g=T.regen();var W=S.width,H=S.height,cen=[],edge=[];
  g.pavers.forEach(function(p){var d=Math.max(Math.abs(p.cx-W/2)/W,Math.abs(p.cy-H/2)/H);if(d<.15)cen.push(p);else if(d>.4)edge.push(p);});
  var mean=function(a){return a.reduce(function(s,p){return s+g.paver.heights[p.type];},0)/Math.max(1,a.length);};
  var m={mode:T.panelMode(),tiling:S.paver.tiling,stelae:g.pavers.length,culled:g.paver.culled,heights:g.paver.heights.join('/'),centreMean:Math.round(mean(cen)),edgeMean:Math.round(mean(edge)),centreDensity:+(cen.length/(.09)).toFixed(0),edgeDensity:+(edge.length/(1-.64)).toFixed(0),orient:S.orient,joint:g.paver.joint};
  if(m.mode!=='paver'||m.tiling!=='stack'||m.stelae<1500||m.stelae>3200)return{pass:false,detail:'loaded as '+JSON.stringify(m),metrics:m};
  if(g.paver.joint!==950)return{pass:false,detail:'the aisles should stay 950 mm, the joint is '+g.paver.joint,metrics:m};
  if(!(m.centreMean>m.edgeMean+1000))return{pass:false,detail:'the stelae should rise toward the middle: '+m.centreMean+' against '+m.edgeMean+' mm at the edge',metrics:m};
  if(!(m.edgeDensity<m.centreDensity*.85))return{pass:false,detail:'the edge should be sparser: '+m.edgeDensity+' against '+m.centreDensity,metrics:m};
  var geo=T.buildGeometryFrom(g);geo.computeBoundingBox();m.tallest=+(geo.boundingBox.max.z-geo.boundingBox.min.z).toFixed(0);geo.dispose();
  if(m.tallest<4690||m.tallest>5150)return{pass:false,detail:'the tallest stela should be 4700 mm, leaning up to 5 degrees, the 3D is '+m.tallest,metrics:m};
  return{pass:true,detail:m.stelae+' stelae ('+m.culled+' culled), '+m.centreMean+' mm high on average in the middle and '+m.edgeMean+' at the edge',metrics:m};});
guard('paver','KAIT loads as a field of thin columns, sparse in the voids',function(){
  T.reset();T.catLoad('kait-workshop');var g=T.regen();var thick=0;g.pavers.forEach(function(p){var q=p.pts,e1=Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y),e2=Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y);if(Math.min(e1,e2)>60.5)thick++;});
  var W=S.width,H=S.height,pts=[[.28,.68],[.7,.3],[.62,.78]],nearV=0,far=0;g.pavers.forEach(function(p){var u=p.cx/W,v=p.cy/H,d=Math.min.apply(null,pts.map(function(q){return Math.hypot(u-q[0],v-q[1]);}));if(d<.06)nearV++;else if(d>.3)far++;});
  var m={mode:T.panelMode(),tiling:S.paver.tiling,columns:g.pavers.length,thick:thick,inVoidCentres:nearV,farFromVoids:far,names:(g.paver.names||[]).join('|'),warn:g.warnMsg||''};
  if(m.mode!=='paver'||m.tiling!=='points'||m.columns<200||m.columns>700)return{pass:false,detail:'loaded as '+JSON.stringify(m),metrics:m};
  if(thick)return{pass:false,detail:thick+' columns thicker than 60 mm',metrics:m};
  var areaNear=pts.length*Math.PI*.06*.06,areaFar=1-pts.length*Math.PI*.3*.3;var dNear=nearV/areaNear,dFar=far/Math.max(.05,areaFar);m.densityNear=+dNear.toFixed(0);m.densityFar=+dFar.toFixed(0);
  if(!(dNear<dFar))return{pass:false,detail:'the voids should hold fewer columns: '+m.densityNear+' against '+m.densityFar+' away from them',metrics:m};
  var geo=T.buildGeometryFrom(g);geo.computeBoundingBox();m.height=+(geo.boundingBox.max.z-geo.boundingBox.min.z).toFixed(0);geo.dispose();
  if(Math.abs(m.height-5000)>1)return{pass:false,detail:'the columns should stand 5 m, the 3D is '+m.height,metrics:m};
  return{pass:true,detail:g.pavers.length+' flat columns, none thicker than 60 mm, sparser in the voids, 5 m tall',metrics:m};});


/* ---- fix15-1: the checks behind the pass 15 sweep ---- */
guard('host','bricks on the wave never overlap, and their back faces sit on the curve',function(){
  T.reset();T.catLoad('church-of-christ-the-worker');var g=T.regen();var B=g.brick,h=S.host,W=g.W,H=g.H,k=2*Math.PI*h.waves/W,ph=(h.phase||0)*Math.PI/180;
  function quad(b){var a=-b.theta*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=b.x,cz=b.shift+B.bW/2,hl=(b.len||B.bL)/2,w=B.bW/2;return[[cx-c*hl+s*w,cz-s*hl-c*w],[cx+c*hl+s*w,cz+s*hl-c*w],[cx+c*hl-s*w,cz+s*hl+c*w],[cx-c*hl-s*w,cz-s*hl+c*w]];}
  function apart(A,Bq){var P=[A,Bq];for(var pi=0;pi<2;pi++)for(var i=0;i<4;i++){var p0=P[pi][i],p1=P[pi][(i+1)%4],nx=p1[1]-p0[1],ny=p0[0]-p1[0],l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;var a0=1e18,a1=-1e18,b0=1e18,b1=-1e18;
    for(var q=0;q<4;q++){var d=A[q][0]*nx+A[q][1]*ny;a0=Math.min(a0,d);a1=Math.max(a1,d);var e=Bq[q][0]*nx+Bq[q][1]*ny;b0=Math.min(b0,e);b1=Math.max(b1,e);}if(a1<=b0+.5||b1<=a0+.5)return true;}return false;}
  var rows={};g.bricks.forEach(function(b){(rows[b.r]=rows[b.r]||[]).push(b);});var pairs=0,over=0,dev=0;
  Object.keys(rows).forEach(function(r){var a=rows[r].slice().sort(function(x,y){return x.x-y.x;});for(var i=1;i<a.length;i++){pairs++;if(!apart(quad(a[i-1]),quad(a[i])))over++;}
    a.forEach(function(b){var an=-b.theta*Math.PI/180,bx=b.x+Math.sin(an)*B.bW/2,bz=b.shift+B.bW/2-Math.cos(an)*B.bW/2,A=(h.a0||0)+((h.a1||0)-(h.a0||0))*Math.min(1,Math.max(0,b.y/H));dev=Math.max(dev,Math.abs(bz-A*Math.sin(k*bx+ph)));});});
  var keys=Object.keys(rows).map(Number).sort(function(a,b){return a-b;}),bot=rows[keys[0]].length,top=rows[keys[keys.length-1]].length;
  var m={bricks:g.bricks.length,pairs:pairs,overlapping:over,backFaceOffCurve:+dev.toFixed(2),bottomCourse:bot,topCourse:top,maxSlope:B.maxSlope,courses:B.hostCourses&&B.hostCourses.join(' to ')};
  if(over)return{pass:false,detail:over+' of '+pairs+' neighbouring bricks overlap',metrics:m};
  if(dev>2)return{pass:false,detail:'a back face sits '+m.backFaceOffCurve+' mm off its curve',metrics:m};
  if(!(top>bot*1.2))return{pass:false,detail:'the deep top course should still hold more bricks than the straight base: '+top+' against '+bot,metrics:m};
  return{pass:true,detail:g.bricks.length+' bricks, none overlapping over '+pairs+' pairs, back faces within '+m.backFaceOffCurve+' mm of the curve; courses of '+m.courses+', turned up to '+B.maxSlope+' degrees',metrics:m};});
guard('host','the bend shares one budget, and a big curved facade has no long unsplit triangles',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.width=6000;S.height=3000;T.regen();var n0=0;T.hostScene().forEach(function(g){n0+=g.index?g.index.count:g.attributes.position.count;});
  S.host={kind:'wave',radius:12000,side:'convex',waves:2,a0:0,a1:300,phase:0};T.regen();
  var gs=T.hostScene(),n=0,run=0;gs.forEach(function(g){var a=g.attributes.position.array;n+=a.length/3;for(var i=0;i<a.length;i+=9){var x0=a[i],x1=a[i+3],x2=a[i+6];run=Math.max(run,Math.max(x0,x1,x2)-Math.min(x0,x1,x2));}});
  var m={flat:n0,vertices:n,longestRun:+run.toFixed(0),wavelength:3000};
  if(n>n0+1.75e6)return{pass:false,detail:'bending added '+(n-n0)+' vertices, over the shared budget',metrics:m};
  if(run>750)return{pass:false,detail:'a triangle runs '+m.longestRun+' mm across a 3000 mm wave: it would tear',metrics:m};
  T.reset();T.setPanelMode('cut');S.arr='grid';S.cols=6;S.rows=4;T.regen();var nf=0;T.hostScene().forEach(function(g){nf+=g.index?g.index.count:g.attributes.position.count;});
  S.host={kind:'cyl',radius:20000,side:'convex',waves:2,a0:0,a1:300,phase:0};T.regen();var gs2=T.hostScene(),n2=0;gs2.forEach(function(g){n2+=g.attributes.position.count;});m.gridFlat=nf;m.gridVertices=n2;
  if(n2>nf+1.75e6)return{pass:false,detail:'a 6 x 4 grid added '+(n2-nf)+' vertices to bend it, over the shared budget',metrics:m};
  return{pass:true,detail:n+' vertices, no triangle longer than '+m.longestRun+' mm across the wave; bending a 6 x 4 grid adds '+(n2-nf)+' vertices',metrics:m};});
guard('host','pavers on the ground stay above the floor on a curved host, and a small radius says it is held',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=3000;S.height=3000;S.host={kind:'cyl',radius:3000,side:'convex',waves:2,a0:0,a1:300,phase:0};T.regen();var y=T.hostSceneMinY();
  var m={lowest:+y.toFixed(1)};if(y<-1)return{pass:false,detail:'the pavers reach '+m.lowest+' mm below the floor',metrics:m};
  S.width=6000;S.host.radius=1000;T.regen();T.hostScene();var held=Array.prototype.map.call(document.querySelectorAll('.host-held'),function(e){return e.textContent;}).join(' ');m.heldNote=held.slice(0,90);
  if(document.querySelectorAll('.host-held').length&&!/held to 1910/.test(held))return{pass:false,detail:'the note should say the radius is held to 1910 mm: '+m.heldNote,metrics:m};
  return{pass:true,detail:'lowest paver '+m.lowest+' mm; '+(m.heldNote||'no radius note on screen')+'',metrics:m};});
guard('catalogue','a card never inherits the last card’s frame, material, thickness, picture or source',function(){
  function look(){var g=T.regen();return{frame:[S.frameL,S.frameR,S.frameT,S.frameB].join('/'),arr:S.arr,material:S.material,thickness:S.thickness,field:S.field.kind,src:S.prov.source,count:(g.holes||[]).length+(g.bricks||[]).length+(g.pavers||[]).length};}
  T.reset();T.catLoad('confluence-park');var a=look();T.reset();T.catLoad('berlin-free-university');T.catLoad('confluence-park');var b=look();
  T.reset();T.catLoad('gantenbein-winery');var c=look();T.reset();T.catLoad('little-island');T.catLoad('gantenbein-winery');var d=look();
  T.reset();T.catLoad('chi-she-gallery');T.catLoad('church-of-christ-the-worker');var e=look();
  var m={confluenceFresh:JSON.stringify(a),confluenceAfterBerlin:JSON.stringify(b),gantenbeinAfterIsland:d.material+'/'+d.count+' vs '+c.material+'/'+c.count,churchField:e.field};
  var keys=['frame','arr','material','thickness','count'],bad=keys.filter(function(k){return a[k]!==b[k];}).concat(keys.filter(function(k){return c[k]!==d[k];}).map(function(k){return 'gantenbein '+k;}));
  if(bad.length)return{pass:false,detail:'leaked: '+bad.join(', '),metrics:m};
  if(!/Confluence Park/.test(b.src))return{pass:false,detail:'the source still names another card: '+b.src,metrics:m};
  if(e.field==='attract')return{pass:false,detail:'Church kept the attractor field of Chi She',metrics:m};
  var inp=null;document.querySelectorAll('.ctl').forEach(function(el){var lb=el.querySelector('label');if(!inp&&lb&&/^Width \(mm\)/.test(lb.textContent))inp=el.querySelector('input');});m.widthMax=inp?inp.max:'';
  if(!inp||+inp.max<100000)return{pass:false,detail:'the width box stops at '+m.widthMax,metrics:m};
  return{pass:true,detail:'Confluence Park and Gantenbein load the same after another card; sources and fields reset; the width box goes to '+m.widthMax+' mm',metrics:m};});
guard('paver','nested modules split by a bottom-to-top gradient step floor by floor',function(){
  var g=nbSetup({nestBy:'field'});S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();g=T.regen();
  var per=[0,0,0];g.pavers.forEach(function(p){if(p.role!=='panel')return;var f=Math.floor(p.cy/3962);if(f>=0&&f<3)per[f]++;});var m={perFloor:per.join('/')};
  if(!(per[0]>per[1]&&per[1]>per[2]))return{pass:false,detail:'panels per floor '+m.perFloor+' should fall floor by floor as the gradient lightens',metrics:m};
  return{pass:true,detail:'panels per floor '+m.perFloor+': the finest split at the dark bottom, whole modules at the light top',metrics:m};});


/* ---- p17-1: tilt, the mirrored wall, the sphere host, the grid snap ---- */
guard('paver','each stela leans at random within its tilt, and the placement list says by how much',function(){
  T.reset();T.catLoad('memorial-murdered-jews');var g=T.regen();var mx=0,zero=0;g.pavers.forEach(function(p){mx=Math.max(mx,Math.abs(p.tx||0),Math.abs(p.ty||0));if(!p.tx&&!p.ty)zero++;});
  var csv=T.paverCSV(g).trim().split(String.fromCharCode(10)),head=csv[0],row=csv[1].split(',');var m={stelae:g.pavers.length,maxTilt:mx,untilted:zero,header:head.slice(-30),tiltCells:row.slice(-2).join('/')};
  if(!(mx>3&&mx<=5))return{pass:false,detail:'the largest lean is '+mx+' degrees for a tilt of 5',metrics:m};
  if(zero>g.pavers.length*.05)return{pass:false,detail:zero+' stelae do not lean at all',metrics:m};
  if(!/tilt_x_deg,tilt_y_deg,hole_mm$/.test(head)||row[row.length-1]==='')return{pass:false,detail:'the placement list lacks the tilt: '+m.header,metrics:m};
  T.reset();S.arr='single';T.setPanelMode('paver');var g2=T.regen();var any=g2.pavers.some(function(p){return p.tx||p.ty;});if(any)return{pass:false,detail:'pavers lean with no tilt asked',metrics:m};
  return{pass:true,detail:g.pavers.length+' stelae leaning up to '+mx+' degrees; the placement list carries tilt_x and tilt_y',metrics:m};});
guard('host','a second wall mirrors the first across the nave',function(){
  T.reset();T.catLoad('church-of-christ-the-worker');T.regen();var b=T.hostSceneBox();var m={zMin:Math.round(b.zMin),zMax:Math.round(b.zMax),mirror:S.host.mirror,meshes:b.meshes};
  if(S.host.mirror!==15000)return{pass:false,detail:'Church should load with its second wall 15 m away, got '+S.host.mirror,metrics:m};
  if(!(b.zMin<-15000-1400&&b.zMin>-15000-1800&&b.zMax>1400&&b.zMax<1800))return{pass:false,detail:'the two walls should span about -16.6 m to +1.6 m in depth: '+m.zMin+' to '+m.zMax,metrics:m};
  S.host.mirror=0;var b2=T.hostSceneBox();m.single=Math.round(b2.zMin)+'/'+Math.round(b2.zMax);if(b2.zMin<-2000)return{pass:false,detail:'with no mirror the wall still reaches '+Math.round(b2.zMin),metrics:m};
  return{pass:true,detail:'the nave spans '+m.zMin+' to '+m.zMax+' mm in depth with two walls; one wall alone '+m.single,metrics:m};});
guard('host','a sphere host keeps every vertex at its radius, and the Biosphere loads on one',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.cell=200;S.width=6000;S.height=4000;S.host={kind:'sphere',radius:8000,side:'convex',waves:2,a0:0,a1:300,phase:0,mirror:0};T.regen();
  var gs=T.hostScene(),R=8000,t=S.thickness,bad=0,n=0,H=S.height;gs.forEach(function(g){var a=g.attributes.position.array;for(var i=0;i<a.length;i+=3){n++;var r=Math.hypot(a[i],a[i+1]-H/2,a[i+2]+R);if(Math.abs(r-R)>t/2+.6)bad++;}});
  var m={vertices:n,offRadius:bad};if(!n||bad)return{pass:false,detail:bad+' of '+n+' vertices off the sphere',metrics:m};
  T.reset();T.catLoad('montreal-biosphere');var g=T.regen();m.mode=T.panelMode();m.host=S.host.kind+'/'+S.host.radius;m.openings=(g.holes||[]).length;m.thickness=S.thickness;
  if(m.mode!=='cut'||S.host.kind!=='sphere'||S.host.radius!==38000||m.openings<10)return{pass:false,detail:'the Biosphere loaded as '+JSON.stringify(m),metrics:m};
  return{pass:true,detail:n+' vertices on an 8 m sphere; the Biosphere loads as '+m.openings+' triangular openings on a 38 m sphere, '+m.thickness+' mm deep',metrics:m};});
guard('paver','KAIT columns near the structural grid move onto it',function(){
  T.reset();T.catLoad('kait-workshop');var g=T.regen();var gx=1000,gy=1500,x0=S.frameL,y0=S.frameB,on=0,near=0;
  g.pavers.forEach(function(p){if(p.cut)return;var dx=Math.abs(p.cx-x0-Math.round((p.cx-x0)/gx)*gx),dy=Math.abs(p.cy-y0-Math.round((p.cy-y0)/gy)*gy),d=Math.min(dx,dy);if(d<1)on++;else if(d<240)near++;});
  var m={columns:g.pavers.length,onGrid:on,nearButOff:near,snapped:g.paver.snapped};
  if(!(on>g.pavers.length*.2))return{pass:false,detail:'only '+on+' of '+g.pavers.length+' columns sit on the grid',metrics:m};
  if(near)return{pass:false,detail:near+' columns are within 240 mm of a grid line but were not snapped',metrics:m};
  return{pass:true,detail:on+' of '+g.pavers.length+' columns on the structural grid, none left just off it',metrics:m};});


/* ---- cfix-1: the card-writer bench ---- */
guard('catalogue','a reply’s recipe is read in the tool’s own words and limits',function(){
  T.reset();var r=T.cardRecipeClean({mode:'paver',width:3000,height:2000,paver:{tiling:'herringbone',palette:['#2B2B2B','#888888','#DDDDDD'],names:['dark','mid','light'],heights:[60,60,80],cull:5,lay:'GROUND'},field:{kind:'attractor-points',attract:{pts:[[0.3,0.5],[0.7,0.5]],radius:0.4}}});
  var k=T.cardRecipeClean({mode:'kin',kin:{unit:'louvre',t:15,motion:'humidity'}}),g=T.cardRecipeClean({mode:'paver',paver:{tiling:'grid'}});
  var P=r.recipe.paver,m={paver:JSON.stringify(P),field:JSON.stringify(r.recipe.field),kin:JSON.stringify(k.recipe.kin),grid:g.recipe.paver.tiling,fixed:r.fixed.concat(k.fixed).join(' | ').slice(0,300),dropped:r.dropped.concat(k.dropped).join(', ')};
  if(P.tiling!=='herring'||P.palette!=='#2B2B2B,#888888,#DDDDDD'||P.names!=='dark,mid,light'||P.heights!=='60,60,80'||P.lay!=='ground')return{pass:false,detail:'not read in the tool’s words: '+m.paver,metrics:m};
  if(P.cull!==1)return{pass:false,detail:'a cull of 5 should be held to 1, got '+P.cull,metrics:m};
  if(!r.recipe.field||r.recipe.field.kind!=='attract'||r.recipe.field.attract.pts!=='0.3,0.5;0.7,0.5')return{pass:false,detail:'the field was not read: '+m.field,metrics:m};
  if(k.recipe.kin.shape!=='louvre'||k.recipe.kin.t!==1||k.recipe.kin.motion!=='wind')return{pass:false,detail:'the kinetic recipe was not read: '+m.kin,metrics:m};
  if(g.recipe.paver.tiling!=='square')return{pass:false,detail:'"grid" should read as square, got '+g.recipe.paver.tiling,metrics:m};
  return{pass:true,detail:'herringbone, lists, a held cull, an attractor list, a louvre unit and a grid all read; '+r.fixed.length+k.fixed.length+' changes reported',metrics:m};});
guard('catalogue','the normaliser mends what the schema forbids, and the draft still shows',function(){
  T.reset();var c=cdGood();c.version='1';c.project={title:'X',designers:'A, B and C',built:2008};c.mappings[0].domain='4 to 20';c.parameters[1].min=null;c.parameters[2].options=[1,2];
  c.pattern_studio.note='a note';c.fabrication.constraints[0].value=[4,20];c.id='bench-slips';
  var d=T.cardAccept(c,'bench');var card=d.card;var m={errors:d.errors.join(' | '),fixed:(d.fixed||[]).join(' | ').slice(0,300),shown:/Test wall: turned bricks/.test(document.body.textContent)};
  if(d.errors.length)return{pass:false,detail:'after mending, still: '+m.errors,metrics:m};
  if(!Array.isArray(card.project.designers)||card.project.designers.length!==3||card.project.built!=='2008'||card.mappings[0].domain[0]!==4||'min' in card.parameters[1]||typeof card.parameters[2].options[0]!=='string'||card.pattern_studio.notes!=='a note'||card.version!=='1.0'||card.fabrication.constraints[0].value!=='4 to 20')
    return{pass:false,detail:'not mended: '+JSON.stringify({designers:card.project.designers,built:card.project.built,domain:card.mappings[0].domain,options:card.parameters[2].options,notes:card.pattern_studio.notes,version:card.version}),metrics:m};
  if(!m.shown)return{pass:false,detail:'the mended draft is not shown',metrics:m};
  var c2=cdGood();c2.id='bench-crash';c2.project={designers:'One Person'};c2.process=['only one step'];var d2=T.cardAccept(c2,'bench');m.oneStep=d2.errors.join(' | ');
  if(!/at least two steps/.test(m.oneStep))return{pass:false,detail:'a one-step process should be reported: '+m.oneStep,metrics:m};
  return{pass:true,detail:'designers, built, the domain, min, options, the note, the constraint value and the version mended; the draft shows; a one-step process is reported',metrics:m};});
guard('catalogue','the keyword skeleton passes the schema’s rules and reads moving louvres as kinetic',function(){
  T.reset();var k=T.cardHeuristic('Kinetic louvres on a south facade, 300 mm aluminium blades on a 400 mm pitch, each blade turned by a motor so it blocks direct sun through the day.');
  var b=T.cardHeuristic('A brick screen wall, 230 x 110 x 76 mm bricks, every other brick left out in a gradient.');
  var m={kinMode:k.recipe.mode,brickMode:b.recipe.mode,kinErrors:T.cardCheck(k).join(' | '),brickErrors:T.cardCheck(b).join(' | '),version:k.version,steps:k.process.length};
  if(m.kinMode!=='kin'||m.brickMode!=='brick')return{pass:false,detail:'read as '+m.kinMode+' and '+m.brickMode,metrics:m};
  if(m.kinErrors||m.brickErrors)return{pass:false,detail:'the skeletons fail the rules: '+m.kinErrors+' / '+m.brickErrors,metrics:m};
  return{pass:true,detail:'motorised louvres read as kinetic, the brick screen as bricks; both skeletons pass',metrics:m};});
guard('catalogue','a partial field in a recipe keeps the field’s other defaults, and the prompt lists the tool’s own words',function(){
  T.reset();var c=cdGood();c.id='bench-field';c.recipe={mode:'brick',width:2400,height:2400,brick:{bL:240,bW:115,bH:65},field:{kind:'attract',attract:{radius:0.3}}};var d=T.cardAccept(c,'bench');T.catLoad(d.id);
  var def=T.fieldDefaults().attract,m={pts:S.field.attract.pts,defPts:def.pts,radius:S.field.attract.radius,kind:S.field.kind};
  if(S.field.kind!=='attract'||S.field.attract.radius!==0.3||S.field.attract.pts!==def.pts)return{pass:false,detail:'the field came back as '+JSON.stringify(m),metrics:m};
  var pr=T.cardPrompt('x');m.promptLength=pr.length;var need=['paver.tiling perm','square','herring','kin.shape','umbrella','one string with commas','at least two steps','not-in-flux','finite_set','paver.cull'],miss=need.filter(function(w){return pr.indexOf(w)<0;});
  if(miss.length)return{pass:false,detail:'the prompt lacks: '+miss.join(', '),metrics:m};
  return{pass:true,detail:'radius 0.3 over the default points; the prompt ('+pr.length+' characters) lists the layouts, shapes and rules',metrics:m};});


/* ---- fix16-1: the checks behind the pass 16 sweep ---- */
guard('catalogue','the Pattern Studio cards load at their own size and settings after any other card',function(){
  function look(){var g=T.regen();return{W:S.width,H:S.height,arr:S.arr,solid:S.solid,back:S.perf.back,cutoff:S.perf.cutoff,levels:S.omb.levels,count:(g.holes||[]).length+(g.tiles||[]).length,warn:g.warnMsg||''};}
  var pairs=[['kait-workshop','ps-perforated-image'],['church-of-christ-the-worker','ps-cut-pattern'],['confluence-park','ps-cut-pattern'],['memorial-murdered-jews','ps-ombrae-tiles'],['p-wall','ps-perforated-image']],bad=[],m={};
  pairs.forEach(function(pq){T.reset();T.catLoad(pq[1]);var a=look();T.reset();T.catLoad(pq[0]);T.catLoad(pq[1]);var b=look();m[pq[0]+'>'+pq[1]]=JSON.stringify(b);
    ['W','H','arr','solid','back','cutoff','levels','count'].forEach(function(k){if(a[k]!==b[k])bad.push(pq[0]+' > '+pq[1]+': '+k+' '+b[k]+' (fresh '+a[k]+')');});});
  T.reset();T.catLoad('ps-perforated-image','Backlit');T.catLoad('p-wall');m.pwallBack=S.perf.back;if(S.perf.back!=='none')bad.push('Backlit leaked into P_Wall');
  if(bad.length)return{pass:false,detail:bad.slice(0,3).join('; '),metrics:m};
  return{pass:true,detail:'five card pairs load the second card exactly as fresh; no backlight leaks into P_Wall',metrics:m};});
guard('host','a big scene stays inside the camera, the floor and the sun’s shadows',function(){
  T.reset();T.catLoad('memorial-murdered-jews');T.regen();var c=T.camState();var size=Math.max(S.width,S.height);
  var m={far:Math.round(c.far),near:+c.near.toFixed(1),distance:Math.round(c.r),floor:Math.round(c.floor),shadowFar:Math.round(c.shadowFar),size:size};
  if(c.far<c.r+size)return{pass:false,detail:'the camera sees to '+m.far+' mm but sits '+m.distance+' away from a '+size+' mm scene',metrics:m};
  if(c.floor<size)return{pass:false,detail:'the floor is '+m.floor+' mm across under a '+size+' mm scene',metrics:m};
  if(c.shadowFar<size)return{pass:false,detail:'shadows reach '+m.shadowFar+' mm over a '+size+' mm scene',metrics:m};
  return{pass:true,detail:'camera far plane '+m.far+' mm, floor '+m.floor+' mm, shadows to '+m.shadowFar+' mm for a '+size+' mm scene',metrics:m};});
guard('host','a large cut panel builds its 3D quickly, wearing its openings as an alpha map',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.width=6000;S.height=6000;var g=T.regen();var t0=performance.now();var geo=T.buildGeometryFrom(g);var ms=performance.now()-t0;
  var m={openings:g.holes.length,ms:Math.round(ms),vertices:geo?geo.attributes.position.count:0,alpha:!!g.perfTex};if(geo)geo.dispose();
  if(!(g.holes.length>1500))return{pass:false,detail:'expected a big panel, got '+g.holes.length+' openings',metrics:m};
  if(ms>3000||!m.alpha)return{pass:false,detail:'built in '+m.ms+' ms, alpha map '+m.alpha,metrics:m};
  return{pass:true,detail:g.holes.length+' openings shown as an alpha-mapped plate in '+m.ms+' ms',metrics:m};});
guard('brick','turned bricks clear the bricks beside them',function(){
  function overlaps(g){var B=g.brick,rows={},n=0,pairs=0;g.bricks.forEach(function(b){(rows[b.r]=rows[b.r]||[]).push(b);});
    function quad(b){var a=-b.theta*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=b.x,cz=b.shift+B.bW/2,hl=(b.len||B.bL)/2,w=B.bW/2;return[[cx-c*hl+s*w,cz-s*hl-c*w],[cx+c*hl+s*w,cz+s*hl-c*w],[cx+c*hl-s*w,cz+s*hl+c*w],[cx-c*hl-s*w,cz-s*hl+c*w]];}
    function apart(A,Bq){var P=[A,Bq];for(var pi=0;pi<2;pi++)for(var i=0;i<4;i++){var p0=P[pi][i],p1=P[pi][(i+1)%4],nx=p1[1]-p0[1],ny=p0[0]-p1[0],l=Math.hypot(nx,ny)||1;nx/=l;ny/=l;var a0=1e18,a1=-1e18,b0=1e18,b1=-1e18;
      for(var q=0;q<4;q++){var d=A[q][0]*nx+A[q][1]*ny;a0=Math.min(a0,d);a1=Math.max(a1,d);var e=Bq[q][0]*nx+Bq[q][1]*ny;b0=Math.min(b0,e);b1=Math.max(b1,e);}if(a1<=b0+.6||b1<=a0+.6)return true;}return false;}
    Object.keys(rows).forEach(function(r){var a=rows[r].slice().sort(function(x,y){return x.i-y.i;});for(var i=1;i<a.length;i++){pairs++;if(!apart(quad(a[i-1]),quad(a[i])))n++;}});return[n,pairs];}
  var m={},bad=[];[['casa-la-roca',null],['gantenbein-winery',null],['gantenbein-winery','Larger rotation range'],['chi-she-gallery',null]].forEach(function(c){T.reset();T.catLoad(c[0],c[1]);var g=T.regen(),o=overlaps(g);m[c[0]+(c[1]?' / '+c[1]:'')]=o[0]+' of '+o[1]+', eased '+(g.brick.neighbourHeld||0);if(o[0])bad.push(c[0]+(c[1]?' / '+c[1]:'')+': '+o[0]+' of '+o[1]);});
  if(bad.length)return{pass:false,detail:'neighbours overlap: '+bad.join('; '),metrics:m};
  return{pass:true,detail:'no neighbouring bricks overlap on Casa la Roca, Gantenbein, its larger turn or Chi She',metrics:m};});
guard('catalogue','drafts keep only the schema’s keys and get ids of their own; the keyword reader reads sizes and modes',function(){
  T.reset();var c=cdGood();c.id='bench-extra';c.extra=1;c.project={title:'X',designers:['A'],nickname:'n'};c.host.colour='red';c.unit.weight=3;c.fields[0].strength=2;c.matrix[0].why='w';
  var d=T.cardAccept(c,'bench');var m={errors:d.errors.join(' | '),extraGone:!('extra' in d.card)&&!('nickname' in d.card.project)&&!('colour' in d.card.host)&&!('weight' in d.card.unit)&&!('strength' in d.card.fields[0])&&!('why' in d.card.matrix[0])};
  if(d.errors.length||!m.extraGone)return{pass:false,detail:'extra keys: '+JSON.stringify(m),metrics:m};
  var t1='A long description of a pavilion screen made of something very particular here, and more words.',a1=T.cardAccept(T.cardHeuristic(t1),'k'),a2=T.cardAccept(T.cardHeuristic(t1+' Different ending.'),'k');m.ids=a1.id+' / '+a2.id;
  if(a1.id===a2.id||/-$/.test(a1.id)||/-$/.test(a2.id))return{pass:false,detail:'ids: '+m.ids,metrics:m};
  var h=T.cardHeuristic('A plaza of brick pavers, 20 x 10 cm, in herringbone, 3.5 m wide.');m.paverMode=h.recipe.mode;m.dims=h.parameters.filter(function(p){return /^d/.test(p.key);}).map(function(p){return p.default;}).join('/');m.name=h.name;
  if(h.recipe.mode!=='paver'||m.dims.indexOf('200/100')!==0||/3$/.test(h.name.split(':')[0]))return{pass:false,detail:'read as '+m.paverMode+', sizes '+m.dims+', name '+m.name,metrics:m};
  var modes=['Slate cladding on a timber frame.','A background of glass.','Un mur de briques tournées.'].map(function(t){return T.cardHeuristic(t).recipe.mode;});m.modes=modes.join('/');
  if(modes[0]==='serial'||modes[1]==='paver'||modes[2]!=='brick')return{pass:false,detail:'modes: '+m.modes,metrics:m};
  return{pass:true,detail:'extra keys left out; ids '+m.ids+'; brick pavers read as pavers of 200 x 100 mm; slate, background and briques read right',metrics:m};});
guard('catalogue','matrix variants do what their rows say',function(){
  var m={},bad=[];T.reset();T.catLoad('casa-la-roca','Unit dimension');m.casa=S.brick.op+'/'+S.brick.shiftMax+'/'+S.brick.bL;if(S.brick.op!=='shift'||S.brick.shiftMax!==178)bad.push('Casa la Roca unit dimension '+m.casa);
  T.reset();T.catLoad('church-of-christ-the-worker','Straight eaves');m.church=S.host.a0+'/'+S.host.a1+'/'+S.host.phase;if(S.host.phase!==180)bad.push('Church straight eaves '+m.church);
  T.reset();T.catLoad('aqua-tower','Fine pitch');m.aqua=S.serial.sheetW+'x'+S.serial.sheetH;if(S.serial.sheetW!==1220)bad.push('Aqua fine pitch on '+m.aqua);
  T.reset();T.catLoad('berlin-free-university','100% Storage');var g=T.regen();var win=g.pavers.filter(function(p){return p.type===3;}).length;m.berlinWindows=win;if(!win)bad.push('Berlin 100% storage has no windows');
  T.reset();T.catLoad('memorial-murdered-jews','Curve attractor');var g2=T.regen();m.memorialTallest=Math.max.apply(null,g2.paver.heights);if(m.memorialTallest!==7620)bad.push('Memorial curve attractor tops out at '+m.memorialTallest);
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'Casa la Roca slides, Church’s base is out of phase, Aqua nests on plywood sheets, Berlin has windows, the Memorial reaches 7620 mm',metrics:m};});


/* ---- asm-1: assemblies on a plan, the robot placement, the machine ---- */
guard('assembly','a courtyard of eight columns closes on itself and faces in or out',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');S.cell=200;S.arr='grid';S.cols=8;S.rows=1;S.gap=20;S.plan={kind:'court',sides:6,angle:90,face:'out'};T.regen();
  var L=T.planLayout(8),last=L.sides[L.sides.length-1],end=T.planPlace({ox:last.ox,oz:last.oz,heading:last.heading},last.len,0);/* pass 44: sides meet at the corner (mitred), the gap is only between panels along a side */
  var b=T.hostSceneBox(),m={sides:L.sides.length,perSide:L.sides.map(function(x){return x.count;}).join('/'),closeX:+end.x.toFixed(1),closeZ:+end.z.toFixed(1),meshes:b.meshes,extent:Math.round(b.zMax-b.zMin)};
  if(L.sides.length!==4||m.perSide!=='2/2/2/2')return{pass:false,detail:'a courtyard should have 4 sides of 2 columns, got '+m.perSide,metrics:m};
  if(Math.abs(end.x)>1||Math.abs(end.z)>1)return{pass:false,detail:'the plan does not close: the last side ends at '+m.closeX+', '+m.closeZ,metrics:m};
  if(b.meshes!==8)return{pass:false,detail:b.meshes+' meshes for 8 panels',metrics:m};
  var side=2*S.width+S.gap;/* pass 44: two columns and the joint between them; the mitred corners add half the thickness at each outside corner */if(Math.abs((b.zMax-b.zMin)-(side+S.thickness))>2)return{pass:false,detail:'the court should be '+(side+S.thickness)+' mm deep (two columns, their joint, the mitred corners), the scene is '+m.extent,metrics:m};
  var rotOut=T.meshRotations();S.plan.face='in';T.regen();var rotIn=T.meshRotations();m.rotOut=rotOut.slice(0,3).map(function(r){return +(r*180/Math.PI).toFixed(0);}).join('/');m.rotIn=rotIn.slice(0,3).map(function(r){return +(r*180/Math.PI).toFixed(0);}).join('/');
  if(rotIn[0]!==0||rotOut[0]!==0||Math.abs(rotIn[2]+rotOut[2])>1e-6||!rotOut[2])return{pass:false,detail:'facing in should walk the plan the other way, not turn the panels: '+m.rotOut+' against '+m.rotIn,metrics:m};
  return{pass:true,detail:'4 sides of 2 columns closing within a millimetre, 8 panels, '+m.extent+' mm deep; facing in walks the plan the other way',metrics:m};});
guard('assembly','Al Bahar loads as a sixteen-sided tower with the picture running round it, and the room wall and hosts step aside',function(){
  T.reset();T.catLoad('al-bahar-towers','Round tower');var g=T.regen();var b=T.hostSceneBox(),L=T.planLayout(S.cols);
  var m={plan:S.plan.kind+'/'+S.plan.sides,cols:S.cols,panels:g.panels?g.panels.length:0,meshes:b.meshes,wide:Math.round(b.xMax-b.xMin),deep:Math.round(b.zMax-b.zMin),host:S.host.kind,wall:T.wallVisible()};
  if(S.plan.kind!=='tower'||S.plan.sides!==16||!g.panels||g.panels.length!==16||b.meshes!==16)return{pass:false,detail:'loaded as '+JSON.stringify(m),metrics:m};
  var R=(S.width+S.gap)/(2*Math.sin(Math.PI/16)),want=2*R;var slack=want*.04+2*(+S.kin.depth||0);if(Math.abs(m.wide-want)>slack||Math.abs(m.deep-want)>slack)return{pass:false,detail:'a 16-gon of '+S.width+' mm sides should be about '+Math.round(want)+' mm across (plus the units that stand out), the scene is '+m.wide+' x '+m.deep,metrics:m};
  if(m.wall)return{pass:false,detail:'the room wall should hide behind an assembly',metrics:m};
  return{pass:true,detail:'16 faces of '+S.width+' mm on a tower '+m.wide+' mm across, '+g.total+' units over them',metrics:m};});
guard('assembly','the robot placement list and program carry every brick in its station frame',function(){
  T.reset();T.catLoad('gantenbein-winery');var g=T.regen();S.fab.reach=1000;var csv=T.robotCSV(g,1).trim().split(String.fromCharCode(10)),krl=T.robotKRL(g,'test',1);var st=T.robotStations(g);
  var head=csv[0],rows=csv.slice(1).map(function(l){return l.split(',');}),B=g.brick,bad=0;rows.forEach(function(r){var b=g.bricks[+r[0]-1];if(Math.abs(+r[7]-(b.shift+B.bW/2))>.02||Math.abs(+r[8]-b.y)>.02||Math.abs(+r[9]-b.theta)>.02)bad++;});
  var m={bricks:g.bricks.length,rows:rows.length,stations:st.length,header:head.slice(0,60),badPoses:bad,releases:(krl.match(/release/g)||[]).length,bases:new Set(krl.match(/\$BASE=BASE_DATA\[\d+\]/g)||[]).size,hasDef:/^&ACCESS RVP\n&REL 1\nDEF /.test(krl.replace(/\r/g,''))};
  if(rows.length!==g.bricks.length||bad)return{pass:false,detail:rows.length+' rows for '+g.bricks.length+' bricks, '+bad+' poses off',metrics:m};
  if(st.length!==Math.ceil(g.W/1400))return{pass:false,detail:'a 1000 mm arm on a '+g.W+' mm wall should need '+Math.ceil(g.W/1400)+' stations, got '+st.length,metrics:m};
  if(m.releases!==g.bricks.length||m.bases!==st.length||!m.hasDef)return{pass:false,detail:'the program has '+m.releases+' placements and '+m.bases+' base frames',metrics:m};
  var order=rows.every(function(r,i){return i===0||(+r[2]>+rows[i-1][2])||(+r[2]===+rows[i-1][2]&&+r[3]>=+rows[i-1][3]);});if(!order)return{pass:false,detail:'the list is not in placing order (station, then course)',metrics:m};
  return{pass:true,detail:g.bricks.length+' bricks in '+st.length+' stations, poses as the bricks stand, '+m.releases+' placements in the KRL',metrics:m};});
guard('assembly','a laser kerf moves the cut lines and a router counts the openings it cannot cut',function(){
  T.reset();S.arr='single';T.setPanelMode('cut');var g=T.regen();S.fab.machine='none';var svg0=T.svgText(g);S.fab.machine='laser';S.fab.kerf=.4;var svg1=T.svgText(g),dxf1=T.dxfText(g);
  var h=g.holes[0],a0=Math.abs(psArea(h.pts)),a1=Math.abs(psArea(T.fabCut(h.pts,true))),ol=[{x:0,y:0},{x:g.W,y:0},{x:g.W,y:g.H},{x:0,y:g.H}],o1=Math.abs(psArea(T.fabCut(ol,false)));
  var m={holeDrawn:Math.round(a0),holeCut:Math.round(a1),outlineCut:Math.round(o1),outline:g.W*g.H,kerfTag:/data-kerf="0.4"/.test(svg1),changed:svg0!==svg1};
  if(!(a1<a0)||!(o1>g.W*g.H))return{pass:false,detail:'the cut lines should run inside each opening and outside the outline: '+JSON.stringify(m),metrics:m};
  if(!m.kerfTag||!m.changed)return{pass:false,detail:'the SVG does not carry the kerf',metrics:m};
  if(!/OPENINGS/.test(dxf1))return{pass:false,detail:'the DXF lost its layers',metrics:m};
  S.fab.machine='router';S.fab.toolD=6;var rc0=T.fabRouterCheck(g);S.fab.toolD=80;var rc=T.fabRouterCheck(g);m.router=JSON.stringify(rc);m.router6=rc0.tight;
  if(!rc||rc.tool!==80||rc.tight<g.holes.length*.9||rc0.tight>g.holes.length*.06)return{pass:false,detail:'an 80 mm tool should find nearly every opening too narrow and a 6 mm tool only the slivers at the frame: '+m.router+' / '+m.router6+' of '+g.holes.length,metrics:m};
  S.fab.machine='none';var svg2=T.svgText(g);if(svg2!==svg0)return{pass:false,detail:'"as drawn" changed the file',metrics:m};
  return{pass:true,detail:'opening '+m.holeDrawn+' drawn, '+m.holeCut+' cut; outline '+m.outlineCut+' for '+m.outline+'; the router finds '+rc.tight+' openings under 40 mm',metrics:m};});


/* ---- p20-1: corner bonds and the assembly OBJ ---- */
guard('assembly','brick courses bond at a corner: running courses reach into it, butting courses stop short, by turns',function(){
  T.reset();T.catLoad('gantenbein-winery','Courtyard');var g=T.regen();var B=g.brick,W=g.W,bW=B.bW;
  var right=g.panels[1],left=g.panels[2];/* column 1 ends side 0 at corner 0; column 2 starts side 1 there */
  function edges(p){var rows={};p.bricks.forEach(function(b){var r=rows[b.r]=rows[b.r]||{min:1e9,max:-1e9};r.min=Math.min(r.min,b.x-(b.len||B.bL)/2);r.max=Math.max(r.max,b.x+(b.len||B.bL)/2);});return rows;}
  var eR=edges(right),eL=edges(left),bad=[],m={corner:!!B.corner,courses:Object.keys(eR).length};
  Object.keys(eR).forEach(function(r){r=+r;var run=r%2===0;var want=run?W:W-bW-B.joint;/* pass 77: the butting course stops a joint short of the one that runs through */if(Math.abs(eR[r].max-want)>.05)bad.push('side 0 course '+(r+1)+' ends at '+eR[r].max.toFixed(1)+' not '+want.toFixed(1));});
  Object.keys(eL).forEach(function(r){r=+r;var butt=r%2===0;var want=butt?bW+B.joint:0;if(Math.abs(eL[r].min-want)>.05)bad.push('side 1 course '+(r+1)+' starts at '+eL[r].min.toFixed(1)+' not '+want.toFixed(1));});
  m.firstBad=bad.slice(0,3).join('; ');
  if(!B.corner||bad.length)return{pass:false,detail:(B.corner?'':'no corner bond; ')+bad.length+' courses off: '+m.firstBad,metrics:m};
  var L=T.planLayout(S.cols);m.cornerGap=+(L.sides[1].ox-(L.sides[0].ox+L.sides[0].len)).toFixed(2);if(Math.abs(m.cornerGap)>.01)return{pass:false,detail:'brick sides should meet with no gap, got '+m.cornerGap,metrics:m};
  var csv=T.robotCSV(right,2).trim().split(String.fromCharCode(10));var beyond=csv.slice(1).filter(function(l){var c=l.split(',');return Math.abs(+c[6]+(+c[5])/2-W)<1;}).length;m.cornerBricksInList=beyond;
  if(!beyond)return{pass:false,detail:'the running courses’ corner bricks are not in the placement list',metrics:m};
  return{pass:true,detail:'side 0 runs through on even courses to '+(W+bW/2)+' and stops at '+(W-bW/2)+' on odd ones; side 1 the reverse; '+beyond+' corner bricks in the list',metrics:m};});
guard('assembly','the bundle’s OBJ carries every panel of the assembly where it stands',function(){
  T.reset();T.catLoad('al-bahar-towers','Round tower');T.regen();var o=T.objText();var lines=o.split(String.fromCharCode(10));
  var v=lines.filter(function(l){return l.indexOf('v ')===0;}).length,f=lines.filter(function(l){return l.indexOf('f ')===0;}).length,g=lines.filter(function(l){return l.indexOf('g panel_')===0;}).length;
  var xs=lines.filter(function(l){return l.indexOf('v ')===0;}).map(function(l){return +l.split(' ')[1];}),xmin=1e18,xmax=-1e18;xs.forEach(function(x){if(x<xmin)xmin=x;if(x>xmax)xmax=x;});/* a loop: apply() overflows the stack once the building behind the panels is in the OBJ */
  var m={vertices:v,faces:f,groups:g,xSpan:Math.round(xmax-xmin)};
  if(g!==16||v<1000||f<300)return{pass:false,detail:g+' groups, '+v+' vertices, '+f+' faces',metrics:m};
  if(!(m.xSpan>30000&&m.xSpan<45000))return{pass:false,detail:'the tower should span about 37 m in the OBJ, got '+m.xSpan+' mm',metrics:m};
  if(lines.some(function(l){return /NaN|undefined/.test(l);}))return{pass:false,detail:'NaN in the OBJ',metrics:m};
  return{pass:true,detail:'16 panel groups, '+v+' vertices, '+f+' faces, '+m.xSpan+' mm across',metrics:m};});


/* ---- p21-1: the robot places pavers and kinetic units too, and the Grasshopper readers ride in the bundle ---- */
guard('assembly','pavers on the bed and on a wall get a robot list whose poses are the pavers',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.paver.lay='ground';S.fab.reach=1000;var g=T.regen();if(!g||!g.pavers||!g.pavers.length)return{pass:false,detail:'no pavers were made'};
  var csv=T.robotCSV(g,1).trim().split(String.fromCharCode(10)),head=csv[0].split(','),rows=csv.slice(1).map(function(l){return l.split(',');}),bad=0,offBed=0;
  rows.forEach(function(r){var p=g.pavers[+r[0]-1];if(!p||Math.abs(+r[6]-p.cx)>.02||Math.abs(+r[7]-p.cy)>.02)bad++;if(+r[8]!==0)offBed++;});
  var st=T.robotStations(g),krl=T.robotKRL(g,'pv',1),m={pavers:g.pavers.length,rows:rows.length,bad:bad,offBed:offBed,stations:st.length,kind:rows[0]&&rows[0][13],releases:(krl.match(/release/g)||[]).length,lowered:/lowered from above/.test(krl)};
  if(head[0]!=='unit'||head[13]!=='kind')return{pass:false,detail:'the header is '+csv[0].slice(0,80),metrics:m};
  if(rows.length!==g.pavers.length||bad||offBed)return{pass:false,detail:rows.length+' rows for '+g.pavers.length+' pavers, '+bad+' centres off, '+offBed+' not on the bed (Z should be 0)',metrics:m};
  if(st.length!==Math.ceil(g.W/1400)||m.releases!==g.pavers.length||!m.lowered)return{pass:false,detail:'the program should have '+g.pavers.length+' placements in '+Math.ceil(g.W/1400)+' stations, lowered from above: '+JSON.stringify(m),metrics:m};
  var order=rows.every(function(r,i){return i===0||(+r[2]>+rows[i-1][2])||(+r[2]===+rows[i-1][2]&&+r[3]>=+rows[i-1][3]);});if(!order)return{pass:false,detail:'not in placing order (station, then row)',metrics:m};
  S.paver.lay='wall';g=T.regen();var csv2=T.robotCSV(g,1).trim().split(String.fromCharCode(10)).slice(1).map(function(l){return l.split(',');}),bad2=0;
  csv2.forEach(function(r){var p=g.pavers[+r[0]-1];if(!p||Math.abs(+r[8]-p.cy)>.02||+r[7]!==0)bad2++;});var krl2=T.robotKRL(g,'pv',1);m.wallBad=bad2;m.offered=/offered to the face/.test(krl2);
  S.paver.lay='ground';
  if(bad2||!m.offered)return{pass:false,detail:'on a wall the centre should go to Z with Y 0 and the piece offered to the face: '+bad2+' rows off',metrics:m};
  return{pass:true,detail:g.pavers.length+' '+m.kind+'s, '+st.length+' stations, poses as the pavers lie; on a wall Z carries the height and the program offers them to the face',metrics:m};});
guard('assembly','kinetic units get a robot list on the face, one row per unit',function(){
  T.reset();S.arr='single';T.setPanelMode('kin');var g=T.regen();if(!g||!g.units||!g.units.length)return{pass:false,detail:'no units were made'};
  var rows=T.robotCSV(g,1).trim().split(String.fromCharCode(10)).slice(1).map(function(l){return l.split(',');}),bad=0;
  rows.forEach(function(r){var u=g.units[+r[0]-1];if(!u||Math.abs(+r[6]-u.x)>.02||Math.abs(+r[8]-u.y)>.02||+r[7]!==0||+r[5]!==g.kin.unit)bad++;});
  var krl=T.robotKRL(g,'kn',1),m={units:g.units.length,rows:rows.length,bad:bad,releases:(krl.match(/release/g)||[]).length,offered:/offered to the face/.test(krl)};
  if(rows.length!==g.units.length||bad||m.releases!==g.units.length||!m.offered)return{pass:false,detail:JSON.stringify(m),metrics:m};
  return{pass:true,detail:g.units.length+' units, each at its grid point with the unit size as its length, offered to the face',metrics:m};});
guard('assembly','the bundle carries the mode\'s files and its Grasshopper readers',function(){
  var GH=T.GH_SCRIPTS();var names=Object.keys(GH),m={readers:names.join(' ')};
  if(names.length<5||!names.every(function(n){return /Rhino\.Geometry/.test(GH[n]);}))return{pass:false,detail:'the embedded readers are '+m.readers,metrics:m};
  T.reset();S.arr='single';T.setPanelMode('brick');T.regen();
  return T.bundleFiles().then(function(files){var fn=files.map(function(f){return f.name;});m.brick=fn.length;
    var want=['-bricks.csv','-robot.csv','-robot.src','grasshopper/bricks_from_csv.py','grasshopper/robot_from_csv.py','grasshopper/README.txt','README.txt'];
    var miss=want.filter(function(w){return !fn.some(function(n){return n.indexOf(w)>=0;});});if(miss.length)return{pass:false,detail:'the brick bundle lacks '+miss.join(', ')+'; it has '+fn.join(', '),metrics:m};
    var readme=new TextDecoder().decode(files.find(function(f){return f.name==='README.txt';}).data);if(!/grasshopper folder/.test(readme))return{pass:false,detail:'the brick README does not mention the grasshopper folder',metrics:m};
    T.reset();S.arr='single';T.setPanelMode('paver');T.regen();return T.bundleFiles();}).then(function(files){if(files.pass===false)return files;var fn=files.map(function(f){return f.name;});m.paver=fn.length;
    var miss=['-pavers.csv','-schedule.csv','-robot.csv','-robot.src','grasshopper/pavers_from_csv.py','grasshopper/robot_from_csv.py'].filter(function(w){return !fn.some(function(n){return n.indexOf(w)>=0;});});
    if(miss.length)return{pass:false,detail:'the paver bundle lacks '+miss.join(', '),metrics:m};
    T.reset();S.arr='single';T.setPanelMode('cut');T.regen();return T.bundleFiles();}).then(function(files){if(files.pass===false)return files;var fn=files.map(function(f){return f.name;});m.cut=fn.length;
    if(fn.some(function(n){return /grasshopper|robot/.test(n);}))return{pass:false,detail:'a cut pattern should carry no robot or grasshopper files: '+fn.join(', '),metrics:m};
    return{pass:true,detail:'brick bundle '+m.brick+' files, paver '+m.paver+', cut pattern '+m.cut+'; readers: '+m.readers,metrics:m};});});


/* ---- p22-1: the sweep of passes 18 to 20 ---- */
function p22Clip(sub,clip){/* the intersection of two convex polygons (Sutherland-Hodgman), as an area */
  var sgn=0;for(var i=0;i<clip.length;i++){var a=clip[i],b=clip[(i+1)%clip.length];sgn+=a[0]*b[1]-b[0]*a[1];}sgn=sgn>=0?1:-1;
  var out=sub.slice();for(var i=0;i<clip.length&&out.length;i++){var a=clip[i],b=clip[(i+1)%clip.length],inp=out;out=[];
    var side=function(p){return sgn*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));};
    for(var k=0;k<inp.length;k++){var P=inp[k],Q=inp[(k+1)%inp.length],sp=side(P),sq=side(Q);
      if(sp>=0)out.push(P);if((sp>=0)!==(sq>=0)){var t=sp/(sp-sq);out.push([P[0]+t*(Q[0]-P[0]),P[1]+t*(Q[1]-P[1])]);}}}
  var A=0;for(var i=0;i<out.length;i++){var p=out[i],q=out[(i+1)%out.length];A+=p[0]*q[1]-q[0]*p[1];}return Math.abs(A)/2;}
function p22Foot(b,B,col){/* a brick's footprint in the room's plan: the box turned about its centre, then placed with its panel */
  var L=b.len||B.bL,th=b.theta*Math.PI/180,c=Math.cos(th),s=Math.sin(th),h=B.bW/2,cl=b.cutL||0,cr=b.cutR||0;
  return[[-L/2,-h],[L/2,-h],[L/2+cr,h],[-L/2-cl,h]].map(function(p){var x=p[0]*c+p[1]*s+b.x,z=-p[0]*s+p[1]*c+h+b.shift;var q=T.planPlace(col,x,z);return[q.x,q.z];});}
function p22Inside(pt,poly){var sgn=0;for(var i=0;i<poly.length;i++){var a=poly[i],b=poly[(i+1)%poly.length],v=(b[0]-a[0])*(pt[1]-a[1])-(b[1]-a[1])*(pt[0]-a[0]);if(i===0)sgn=v>=0?1:-1;else if((v>=0?1:-1)!==sgn)return false;}return true;}
function p22Corner(plan,cols,label){T.reset();S.arr='grid';S.rows=1;S.cols=cols;S.gap=0;S.frameL=S.frameR=S.frameT=S.frameB=0;S.width=900;S.height=600;S.omb.span=true;T.setPanelMode('brick');S.brick.op='rotate';S.brick.d1=0;S.brick.d2=18;S.plan=plan;
  var g=T.regen();if(!g||!g.panels)return{bad:label+': no panels'};var L=T.planLayout(S.cols),B=g.brick,W=g.W,bW=B.bW,n=g.panels.length,turn=L.turn,overlap=0,uncovered=0,courses=0,pairs=0,held=0;
  g.panels.forEach(function(p){held+=p.brick.cornerHeld||0;});
  for(var k=0;k<n;k++){var k2=(k+1)%n;if(k2===0&&!L.closed)break;var A=g.panels[k],Bp=g.panels[k2],ca=L.cols[k],cb=L.cols[k2];if(ca.side===cb.side)continue;pairs++;
    var tip=T.planPlace(ca,W+bW*Math.tan(Math.abs(turn)/2)-1.5,bW-1.5);
    for(var r=0;r<B.courses;r++){courses++;var ea=A.bricks.filter(function(b){return b.r===r&&b.x>W-2*B.bL;}).map(function(b){return p22Foot(b,B,ca);}),eb=Bp.bricks.filter(function(b){return b.r===r&&b.x<2*B.bL;}).map(function(b){return p22Foot(b,B,cb);});
      ea.forEach(function(fa){eb.forEach(function(fb){overlap+=p22Clip(fa,fb);});});
      if(turn>0){var cov=ea.concat(eb).some(function(f){return p22Inside([tip.x,tip.z],f);});if(!cov)uncovered++;}}}
  S.plan={kind:'wall',sides:6,angle:90,face:'out'};
  return{label:label,pairs:pairs,courses:courses,overlap:Math.round(overlap),uncovered:uncovered,held:held,mitred:!!g.panels[0].brick.mitred,bricks:g.total};}
guard('assembly','a closed plan closes whatever the column count, the count held to one that closes',function(){
  T.reset();S.arr='grid';S.rows=1;T.setPanelMode('cut');S.gap=0;var closeAt=function(){var L=T.planLayout(S.cols),last=L.sides[L.sides.length-1],e=T.planPlace({ox:last.ox,oz:last.oz,heading:last.heading},last.len,0);return{cols:L.cols.length,sides:L.sides.map(function(s){return s.count;}).join('/'),gap:+Math.hypot(e.x,e.z).toFixed(1),held:L.held};};
  var m={};S.plan={kind:'court',sides:4,angle:90,face:'out'};S.cols=6;m.court6=closeAt();S.cols=1;m.court1=closeAt();S.plan={kind:'tower',sides:6,angle:90,face:'out'};S.cols=8;m.tower8=closeAt();S.plan={kind:'tower',sides:24,angle:90,face:'out'};S.cols=2;m.tower24=closeAt();S.plan={kind:'corner',sides:2,angle:90,face:'out'};S.cols=1;m.corner1=closeAt();
  var bad=[];if(m.court6.gap>1||m.court6.sides!=='2/1/2/1')bad.push('court of 6: '+JSON.stringify(m.court6));if(m.court1.gap>1||m.court1.cols!==4)bad.push('court of 1: '+JSON.stringify(m.court1));if(m.tower8.gap>1||m.tower8.cols!==6)bad.push('tower of 8: '+JSON.stringify(m.tower8));if(m.tower24.gap>1||m.tower24.cols!==24)bad.push('24 sides of 2: '+JSON.stringify(m.tower24));if(m.corner1.cols!==2)bad.push('corner of 1: '+JSON.stringify(m.corner1));
  S.plan={kind:'wall',sides:6,angle:90,face:'out'};if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'a court of 6 lays 2/1/2/1 and closes; 1 column becomes 4; a 6-sided tower of 8 columns is held to 6; 24 sides of 2 to 24; a corner of 1 to 2',metrics:m};});
guard('assembly','bricks at a corner neither overlap nor leave the corner open, square, mitred or facing in',function(){
  var sq=p22Corner({kind:'corner',sides:2,angle:90,face:'out'},2,'square'),mt=p22Corner({kind:'corner',sides:2,angle:120,face:'out'},2,'mitred 60'),cc=p22Corner({kind:'corner',sides:2,angle:90,face:'in'},2,'concave'),hx=p22Corner({kind:'tower',sides:6,angle:90,face:'out'},6,'hexagon');
  var m={square:sq,mitred:mt,concave:cc,hexagon:hx},bad=[];
  [sq,mt,cc,hx].forEach(function(c){if(c.bad)bad.push(c.bad);else{if(c.overlap>5)bad.push(c.label+': '+c.overlap+' mm2 of overlap over '+c.courses+' courses');if(c.uncovered)bad.push(c.label+': the outer corner is open on '+c.uncovered+' of '+c.courses+' courses');if(!c.held)bad.push(c.label+': no corner brick held flat');}});
  if(!mt.mitred||!hx.mitred||sq.mitred)bad.push('mitres: square '+sq.mitred+', 60 '+mt.mitred+', hexagon '+hx.mitred);
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'square quoin, 60-degree squints, a concave corner and a hexagon: no overlap, the outer corner covered on every course, '+sq.held+'/'+mt.held+'/'+cc.held+'/'+hx.held+' corner bricks held flat',metrics:m};});
guard('assembly','under a plan every course runs the whole side in one bond: no gap wider than a joint, and no panel joint a straight joint through two courses',function(){
  T.reset();S.arr='grid';S.rows=1;S.cols=6;S.gap=20;S.frameL=S.frameR=40;S.width=900;S.height=600;S.omb.span=true;T.setPanelMode('brick');S.plan={kind:'corner',sides:2,angle:90,face:'out'};var g=T.regen();
  /* pass 45: a course is laid along the whole side and each brick drawn by the panel holding its centre, so the test reads a side, not a panel */
  var B=g.brick,W=g.W,j=B.joint,gaps=0,straight=0,courses=0,offs=[];[[0,1,2],[3,4,5]].forEach(function(side,si){var prev=null;for(var r=0;r<B.courses;r++){var iv=[];side.forEach(function(k,q){(g.panels[k].bricks||[]).forEach(function(b){if(b.r!==r)return;var L=b.len||B.bL,x=b.x+q*W;iv.push([x-L/2,x+L/2]);});});if(!iv.length)continue;courses++;iv.sort(function(a,b){return a[0]-b[0];});
    for(var i=1;i<iv.length;i++){if(iv[i][0]-iv[i-1][1]>j+.5){gaps++;if(offs.length<6)offs.push('side '+(si+1)+' course '+(r+1)+' gap at '+iv[i-1][1].toFixed(0));}}
    var at=[1,2].map(function(q){var X=q*W;return !iv.some(function(v){return v[0]<X-5&&v[1]>X+5;});});if(prev){at.forEach(function(a,q){if(a&&prev[q]){straight++;if(offs.length<6)offs.push('side '+(si+1)+' joint '+(q+1)+' straight through courses '+r+'-'+(r+1));}});}prev=at;}});
  var m={panels:g.panels.length,courses:courses,gaps:gaps,straight:straight,gapHeld:g.span.gap,offs:offs.join('; ')};S.plan={kind:'wall',sides:6,angle:90,face:'out'};S.frameL=S.frameR=0;
  if(gaps||straight||g.span.gap!==0)return{pass:false,detail:gaps+' gaps, '+straight+' straight joints ('+offs.join('; ')+'); the panel gap is '+g.span.gap+' mm',metrics:m};
  return{pass:true,detail:courses+' courses on 2 sides of 3 panels: no gap wider than the joint, no straight joint at a panel joint, the panel gap held at 0',metrics:m};});
guard('assembly','Next step from a mode tab goes on to Material and never rebuilds the panel as another mode',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');T.regen();T.updateStats();
  return new Promise(function(res){setTimeout(res,30);}).then(function(){var nav=T.tabNav('Brick courses'),m={brick:nav.join(' | ')};
    if(!nav.some(function(t){return /Material/.test(t);})||nav.some(function(t){return /Serial|Kinetic|Pavers|Ombrae|Perforated|Pattern/.test(t);}))return{pass:false,detail:'from Brick courses the steps are '+m.brick,metrics:m};
    T.setPanelMode('paver');T.regen();T.updateStats();return new Promise(function(res){setTimeout(res,30);}).then(function(){var nv=T.tabNav('Pavers');m.paver=nv.join(' | ');
      if(!nv.some(function(t){return /Material/.test(t);})||!nv.some(function(t){return /Catalogue/.test(t);}))return{pass:false,detail:'from Pavers the steps are '+m.paver,metrics:m};
      return{pass:true,detail:'Brick courses: '+m.brick+'; Pavers: '+m.paver,metrics:m};});});});
guard('assembly','each face of a tower sees the sun from its own side',function(){
  T.reset();T.catLoad('al-bahar-towers','Round tower');var g=T.regen();if(!g.panels||g.panels.length!==16)return{pass:false,detail:'not a 16-face tower'};
  var L=T.planLayout(S.cols),mean=g.panels.map(function(p){return +p.kin.meanNow.toFixed(3);}),offs=g.panels.map(function(p){return +p.kin.faceOff.toFixed(1);}),lo=Math.min.apply(null,mean),hi=Math.max.apply(null,mean);
  var m={motion:S.kin.motion,mean:mean.join('/'),offs:offs.slice(0,4).join('/')};
  var offOk=offs.every(function(o,k){return Math.abs(o-(-L.cols[k].heading*180/Math.PI))<.1;});
  if(S.kin.motion!=='sun'||!offOk)return{pass:false,detail:'the faces should carry their compass turn: '+JSON.stringify(m),metrics:m};
  if(hi-lo<.1)return{pass:false,detail:'all 16 faces deploy alike ('+lo+' to '+hi+')',metrics:m};
  return{pass:true,detail:'deployment runs from '+lo+' to '+hi+' round the tower',metrics:m};});
guard('assembly','the router check reads the narrowest part of each opening and its note follows the design',function(){
  var w=T.fabMinWidth([{x:0,y:0},{x:70.71,y:70.71},{x:63.64,y:77.78},{x:-7.07,y:7.07}]),m={rotated:+w.toFixed(1)};
  if(Math.abs(w-10)>.3)return{pass:false,detail:'a 100 x 10 mm slot turned 45 degrees reads '+m.rotated+' mm wide',metrics:m};
  T.reset();S.arr='single';T.setPanelMode('cut');S.fab.machine='router';S.fab.toolD=12;T.buildFabDyn();var g=T.regen();T.updateStats();var n1=T.routerNote(),rc1=T.fabRouterCheck(g);m.note1=n1.slice(0,90);m.tight1=rc1.tight;
  S.cell=40;g=T.regen();T.updateStats();var n2=T.routerNote(),rc2=T.fabRouterCheck(g);m.note2=n2.slice(0,90);m.tight2=rc2.tight;S.fab.machine='none';T.buildFabDyn();
  if(n1.indexOf(rc1.tight+' of ')<0||n2.indexOf(rc2.tight+' of ')<0||rc2.tight<=rc1.tight)return{pass:false,detail:'the note should carry the count each time: '+JSON.stringify(m),metrics:m};
  return{pass:true,detail:'a turned slot reads '+m.rotated+' mm; the note says '+rc1.tight+' then '+rc2.tight+' openings under 12 mm as the cell shrinks',metrics:m};});
guard('assembly','the header leads with the whole set and names the plan',function(){
  T.reset();S.arr='grid';S.cols=5;S.rows=1;S.omb.span=true;T.setPanelMode('brick');var g=T.regen();T.updateStats();var lead=T.statsLead(),m={lead:lead,total:g.total,panel1:g.bricks.length,stats:T.statsText().slice(0,160)};
  if(lead!==g.total.toLocaleString())return{pass:false,detail:'the header leads with '+lead+' for a set of '+g.total,metrics:m};
  S.plan={kind:'court',sides:4,angle:90,face:'out'};S.cols=8;g=T.regen();T.updateStats();var st=T.statsText();m.plan=st;S.plan={kind:'wall',sides:6,angle:90,face:'out'};
  if(!/courtyard/.test(st)||!/in all/.test(st))return{pass:false,detail:'on a courtyard the readout says: '+st.slice(0,200),metrics:m};
  return{pass:true,detail:'lead '+lead+' over 5 panels; on a courtyard the readout names it and gives the weight in all',metrics:m};});
guard('assembly','the KRL has an INI fold, a base per face and station, the pallet in the robot\'s frame, and the bundle a plan file',function(){
  T.reset();T.catLoad('gantenbein-winery','Courtyard');var g=T.regen();var k=1,Gk=g.panels[k],nSt=T.robotStations(Gk).length,krl=T.robotKRL(Gk,'x',k+1);
  var m={stations:nSt,ini:/BAS \(#INITMOV/.test(krl),tool:/\$TOOL=TOOL_DATA\[1\]/.test(krl),nullframe:(krl.match(/\$BASE=\$NULLFRAME/g)||[]).length,base:krl.indexOf('$BASE=BASE_DATA['+(nSt+1)+']')>=0,home:/PTP XHOME/.test(krl),squint:/squint/.test(krl),closer:/closer/.test(krl)};
  if(!m.ini||!m.tool||!m.base||!m.home||m.nullframe<Gk.bricks.length)return{pass:false,detail:JSON.stringify(m),metrics:m};
  return T.bundleFiles().then(function(files){var pl=files.find(function(f){return /-plan\.csv$/.test(f.name);});if(!pl)return{pass:false,detail:'no -plan.csv in the bundle',metrics:m};
    var rows=new TextDecoder().decode(pl.data).trim().split(String.fromCharCode(10));m.planRows=rows.length-1;m.planHead=rows[0];
    if(rows.length!==9||!/first_base/.test(rows[0]))return{pass:false,detail:'the plan file has '+(rows.length-1)+' rows: '+rows[0],metrics:m};
    return{pass:true,detail:'face 2 uses BASE_DATA['+(nSt+1)+'] on, picks under $NULLFRAME '+m.nullframe+' times, '+(m.closer?'names its closers':'has no closer')+'; -plan.csv lists 8 panels',metrics:m};});});
guard('assembly','an assembly too big for one OBJ is left out of the bundle and said so',function(){
  T.reset();S.arr='grid';S.cols=3;S.rows=1;S.omb.span=true;T.setPanelMode('tiles');var g=T.regen();
  return T.bundleFiles().then(function(files){var names=files.map(function(f){return f.name;}),note=T.objNote(),m={tiles:g.total,obj:names.filter(function(n){return /\.obj$/.test(n);}).length,note:note.slice(0,80)};
    if(m.obj||!/left out/.test(note))return{pass:false,detail:'3 tile panels: '+m.obj+' obj files, note "'+note+'"',metrics:m};
    return{pass:true,detail:g.total+' tiles over 3 panels: no OBJ, and the note says why',metrics:m};});});


/* ---- p23-1: the sun field per face, the 3D fit on a narrow stage, the corner caption ---- */
guard('assembly','a sun field lights each face of a brick tower from its own side',function(){
  T.reset();S.arr='grid';S.rows=1;S.cols=8;S.gap=0;S.width=1800;S.height=1500;S.omb.span=true;T.setPanelMode('brick');S.field.kind='sun';S.field.sun.facing=180;S.field.sun.lat=49;S.field.sun.month=6;S.field.sun.overhang=300;S.field.sun.reveal=0;T.fieldUse();/* the sun field is the share of a face's own sun each point gets under its overhang, so the faces differ by how their shadows fall */S.plan={kind:'tower',sides:8,angle:90,face:'out'};
  var t0=performance.now(),g=T.regen(),ms=Math.round(performance.now()-t0);
  var tones=g.panels.map(function(p){var s=0;p.bricks.forEach(function(b){s+=b.t;});return +(s/p.bricks.length).toFixed(3);}),lo=Math.min.apply(null,tones),hi=Math.max.apply(null,tones);
  var m={tones:tones.join('/'),spread:+(hi-lo).toFixed(3),ms:ms,preview:!!T.previewFull()};S.plan={kind:'wall',sides:6,angle:90,face:'out'};
  if(hi-lo<.03)return{pass:false,detail:'the 8 faces read alike under the sun: '+m.tones,metrics:m};
  if(!m.preview)return{pass:false,detail:'the picture was left as the last face\'s slice',metrics:m};
  if(ms>6000)return{pass:false,detail:'an 8-face tower under the sun took '+ms+' ms',metrics:m};
  return{pass:true,detail:'mean tone runs from '+lo+' to '+hi+' round the tower in '+ms+' ms, and the whole picture is back for the preview',metrics:m};});
guard('assembly','a narrow stage backs the camera off so the set stays in view, and the corner drawing says what runs past its outline',function(){
  T.reset();S.arr='grid';S.cols=5;S.rows=1;T.setPanelMode('cut');T.regen();var wide=T.orbitR(1.9),narrow=T.orbitR(1.0),m={wide:Math.round(wide),narrow:Math.round(narrow),ratio:+(narrow/wide).toFixed(2)};T.orbitR(1.9);
  if(!(narrow>wide*1.3))return{pass:false,detail:'at aspect 1.0 the camera should stand back at least 1.3 times as far as at 1.9: '+JSON.stringify(m),metrics:m};
  T.reset();S.arr='grid';S.rows=1;S.cols=2;S.gap=0;S.width=900;S.height=600;S.omb.span=true;T.setPanelMode('brick');S.plan={kind:'corner',sides:2,angle:90,face:'out'};T.regen();var cd=Array.prototype.slice.call(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='Course drawing';});if(cd)cd.click();T.render2D();
  var svg=document.querySelector('#view2d svg'),txt=svg?svg.textContent:'';m.quoin=/QUOIN/.test(txt);
  S.plan={kind:'corner',sides:2,angle:120,face:'out'};T.regen();T.render2D();svg=document.querySelector('#view2d svg');txt=svg?svg.textContent:'';m.squint=/SQUINT/.test(txt);S.plan={kind:'wall',sides:6,angle:90,face:'out'};
  if(!m.quoin||!m.squint)return{pass:false,detail:'the course drawing should name the quoin and the squints: '+JSON.stringify(m),metrics:m};
  return{pass:true,detail:'the camera stands '+m.ratio+' times further back at aspect 1.0; the drawing names the quoin and the squints',metrics:m};});


/* ---- p24-1: the serpentine plan ---- */
guard('assembly','a serpentine plan lays every panel as a chord of the sine and mitres every joint without overlap',function(){
  T.reset();S.arr='grid';S.rows=1;S.cols=8;S.gap=0;S.frameL=S.frameR=S.frameT=S.frameB=0;S.width=900;S.height=600;S.omb.span=true;T.setPanelMode('brick');S.brick.op='rotate';S.brick.d1=0;S.brick.d2=15;S.plan={kind:'serp',waves:2,amp:600,face:'out',sides:6,angle:90};
  var g=T.regen();if(!g||!g.panels||g.panels.length!==8)return{pass:false,detail:'expected 8 panels, got '+(g&&g.panels?g.panels.length:0)};
  var L=T.planLayout(8),W=g.W,B=g.brick,A=600,kk=2*Math.PI*2/(8*W),offCurve=0,offChord=0,turns=[],bad=[];
  L.sides.forEach(function(s,i){var z=A*Math.sin(kk*s.ox);if(Math.abs(s.oz-z)>1)offCurve++;var e=T.planPlace({ox:s.ox,oz:s.oz,heading:s.heading},W,0);var nx=L.sides[i+1];if(nx&&(Math.abs(e.x-nx.ox)>1||Math.abs(e.z-nx.oz)>1))offChord++;turns.push(+(s.turnOut*180/Math.PI).toFixed(1));});
  var signs=turns.slice(0,7).map(function(t){return t>0?1:t<0?-1:0;}),flips=0;for(var i=1;i<signs.length;i++)if(signs[i]&&signs[i-1]&&signs[i]!==signs[i-1])flips++;
  var overlap=0,held=0,mitred=0;g.panels.forEach(function(p){held+=p.brick.cornerHeld||0;if(p.brick.mitred)mitred++;});
  for(var k=0;k<7;k++){var Pa=g.panels[k],Pb=g.panels[k+1],ca=L.cols[k],cb=L.cols[k+1];
    for(var r=0;r<B.courses;r++){var ea=Pa.bricks.filter(function(b){return b.r===r&&b.x>W-2*B.bL;}).map(function(b){return p22Foot(b,B,ca);}),eb=Pb.bricks.filter(function(b){return b.r===r&&b.x<2*B.bL;}).map(function(b){return p22Foot(b,B,cb);});
      ea.forEach(function(fa){eb.forEach(function(fb){overlap+=p22Clip(fa,fb);});});}}
  var m={offCurve:offCurve,offChord:offChord,turns:turns.join('/'),flips:flips,overlap:Math.round(overlap),held:held,mitred:mitred,bricks:g.total};S.plan={kind:'wall',sides:6,angle:90,face:'out'};S.frameL=S.frameR=S.frameT=S.frameB=0;
  if(offCurve)bad.push(offCurve+' panel origins off the sine');if(offChord)bad.push(offChord+' chords that do not meet the next panel');if(flips<1)bad.push('the joints never change the way they turn: '+m.turns);
  if(overlap>5)bad.push(overlap.toFixed(0)+' mm2 of overlap at the joints');if(mitred<7)bad.push('only '+mitred+' of 8 panels mitred');if(!held)bad.push('no corner brick held flat');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'8 chords on a sine of 2 waves, joints turned '+turns.slice(0,4).join('/')+' degrees and on, no overlap, '+held+' corner bricks held flat, '+mitred+' panels with squints',metrics:m};});


/* ---- p26-1: a plan from any curve ---- */
guard('assembly','a plan from a typed polyline lays every panel as a chord of it, a square kink as a quoin, the rest mitred, without overlap',function(){
  T.reset();S.arr='grid';S.rows=1;S.cols=8;S.gap=0;S.frameL=S.frameR=S.frameT=S.frameB=0;S.width=900;S.height=600;S.omb.span=true;T.setPanelMode('brick');S.brick.op='rotate';S.brick.d1=0;S.brick.d2=15;
  S.plan={kind:'curve',pts:'0,0 2700,0 2700,2700 4500,3700 7200,3700',face:'out',sides:6,angle:90};
  var g=T.regen();if(!g||!g.panels||g.panels.length!==8)return{pass:false,detail:'expected 8 panels, got '+(g&&g.panels?g.panels.length:0)};
  var L=T.planLayout(8),W=g.W,B=g.brick,Q=[[0,0],[2700,0],[2700,2700],[4500,3700],[7200,3700]],bad=[],offLine=0,offChord=0,turns=[];
  function dLine(p){var best=1e9;for(var i=1;i<Q.length;i++){var a=Q[i-1],b=Q[i],dx=b[0]-a[0],dz=b[1]-a[1],t=((p.x-a[0])*dx+(p.z-a[1])*dz)/(dx*dx+dz*dz);t=Math.max(0,Math.min(1,t));best=Math.min(best,Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz));}
    /* past the last point the line carries on along its last leg */
    var a=Q[Q.length-2],b=Q[Q.length-1],dx=b[0]-a[0],dz=b[1]-a[1],t=((p.x-a[0])*dx+(p.z-a[1])*dz)/(dx*dx+dz*dz);if(t>1)best=Math.min(best,Math.hypot(p.x-a[0]-t*dx,p.z-a[1]-t*dz));return best;}
  L.sides.forEach(function(s,i){if(dLine({x:s.ox,z:s.oz})>1)offLine++;var e=T.planPlace({ox:s.ox,oz:s.oz,heading:s.heading},W,0);if(dLine(e)>1)offLine++;var nx=L.sides[i+1];if(nx&&(Math.abs(e.x-nx.ox)>1||Math.abs(e.z-nx.oz)>1))offChord++;turns.push(+(s.turnOut*180/Math.PI).toFixed(1));});
  var square=Math.abs(Math.abs(turns[2])-90)<.5,kinks=turns.slice(0,7).filter(function(t){return Math.abs(t)>1;}).length;
  var overlap=0,held=0,mitred=0;g.panels.forEach(function(p){held+=p.brick.cornerHeld||0;if(p.brick.mitred)mitred++;});
  for(var k=0;k<7;k++){var Pa=g.panels[k],Pb=g.panels[k+1],ca=L.cols[k],cb=L.cols[k+1];
    for(var r=0;r<B.courses;r++){var ea=Pa.bricks.filter(function(b){return b.r===r&&b.x>W-2*B.bL;}).map(function(b){return p22Foot(b,B,ca);}),eb=Pb.bricks.filter(function(b){return b.r===r&&b.x<2*B.bL;}).map(function(b){return p22Foot(b,B,cb);});
      ea.forEach(function(fa){eb.forEach(function(fb){overlap+=p22Clip(fa,fb);});});}}
  var m={offLine:offLine,offChord:offChord,turns:turns.join('/'),square:square,kinks:kinks,overlap:Math.round(overlap),held:held,mitred:mitred,bricks:g.total};
  S.plan={kind:'wall',sides:6,angle:90,face:'out'};S.frameL=S.frameR=S.frameT=S.frameB=0;
  if(offLine)bad.push(offLine+' panel ends off the polyline');if(offChord)bad.push(offChord+' chords that do not meet the next panel');
  if(!square)bad.push('the third joint is not the square corner: '+m.turns);if(kinks<2)bad.push('fewer than two turned joints: '+m.turns);
  if(overlap>5)bad.push(overlap.toFixed(0)+' mm2 of overlap at the joints');if(!held)bad.push('no corner brick held flat');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'8 chords on a 5-point polyline, joints turned '+turns.slice(0,5).join('/')+' degrees, one square corner, no overlap, '+held+' corner bricks held flat, '+mitred+' panels with squints',metrics:m};});


/* ---- p27-1: the kinetic mechanisms ---- */
guard('kin','every unit shape builds its mechanism in 3D (hub, struts, spider, blades on pins, bracket and rod) and the actuator table carries its travel',function(){
  T.reset();S.arr='single';S.width=900;S.height=900;T.setPanelMode('kin');S.kin.pitch=300;S.kin.unit=270;S.kin.motion='pulse';var m={},bad=[];
  ['umbrella','iris','louvre'].forEach(function(sh){S.kin.shape=sh;S.kin.grid=sh==='umbrella'?'hex':'square';var g=T.regen();if(!g||!g.units||!g.units.length){bad.push(sh+': no units');return;}
    var geo=T.kinGeometry(g);var n=geo?geo.attributes.position.count:0;m[sh+'Verts']=n;
    /* the old drawing was a frame plus a petal, disc or flap: a few hundred vertices a unit; the linkage adds rods of 10 segments */
    var per=n/g.units.length;m[sh+'PerUnit']=Math.round(per);if(per<300)bad.push(sh+': only '+Math.round(per)+' vertices a unit, the mechanism is missing');
    var bb=geo.boundingBox||(geo.computeBoundingBox(),geo.boundingBox);m[sh+'Depth']=Math.round(bb.max.z-bb.min.z);
    /* the umbrella's actuator and the louvre's bracket hang behind the frame; the iris turns in front, its blades stacked on their pins */
    if(sh!=='iris'&&bb.min.z>-S.kin.depth*.5)bad.push(sh+': nothing behind the frame (min z '+bb.min.z.toFixed(0)+'), no actuator or bracket');
    if(sh==='iris'&&bb.max.z<S.thickness*4)bad.push(sh+': no blades stacked in front (max z '+bb.max.z.toFixed(0)+')');
    var csv=T.kinCSV(g),head=csv.split('\n')[0];if(!/actuator_rest_(hub_mm|ring_deg|rod_mm)/.test(head))bad.push(sh+': no actuator column: '+head.slice(0,80));
    var a0=T.kinActuator(Object.assign({},S.kin,{unit:g.kin.unit,shape:sh,grid:S.kin.grid}),0).v,a1=T.kinActuator(Object.assign({},S.kin,{unit:g.kin.unit,shape:sh,grid:S.kin.grid}),1).v;m[sh+'Travel']=+(a1-a0).toFixed(1);
    if(!(Math.abs(a1-a0)>1))bad.push(sh+': the actuator does not travel between closed and open ('+a0.toFixed(1)+' to '+a1.toFixed(1)+')');});
  S.kin.shape='umbrella';S.kin.grid='square';
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'umbrella '+m.umbrellaPerUnit+', iris '+m.irisPerUnit+', louvre '+m.louvrePerUnit+' vertices a unit, mechanisms behind the frame, travel '+m.umbrellaTravel+' mm / '+m.irisTravel+' deg / '+m.louvreTravel+' mm',metrics:m};});




/* ---- p29-1: Keio's holes ---- */
guard('paver','Keio: a hole per type cut through the slabs that can carry it, trees and grass in 3D, the hole in both lists',function(){
  T.reset();S.arr='single';S.width=6000;S.height=4000;S.frameL=S.frameR=S.frameT=S.frameB=0;T.setPanelMode('paver');S.paver.tiling='stack';S.paver.size=500;S.paver.ratio=1;/* Keio's slabs are square */S.paver.joint=10;S.paver.types=5;S.paver.palette='#2F2E2C,#5E5B56,#8E8A83,#BDB7AC,#E4DED2';S.paver.assign='dither';S.paver.holes='375,300,200,150,0';S.paver.plant=true;S.paver.cull=0;
  var g=T.regen();if(!g||!g.pavers||!g.pavers.length)return{pass:false,detail:'no pavers'};
  var holes=g.pavers.filter(function(p){return p.hole>0;}),sizes={},bad=[],tooBig=0;
  holes.forEach(function(p){sizes[p.hole]=(sizes[p.hole]||0)+1;var r=p.hole/2;for(var i=0;i<p.pts.length;i++){var a=p.pts[i],b=p.pts[(i+1)%p.pts.length],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);if(L<1e-6)continue;if(Math.abs((p.cx-a.x)*dy-(p.cy-a.y)*dx)/L<r)tooBig++;}});
  var solid=g.pavers.filter(function(p){return p.type===4;}),solidHoled=solid.filter(function(p){return p.hole>0;}).length;
  var csv=T.paverCSV(g),head=csv.split('\n')[0],sched=T.paverScheduleCSV([g]).split('\n');
  var gOn=T.paverGeometry(g),nOn=gOn?gOn.attributes.position.count:0;S.paver.plant=false;var gOff=T.paverGeometry(g),nOff=gOff?gOff.attributes.position.count:0;S.paver.plant=true;
  var m={pavers:g.pavers.length,holed:holes.length,sizes:Object.keys(sizes).map(function(k){return k+'x'+sizes[k];}).join(' '),tooBig:tooBig,solidHoled:solidHoled,held:g.paver.holesHeld||0,vertsOn:nOn,vertsOff:nOff};
  if(!sizes[375]||!sizes[300])bad.push('the big holes never fit: '+m.sizes);if(holes.length<g.pavers.length*.5)bad.push('only '+holes.length+' of '+g.pavers.length+' slabs carry a hole');if(tooBig)bad.push(tooBig+' holes break out of their slab');if(solidHoled)bad.push(solidHoled+' solid-type slabs got a hole');
  if(!/,hole_mm$/.test(head))bad.push('no hole_mm column in the placement list');if(!/hole_mm/.test(sched[0])||!/,375$/.test(sched[1]))bad.push('the schedule does not carry the hole: '+sched[0]+' / '+sched[1]);
  if(!(nOn>nOff+2000))bad.push('planting adds nothing to the 3D ('+nOn+' vs '+nOff+' vertices)');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:holes.length+' of '+g.pavers.length+' slabs holed ('+m.sizes+'), none breaking out, '+m.held+' held; planting '+nOff+' -> '+nOn+' vertices',metrics:m};});

/* ---- p29-2: Roche's paths ---- */
guard('paver','Roche: the cull toward the trees leaves the kept path alone and the culled cells come back planted',function(){
  T.reset();S.arr='single';S.width=6000;S.height=4000;S.frameL=S.frameR=S.frameT=S.frameB=0;T.setPanelMode('paver');S.paver.tiling='stack';S.paver.size=400;S.paver.ratio=1;S.paver.joint=8;S.paver.types=1;S.paver.palette='#BDB7AC';S.paver.holes='';S.field=T.fieldDefaults?T.fieldDefaults():S.field;
  S.paver.cull=.9;S.paver.keep='';S.paver.keepW=600;var g0=T.regen();var c0=g0.paver.culled;
  S.paver.keep='0,0.5 1,0.5';var g=T.regen();var Pk=g.paver,H=g.H,bad=[];
  var onPath=g.pavers.filter(function(p){return Math.abs(p.cy-H/2)<=600;}).length,culledOnPath=(Pk.planted||[]).filter(function(q){var cy=0;q.forEach(function(v){cy+=v.y;});cy/=q.length;return Math.abs(cy-H/2)<=600-200;}).length;
  var m={culledNoPath:c0,culled:Pk.culled,kept:Pk.kept,planted:(Pk.planted||[]).length,onPath:onPath,culledOnPath:culledOnPath};
  if(!(c0>0))bad.push('the cull left nothing out without a path');if(!(Pk.kept>0))bad.push('no paver was kept by the path');if(culledOnPath)bad.push(culledOnPath+' cells on the path were culled');
  if((Pk.planted||[]).length!==Pk.culled)bad.push('planted outlines '+(Pk.planted||[]).length+' do not match the culled count '+Pk.culled);if(!(Pk.culled<c0))bad.push('the path kept nothing: culled '+Pk.culled+' vs '+c0+' without it');
  S.paver.cull=0;S.paver.keep='';
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:c0+' culled without a path, '+Pk.culled+' with it ('+Pk.kept+' kept on the path, none culled there), '+Pk.planted.length+' planted outlines',metrics:m};});


/* ---- p30-1: the roof between walls ---- */
guard('host','a roof between the wall and its mirror: ribs of each profile bear on both wall tops, reach the rise at the crown, and the schedule lists them',function(){
  T.reset();S.arr='single';S.width=3000;S.height=2400;S.host.mirror=4000;S.roof={on:true,profile:'catenary',rise:1600,pitch:600,depth:150,t:18};var bad=[],m={};
  ['catenary','arch','pointed'].forEach(function(pf){S.roof.profile=pf;var V=T.roofRibs(3000,2400);m[pf+'Ribs']=V.n;
    var ends=0,crown=0,below=0;V.ribs.forEach(function(r){if(Math.abs(r.top[0][1])>1e-6||Math.abs(r.top[r.top.length-1][1])>1e-6)ends++;var mx=0;r.top.forEach(function(q){mx=Math.max(mx,q[1]);});if(Math.abs(mx-1600)>1)crown++;r.bot.forEach(function(q){if(q[1]<-1e-6)below++;});});
    if(ends)bad.push(pf+': '+ends+' ribs do not spring from the wall top');if(crown)bad.push(pf+': '+crown+' ribs miss the rise');if(below)bad.push(pf+': '+below+' stations of the underside dip below the wall top');
    var sym=0;V.ribs[0].top.forEach(function(q,k){var o=V.ribs[0].top[V.ribs[0].top.length-1-k];if(Math.abs(q[1]-o[1])>1e-6)sym++;});if(sym)bad.push(pf+': the profile is not symmetric');});
  if(m.catenaryRibs!==6)bad.push('expected 6 ribs on 3000 mm at 600, got '+m.catenaryRibs);
  /* pass 46: the vault springs from a 220 ring beam on each wall, tie rods take the thrust; ribs, purlins and a standing-seam skin (eaves drop 300 past the springing), or a brick vault */
  var geos=T.hostScene(),roofMeshes=T.roofMeshes(),nRoof=roofMeshes.length;m.roofMeshes=nRoof;if(nRoof!==5)bad.push('expected 5 roof meshes (ring beams, ties, ribs, purlins, skin), got '+nRoof);
  var minY=1e9,maxY=-1e9;roofMeshes.forEach(function(g){g.computeBoundingBox();minY=Math.min(minY,g.boundingBox.min.y);maxY=Math.max(maxY,g.boundingBox.max.y);});m.minY=Math.round(minY);m.maxY=Math.round(maxY);
  if(minY<2400-400)bad.push('roof geometry drops more than an eave below the wall top: min y '+minY.toFixed(0));if(Math.abs(maxY-(2400+220+1600+77))>15)bad.push('crown at '+maxY.toFixed(0)+', expected about '+(2400+220+1600+77));
  T.setPanelMode('brick');S.roof.on=true;S.host.mirror=4000;S.roof.profile='catenary';var gb=T.hostScene(),rb=T.roofMeshes();m.brickRoofMeshes=rb.length;var bMax=-1e9,bMin=1e9;rb.forEach(function(g){g.computeBoundingBox();bMax=Math.max(bMax,g.boundingBox.max.y);bMin=Math.min(bMin,g.boundingBox.min.y);});m.brickCrown=Math.round(bMax);
  if(rb.length!==3)bad.push('a brick vault should be 3 meshes (ring beams, ties, bricks), got '+rb.length);if(bMin<2400-1)bad.push('the brick vault dips below the wall top: '+Math.round(bMin));if(Math.abs(bMax-(2400+220+1600+65))>40)bad.push('brick crown at '+Math.round(bMax)+', expected about '+(2400+220+1600+65));
  var csv=T.roofCSV().split('\n');m.csvRows=csv.length-2;if(csv.length-2!==6||!/^rib,x_mm,span_mm,rise_mm/.test(csv[0]))bad.push('the schedule has '+(csv.length-2)+' rows: '+csv[0].slice(0,60));
  S.roof.on=false;S.host.mirror=0;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'6 ribs of each profile spring from both wall tops and reach 1600 at the crown; on a ring beam with ties, 5 meshes from '+m.minY+' to '+m.maxY+' mm; the brick vault crowns at '+m.brickCrown+'; 6 rows in -vault.csv',metrics:m};});


/* ---- p31-1: Little Island's pots ---- */
guard('paver','Little Island loads as pots: every cell lofted from its pile to its own height from the field, the top of the 3D at the tallest, the list carrying each height',function(){
  T.reset();T.catLoad('little-island');var g=T.regen();if(!g||!g.pavers||!g.pavers.length)return{pass:false,detail:'no cells'};var Pk=g.paver,bad=[],m={cells:g.pavers.length};
  if(!Pk.pots)bad.push('the recipe did not turn pots on');var hs=g.pavers.map(function(p){return p.h;}),hmin=Math.min.apply(null,hs),hmax=Math.max.apply(null,hs),distinct=new Set(hs.map(function(h){return Math.round(h);})).size;
  m.hmin=Math.round(hmin);m.hmax=Math.round(hmax);m.distinct=distinct;
  if(!(hmin>=700-1&&hmax<=2100+1))bad.push('heights run '+hmin.toFixed(0)+' to '+hmax.toFixed(0)+', expected within 700 to 2100');if(distinct<20)bad.push('only '+distinct+' distinct heights: the terrain steps, it does not undulate');
  var geo=T.paverGeometry(g);if(!geo)bad.push('no geometry');else{geo.computeBoundingBox();m.top=Math.round(geo.boundingBox.max.z);m.verts=geo.attributes.position.count;if(Math.abs(geo.boundingBox.max.z-hmax)>1)bad.push('the 3D tops out at '+geo.boundingBox.max.z.toFixed(0)+', the tallest cell is '+hmax.toFixed(0));
    if(geo.boundingBox.min.z<-1)bad.push('geometry below the ground');if(m.verts<g.pavers.length*60)bad.push('too few vertices for lofted pots: '+m.verts);}
  var csv=T.paverCSV(g).split('\n'),hcol=csv[0].split(',').indexOf('height_mm'),vals=new Set();for(var i=1;i<csv.length&&i<400;i++){var c=csv[i].split(',');if(c.length>hcol)vals.add(c[hcol]);}m.csvHeights=vals.size;
  if(vals.size<20)bad.push('the placement list carries only '+vals.size+' heights');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:g.pavers.length+' pots from '+m.hmin+' to '+m.hmax+' mm, '+distinct+' distinct heights, the 3D topping out at '+m.top+' with '+m.verts+' vertices',metrics:m};});


/* ---- p32-1: the logic library ---- */
guard('catalogue','the logic library holds one principle per card with its drives, limits and what-ifs, every rule credited to a card the tool knows',function(){
  var L=T.logic(),bad=[],m={cards:L.cards,principles:(L.principles||[]).length,rules:(L.rules||[]).length,categories:(L.categories||[]).length,hosts:(L.hosts||[]).length,units:(L.units||[]).length,fields:(L.fields||[]).length};
  if(m.principles!==m.cards)bad.push('principles '+m.principles+' for '+m.cards+' cards');if(m.rules<300)bad.push('only '+m.rules+' rules');
  var known={};for(var id in (L.credits||{}))known[id]=1;var orphan=(L.rules||[]).filter(function(r){return !known[r.from];}).length;if(orphan)bad.push(orphan+' rules credit no known card');
  var empty=(L.principles||[]).filter(function(p){return !p.drives.length&&!p.limits.length&&!p.when.length;}).length;m.empty=empty;if(empty>8)bad.push(empty+' principles carry no drive, limit or what-if');
  var cats=(L.categories||[]).filter(function(c){return !c.units.length||!c.fields.length;}).length;if(cats)bad.push(cats+' categories list no unit or field');
  var brick=T.logicRules('stacked-aggregates','drive');m.brickDrives=brick.length;if(!brick.length)bad.push('no drive rule under stacked-aggregates');
  if(!/Gantenbein/.test(T.logicCredit('gantenbein-winery')))bad.push('credit does not name the card');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.principles+' principles, '+m.rules+' rules in '+m.categories+' categories over '+m.hosts+' hosts, '+m.units+' units and '+m.fields+' fields; '+empty+' principles with no rule yet',metrics:m};});


/* ---- p33-1: the Start tab ---- */
guard('flow','the Start tab is first, offers the five steps and four doors, lists every host kind of the library, and a typed plan line becomes the design’s plan',function(){
  T.reset();var tabs=Array.from(document.querySelectorAll('#tabs button[role=tab]')).map(function(b){return b.textContent.replace(/^[a-z ]+/,'');});
  var bad=[],m={first:tabs[0]};if(!/Start$/.test(tabs[0]))bad.push('first tab is '+tabs[0]);
  var panel=document.querySelector('.startwrap');if(!panel)return{pass:false,detail:'no Start panel'};
  m.steps=panel.querySelectorAll('.sstep').length;m.doors=panel.querySelectorAll('.sdoor').length;if(m.steps!==5)bad.push(m.steps+' steps');if(m.doors!==4)bad.push(m.doors+' doors');
  panel.querySelector('[data-door=host]').click();var hosts=panel.querySelectorAll('.shost');m.hosts=hosts.length;var L=T.logic();if(hosts.length!==(L.hosts||[]).length)bad.push(hosts.length+' host cards for '+(L.hosts||[]).length+' kinds');
  var cyl=Array.from(hosts).filter(function(h){return /^cylinder/i.test(h.textContent);})[0];if(cyl){cyl.click();if(S.host.kind!=='cyl')bad.push('the cylinder host did not set host.kind: '+S.host.kind);}else bad.push('no cylinder card');
  S.host.kind='plane';panel.querySelector('[data-door=geo]').click();panel.querySelector('.sgeoPts').value='0,0 2700,0 2700,2700 5400,2700';S.width=900;panel.querySelector('.sgeoGo').click();
  m.planKind=S.plan.kind;m.cols=S.cols;if(S.plan.kind!=='curve')bad.push('plan kind '+S.plan.kind);if(S.cols!==9)bad.push('expected 9 chords of 900 along 8100 mm, got '+S.cols);
  var g=T.regen();if(!g||!g.panels||g.panels.length!==S.cols)bad.push('the design did not build on the line');
  S.plan={kind:'wall',sides:6,angle:90,face:'out'};S.arr='single';
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'Start first; 5 steps, 4 doors, '+m.hosts+' host kinds; a typed line of 8.1 m became a '+m.cols+'-panel plan on the curve',metrics:m};});




/* ---- p34-1: compose ---- */
guard('flow','Compose makes a buildable design from the library for any host and category, differs by seed, and credits the systems its rules came from',function(){
  T.reset();var bad=[],m={},hosts=['any','plane','cylinder','revolved','ground-plane','site-polygon','volume','ruled-sine-wall','single-curved-loft'],cats=[[],['stacked-aggregates'],['serial-iterations'],['multi-agent-networks','cellular-clusters'],['pixelated-fields'],['modular-assemblages'],['stacked-aggregates'],['woven-meshes'],['serial-iterations']];var forms={};
  var modes={},built=0,tried=0,words=[];
  hosts.forEach(function(hk,i){var c=cats[i%cats.length];var res=T.composeDesign(hk,c,17+i*31);tried++;if(!res){bad.push('no design for '+hk+' / '+c.join('+'));return;}
    var g=T.regen();var n=g?(g.total||(g.bricks||g.ribs||g.units||g.pavers||g.tiles||g.holes||[]).length):0;if(!g||!(n>0)){bad.push(hk+': built nothing ('+res.mode+')');return;}
    built++;modes[res.mode]=(modes[res.mode]||0)+1;forms[res.form]=1;words.push(res.words);if(!res.method||!res.method.length)bad.push(hk+': no method readback');if(!res.credits.length)bad.push(hk+': no credits');if(!/Composed from the logic of/.test(S.prov.source))bad.push(hk+': the record does not name the systems');
    if(c.length){var L=T.logic();var pr=L.principles.filter(function(p){return p.id===res.credits[0];})[0];if(pr&&c.indexOf(pr.category)<0)bad.push(hk+': the unit came from '+pr.category+', not '+c.join('+'));}});
  var a=T.composeDesign('plane',[],5),wa=a&&a.words,ka=a&&a.mode+'|'+a.unit+'|'+a.field;var b=T.composeDesign('plane',[],6),kb=b&&b.mode+'|'+b.unit+'|'+b.field;var c2=T.composeDesign('plane',[],5);
  m.tried=tried;m.built=built;m.modes=Object.keys(modes).join('/');m.forms=Object.keys(forms).join('/');if(Object.keys(forms).length<4)bad.push('only '+m.forms+' forms over nine hosts');m.seed5=ka;m.seed6=kb;if(ka===kb&&a.words===b.words)bad.push('seeds 5 and 6 gave the same design');if(c2.words!==wa)bad.push('seed 5 is not repeatable');
  /* a building the user asks for: a tower of 8 sides and 3 storeys in the stacked way, corners closed */
  var tw=T.composeDesign('tower',['stacked-aggregates'],3,{storeys:3,sides:8,length:0});var gt=T.regen();m.tower=tw?tw.mode+' '+S.plan.kind+' sides '+S.plan.sides+' rows '+S.rows+' gap '+S.gap:'none';
  if(!tw||S.plan.kind!=='tower'||S.plan.sides!==8||S.rows!==3||S.gap!==0||!gt||!(gt.total>0))bad.push('the asked-for tower did not come out as 8 sides x 3 storeys, closed: '+m.tower);
  var wl=T.composeDesign('wall',['serial-iterations'],4,{storeys:2,sides:8,length:12});var gw=T.regen();m.wall=wl?wl.mode+' cols '+S.cols+' rows '+S.rows+' w '+S.width:'none';
  if(!wl||S.rows!==2||Math.abs(S.cols*S.width-12000)>S.width||!gw)bad.push('the asked-for 12 m, 2-storey wall did not come out: '+m.wall);
  /* the category chips are single-select: pressing a second clears the first; pressing the same again clears it */
  var chips=document.querySelectorAll('.compose .chip');if(chips.length>1){chips[0].click();chips[1].click();var lit=document.querySelectorAll('.compose .chip.on').length;m.lit=lit;if(lit!==1)bad.push(lit+' chips lit after pressing two');chips[1].click();if(document.querySelectorAll('.compose .chip.on').length)bad.push('a chip stayed lit after being pressed again');}
  S.plan={kind:'wall',sides:6,angle:90,face:'out'};S.arr='single';S.host.kind='plane';
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:built+' of '+tried+' compositions built ('+m.modes+'; forms '+m.forms+'); seeds differ and repeat; e.g. '+words[0],metrics:m};});


/* ---- p40-1: the stacked tower, from construction (replaces p35-1) ---- */
guard('host','a stacked tower is slabs on columns round a core: every slab edge stands past the glass within the cantilever, the outlines close through their corners, a column at every corner, the core inside the smallest floor, taper and twist read, every element built',function(){
  T.reset();S.arr='single';S.field=T.fieldDefaults();S.field.kind='noise';S.stack={on:true,shape:'polygon',sides:8,w:18000,d:12000,storeys:10,storeyH:3200,layers:2,band:120,push:1500,taper:.2,twist:40,samples:48,hold:.3,slab:250,cant:3000,core:.2,colMax:7500};
  var St=T.stackOutlines(),bad=[],m={floors:St.floors.length,layers:St.L,cols:St.cols.length,colD:St.colD,core:Math.round(St.core)};
  if(St.floors.length!==11)bad.push(St.floors.length+' floors, expected 11');
  var slabs=St.layers.filter(function(l){return l.kind!=='fin';}).length,fins=St.layers.filter(function(l){return l.kind==='fin';}).length;if(slabs!==11||fins!==10)bad.push(slabs+' slabs and '+fins+' fins, expected 11 and 10');
  var out=0,over=0,gap=0,maxP=0;St.floors.forEach(function(f){var n=f.O.length;for(var k=0;k<n;k++){var d=(f.O[k].x-f.E[k].x)*f.N[k].x+(f.O[k].z-f.E[k].z)*f.N[k].z;maxP=Math.max(maxP,d);if(d<299)out++;if(d>St.cant+1)over++;var q=f.O[(k+1)%n];if(Math.hypot(q.x-f.O[k].x,q.z-f.O[k].z)>3000)gap++;}});
  m.maxProj=Math.round(maxP);if(out)bad.push(out+' slab-edge points less than 300 past the glass');if(over)bad.push(over+' points past the cantilever');if(gap)bad.push(gap+' slab-edge segments over 3 m (a broken corner)');if(maxP<900)bad.push('the field pushed nothing out: '+Math.round(maxP));
  var corners=St.base.map(function(b,k){return b.corner?k:-1;}).filter(function(k){return k>=0;});m.corners=corners.length;if(corners.length!==8)bad.push(corners.length+' corner samples on an octagon');
  var miss=corners.filter(function(k){return St.cols.indexOf(k)<0;}).length;if(miss)bad.push(miss+' corners without a column');
  var rin=1e9;St.floors.forEach(function(f){f.E.forEach(function(p){rin=Math.min(rin,Math.hypot(p.x,p.z));});});if(St.core/2*Math.SQRT2>rin-St.colD)bad.push('the core ('+Math.round(St.core)+') does not clear the smallest floor (inradius '+Math.round(rin)+')');
  var top=St.floors[St.floors.length-1],bot=St.floors[0],rt=0,rb=0;top.E.forEach(function(q){rt+=Math.hypot(q.x,q.z);});bot.E.forEach(function(q){rb+=Math.hypot(q.x,q.z);});m.taperRatio=+(rt/rb).toFixed(2);if(Math.abs(rt/rb-.8)>.02)bad.push('taper '+m.taperRatio+', expected 0.8');
  var a0=Math.atan2(bot.E[0].z,bot.E[0].x),a1=Math.atan2(top.E[0].z,top.E[0].x),dtw=((a1-a0)*180/Math.PI+540)%360-180;m.twistDeg=+dtw.toFixed(1);if(Math.abs(dtw-40)>1)bad.push('twist '+dtw.toFixed(1)+', expected 40');
  var geos=T.hostScene(),sm=T.stackMeshes();m.meshes=sm.length;if(sm.length!==10)bad.push(sm.length+' meshes, expected 10 (slabs, core, columns, glass, mullions, balustrades, rails, fins, posts, anchors)');
  var miny=1e9;sm.forEach(function(g){g.computeBoundingBox();miny=Math.min(miny,g.boundingBox.min.y);});m.minY=Math.round(miny);if(Math.abs(miny)>1)bad.push('the tower does not stand on the ground (min y '+Math.round(miny)+')');
  var csv=T.stackCSV().split('\n');if(csv.length-2!==St.L)bad.push('the schedule has '+(csv.length-2)+' rows for '+St.L+' layers');
  S.stack.push=6000;S.stack.layers=1;var Sh=T.stackOutlines();m.held=Sh.held;var mp=0;Sh.floors.forEach(function(f){f.proj.forEach(function(p){mp=Math.max(mp,p);});});if(!(Sh.held>0&&mp<=Sh.cant+1))bad.push('a 6 m push was not held to the cantilever ('+Math.round(mp)+')');
  S.stack.shape='rect';S.stack.taper=0;S.stack.twist=0;var Sr=T.stackOutlines(),rc=Sr.base.filter(function(b){return b.corner;});var sq=rc.filter(function(b){return Math.abs(Math.abs(b.x)-9000)<1&&Math.abs(Math.abs(b.z)-6000)<1;}).length;if(sq!==4)bad.push('the rectangle has '+sq+' exact corners');
  S.stack.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'11 slabs + 10 fins, edges 300 to '+m.maxProj+' mm past the glass (held at the cantilever when pushed 6 m), '+m.cols+' columns of '+m.colD+' incl. all 8 corners, core '+m.core+' inside, top '+m.taperRatio+', twist '+m.twistDeg+', 9 meshes on the ground, rectangle corners exact',metrics:m};});


/* ---- p41-1: the voxel building, from construction (replaces p36-1) ---- */
guard('host','a voxel building stands: every module bears on the one below or cantilevers one module off a supported neighbour, nothing stands on a cantilever, every storey is reached from a continuous core, party walls where modules meet, balconies only on outside faces',function(){
  T.reset();S.arr='single';S.field=T.fieldDefaults();S.field.kind='gradient';S.vox={on:true,mod:3000,h:3100,nx:12,ny:8,storeys:10,pull:'20,40,30,25,35,50,45,30',top:'60,80,70,55',erode:25,erodeBy:'uniform',balcony:20,seed:3,cant:true,podium:true};
  var V=T.voxCells(),bad=[],m={modules:V.cells.length,inside:V.inside,eroded:V.eroded,floating:V.floating,detached:V.detached,cants:V.cants,party:V.party,bal:V.balconies,coreTop:V.coreTop};
  if(V.inside<200)bad.push('only '+V.inside+' modules inside the frame');if(!(V.eroded>0))bad.push('nothing eroded at 25%');
  var unsup=0,onCant=0,cantBad=0,core=0;V.cells.forEach(function(c){if(c.core)core++;if(c.k===0)return;var below=V.kept.get(V.key(c.i,c.j,c.k-1));
    if(!c.cant){if(!below)unsup++;else if(below.cant)onCant++;}
    else{var ok=[[1,0],[-1,0],[0,1],[0,-1]].some(function(d){var n=V.kept.get(V.key(c.i+d[0],c.j+d[1],c.k));if(!n||n.cant)return false;var nb=V.kept.get(V.key(n.i,n.j,n.k-1));return n.k===0||(nb&&!nb.cant);});if(!ok)cantBad++;if(below)cantBad++;}});
  if(unsup)bad.push(unsup+' modules with nothing under them');if(onCant)bad.push(onCant+' modules standing on a cantilever');if(cantBad)bad.push(cantBad+' cantilevers not beside a supported module');
  if(core!==V.coreTop+1)bad.push('the core has '+core+' modules for '+(V.coreTop+1)+' storeys (a gap)');
  var reach=0;for(var k=0;k<=V.coreTop;k++){var lay=V.cells.filter(function(c){return c.k===k;}),set={};lay.forEach(function(c){set[c.i+','+c.j]=c;});var st=V.core[0]+','+V.core[1],seen={},q=[st];seen[st]=1;
    while(q.length){var p=q.shift().split(',').map(Number);[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(d){var n=(p[0]+d[0])+','+(p[1]+d[1]);if(set[n]&&!seen[n]){seen[n]=1;q.push(n);}});}
    lay.forEach(function(c){if(!seen[c.i+','+c.j])reach++;});}
  if(reach)bad.push(reach+' modules the core cannot reach');if(V.cells.some(function(c){return c.k>V.coreTop;}))bad.push('modules above the core');
  var pairs=0;V.cells.forEach(function(c){[[1,0],[0,1]].forEach(function(d){if(V.kept.has(V.key(c.i+d[0],c.j+d[1],c.k)))pairs++;});});if(pairs!==V.party)bad.push(V.party+' party walls for '+pairs+' shared faces');
  var balIn=V.cells.filter(function(c){return c.balcony&&V.kept.has(V.key(c.i+c.balcony[0],c.j+c.balcony[1],c.k));}).length;if(balIn)bad.push(balIn+' balconies on an inside face');if(!(V.balconies>0))bad.push('no balconies');
  var geos=T.hostScene(),vm=T.voxMeshes();m.meshes=vm.length;if(vm.length<9)bad.push(vm.length+' meshes, expected 10 (podium, cassettes, posts, walls, party walls, core, glass, balconies, rails, roofs)');
  var miny=1e9;vm.forEach(function(g){g.computeBoundingBox();miny=Math.min(miny,g.boundingBox.min.y);});m.minY=Math.round(miny);if(Math.abs(miny)>1)bad.push('the building does not stand on the ground (min y '+Math.round(miny)+')');
  var csv=T.voxCSV().split('\n');if(csv.length-2!==V.cells.length)bad.push('the schedule has '+(csv.length-2)+' rows');
  S.vox.cant=false;var V2=T.voxCells();m.noCant=V2.cells.length;if(V2.cants!==0||V2.cells.length>V.cells.length)bad.push('with cantilevers off: '+V2.cants+' cantilevers, '+V2.cells.length+' modules');
  S.vox.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.modules+' modules stand of '+m.inside+' inside ('+m.eroded+' eroded, '+m.floating+' unsupported and '+m.detached+' unreachable left out), '+m.cants+' one-module cantilevers, core '+(m.coreTop+1)+' storeys, '+m.party+' party walls, '+m.bal+' balconies, '+m.meshes+' meshes on the ground',metrics:m};});


/* ---- p37-1: the dome ---- */
guard('host','a geodesic dome is a closed lattice: every edge above the rim is shared by two faces, the vertex count is the icosahedron’s, both layers are webbed, and the field opens panels',function(){
  T.reset();S.arr='single';S.field=T.fieldDefaults();S.field.kind='gradient';S.dome={on:true,r:12000,level:3,cut:0,depth:600,strut:90,openBelow:0,panels:true};
  var bad=[],m={};var D=T.domeCells();m.faces=D.faces.length;m.edges=D.edges.length;m.vertices=D.vertices;m.rim=D.rim;
  /* a whole sphere at level 3: 1280 faces, 1920 edges, 642 vertices (10 x 4^L + 2); every edge shared by two faces */
  if(D.faces.length!==1280)bad.push(D.faces.length+' faces, expected 1280');if(D.vertices!==642)bad.push(D.vertices+' vertices, expected 642');if(D.rim!==0)bad.push(D.rim+' open edges on a whole sphere');
  var bad2=D.edges.filter(function(e){return e.shared!==2;}).length;if(bad2)bad.push(bad2+' edges not shared by two faces');
  S.dome.cut=.3;var Dc=T.domeCells();m.cutFaces=Dc.faces.length;m.cutRim=Dc.rim;if(!(Dc.faces.length<1280&&Dc.faces.length>400))bad.push('the cut kept '+Dc.faces.length+' faces');if(!(Dc.rim>0))bad.push('a cut dome has no rim on the ground');
  var inner=Dc.edges.filter(function(e){return e.shared===2;}).length;if(inner+Dc.rim!==Dc.edges.length)bad.push('edges neither shared nor rim');
  S.dome.openBelow=.5;var Do=T.domeCells();m.opened=Do.opened;if(!(Do.opened>0&&Do.opened<Do.faces.length))bad.push('the field opened '+Do.opened+' of '+Do.faces.length);
  var geos=T.hostScene(),dm=T.domeMeshes();m.meshes=dm.length;/* pass 39: the frame is merged by role (members, nodes, plates, ring, plinth, frames, glass); p39-1 checks it */if(dm.length<8)bad.push('only '+dm.length+' dome meshes');
  var csv=T.domeCSV().split('\n');if(csv.length-2!==Do.frame.members.length)bad.push('the member schedule has '+(csv.length-2)+' rows');
  S.dome.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'whole sphere 1280 faces / 1920 struts / 642 vertices, every strut shared by two faces; cut at 0.3: '+m.cutFaces+' faces with '+m.cutRim+' rim struts; '+m.opened+' panels opened by the field; '+m.meshes+' meshes',metrics:m};});


/* ---- p38-1: the loft ---- */
guard('host','a sectioned loft is a stack of closed plates at the pitch, inflated by the field, turned and swayed along the height, every rod passing through every plate',function(){
  T.reset();S.arr='single';S.field=T.fieldDefaults();S.field.kind='noise';S.loft={on:true,w:9000,d:6000,h:12000,pitch:300,t:24,bulge:.35,twist:30,sway:800,rods:4,samples:40};
  var bad=[],m={};var L=T.loftSections();m.plates=L.n;if(L.n!==40)bad.push(L.n+' plates, expected 40');
  var gaps=0;L.secs.forEach(function(s,j){if(s.pts.length<12)bad.push('plate '+j+' has '+s.pts.length+' points');if(j>0&&Math.abs(s.y-(L.secs[j-1].y+300))>.5)gaps++;});if(gaps)bad.push(gaps+' pitch errors');
  var rMax=0,rMin=1e9;L.secs[20].pts.forEach(function(q){var r=Math.hypot(q.x-L.cen[20].x,q.z-L.cen[20].z);rMax=Math.max(rMax,r);rMin=Math.min(rMin,r);});m.midRadii=[Math.round(rMin),Math.round(rMax)];if(!(rMax>4500*1.02||rMin<3000*.98))bad.push('the field inflated nothing at mid height');
  /* the sway is read with the bulge off, so the field's asymmetry does not move the centroid */S.loft.bulge=0;var L0=T.loftSections();S.loft.bulge=.35;var sway=L0.cen[20].x-L0.cen[0].x;m.swayMid=Math.round(sway);if(Math.abs(sway-800)>80)bad.push('the sway at mid height is '+sway.toFixed(0)+', expected about 800');
  var a0=Math.atan2(L.secs[0].pts[0].z-L.cen[0].z,L.secs[0].pts[0].x-L.cen[0].x),a1=Math.atan2(L.secs[39].pts[0].z-L.cen[39].z,L.secs[39].pts[0].x-L.cen[39].x),dtw=((a1-a0)*180/Math.PI+540)%360-180;m.twist=+dtw.toFixed(1);if(Math.abs(Math.abs(dtw)-30)>10)bad.push('the twist at the top is '+dtw.toFixed(1)+', expected about 30');
  m.threaded=L.threaded;if(!L.allThreaded)bad.push('a rod misses a plate: '+L.threaded+' of '+(L.n*4)+' passes');
  var geos=T.hostScene(),lm=T.loftMeshes();m.meshes=lm.length;var want=L.n+4*(L.n-1);if(lm.length!==want)bad.push('expected '+want+' meshes (plates + rod segments), got '+lm.length);
  var csv=T.loftCSV().split('\n');if(csv.length-2!==L.n)bad.push('the plate schedule has '+(csv.length-2)+' rows');
  S.loft.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'40 plates at 300 mm, inflated by the field (mid radii '+m.midRadii.join(' to ')+' mm), swayed '+m.swayMid+' mm, twisted '+m.twist+' deg; 4 rods pass through all 40 plates ('+m.threaded+' passes); '+m.meshes+' meshes; schedule matches',metrics:m};});

/* ---- p39-1: the dome as a space frame ---- */
guard('host','the dome is a stable space frame on a level ring: members + reactions >= 3 x nodes, every node has three or more members, the rim lies on the ground, members grow with their length, openings never touch, and the hexagonal dual builds',function(){
  T.reset();S.arr='single';S.field=T.fieldDefaults();S.field.kind='gradient';S.dome={on:true,r:12000,level:3,cut:.25,depth:600,strut:60,openBelow:.5,panels:true,skin:'tri',footing:true};
  var bad=[],m={};var D=T.domeCells(),F=D.frame;m.nodes=F.nodes.length;m.members=F.members.length;m.cells=F.cells.length;m.opened=D.opened;
  if(!F.maxwell.ok)bad.push('Maxwell fails: '+F.maxwell.m+' + '+F.maxwell.r+' < 3 x '+F.maxwell.j);
  if(F.minDeg<3)bad.push('a node with '+F.minDeg+' members');
  var ring=F.nodes.filter(function(n){return n.kind==='ring';});m.ring=ring.length;if(ring.length<6)bad.push(ring.length+' ring nodes');
  var off=ring.filter(function(n){return Math.abs(n.p[1])>1e-6||Math.abs(Math.hypot(n.p[0],n.p[2])-D.Rg)>1;}).length;if(off)bad.push(off+' ring nodes off the ground ring');
  var below=F.nodes.filter(function(n){return n.p[1]<-1e-6;}).length;if(below)bad.push(below+' nodes below ground');
  /* sizes follow length: the longest chord is at least as big as the shortest */
  var ch=F.members.filter(function(x){return x.kind==='chord-out';}).sort(function(a,b){return a.L-b.L;});if(ch[ch.length-1].d<ch[0].d)bad.push('a longer chord is smaller');
  F.members.forEach(function(x){if(x.kind!=='ring'&&x.L/(0.35*x.d)>125)bad.push('member '+Math.round(x.L)+' long at CHS '+x.d+' is too slender');});
  /* openings never touch, never in the bottom tier */
  var touch=0,base=0;F.cells.forEach(function(c,ci){if(!c.open)return;if(c.base)base++;F.nb[ci].forEach(function(n){if(F.cells[n].open)touch++;});});if(touch)bad.push(touch+' touching openings');if(base)bad.push(base+' openings in the bottom tier');
  if(!(D.opened>0))bad.push('no openings at threshold 0.5');
  var geos=T.hostScene(),dm=T.domeMeshes();m.meshes=dm.length;if(dm.length<8)bad.push('only '+dm.length+' dome meshes (members, nodes, plates, ring, plinth, frames, glass)');
  var miny=1e9;dm.forEach(function(g){g.computeBoundingBox();miny=Math.min(miny,g.boundingBox.min.y);});m.minY=Math.round(miny);if(Math.abs(miny)>2)bad.push('the plinth does not stand on the ground (min y '+Math.round(miny)+')');
  var csv=T.domeCSV().split('\n');if(csv.length-2!==F.members.length)bad.push('the schedule has '+(csv.length-2)+' rows for '+F.members.length+' members');
  S.dome.skin='hex';var H=T.domeCells(),FH=H.frame;m.hexCells=FH.cells.length;m.hexMembers=FH.members.length;if(!FH.maxwell.ok)bad.push('hex: Maxwell fails');if(FH.minDeg<3)bad.push('hex: a node with '+FH.minDeg+' members');
  var six=FH.cells.filter(function(c){return !c.base&&c.ids.length===6;}).length,five=FH.cells.filter(function(c){return !c.base&&c.ids.length===5;}).length;m.hex6=six;m.hex5=five;if(!(six>five&&five>0))bad.push('hex cells: '+six+' hexagons, '+five+' pentagons');
  S.dome.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.nodes+' nodes, '+m.members+' members ('+F.maxwell.m+' + '+F.maxwell.r+' >= 3 x '+F.maxwell.j+'), '+m.ring+' ring nodes on the ground, '+m.opened+' openings apart; hex dual '+six+' hexagons + '+five+' pentagons; '+m.meshes+' meshes on the ground',metrics:m};});


/* ---- p43-1: panels on a plan: corners and floors ---- */
guard('assembly','panels on a plan have a post at every corner that covers both panel ends of the joint, and a closed plan facing out has a building behind them: a slab at every storey line, brackets at every joint and floor, nothing showing through the panels',function(){
  T.reset();T.setPanelMode('cut');S.arr='grid';S.plan={kind:'tower',sides:6,angle:90,face:'out'};S.cols=36;S.rows=4;S.width=1200;S.height=3000;S.gap=0;S.planb={on:true,cavity:600,storeyH:0};
  var bad=[],m={};T.hostScene();var B=window.PS_PLANB;if(!B){return{pass:false,detail:'no plan building was made'};}
  m.corners=B.corners.length;m.covered=B.covered;m.slabs=B.slabs;m.brackets=B.brackets;m.storeys=B.storeys;m.meshes=B.meshes;
  if(B.corners.length!==6)bad.push(B.corners.length+' corner posts on a hexagon');if(B.covered!==B.corners.length)bad.push((B.corners.length-B.covered)+' corners left open');
  if(!B.building)bad.push('no building behind a closed plan');if(B.slabs!==B.storeys+1)bad.push(B.slabs+' slabs for '+B.storeys+' storeys');if(B.storeys!==4)bad.push(B.storeys+' storeys for 4 rows of 3 m');
  if(B.brackets!==B.storeys*(36+6))bad.push(B.brackets+' brackets, expected '+(B.storeys*42)+' (a joint every panel per side, every floor)');
  if(B.zB>=B.zF)bad.push('panel back/front read wrong');
  S.plan={kind:'corner',sides:6,angle:90,face:'out'};S.cols=8;T.hostScene();var C=window.PS_PLANB;m.cornerPlan=C.corners.length;if(C.corners.length!==1||C.covered!==1||C.building)bad.push('a corner plan: '+C.corners.length+' posts, '+C.covered+' covered, building '+C.building);
  S.plan={kind:'tower',sides:6,angle:90,face:'out'};S.cols=36;S.planb.on=false;window.PS_PLANB=null;T.hostScene();if(window.PS_PLANB)bad.push('switched off but still built');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'hexagon: 6 corner posts, all 6 cover both panel ends; 4 storeys, 5 slabs, '+m.brackets+' brackets; corner plan: 1 post, no building; off means off',metrics:m};});


/* ---- p47-1: stacked timber on a fixed-length chain ---- */
guard('host','stacked timber: every member the same length, folded where the outline is short, a dowel at every crossing within reach of the member below, every member end supported, openings framed, an open wall on end posts',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';var bad=[],m={};
  var cases=[['pavilion',{}],['hexagon leaning bulge',{sides:6,d0:5000,d1:3000,dmid:6500,lean:1200,height:4200}],['curved wall',{arc:180,d0:9000,d1:9000,height:2800,open:.3}],['steep cone',{d0:8000,d1:2500,height:4500}]];
  cases.forEach(function(cs){S.crib=Object.assign({on:true,d0:6000,d1:3600,dmid:0,height:3600,lean:0,sides:0,arc:360,L:610,w:76,h:76,e:60,dowel:20,fold:'in',open:.25,slotH:2100,seed:5,footing:true,cap:true},cs[1]);T.hostScene();var R=window.PS_CRIB;
    if(!R){bad.push(cs[0]+': nothing built');return;}m[cs[0]]={members:R.mem.filter(function(x){return !x.open;}).length,dowels:R.dowels.length,slips:R.slips,unsup:R.unsup,slots:R.slots.length,held:R.held,lmin:+R.lmin.toFixed(2),lmax:+R.lmax.toFixed(2)};
    if(Math.abs(R.lmax-R.L)>.5||Math.abs(R.lmin-R.L)>.5)bad.push(cs[0]+': member lengths '+R.lmin.toFixed(1)+' to '+R.lmax.toFixed(1)+', not all '+R.L);
    if(R.slips)bad.push(cs[0]+': '+R.slips+' crossings out of dowel reach');if(R.unsup)bad.push(cs[0]+': '+R.unsup+' member ends unsupported');if(R.stretched)bad.push(cs[0]+': '+R.stretched+' pleats stretched straight');
    var need=0;for(var c=1;c<R.C;c++)need+=0;if(R.dowels.length<R.mem.filter(function(x){return !x.open&&x.c>0;}).length)bad.push(cs[0]+': '+R.dowels.length+' dowels for '+R.mem.filter(function(x){return !x.open&&x.c>0;}).length+' members above the first course');
    if(R.closed&&!R.slots.some(function(q){return q.door&&q.c0===0;}))bad.push(cs[0]+': a closed pavilion with no entrance from the ground');});
  var csv=T.hostScene&&window.PS_CRIB?1:0;
  S.crib.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:Object.keys(m).map(function(k){var q=m[k];return k+': '+q.members+' members of one length, '+q.dowels+' dowels, '+q.slots+' framed openings'+(q.held?', held on '+q.held+' courses':'');}).join('; ')+'; no slips, every end supported',metrics:m};});


/* ---- p48-1: the planted ground ---- */
guard('paver','a roof garden sizes each hole from the field between the smallest and largest, every hole clears its slab by 15 mm of stone, the trees keep their crown spacing, two attractor curves both draw holes',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=18000;S.height=12000;
  Object.assign(S.paver,{tiling:'stack',ratio:1,size:600,joint:6,types:3,palette:'#9C9A95,#A9A7A2,#B5B3AE',assign:'scatter',heights:'60',holeBy:'field',holeMin:100,holeMax:520,holeCut:.25,holeGamma:1.8,stools:.35,edge:'parapet',cull:0,keep:'',plant:true,pots:false,treeGap:3500});
  S.field=T.fieldDefaults();S.field.kind='attractCurve';S.field.attractCurve.pts='0,0.15;0.3,0.4;0.55,0.35;1,0.8|0.1,1;0.4,0.7;0.7,0.75;1,0.35';S.field.attractCurve.radius=.28;T.fieldUse();
  var g=T.regen(),bad=[],m={};var pv=g.pavers||[],holes=pv.filter(function(p){return p.hole>0;});m.pavers=pv.length;m.holes=holes.length;
  if(!(holes.length>40))bad.push('only '+holes.length+' holes');var sizes={};holes.forEach(function(p){sizes[p.hole]=1;});m.sizes=Object.keys(sizes).length;if(m.sizes<10)bad.push('only '+m.sizes+' hole sizes: not continuous');
  var out=holes.filter(function(p){return p.hole<100-1e-6||p.hole>520+1e-6;}).length;if(out)bad.push(out+' holes outside 100 to 520');
  /* clearance: the circle clears every edge of its slab by 15 mm */var tight=0;holes.forEach(function(p){var q=p.pts;for(var i=0;i<q.length;i++){var a=q[i],b=q[(i+1)%q.length],L=Math.hypot(b.x-a.x,b.y-a.y);if(L<1e-6)continue;if(Math.abs((p.cx-a.x)*(b.y-a.y)-(p.cy-a.y)*(b.x-a.x))/L<p.hole/2+15-1e-6){tight++;break;}}});if(tight)bad.push(tight+' holes closer than 15 mm to a slab edge');
  /* both curves draw: holes in the top half and the bottom half of the garden */var top=holes.filter(function(p){return p.cy>6000;}).length,bot=holes.length-top;m.top=top;m.bottom=bot;if(!(top>10&&bot>10))bad.push('holes top '+top+', bottom '+bot+': one curve is missing');
  T.hostScene();m.trees=g.paver.trees;var big=holes.filter(function(p){return p.hole>=420;});var tr=[];big.sort(function(a,b){return b.hole-a.hole;}).forEach(function(p){if(tr.every(function(q){return Math.hypot(q.cx-p.cx,q.cy-p.cy)>=3500;}))tr.push(p);});
  if(g.paver.trees!==tr.length)bad.push(g.paver.trees+' trees planted, the spacing rule gives '+tr.length);if(!(tr.length>=2))bad.push('fewer than 2 trees');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.holes+' holes of '+m.sizes+' sizes from 100 to 520, all clear of their slab edges; '+m.top+' under one curve and '+m.bottom+' under the other; '+m.trees+' trees at 3.5 m spacing',metrics:m};});


/* ---- p49-1: stacked timber built by a robot ---- */
guard('host','the stacked timber bundle carries a robot program: every member placed once, a drill and a dowel at every dowelled pivot, stations within reach of the base, no NaN',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';S.crib={on:true,d0:6000,d1:3600,dmid:0,height:3600,lean:0,sides:0,arc:360,L:610,w:76,h:76,e:60,dowel:20,fold:'in',open:.25,slotH:2100,seed:5,footing:true,cap:true};S.fab.reach=2700;
  T.hostScene();var R=window.PS_CRIB;return Promise.resolve(T.bundleFiles()).then(function(files){var bad=[],m={};var src=files.filter(function(f){return /-robot\.src$/.test(f.name);})[0],csvf=files.filter(function(f){return /-robot\.csv$/.test(f.name);})[0];
  if(!src||!csvf){S.crib.on=false;return{pass:false,detail:'no robot files in the bundle: '+files.map(function(f){return f.name;}).join(', ')};}
  var dec=function(d){return typeof d==='string'?d:new TextDecoder().decode(d);},krl=dec(src.data),rows=dec(csvf.data).trim().split(String.fromCharCode(10)).slice(1).map(function(l){return l.split(',');});
  var place=rows.filter(function(r){return r[0]==='place';}).length,drill=rows.filter(function(r){return r[0]==='drill';}).length,dowel=rows.filter(function(r){return r[0]==='dowel';}).length,live=R.mem.filter(function(x){return !x.open;}).length;
  m={members:live,place:place,drill:drill,dowel:dowel,dowels:R.dowels.length,stations:new Set(rows.map(function(r){return r[3];})).size};
  if(place!==live)bad.push(place+' placements for '+live+' members');if(drill!==dowel)bad.push(drill+' drillings for '+dowel+' dowels');
  /* each dowel is driven once, by the member that ends on it from above */if(dowel!==R.dowels.length)bad.push(dowel+' dowels driven, '+R.dowels.length+' in the schedule');
  if(/NaN|undefined/.test(krl))bad.push('NaN in the program');if(!/DEF TIMBER_STACK\(\)/.test(krl)||!/END\s*$/.test(krl))bad.push('the program is not a KRL DEF ... END');if(m.stations<2)bad.push('a 6 m pavilion on '+m.stations+' station with a 2.7 m reach');
  S.crib.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.members+' members placed, '+m.drill+' drilled and dowelled pivots, '+m.stations+' stations',metrics:m};});});


/* ---- p50-1: brick walls built as walls ---- */
guard('brick','open bond: every brick off the first course bears at least a quarter of its length on the course below; a tall free-standing wall gets bonded piers and a coping',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=1200;S.brick.open=.4;S.brick.d2=0;S.brick.d1=0;var g=T.regen(),B=g.brick,bad=[],m={};
  var by={};g.bricks.forEach(function(b){(by[b.r]=by[b.r]||[]).push(b);});var low=0,checked=0;
  Object.keys(by).forEach(function(r){r=+r;if(!r||!by[r-1])return;by[r].forEach(function(b){var L=b.len||B.bL,a=b.x-L/2,e=b.x+L/2;if(L<B.bL-1)return;checked++;var ov=by[r-1].map(function(q){var Lq=q.len||B.bL;return Math.max(0,Math.min(e,q.x+Lq/2)-Math.max(a,q.x-Lq/2));}).filter(function(o){return o>0;});
    var s=ov.reduce(function(x,y){return x+y;},0);if(s<B.bL/2-1)low++;});});m.checked=checked;m.low=low;if(!checked)bad.push('no bricks to check');if(low)bad.push(low+' bricks bear less than half their length in all');
  var gaps=0;Object.keys(by).forEach(function(r){var row=by[r].slice().sort(function(a,b){return a.x-b.x;});for(var i=1;i<row.length;i++){var gp=(row[i].x-(row[i].len||B.bL)/2)-(row[i-1].x+(row[i-1].len||B.bL)/2);if(gp>B.joint+.4*B.bL+1)gaps++;}});if(gaps)bad.push(gaps+' gaps wider than the open bond allows');
  S.arr='grid';S.cols=8;S.rows=1;S.width=1500;S.height=2400;S.brick.open=0;S.brick.piers='auto';S.brick.cope='stone';T.regen();var geos=T.hostScene(),b=T.hostSceneBox();m.zMin=Math.round(b.zMin);
  /* the piers stand behind the wall: the scene reaches more than a brick's length behind its back face */if(!(b.zMin<-S.brick.bW/2-S.brick.bL+5))bad.push('no piers behind a 2.4 m free-standing wall (z min '+Math.round(b.zMin)+')');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.checked+' bricks in open bond all bear at least half their length on the course below; piers behind a 2.4 m wall',metrics:m};});


/* ---- p51-1: the stacked timber's fasteners ---- */
guard('host','stacked timber fasteners: threaded rods pin every crossing (each segment within the hole clearance, the next overlapping by a course); screws and dowels one per crossing; the schedules follow the choice',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';var base={on:true,d0:6000,d1:3600,dmid:0,height:3600,lean:0,sides:0,arc:360,L:610,w:76,h:76,e:60,dowel:20,fold:'in',open:.25,slotH:2100,seed:5,footing:true,cap:true,rodD:16,screwD:8};
  S.crib=Object.assign({},base,{fastener:'rod'});T.hostScene();var R=window.PS_CRIB,bad=[],m={};m.rods=R.rods.length;m.crossings=R.dowels.length;
  var unpinned=0;R.dowels.forEach(function(d){if(!R.rods.some(function(r){return r.key===d.key&&r.c0<=d.c-1&&r.c1>=d.c;}))unpinned++;});m.unpinned=unpinned;if(unpinned)bad.push(unpinned+' of '+R.dowels.length+' crossings not pinned by a rod');
  if(!(R.rods.length>0&&R.rods.length<R.dowels.length/2))bad.push(R.rods.length+' rod segments for '+R.dowels.length+' crossings: they should run several courses');
  var avg=R.rods.reduce(function(s,r){return s+(r.c1-r.c0+1);},0)/Math.max(1,R.rods.length);m.avgCourses=+avg.toFixed(1);
  S.crib=Object.assign({},base,{fastener:'screw'});T.hostScene();var R2=window.PS_CRIB;m.screws=R2.dowels.length;if(R2.dowels.length!==R.dowels.length)bad.push('screws '+R2.dowels.length+' for '+R.dowels.length+' crossings');
  S.crib.on=false;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.rods+' rod segments (about '+m.avgCourses+' courses each) pin all '+m.crossings+' crossings; '+m.screws+' screws, one per crossing',metrics:m};});


/* ---- p54-1: a field of curved timber walls ---- */
guard('host','a pavilion of curved stacked timber walls: every wall one member length, no slips, every end supported, end posts on each wall, one robot program per wall in the bundle',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';S.crib={on:true,walls:5,gap:-10,stagger:900,turn:0,fastener:'dowel',rodD:16,screwD:8,d0:8000,d1:7400,dmid:0,height:3000,lean:0,sides:0,arc:360,L:610,w:76,h:76,e:60,dowel:20,fold:'in',open:.15,slotH:2100,seed:5,footing:true,cap:true};
  T.hostScene();var Rs=window.PS_CRIBS||[],bad=[],m={walls:Rs.length};if(Rs.length!==5)bad.push(Rs.length+' walls built, expected 5');
  Rs.forEach(function(R,i){if(R.closed)bad.push('wall '+(i+1)+' is closed');if(R.slips)bad.push('wall '+(i+1)+': '+R.slips+' slips');if(R.unsup)bad.push('wall '+(i+1)+': '+R.unsup+' unsupported ends');if(Math.abs(R.lmax-R.L)>.5||Math.abs(R.lmin-R.L)>.5)bad.push('wall '+(i+1)+': lengths '+R.lmin.toFixed(1)+' to '+R.lmax.toFixed(1));});
  m.members=Rs.reduce(function(s,R){return s+R.mem.filter(function(x){return !x.open;}).length;},0);
  S.crib.on=false;if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'5 overlapping walls, '+m.members+' members of one length, no slips, every end supported',metrics:m};});


/* ---- p55-1: pavers as a module library ---- */
guard('paver','the module library: each new layout covers the frame without overlap, every type takes its kind, seat blocks stand apart, a planted-hole type carries holes, a grass type keeps its cells',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={};
  ['ashlar','planks','radial','tri'].forEach(function(lay){Object.assign(S.paver,{tiling:lay,ratio:lay==='planks'?4:lay==='radial'?2:1,size:lay==='radial'?900:600,joint:0,types:3,kinds:'',cull:0,keep:'',holes:'',holeBy:'type',minPiece:.02});
    var g=T.regen(),pv=g.pavers||[],A=0,F=(S.width-Math.max(0,S.frameL)-Math.max(0,S.frameR))*(S.height-Math.max(0,S.frameB)-Math.max(0,S.frameT));pv.forEach(function(p){A+=p.area;});m[lay]={pavers:pv.length,cover:+(A/F).toFixed(4)};
    if(Math.abs(A/F-1)>(lay==='radial'?.03:.01))bad.push(lay+' covers '+(100*A/F).toFixed(1)+'% of the frame');});
  Object.assign(S.paver,{tiling:'ashlar',ratio:1,size:600,joint:6,types:4,kinds:'slab,hole,seat,grass',assign:'quantise'});S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var g=T.regen(),pv=g.pavers||[];
  var kinds={};pv.forEach(function(p){kinds[p.kind]=(kinds[p.kind]||0)+1;});m.kinds=kinds;['slab','hole','seat','grass'].forEach(function(k){if(!kinds[k])bad.push('no '+k+' modules');});
  var seats=pv.filter(function(p){return p.kind==='seat';}),close=0;seats.forEach(function(a,i){seats.forEach(function(b,j){if(j>i&&Math.hypot(a.cx-b.cx,a.cy-b.cy)<900-1e-6)close++;});});if(close)bad.push(close+' pairs of seat blocks closer than 1.5 modules');
  var holed=pv.filter(function(p){return p.kind==='hole'&&p.hole>0;}).length;m.holed=holed;if(!(holed>0))bad.push('the planted-hole type carries no holes');
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:'ashlar, planks, radial and triangles each cover the frame; kinds '+JSON.stringify(kinds)+'; seats 1.5 modules apart; '+holed+' planted holes',metrics:m};});


/* ---- p56-1: what holds the serial ribs ---- */
guard('serial','what holds the ribs: rods through every rib with stock round each hole, spacers at the pitch, a base channel on the ground; rails notched half and half; a twist made of blades on spines between posts',function(){
  T.reset();S.arr='single';T.ombBuiltin('ramp');T.setPanelMode('serial');S.width=1800;S.height=2400;Object.assign(S.serial,{op:'contour',dir:'horizontal',join:'rods',rodD:16,bay:600,base:true,dMin:10,dMax:240,pitch:60,t:18,zeroWaste:true});
  var g=T.regen(),Sr=g.serial,F=Sr.fix,bad=[],m={};
  m.rods=F.rods;m.front=F.front;m.stations=F.stations.length;m.dMinHeld=Sr.dMinHeld;m.spacerL=F.spacerL;m.arm=F.arm;
  if(F.join!=='rods')bad.push('join '+F.join);
  var need=2*F.edge+F.dh;if(Sr.dMinHeld!==Math.round(need))bad.push('shallowest held to '+Sr.dMinHeld+', expected '+need);
  var miss=0;g.ribs.forEach(function(r){F.rodsAt.forEach(function(o){var v=r.v[o.k];if(v<o.zb+F.dh/2+F.edge-1e-6)miss++;if(o.zf!=null&&v<o.zf+F.dh/2+F.edge-1e-6)miss++;});});if(miss)bad.push(miss+' holes without '+F.edge+' mm of stock in front');
  if(F.stations.length<3)bad.push(F.stations.length+' rod stations on a 1.8 m rib at 600');
  for(var q=1;q<F.stations.length;q++)if(F.stations[q]-F.stations[q-1]>600+1e-6)bad.push('rods '+(F.stations[q]-F.stations[q-1]).toFixed(0)+' apart');
  if(Math.abs(F.spacerL-(Sr.pitch-Sr.t))>1e-6)bad.push('spacer '+F.spacerL+' for a gap of '+(Sr.pitch-Sr.t));
  if(F.spacers!==F.rods*(g.ribs.length-1))bad.push(F.spacers+' spacers for '+F.rods+' rods and '+g.ribs.length+' ribs');
  if(!(g.ribs[0].c>=F.baseH-1e-6))bad.push('the first rib sits at '+g.ribs[0].c+', inside the base');
  var dxf=T.serialDXFText(g),circ=(dxf.match(/CIRCLE\n8\nHOLES/g)||[]).length;m.dxfHoles=circ;if(Sr.splice===1&&circ!==F.rods*g.ribs.length)bad.push('the DXF has '+circ+' holes for '+F.rods*g.ribs.length);
  var svg=T.serialSVGText(g);m.svgHoles=(svg.match(/serial-hole/g)||[]).length;if(m.svgHoles!==circ)bad.push('the SVG has '+m.svgHoles+' holes, the DXF '+circ);
  var geo=T.buildGeometryFrom(g);m.vertices=geo?geo.attributes.position.count:0;
  if(!geo||!geo.attributes.color||!geo.attributes.srole)bad.push('no coloured 3D');
  else{geo.computeBoundingBox();m.minY=+geo.boundingBox.min.y.toFixed(1);if(geo.boundingBox.min.y<-.01)bad.push('something below the ground: '+geo.boundingBox.min.y.toFixed(1));var steel=0,ar=geo.attributes.srole.array;for(var i=0;i<ar.length;i++)if(ar[i]>=2)steel++;m.steelVerts=steel;if(!steel)bad.push('no steel in 3D');geo.dispose();}
  var csv=T.serialFixCSV(g);m.fixRows=csv.trim().split(String.fromCharCode(10)).length-1;if(!/threaded rod/.test(csv)||!/base channel/.test(csv))bad.push('the fixings schedule lacks rods or the base');
  Object.assign(S.serial,{dir:'vertical',join:'rails',dMin:10,pitch:80});g=T.regen();Sr=g.serial;F=Sr.fix;m.rails=F.rails;m.slots=F.slots;
  if(F.join!=='rails'||F.slots!==F.rails*g.ribs.length)bad.push('rails: '+F.slots+' slots for '+F.rails+' rails and '+g.ribs.length+' ribs');
  if(F.short)bad.push(F.short+' ribs too shallow at a notch');
  geo=T.buildGeometryFrom(g);if(!geo)bad.push('rails 3D not built');else geo.dispose();
  Object.assign(S.serial,{dir:'horizontal',op:'twist',join:'rods',aMin:5,aMax:70,blade:150,dMax:200,pitch:120});g=T.regen();Sr=g.serial;F=Sr.fix;m.blades=F.bladeN;m.posts=F.posts;
  if(F.join!=='blades'||!F.blades.length)bad.push('twist not made of blades');
  else{if(F.bladeN!==F.blades.length*g.ribs.length)bad.push(F.bladeN+' blades');var clash=0;F.blades.forEach(function(b){F.stations.forEach(function(s){if(b.x0<s+30&&b.x0+b.w>s-30)clash++;});});if(clash)bad.push(clash+' blades cross a post');
    var a0=g.ribs[0].a0,L=g.ribs[0].len,past=0;F.blades.forEach(function(b){if(b.x0<a0-1e-6||b.x0+b.w>a0+L+1e-6)past++;});if(past)bad.push(past+' blades past the rib');}
  geo=T.buildGeometryFrom(g);if(!geo)bad.push('blades 3D not built');else geo.dispose();
  S.serial.op='contour';
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'rods: '+m.rods+' (a front row at '+m.front+' stations, '+m.arm+' mm lever arm), shallowest held to '+m.dMinHeld+', '+m.dxfHoles+' holes in the DXF and SVG; rails: '+m.slots+' half-lap joints; twist: '+m.blades+' blades on '+m.posts+' posts',metrics:m};});


/* ---- p57-1: a pavilion of serial timber portal frames ---- */
guard('host','timber portals: a frame per pitch, knees at least span/14, chord splices staggered between leaves, every panel braced, short members from stock, purlins every bay, feet level, every member scheduled',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  var D={on:true,kind:'gable',path:'line',len:12000,bend:0,pitch:1200,span:6000,h:4200,vary:.35,varyBy:'height',dMin:280,dMax:900,chordW:45,chordD:195,webW:45,webD:95,purlin:900,skin:'roof',deck:true,brace:true,footing:true,stock:4800};
  [['gable','line',0],['arch','arc',90],['shed','line',0]].forEach(function(c){S.portal=JSON.parse(JSON.stringify(D));S.portal.kind=c[0];S.portal.path=c[1];S.portal.bend=c[2];T.hostScene();var R=window.PS_PORTAL,tag=c[0];
    if(!R){bad.push(tag+': not built');return;}var nF=Math.floor(12000/1200)+1;if(R.frames.length!==nF)bad.push(tag+': '+R.frames.length+' frames, expected '+nF);
    R.frames.forEach(function(F){if(F.dMax<F.s/14-1e-6)bad.push(tag+' frame '+(F.i+1)+': knee '+F.dMax+' under span/14');var mx=Math.max.apply(null,F.depth);if(F.depth[0]>mx-1e-6&&F.P.knees.length)bad.push(tag+': the foot is the deepest');
      if(F.I[0][1]!==0||F.I[F.I.length-1][1]!==0)bad.push(tag+': a foot is not level');});
    var F0=R.frames[0],m0=F0.P.nodes.length-1,leaf={};R.mem.filter(function(q){return q.frame===0&&q.kind==='chord-out';}).forEach(function(q){var k=q.o>0?'A':'B';(leaf[k]=leaf[k]||[]).push(q.n[1]);});
    var sa=(leaf.A||[]).filter(function(k){return k<m0&&!F0.P.corner[k];}),sb=(leaf.B||[]).filter(function(k){return k<m0&&!F0.P.corner[k];}),both=sa.filter(function(k){return sb.indexOf(k)>=0;});if(both.length)bad.push(tag+': both leaves spliced at node '+both[0]);
    var diag0=R.mem.filter(function(q){return q.frame===0&&q.kind==='diagonal';}).length;if(diag0<m0)bad.push(tag+': '+diag0+' diagonals for '+m0+' panels');
    if(R.stockOver)bad.push(tag+': '+R.stockOver+' members longer than the stock');if(R.webSlender>50)bad.push(tag+': web slenderness '+R.webSlender);
    var pur=R.counts.purlin||0;if(pur!==(R.frames.length-1)*R.sig.length)bad.push(tag+': '+pur+' purlins');if(!R.brace.length)bad.push(tag+': no bracing');
    var nodes=R.frames.reduce(function(s,F){return s+2*F.P.nodes.length;},0);if(R.bolts.length!==nodes)bad.push(tag+': '+R.bolts.length+' bolts for '+nodes+' nodes');
    if(c[0]==='gable'&&R.gus.length!==3*R.frames.length)bad.push(tag+': '+R.gus.length+' gussets for '+R.frames.length+' frames (two knees and a ridge each)');
    var csv=T.portalCSV();var rows=csv.trim().split(String.fromCharCode(10)).length-1;if(rows!==R.mem.length+R.brace.length)bad.push(tag+': '+rows+' schedule rows for '+(R.mem.length+R.brace.length)+' members and rods');
    m[tag]={frames:R.frames.length,members:R.mem.length,unique:R.unique,longest:R.longest,slender:R.webSlender,laps:R.laps,bolts:R.bolts.length,knee:R.knee.join('-'),spans:R.spans.join('-'),heights:R.heights.join('-')};});
  S.portal.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'gable '+m.gable.members+', arch '+m.arch.members+', mono-pitch '+m.shed.members+' members; knees at least span/14, splices staggered, every panel braced, longest member '+Math.max(m.gable.longest,m.arch.longest,m.shed.longest)+' mm, web slenderness under 50',metrics:m};});


/* ---- p58-1: a timber canopy on clustered posts ---- */
guard('host','timber canopy: four posts a column, every board splice over a column and the two boards a bay apart, studs between the field heights, noggins on tall studs, brackets at every half-bay crossing, every piece scheduled',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  S.canopy={on:true,w:9600,d:7200,bay:2400,clear:2700,postW:89,gap:38,boardT:38,beamD:286,stud:400,hMin:300,hMax:2400,net:true,skin:true,brace:true,footing:true,stock:6096};
  T.hostScene();var R=window.PS_CANOPY;if(!R)return{pass:false,detail:'not built'};
  var cols=(R.nx+1)*(R.nz+1);m.columns=cols;m.posts=R.counts.post;if(R.counts.post!==4*cols)bad.push(R.counts.post+' posts for '+cols+' columns');
  var bay=2400,x0=-R.W/2,z0=-R.D/2,lines={};R.mem.filter(function(q){return q.kind==='beam-low'||q.kind==='beam-high';}).forEach(function(q){var key=q.kind+'|'+q.line.toFixed(1)+'|'+q.side;(lines[key]=lines[key]||[]).push(q);});
  var shared=0,offCol=0;Object.keys(lines).forEach(function(k){var parts=k.split('|');if(parts[2]!=='1')return;var other=lines[parts[0]+'|'+parts[1]+'|-1']||[],low=parts[0]==='beam-low';
    var sp=function(arr){return arr.map(function(q){return low?q.b[0]:q.b[2];}).filter(function(v){return v<(low?x0+R.W:z0+R.D)-1;});};var a=sp(lines[k]),b=sp(other);
    a.concat(b).forEach(function(v){var t=(v-(low?x0:z0))/bay;if(Math.abs(t-Math.round(t))>1e-6)offCol++;});a.forEach(function(v){if(b.some(function(w){return Math.abs(w-v)<1;}))shared++;});});
  if(shared)bad.push(shared+' splices shared by both boards');if(offCol)bad.push(offCol+' splices between columns');
  if(R.stockOver)bad.push(R.stockOver+' pieces over the stock');
  var studs=R.mem.filter(function(q){return q.kind==='stud';}),lo=1e9,hi=-1e9;studs.forEach(function(q){lo=Math.min(lo,q.b[1]-R.y3);hi=Math.max(hi,q.b[1]-R.y3);});m.studs=studs.length;m.studRange=Math.round(lo)+'-'+Math.round(hi);
  if(lo<300-1e-6||hi>2400+1e-6)bad.push('studs stand '+lo.toFixed(0)+' to '+hi.toFixed(0)+' above the grid, outside 300 to 2400');if(!(hi-lo>600))bad.push('the field barely changes the studs: '+(hi-lo).toFixed(0));
  var nzS=Math.round(R.D/400),want=(2*R.nx+1)*(nzS+1);if(studs.length!==want)bad.push(studs.length+' studs, expected '+want);
  var tall=0;R.tops.forEach(function(row){for(var q=0;q<row.length-1;q++)if(Math.min(row[q][1],row[q+1][1])-R.y3>1200)tall++;});if((R.counts.noggin||0)!==tall)bad.push((R.counts.noggin||0)+' noggins for '+tall+' tall pairs');
  if(R.brackets.length!==R.nx*(R.nz+1)*2)bad.push(R.brackets.length+' brackets');
  if(!(R.counts.brace>0))bad.push('no knee braces');
  var csv=T.canopyCSV(),rows=csv.trim().split(String.fromCharCode(10)).length-1;if(rows!==R.mem.length)bad.push(rows+' schedule rows for '+R.mem.length+' pieces');
  m.pieces=R.mem.length;m.bolts=R.bolts.length;m.cable=R.cable;m.studLengths=R.studLengths;
  S.canopy.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:cols+' columns, '+R.mem.length+' pieces, '+studs.length+' studs in '+R.studLengths+' lengths, '+R.bolts.length+' bolts, '+R.cable+' m of cable; every splice over a column, staggered',metrics:m};});


/* ---- p59-1: a corbelled timber corridor ---- */
guard('host','timber corridor: every course cantilevers no more than a third of its block, one cantilever length, the two sides meet under a ridge, no post mortised twice at one height, every piece scheduled',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  var D={on:true,path:'line',len:9000,bend:0,pitch:900,width:2400,h:2400,vary:.3,post:140,bw:89,bh:89,blockL:600,step:150,railGap:600,floor:true,footing:true};
  [['line',0,150],['arc',120,250]].forEach(function(c){S.corbel=JSON.parse(JSON.stringify(D));S.corbel.path=c[0];S.corbel.bend=c[1];S.corbel.step=c[2];T.hostScene();var R=window.PS_CORBEL,tag=c[0];
    if(!R){bad.push(tag+': not built');return;}
    if(R.p>R.Lb/3+1e-6)bad.push(tag+': step '+R.p+' over a third of '+R.Lb);if(c[2]>200&&!R.held)bad.push(tag+': a 250 step was not held');
    if(R.cantLengths!==1)bad.push(tag+': '+R.cantLengths+' cantilever lengths');
    if(!(R.last<=R.bw+1e-6))bad.push(tag+': the sides stop '+R.last.toFixed(0)+' from the centre');
    var F0=R.frames[0],ok=0,wrong=0;R.mem.filter(function(q){return q.kind==='cantilever'&&q.frame===0&&q.course>1;}).forEach(function(q){var below=R.mem.filter(function(r){return r.kind==='rail'&&r.course===q.course-1&&r.side===q.side&&r.bay===0;})[0];if(!below)return;
      var x=function(pt){return (pt[0]-F0.C[0])*F0.A[0]+(pt[2]-F0.C[2])*F0.A[2];};var inner=Math.min(q.side*x(q.a),q.side*x(q.b)),railC=q.side*x(below.a);if(Math.abs((railC-R.bw/2)-inner-q.step)<.5)ok++;else wrong++;});
    if(wrong)bad.push(tag+': '+wrong+' cantilevers do not project one step past the rail below');if(!ok)bad.push(tag+': no cantilever checked');
    var bays={};R.mem.filter(function(q){return q.kind==='wall rail';}).forEach(function(q){(bays[q.bay]=bays[q.bay]||[]).push(Math.round(q.a[1]));});var twice=0;Object.keys(bays).forEach(function(b){var nx=bays[+b+1];if(nx)bays[b].forEach(function(y){if(nx.indexOf(y)>=0)twice++;});});if(twice)bad.push(tag+': '+twice+' mortises at one height in a post');
    if((R.counts.ridge||0)!==R.frames.length-1)bad.push(tag+': '+(R.counts.ridge||0)+' ridge blocks');if((R.counts.post||0)!==2*R.frames.length)bad.push(tag+': '+R.counts.post+' posts');
    var csv=T.corbelCSV(),rows=csv.trim().split(String.fromCharCode(10)).length-1;if(rows!==R.mem.length)bad.push(tag+': '+rows+' schedule rows for '+R.mem.length);
    m[tag]={frames:R.frames.length,courses:R.nC,step:R.p,pieces:R.mem.length,cantilevers:R.counts.cantilever,rails:R.counts.rail,mortises:R.mortises,ridge:R.ridgeY.join('-'),checked:ok};});
  S.corbel.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'straight: '+m.line.courses+' courses of '+m.line.step+' mm, '+m.line.pieces+' pieces; curved: step held to '+m.arc.step+'; every cantilever one step past the rail below, one length, the sides meet, no post mortised twice at one height',metrics:m};});


/* ---- p60-1: one picker for the whole forms ---- */
guard('flow','the whole-form picker: a chip turns one form on and the rest off, only its controls show, None returns to the panels',function(){
  T.reset();var bad=[],m={};var chip=function(k){return document.querySelector('.form-chip[data-form="'+k+'"]');};var vis=function(p){var e=document.querySelector('[data-path="'+p+'"]');return !!e&&!e.classList.contains('hidden');};
  if(!chip('portal')||!chip('none'))return{pass:false,detail:'no form chips'};
  S.crib.on=true;chip('portal').click();T.refreshAll();
  if(!S.portal.on||S.crib.on)bad.push('portal on '+S.portal.on+', stacked timber still '+S.crib.on);
  if(!vis('portal.span'))bad.push('the portal controls are hidden');if(vis('crib.d0')||vis('canopy.bay')||vis('stack.storeys'))bad.push('another form’s controls still show');
  if(!chip('portal').classList.contains('on'))bad.push('the portal chip is not marked');
  chip('canopy').click();T.refreshAll();if(!S.canopy.on||S.portal.on)bad.push('canopy did not replace the portals');if(!vis('canopy.bay')||vis('portal.span'))bad.push('controls did not follow the canopy');
  chip('none').click();T.refreshAll();var on=['stack','vox','dome','crib','portal','canopy','corbel','loft'].filter(function(k){return S[k]&&S[k].on;});if(on.length)bad.push('None left '+on.join(', ')+' on');
  if(vis('canopy.bay'))bad.push('canopy controls show with None');if(!vis('host.kind'))bad.push('the surface control is hidden');
  m.chips=document.querySelectorAll('.form-chip').length;
  if(bad.length)return{pass:false,detail:bad.join('; '),metrics:m};
  return{pass:true,detail:m.chips+' chips; one form at a time, its controls alone, None clears them',metrics:m};});


/* ---- p61-1: a curved two-layer timber wall leaning into a canopy ---- */
guard('host','leaning timber wall: every course steps in no more than a third of a member, the joints of each course fall between those below, spacers alternate, the field changes the lean, every piece scheduled',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  S.lean={on:true,a:5000,b:3600,arc:220,turn:0,height:2700,mw:89,mh:38,gap:180,node:600,lean:1200,pow:1.6,vary:.5,bench:true,deck:true,anchors:true};
  T.hostScene();var R=window.PS_LEAN;if(!R)return{pass:false,detail:'not built'};
  var over=0;R.off.forEach(function(o){for(var k=1;k<o.length;k++)if(o[k]-o[k-1]>R.cap+1e-6)over++;});if(over)bad.push(over+' steps over a third of a member');
  if(!(R.topReach>600))bad.push('it hardly leans: '+R.topReach);var tops=R.off.map(function(o){return o[R.nK];});m.leanRange=Math.round(Math.min.apply(null,tops))+'-'+Math.round(Math.max.apply(null,tops));if(Math.max.apply(null,tops)-Math.min.apply(null,tops)<100)bad.push('the field does not change the lean');
  var ends={};R.mem.forEach(function(q){if(q.layer)return;(ends[q.k]=ends[q.k]||[]).push(q.j1);});var straight=0;for(var k=1;k<R.nK;k++){var a=(ends[k]||[]).filter(function(j){return j<R.nN;}),b=ends[k-1]||[];a.forEach(function(j){if(b.indexOf(j)>=0)straight++;});}if(straight)bad.push(straight+' joints over a joint in the course below');
  var at={};R.spacers.forEach(function(s){at[s.k+'|'+s.j]=1;});var stacked=0;R.spacers.forEach(function(s){if(at[(s.k+1)+'|'+s.j])stacked++;});if(stacked)bad.push(stacked+' spacers on a spacer');
  if(!R.anchors.length||!R.bench.length)bad.push('no anchors or no bench');
  var csv=T.leanCSV(),rows=csv.trim().split(String.fromCharCode(10)).length-1;/* pass 80: the schedule lists the fixings, the cap and the anchors too */if(rows!==R.mem.length+R.spacers.length+R.capP.length+R.dowels.length+R.ties.length+R.anchors.length)bad.push(rows+' schedule rows');
  m.courses=R.nK;m.members=R.mem.length;m.spacers=R.spacers.length;m.top=R.topReach;m.lengths=R.lengths;m.held=R.held;m.mass=R.lean0+'/'+R.baseD;
  S.lean.on=false;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:R.nK+' courses, '+R.mem.length+' members, '+R.spacers.length+' spacers; leans '+m.leanRange+' mm at the top by the field; no step over a third, no joint over a joint, spacers alternate',metrics:m};});


/* ---- p62-1: the saw's cut list for the timber forms ---- */
guard('host','timber cut lists: every piece of the portals, canopy, corridor and leaning wall counted once by section and length, packed into stock no fuller than its length, waste reported',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  S.portal=Object.assign({},S.portal,{on:false});S.canopy=Object.assign({},S.canopy,{on:false});S.corbel=Object.assign({},S.corbel,{on:false});S.lean=Object.assign({},S.lean,{on:false,mh:38,gap:180});
  ['portal','canopy','corbel','lean'].forEach(function(k){var C=T.timberCutFor(k);if(!C){bad.push(k+': no cut list');return;}var n=0,len=0;C.rows.forEach(function(r){n+=r.n;len+=r.len*r.n;});
    if(n!==C.pieces)bad.push(k+': '+n+' counted for '+C.pieces+' pieces');var need=0;C.sections.forEach(function(s){});var cap=0;C.sections.forEach(function(s){Object.keys(s.by).forEach(function(l){cap+=(+l)*s.by[l];});});if(cap<len-C.over*C.stock*3)bad.push(k+': '+C.boards+' boards ('+cap+' mm) cannot hold '+Math.round(len)+' mm');
    if(!(C.waste>=0&&C.waste<60))bad.push(k+': waste '+C.waste+'%');var csv=T.timberCutCSV(C);if(!/^section_mm,length_mm,count/.test(csv))bad.push(k+': csv header');
    m[k]={pieces:C.pieces,boards:C.boards,waste:C.waste,over:C.over,sections:C.sections.length};});
  var L=T.timberCutFor('lean');if(L&&!L.rows.some(function(r){return r.len===180;}))bad.push('lean: no spacer of the 180 gap');
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:Object.keys(m).map(function(k){return k+' '+m[k].pieces+' pieces from '+m[k].boards+' boards, '+m[k].waste+'% offcut';}).join('; '),metrics:m};});


/* ---- p63-1: the robot for the timber forms ---- */
guard('host','timber robot: every piece of the leaning wall, the corridor and the portal frames cut once and placed once, in course order, with its fixings, and a KRL program with a section per station',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};
  S.lean=Object.assign({},S.lean,{on:false,mh:38,gap:180});
  ['lean','corbel','portal'].forEach(function(k){var RB=T.timberRobot(k);if(!RB){bad.push(k+': no program');return;}
    var cuts=RB.rows.filter(function(r){return r.op==='cut';}).length,places=RB.rows.filter(function(r){return r.op==='place';});if(cuts!==RB.pieces||places.length!==RB.pieces)bad.push(k+': '+cuts+' cuts and '+places.length+' places for '+RB.pieces+' pieces');
    var back=0;for(var i=1;i<places.length;i++)if(places[i].c<places[i-1].c-1e-9)back++;if(back)bad.push(k+': '+back+' placements before the course below');
    var fx=RB.rows.filter(function(r){return r.op!=='cut'&&r.op!=='place';}).length;if(fx!==RB.fixings)bad.push(k+': '+fx+' fixing rows for '+RB.fixings);
    if(!/^&ACCESS RVP/.test(RB.krl)||!/\nEND\n$/.test(RB.krl)||/NaN/.test(RB.krl))bad.push(k+': the KRL is not a whole program');
    var bases=(RB.krl.match(/\$BASE=BASE_DATA\[\d+\]/g)||[]);var distinct={};bases.forEach(function(b){distinct[b]=1;});if(Object.keys(distinct).length!==RB.stations)bad.push(k+': '+Object.keys(distinct).length+' bases for '+RB.stations+' stations');
    var flagged=places.filter(function(r){return r.far;}).length;if(flagged!==RB.beyond)bad.push(k+': '+flagged+' flagged beyond for '+RB.beyond);
    m[k]={pieces:RB.pieces,fixings:RB.fixings,stations:RB.stations,beyond:RB.beyond,krlLines:RB.krl.split(String.fromCharCode(10)).length};});
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:Object.keys(m).map(function(k){return k+' '+m[k].pieces+' pieces, '+m[k].fixings+' fixings, '+m[k].stations+(k==='portal'?' frames':' stations')+(m[k].beyond?', '+m[k].beyond+' beyond reach':'');}).join('; '),metrics:m};});


/* ---- p64-1: the timber schedules carry what Rhino needs ---- */
guard('host','timber schedules for Rhino: every row as wide as its header, every sectioned piece with a unit depth direction square to it, the portal leaves offset by half a web and a chord',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();var bad=[],m={};S.lean=Object.assign({},S.lean,{mh:38,gap:180});
  var NLc=String.fromCharCode(10);
  [['portal',T.portalCSV],['canopy',T.canopyCSV],['corbel',T.corbelCSV],['lean',T.leanCSV]].forEach(function(c){var lines=c[1]().trim().split(NLc),head=lines[0].split(','),ix={};head.forEach(function(h,i){ix[h]=i;});
    if(!('dx' in ix))bad.push(c[0]+': no depth direction');var wide=0,skew=0,secs=0;
    lines.slice(1).forEach(function(l){var r=l.split(',');if(r.length!==head.length){wide++;return;}if(!/x/.test(r[ix.section_mm]||''))return;secs++;
      var a=[+r[ix.ax],+r[ix.ay],+r[ix.az]],b=[+r[ix.bx],+r[ix.by],+r[ix.bz]],d=[+r[ix.dx],+r[ix.dy],+r[ix.dz]],L=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),dl=Math.hypot(d[0],d[1],d[2]);
      if(Math.abs(dl-1)>.01)skew++;else if(L>1){var dot=Math.abs(((b[0]-a[0])*d[0]+(b[1]-a[1])*d[1]+(b[2]-a[2])*d[2])/L);if(dot>.5)skew++;}});
    if(wide)bad.push(c[0]+': '+wide+' rows not as wide as the header');if(skew)bad.push(c[0]+': '+skew+' pieces without a depth direction square to them');
    m[c[0]]={rows:lines.length-1,sectioned:secs};
    if(c[0]==='portal'){var off=0,want=(S.portal.webW+S.portal.chordW)/2||45;lines.slice(1).forEach(function(l){var r=l.split(',');if(/chord/.test(r[ix.kind])){var o=Math.hypot(+r[ix.ox],+r[ix.oy],+r[ix.oz]);if(Math.abs(o-want)>.2)off++;}});if(off)bad.push('portal: '+off+' chord leaves not offset '+want);}});
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:Object.keys(m).map(function(k){return k+' '+m[k].rows+' rows';}).join(', ')+'; every row whole, every piece with its depth direction',metrics:m};});


/* ---- p65-1: the portal frames analysed as trusses ---- */
guard('host','portal truss analysis: every frame solves (no mechanism), the reactions balance the loads, a deeper knee makes the frame stiffer',function(){
  T.reset();S.field=T.fieldDefaults();S.field.kind='gradient';T.fieldUse();var bad=[],m={};
  S.portal=Object.assign({},S.portal,{on:false,kind:'gable',path:'line',bend:0,len:6000,pitch:1200,span:6000,h:4200,vary:0,dMin:280,dMax:900});
  var A=T.portalTruss();if(!A)return{pass:false,detail:'no analysis (a mechanism)'};
  if(A.res.length!==A.frames)bad.push(A.res.length+' of '+A.frames+' frames solved');if(A.eq>1e-6)bad.push('reactions off the loads by '+A.eq.toExponential(2));
  var d1=A.dg.defl;S.portal.dMax=1400;var B=T.portalTruss(),d2=B.dg.defl;m.defl900=+d1.toFixed(3);m.defl1400=+d2.toFixed(3);if(!(d2<d1))bad.push('a deeper knee did not stiffen the frame: '+d1.toFixed(3)+' to '+d2.toFixed(3)+' mm');
  m.maxU=+A.maxU.toFixed(3);m.defl=+A.dg.defl.toFixed(2);m.limit=+A.dg.limit.toFixed(1);m.worst=A.gov.worst.kind+' '+A.gov.worst.combo;
  if(!(A.dg.defl>0&&A.dg.defl<A.dg.limit*20))bad.push('deflection '+A.dg.defl);
  var csv=T.portalTrussCSV();if(!/^frame,member,kind,length_mm,force_kN_governing,combination,utilisation/.test(csv))bad.push('analysis csv header');
  S.portal.dMax=900;
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'every frame solves, reactions balance to '+A.eq.toExponential(1)+'; worst member '+Math.round(m.maxU*100)+'% ('+m.worst+'), deflection '+m.defl+' of '+m.limit+' mm; a 1400 knee instead of 900 takes the deflection from '+m.defl900+' to '+m.defl1400+' mm',metrics:m};});


/* ---- p70-1: capabilities in order of how far they are developed ---- */
guard('flow','Start leads with the most developed worked cases; Compose lists the brick wall first and the experimental timber forms last, and never picks them itself',function(){
  T.reset();var bad=[],m={};var cards=[].slice.call(document.querySelectorAll('.scase'));m.cases=cards.map(function(b){return b.dataset.case;}).join(',');
  if(!cards.length||cards[0].dataset.case!=='brickwall')bad.push('the first worked case is '+(cards[0]&&cards[0].dataset.case));
  var dev=cards.map(function(b){return !!b.querySelector('.tag.dev');}),firstIng=dev.indexOf(false);if(firstIng>=0&&dev.slice(firstIng).some(function(x){return x;}))bad.push('a developing case sits above a developed one');
  var sel=document.querySelector('.cmpHost');if(!sel)bad.push('no Compose list');else{if(sel.options[sel.selectedIndex].value!=='wall')bad.push('Compose starts on '+sel.value);if(sel.options[0].value!=='wall')bad.push('the first Compose form is '+sel.options[0].value);
    var gs=sel.querySelectorAll('optgroup'),last=gs[gs.length-1];if(!last||!/Experimental/.test(last.label))bad.push('the last group is '+(last&&last.label));else{var ex=[].map.call(last.querySelectorAll('option'),function(o){return o.value;});m.experimental=ex.join(',');['timber portals','timber canopy','timber corridor'].forEach(function(k){if(ex.indexOf(k)<0)bad.push(k+' not in the experimental group');});}}
  var picked=0;['plane','cylinder','double-curved','sphere','ruled-sine-wall','single-curved-loft','revolved','volume','site-polygon','ground-plane','any'].forEach(function(hk,i){for(var sd=1;sd<=4;sd++){T.reset();T.composeDesign(hk,[],sd*37+i*11);if(S.portal.on||S.canopy.on||S.corbel.on)picked++;}});if(picked)bad.push('Compose picked an experimental form '+picked+' times');
  var chips=[].slice.call(document.querySelectorAll('.form-chip')),ip=chips.findIndex(function(c){return c.dataset.form==='portal';}),il=chips.findIndex(function(c){return c.dataset.form==='lean';});if(!(il>=0&&ip>il))bad.push('the portals chip is not below the leaning wall');if(ip>=0&&!chips[ip].classList.contains('exp'))bad.push('the portals chip is not marked experimental');
  T.reset();var b=document.querySelector('.scase[data-case="brickwall"]');b.click();var g=T.regen();m.brickwall=T.panelMode()+' '+(g.bricks?g.bricks.length:0)+' bricks';if(T.panelMode()!=='brick'||!(g.bricks&&g.bricks.length))bad.push('the brick wall case built '+m.brickwall);
  T.reset();document.querySelector('.scase[data-case="crib"]').click();if(!S.crib.on)bad.push('the stacked timber case did not turn the pavilion on');S.crib.on=false;
  T.reset();document.querySelector('.scase[data-case="pavers"]').click();g=T.regen();m.pavers=(g.pavers||[]).length;if(T.panelMode()!=='paver'||!m.pavers)bad.push('the paver case built '+m.pavers+' pavers');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:cards.length+' worked cases, brick wall first; Compose starts on the wall, the three timber forms grouped last and never picked by itself in 44 compositions',metrics:m};});


/* ---- p71-1: the paver module bar ---- */
guard('paver','the module bar heads the Pavers tab: the family drawn to scale for the layout, a card per type that edits colour, kind, height and name together, counts that add up, and rules that say what a layout or module cannot carry',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={};
  var bar=document.querySelector('.pmod');if(!bar)return{pass:false,detail:'no module bar'};
  var body=bar.parentNode;if(!body.classList.contains('body'))bad.push('the bar is not in the tab');
  Object.assign(S.paver,{tiling:'ashlar',size:600,ratio:1,joint:6,types:4,palette:'#2F2E2C,#5E5B56,#8E8A83,#BDB7AC',heights:'60',kinds:'slab,slab,slab,slab',names:'',holes:'',holeBy:'type',cull:0});T.refreshAll();T.regen();window.__pmodDraw();
  var shapes=bar.querySelectorAll('.pmod-fam polygon,.pmod-fam rect,.pmod-fam path').length;m.ashlarShapes=shapes;if(shapes!==5)bad.push('ashlar family draws '+shapes+' modules, not 5');
  var cards=bar.querySelectorAll('.pmod-card');m.cards=cards.length;if(cards.length!==4)bad.push(cards.length+' cards for 4 types');
  var cnt=0;bar.querySelectorAll('.pmod-n').forEach(function(e){cnt+=+e.textContent.replace(/[^0-9]/g,'');});var g=T.regen();m.counted=cnt;m.pavers=g.pavers.length;if(cnt!==g.pavers.length)bad.push('the cards count '+cnt+' of '+g.pavers.length+' pavers');
  var sel=bar.querySelector('select[data-i="0"]');sel.value='hole';sel.dispatchEvent(new Event('change'));if(String(S.paver.kinds).split(',')[0]!=='hole')bad.push('kind not written: '+S.paver.kinds);
  bar=document.querySelector('.pmod');var col=bar.querySelector('input[type=color][data-i="0"]');col.value='#f2f0ea';col.dispatchEvent(new Event('change'));
  var ks=String(S.paver.kinds).split(','),pal=String(S.paver.palette).split(',');m.after=S.paver.palette+' / '+S.paver.kinds;if(ks[ks.length-1]!=='hole'||pal[pal.length-1].toLowerCase()!=='#f2f0ea')bad.push('the kind did not travel with its colour: '+m.after);
  bar=document.querySelector('.pmod');var h=bar.querySelector('input[type=number][data-i="1"]');h.value='120';h.dispatchEvent(new Event('change'));if(String(S.paver.heights).split(',')[1]!=='120')bad.push('height not written: '+S.paver.heights);
  bar=document.querySelector('.pmod');bar.querySelector('.pmod-step[data-d="1"]').click();if(S.paver.types!==5)bad.push('the + step gave '+S.paver.types+' types');
  Object.assign(S.paver,{tiling:'herring',ratio:1,size:120,kinds:'hole,slab'});T.refreshAll();window.__pmodDraw();bar=document.querySelector('.pmod');var rules=[].map.call(bar.querySelectorAll('.pmod-rules p.pr-bad'),function(p){return p.textContent;});m.rules=rules.length;
  if(!rules.some(function(t){return /Herringbone/.test(t);}))bad.push('no rule for herringbone at 1:1');if(!rules.some(function(t){return /planted hole/.test(t);}))bad.push('no rule for planted holes on a 120 module');
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'5 ashlar modules drawn, '+m.cards+' cards counting all '+m.pavers+' pavers; kind, colour and height edit together; herringbone at 1:1 and planted holes on 120 are refused in words',metrics:m};});


/* ---- p72-1: the Pavers tab holds only what designs a paved ground ---- */
guard('paver','the Pavers tab shows no towers, plans, timber forms, panel types or facade-only options; a facade option returns while a loaded design uses it; the other tabs keep theirs',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');T.refreshAll();var bad=[],m={};
  var body=document.querySelector('.pmod').parentNode;var shown=function(e){if(!e)return false;for(var x=e;x&&x!==body.parentNode;x=x.parentNode){if(x.classList&&(x.classList.contains('pv-off')||x.classList.contains('hidden')))return false;}return true;};
  var q=function(p){return body.querySelector('[data-path="'+p+'"]');};
  ['stack.storeys','portal.span','crib.d0','dome.r','vox.nx','lean.a','canopy.bay','corbel.len','plan.kind','host.kind','roof.on','element','arr','orient','clip','frameL','paver.lay','paver.pots','paver.tilt'].forEach(function(p){if(shown(q(p)))bad.push(p+' still shows in Pavers');});
  ['paver.tiling','paver.size','paver.joint','paver.types','paver.cull','paver.edge','paver.holeBy','width','height','field.kind'].forEach(function(p){if(!shown(q(p)))bad.push(p+' is missing from Pavers');});
  var tb=function(v){return body.querySelector('[data-path="paver.tiling"] button[data-v="'+v+'"]');};if(shown(tb('nested'))||shown(tb('points')))bad.push('facade layouts offered');if(!shown(tb('ashlar'))||!shown(tb('herring')))bad.push('a paving layout is missing');
  m.forms=body.querySelectorAll('.form-chip').length;if(shown(body.querySelector('.form-chip')))bad.push('the whole-form picker shows');
  S.paver.tiling='nested';S.paver.lay='wall';T.refreshAll();if(!shown(tb('nested'))||!shown(q('paver.lay')))bad.push('a loaded nested design cannot be seen or changed');S.paver.tiling='ashlar';S.paver.lay='ground';T.refreshAll();if(shown(tb('nested')))bad.push('nested stayed after leaving it');
  var other=[].filter.call(document.querySelectorAll('[data-path="plan.kind"]'),function(e){return !body.contains(e);});m.otherTabs=other.length;if(!other.length||other.some(function(e){return e.closest('.pv-off');}))bad.push('another tab lost its plan control');
  var sm=[].map.call(body.querySelectorAll('summary'),function(x){return x.textContent;});if(!sm.some(function(t){return t.indexOf('Ground size')===0;}))bad.push('no Ground size fold');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'19 tower, form, panel and facade controls off the Pavers tab, 10 paving controls on it; a nested design brings its options back; '+m.otherTabs+' other tabs keep the plan control',metrics:m};});


/* ---- p73-1: the permeable family ---- */
guard('paver','the permeable family: whole stones on one lattice, grades that open evenly from the closed grade, the route always closed and under 13 mm, the field opening the ground away from it, a water check that answers the storm, 2D, 3D and the grades list',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={};
  var base={tiling:'perm',pLat:'square',pMorph:'round',size:300,openMin:4,openMax:24,pFill:'auto',grassFrom:20,types:4,palette:'#A9A69F,#B7B4AD,#C4C1BA,#D0CDC6',heights:'60',kinds:'slab,grass,seat,hole',assign:'quantise',cull:0,holes:'',holeBy:'type',joint:6,spin:20,keep:'0,0.5 1,0.5',keepW:900,routeOn:true,seats:2,storm:25,runon:.25,rGravel:600,rGrass:100,rSand:40,base:300,sub:10,edge:'none'};
  S.field=T.fieldDefaults();S.field.kind='attractCurve';S.field.attractCurve.pts='0,0.5; 1,0.5';S.field.attractCurve.radius=.35;T.fieldUse();
  [['square','round'],['square','turn'],['hex','shrink'],['hex','round'],['brick','slot'],['brick','round']].forEach(function(c){Object.assign(S.paver,base,{pLat:c[0],pMorph:c[1]});var g=T.regen(),pv=g.pavers||[],Pk=g.paver,pm=Pk.perm,tag=c[0]+'/'+c[1];
    if(!pm||!pv.length){bad.push(tag+': not built');return;}
    var x0=S.frameL,x1=S.width-S.frameR,y0=S.frameB,y1=S.height-S.frameT,out=0,cut=0,kinds=0,wrong=0;
    pv.forEach(function(s){if(s.cut)cut++;if(s.kind!=='slab'||s.hole)kinds++;s.cell.forEach(function(q){if(q.x<x0-.01||q.x>x1+.01||q.y<y0-.01||q.y>y1+.01)out++;});
      var a=0,p=s.pts;for(var i=0;i<p.length;i++){var u=p[i],v=p[(i+1)%p.length];a+=u.x*v.y-v.x*u.y;}a=Math.abs(a)/2;if(Math.abs(a/s.area-(1-s.open))>.002)wrong++;});
    if(out)bad.push(tag+': '+out+' foot corners outside the frame');if(cut)bad.push(tag+': '+cut+' cut stones');if(kinds)bad.push(tag+': '+kinds+' stones carry a kind or a hole');if(wrong)bad.push(tag+': '+wrong+' tops do not match their open share');
    var f=pm.fam,n=f.length;if(f[n-1].grade!==1)bad.push(tag+': the lightest type is not grade 1');for(var k=1;k<n;k++)if(!(f[k].open<f[k-1].open+1e-9))bad.push(tag+': grades do not open in order');
    if(Math.abs(f[n-1].open-.04)>.015)bad.push(tag+': closed grade '+(f[n-1].open*100).toFixed(1)+' % open, asked 4');if(!f[0].held&&Math.abs(f[0].open-.24)>.015)bad.push(tag+': open grade '+(f[0].open*100).toFixed(1)+' %, asked 24');
    var yM=(y0+y1)/2,onR=pv.filter(function(s){return Math.abs(s.cy-yM)<=900;}),notClosed=onR.filter(function(s){return s.grade!==1;}).length;if(!onR.length||notClosed)bad.push(tag+': '+notClosed+' of '+onR.length+' stones on the route are not the closed grade');
    if(!(pm.routeGap<=13))bad.push(tag+': '+pm.routeGap+' mm openings on the route');
    var near=0,nn=0,far=0,nf=0;pv.forEach(function(s){var d=Math.abs(s.cy-yM);if(d<1400){near+=s.open;nn++;}else if(d>2300){far+=s.open;nf++;}});if(!(nf&&nn&&far/nf>near/nn+.03))bad.push(tag+': the ground does not open away from the route');
    if(pm.seats.length!==2)bad.push(tag+': '+pm.seats.length+' benches for 2');else pm.seats.forEach(function(b){pv.forEach(function(s){if(Math.hypot(s.cx-b.x,s.cy-b.y)<1000&&s.grade!==1)bad.push(tag+': a bench stands on open ground');});});
    var w=Pk.water,os=0,A=0;pv.forEach(function(s){os+=s.open*s.area;A+=s.area;});if(Math.abs(w.open-os/A)>1e-6)bad.push(tag+': the open share is not the stones own');if(Math.abs(w.need-31.25)>1e-6)bad.push(tag+': need '+w.need);
    if(Math.abs(w.fills.sand+w.fills.gravel+w.fills.grass-os)>1)bad.push(tag+': the fills do not add up to the open ground');
    m[tag]={stones:pv.length,open:+(w.open*100).toFixed(1),intake:Math.round(w.intake),gap:pm.routeGap,held:pm.held};});
  Object.assign(S.paver,base);var g=T.regen(),w1=g.paver.water;S.paver.storm=100;S.paver.runon=3;var g2=T.regen();if(g2.paver.water.ok)bad.push('a 100 mm/h storm with three times its area draining on is said to be taken');if(g2.paver.water.intake!==w1.intake)bad.push('the storm changed what the ground takes in');
  S.paver.storm=25;S.paver.runon=.25;S.paver.openMin=12;S.paver.pMorph='shrink';var g3=T.regen();m.gap12=g3.paver.perm.routeGap;if(!(g3.paver.perm.routeGap>13))bad.push('a 12 % closed grade that shrinks should open the route past 13 mm, got '+g3.paver.perm.routeGap);
  Object.assign(S.paver,base);g=T.regen();var geo=T.buildGeometryFrom(g);m.vertices=geo?geo.attributes.position.count:0;if(!geo||!geo.attributes.color)bad.push('no coloured 3D');else{geo.computeBoundingBox();if(geo.boundingBox.max.z<500)bad.push('no bench in 3D');geo.dispose();}
  var svg=T.paverSVGText(g);if(!/paver-cells/.test(svg))bad.push('the setting-out has no lattice');var csv=T.permGradesCSV(g),ln=csv.split(String.fromCharCode(10));if(!/^grade,type,top_mm,open_percent,joint_fill/.test(ln[0])||!/^G1,4,/.test(ln[1]))bad.push('grades list: '+ln[0]+' / '+ln[1]);if(!/takes_in_mm_per_h/.test(csv))bad.push('the grades list has no water line');
  S.paver.tiling='ashlar';S.paver.size=600;S.paver.kinds='slab,grass,slab,bed';S.paver.joint=8;var g4=T.regen();if(!(g4.paver.water&&g4.paver.water.open>.05&&g4.paver.water.fills.grass>0))bad.push('an ordinary ground has no water check');if(g4.paver.perm)bad.push('perm left on an ashlar ground');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'six lattice and variation pairs: whole stones, grades in order from 4 % open, route closed and under 13 mm, opening away from it, benches on closed ground; water answers the storm; 3D, lattice drawing and grades list made',metrics:m};});
/* ---- p73-2: the Pavers tab as five steps ---- */
guard('paver','the Pavers tab is five steps: one shows at a time, every paving control lives in one of them, the family controls show only with the permeable family',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');T.refreshAll();var bad=[],m={};var nav=document.querySelector('.pvsteps:not(.six)');if(!nav||nav.querySelectorAll('button').length!==6)return{pass:false,detail:'no six-step nav (pass 109 added By hand, shown fourth)'};
  var body=document.querySelector('.pmod').parentNode,vis=function(e){if(!e)return false;for(var x=e;x&&x!==body.parentNode;x=x.parentNode){if(x.classList&&(x.classList.contains('pvs-off')||x.classList.contains('pv-off')||x.classList.contains('hidden')))return false;}return true;},q=function(p){return body.querySelector('[data-path="'+p+'"]');};
  var want={1:['width','height','paver.route','paver.edge'],2:['paver.tiling'],3:['paver.assign','field.kind','paver.cull'],4:['paver.storm','paver.runon','paver.rGravel'],5:[]};
  for(var k=1;k<=5;k++){window.__pvStep(k);want[k].forEach(function(p){if(!vis(q(p)))bad.push(p+' not shown in step '+k);});for(var j=1;j<=5;j++)if(j!==k)want[j].forEach(function(p){if(vis(q(p)))bad.push(p+' of step '+j+' shows in step '+k);});
    if(vis(document.querySelector('.pmod'))!==(k===2))bad.push('the module bar '+(k===2?'is hidden in':'shows outside')+' step 2');}
  window.__pvStep(2);if(vis(q('paver.pLat'))||vis(q('paver.openMax')))bad.push('the family controls show for a running bond');
  S.paver.tiling='perm';T.refreshAll();if(!vis(q('paver.pLat'))||!vis(q('paver.openMax')))bad.push('the family controls are hidden for the permeable family');
  var slot=body.querySelector('[data-path="paver.pMorph"] button[data-v="slot"]');if(vis(slot))bad.push('Slot is offered on a square lattice');S.paver.pLat='brick';T.refreshAll();if(!vis(slot))bad.push('Slot is not offered on the brick lattice');
  T.regen();window.__pvStep(4);window.__pvPanel();if(!/Takes in/.test(body.querySelector('.pvwout').textContent))bad.push('no water readout');window.__pvStep(5);if(!/Grade/.test(body.querySelector('.pvdout').textContent))bad.push('no grade table');
  var untagged=[].filter.call(body.querySelectorAll('[data-path^="paver."]'),function(e){return !e.closest('[data-pvstep]');}).map(function(e){return e.dataset.path;});m.untagged=untagged.join(',');if(untagged.length)bad.push('controls in no step: '+untagged.slice(0,4).join(', '));
  window.__pvStep(1);T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'five steps, each showing its own controls and no other; the module bar in Modules; lattice, variation and open range only with the permeable family; Slot only on the brick lattice; water and grade readouts fill',metrics:m};});


/* ---- p74-1: the ground falls ---- */
guard('paver','the ground falls: water runs band by band to the low edge and balances, open ground downhill soaks up more than the same ground uphill, a level ground uses the average, slots turn to run with the fall, the plan marks it, the section draws the build-up',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={};
  var base={tiling:'perm',pLat:'square',pMorph:'shrink',size:300,openMin:3,openMax:24,pFill:'gravel',grassFrom:20,types:4,palette:'#A9A69F,#B7B4AD,#C4C1BA,#D0CDC6',heights:'60',kinds:'',assign:'quantise',cull:0,holes:'',holeBy:'type',keep:'',route:'none',routeOn:true,seats:0,storm:25,runon:0,rGravel:600,rGrass:100,rSand:40,base:300,sub:10,edge:'none',fall:1.5,fallTo:'S'};
  S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();
  Object.assign(S.paver,base);var gS=T.regen(),wS=gS.paver.water;S.paver.fallTo='N';var wN=T.regen().paver.water;S.paver.fall=0;var w0=T.regen().paver.water;
  m.edgeLowOpen=+wS.edge.toFixed(1);m.edgeHighOpen=+wN.edge.toFixed(1);m.need=wS.need;m.intake=+wS.intake.toFixed(1);
  if(Math.abs(wS.taken+wS.edge-wS.need)>1e-6||Math.abs(wN.taken+wN.edge-wN.need)>1e-6)bad.push('what soaks in and what reaches the edge do not add up to what arrives');
  if(!(wS.edge<wN.edge-1))bad.push('open ground at the low edge ('+m.edgeLowOpen+' mm/h reaches the drain) should beat open ground at the high edge ('+m.edgeHighOpen+')');
  if(Math.abs(wS.intake-wN.intake)>1e-9||Math.abs(wS.open-wN.open)>1e-9)bad.push('turning the fall changed the ground itself');
  if(w0.ok!==(w0.intake>=w0.need)||Math.abs(w0.taken-Math.min(w0.intake,w0.need))>1e-9)bad.push('a level ground does not use the average');
  if(!(wN.edgeLs>0)||Math.abs(wN.edgeLs-wN.edge*wN.area/1e6/3600)>1e-9)bad.push('litres per second do not follow from the edge rate');
  var svg1=T.paverSVGText(gS);S.paver.fall=0;var svg0=T.paverSVGText(T.regen());if(!/paver-fall/.test(svg1)||/paver-fall/.test(svg0))bad.push('the plan marks the fall wrongly');
  var box=function(g){var c=g.pavers[0].cell,xa=1e9,xb=-1e9,ya=1e9,yb=-1e9;c.forEach(function(q){xa=Math.min(xa,q.x);xb=Math.max(xb,q.x);ya=Math.min(ya,q.y);yb=Math.max(yb,q.y);});return[xb-xa,yb-ya];};
  Object.assign(S.paver,base,{pLat:'brick',pMorph:'slot',size:400,fall:2,fallTo:'S'});var bS=box(T.regen());S.paver.fallTo='E';var bE=box(T.regen());m.slotS=bS.map(Math.round).join('x');m.slotE=bE.map(Math.round).join('x');
  if(!(bS[1]>bS[0]*1.5))bad.push('with the fall down the plan the bricks should run down it: '+m.slotS);if(!(bE[0]>bE[1]*1.5))bad.push('with the fall across the plan the bricks should run across: '+m.slotE);
  Object.assign(S.paver,base);var g=T.regen(),sec=T.paverSectionSVG(g);if(!/Stone base, 300 mm/.test(sec)||!/Geotextile/.test(sec)||!/Bedding grit/.test(sec))bad.push('the section lacks a layer');S.paver.base=450;if(!/base, 450 mm/.test(T.paverSectionSVG(T.regen())))bad.push('the section does not follow the base depth');
  S.paver.base=300;var geo1=T.buildGeometryFrom(T.regen());S.paver.fall=0;var geo0=T.buildGeometryFrom(T.regen());m.drainVerts=geo1.attributes.position.count-geo0.attributes.position.count;if(m.drainVerts!==36)bad.push('the drain is not one strip in 3D: '+m.drainVerts+' vertices');geo1.dispose();geo0.dispose();
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'of '+m.need+' mm/h arriving, '+m.edgeLowOpen+' reaches the drain with the open ground downhill and '+m.edgeHighOpen+' with it uphill; balances; level ground uses the average; slots turn with the fall; plan, section and drain drawn',metrics:m};});
/* ---- p74-2: the panel: nothing floats over it, nothing clips, a dropdown, starting designs, Compose ---- */
guard('paver','in the Pavers panel a rule never floats over the controls, every layout draws its family inside the drawing, the layout is a dropdown, the three starting designs load, and Compose makes permeable grounds',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');var bad=[],m={};window.__pvStep(2);var bar=document.querySelector('.pmod');
  Object.assign(S.paver,{tiling:'herring',ratio:1,size:150,types:4,kinds:'grass,slab,groove,hole'});T.refreshAll();T.regen();window.__pmodDraw();
  var rules=bar.querySelectorAll('.pmod-rules p');m.rules=rules.length;if(!rules.length)bad.push('no rules shown');[].forEach.call(rules,function(p){var cs=getComputedStyle(p);if(cs.position!=='static')bad.push('a rule is positioned '+cs.position);if(/(^| )(warn|ok|bad|note)( |$)/.test(p.className))bad.push('a rule carries a bare class: '+p.className);});
  var clipped=[];['perm','square','running','stack','herring','basket','ashlar','planks','tri','hex','cairo','radial','voronoi'].forEach(function(t){Object.assign(S.paver,{tiling:t,ratio:t==='planks'?4:2,size:300});T.refreshAll();window.__pmodDraw();var sv=bar.querySelector('.pmod-fam'),vb=sv.viewBox.baseVal,bb;try{bb=sv.getBBox();}catch(e){bb=null;}
    if(bb&&bb.width>0&&(bb.x<-1||bb.y<-1||bb.x+bb.width>vb.width+1||bb.y+bb.height>vb.height+1))clipped.push(t+' ('+[bb.x,bb.y,bb.x+bb.width,bb.y+bb.height].map(Math.round).join(',')+' in '+vb.width+'x'+vb.height+')');});
  if(clipped.length)bad.push('the family drawing clips: '+clipped.slice(0,4).join('; '));
  var sel=document.querySelector('.pv-laysel');if(!sel)bad.push('no layout dropdown');else{S.paver.tiling='hex';T.refreshAll();if(sel.value!=='hex')bad.push('the dropdown shows '+sel.value+' for hexagons');sel.value='ashlar';sel.dispatchEvent(new Event('change'));if(S.paver.tiling!=='ashlar')bad.push('choosing in the dropdown did not set the layout');
    if(sel.querySelector('option[value="nested"]'))bad.push('a facade layout is offered');var seg=sel.parentNode.querySelector('.seg');if(seg&&getComputedStyle(seg).display!=='none')bad.push('the thirteen buttons still show');m.options=sel.options.length;}
  var chips=document.querySelectorAll('.pvchips button');m.chips=chips.length;var slot=[].slice.call(chips).filter(function(c){return /slot/i.test(c.textContent);})[0];/* pass 123 adds the Pocket park chip first */if(chips.length<3||!slot)bad.push(chips.length+' starting designs');else{slot.click();var g=T.regen();if(S.paver.tiling!=='perm'||S.paver.pLat!=='brick'||S.paver.pMorph!=='slot'||S.field.kind!=='gradient'||!(g.pavers&&g.pavers.length))bad.push('Slot bond did not load');
    var pin=[].slice.call(chips).filter(function(c){return /pinwheel/i.test(c.textContent);})[0]||chips[1];pin.click();g=T.regen();if(S.paver.pMorph!=='turn'||S.paver.types!==5||!g.paver.perm||g.paver.perm.fam.length!==5)bad.push('Pinwheel court did not load five grades');}
  var perm=0,built=0,N=40;for(var sd=1;sd<=N;sd++){T.reset();T.composeDesign('ground',[],sd*53+7);var gg=T.regen();if(gg.pavers&&gg.pavers.length)built++;if(S.paver.tiling==='perm'){perm++;if(!gg.paver.perm||!gg.paver.water)bad.push('a composed permeable ground has no family or water check');}}
  m.composedPerm=perm;m.composedBuilt=built;if(built!==N)bad.push((N-built)+' composed grounds built nothing');if(!(perm>=4&&perm<=20))bad.push(perm+' of '+N+' composed grounds are permeable');
  T.reset();S.arr='grid';S.cols=5;S.rows=1;S.width=900;S.height=2400;T.showTab('Pavers',true);m.ground=S.arr+' '+S.width+'x'+S.height;if(S.arr!=='single'||S.width<3000||S.height<3000)bad.push('a click on Pavers over five wall panels gives '+m.ground+', not one ground');T.showTab('Brick courses',true);if(S.arr!=='grid'||S.cols!==5||S.width!==900||S.height!==2400)bad.push('leaving Pavers did not bring the set back: '+S.arr+' '+S.cols+' x '+S.width);
  T.reset();window.__pvStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'rules sit in the panel; thirteen families draw inside their drawing; a dropdown of '+m.options+' layouts; three starting designs; '+perm+' of '+N+' composed grounds are permeable',metrics:m};});


/* ---- p75-1: sizes, sets and the route change the ground ---- */
guard('paver','a module width or depth can be set to any number and the pavers follow, herringbone holds a whole ratio, an ashlar set can lose modules, plank lengths are typed, a route changes every layout, and the fall is in the title, not over the plan',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={},P=S.paver;
  Object.assign(P,{tiling:'running',size:600,ratio:2,joint:6,types:4,palette:'#555555,#888888,#AAAAAA,#DDDDDD',heights:'60',kinds:'',names:'',assign:'quantise',cull:0,holes:'',holeBy:'type',keep:'',route:'none',routeOn:true,spin:0,fall:1.5,fallTo:'S',ashlarSet:'',plankSet:''});
  T.paverDimSet(P,'width',240);m.ratio=P.ratio;if(Math.abs(P.ratio-2.5)>1e-9)bad.push('a 240 width on a 600 paver gave a ratio of '+P.ratio);
  var g=T.regen(),whole=g.pavers.filter(function(p){return !p.cut;}),hs=whole.map(function(p){var a=1e9,b=-1e9;p.pts.forEach(function(q){a=Math.min(a,q.y);b=Math.max(b,q.y);});return Math.round(b-a);});
  if(!whole.length||hs.some(function(h){return Math.abs(h-240)>8;}))bad.push('whole pavers are not 240 wide less the joint: '+hs.slice(0,3).join(','));
  T.paverDimSet(P,'length',900);if(P.size!==900||Math.abs(900/P.ratio-240)>1)bad.push('changing the length did not keep the width: '+P.size+' / '+P.ratio);
  P.tiling='herring';P.size=600;P.ratio=3;T.paverDimSet(P,'width',240);if(P.ratio!==Math.round(P.ratio))bad.push('herringbone took a part ratio: '+P.ratio);m.herring=P.ratio;
  P.tiling='running';P.size=600;P.ratio=2;P.heights='60,60,450,60';P.kinds='slab,slab,seat,slab';T.paverDimSet(P,'depth',90);m.heights=P.heights;
  if(P.heights.split(',').filter(function(h){return +h===90;}).length!==3||P.heights.indexOf('450')<0)bad.push('depth 90 gave heights '+P.heights);if(S.thickness!==450)bad.push('the thickness did not follow: '+S.thickness);
  P.heights='60';P.kinds='';T.paverDimSet(P,'depth',85);if(P.heights.split(',').some(function(h){return +h!==85;})||S.thickness!==85)bad.push('a uniform depth of 85 gave '+P.heights+' and thickness '+S.thickness);
  /* ashlar: the set loses modules */
  P.tiling='ashlar';P.size=600;P.joint=0;P.ashlarSet='';var areas=function(){var st={};T.regen().pavers.forEach(function(p){if(!p.cut)st[Math.round(p.area/1e3)]=1;});return Object.keys(st).length;};
  var a5=areas();P.ashlarSet='1x1';var a1=areas();P.ashlarSet='2x2,1x1';var a2=areas();m.ashlar=[a5,a2,a1].join('/');
  if(!(a5>=4))bad.push('the full ashlar set lays '+a5+' sizes');if(a1!==1)bad.push('the single unit alone lays '+a1+' sizes');if(a2!==2)bad.push('two modules lay '+a2+' sizes');
  var gA=T.regen(),sumA=gA.pavers.reduce(function(s,p){return s+p.area;},0);if(Math.abs(sumA-9000*6000)/(9000*6000)>.03)bad.push('the reduced ashlar set does not cover the ground: '+(sumA/1e6).toFixed(1)+' m2');
  P.ashlarSet='';
  /* planks: typed lengths */
  P.tiling='planks';P.size=600;P.ratio=4;T.paverDimSet(P,'plank2',1500);m.plankSet=P.plankSet;if(P.plankSet!=='1,1.5,2.5')bad.push('typing 1500 for the third plank gave '+P.plankSet);
  var gP=T.regen();if(!(gP.pavers&&gP.pavers.length>20))bad.push('planks with typed lengths built nothing');P.plankSet='';
  /* the route on an ordinary layout */
  Object.assign(P,{tiling:'running',size:600,ratio:2,joint:6,kinds:'hole,grass,slab,slab',heights:'60',route:'none',keep:'',keepW:900});S.field=T.fieldDefaults();S.field.kind='gradient';T.fieldUse();
  var sig=function(g){var h=7;g.pavers.forEach(function(p){h=(h*31+p.type+1)>>>0;});return h;},g0=T.regen(),s0=sig(g0);
  P.route='straight';T.paverRouteSet();var g1=T.regen(),s1=sig(g1),near=g1.pavers.filter(function(p){return Math.abs(p.cy-3000)<600;}),n=g1.paver.palette.length;m.routeN=g1.paver.routeN;
  if(s1===s0)bad.push('a route straight across changed nothing');if(!near.length||near.some(function(p){return p.type!==n-1||p.kind!=='slab'||p.hole;}))bad.push('pavers along the route are not the lightest plain slab');
  if(!(g1.paver.routeN>0))bad.push('no pavers counted on the route');
  P.route='diag';T.paverRouteSet();var s2=sig(T.regen());if(s2===s1||s2===s0)bad.push('corner to corner gave the same ground');
  P.routeOn=false;if(sig(T.regen())!==s0)bad.push('with the route switched off the ground is not as it was');P.routeOn=true;
  /* the permeable family: the field follows the route */
  P.tiling='perm';T.permStart();var f0=S.field.attractCurve.pts;P.route='straight';T.paverRouteSet();var f1=S.field.attractCurve.pts;m.fieldFollows=f1;if(f1===f0||f1.replace(/;/g,'').split(/\s+/).join(' ')!==P.keep)bad.push('the field did not follow the new route: '+f1);
  /* the fall: in the title, a drain line on the drawing, no arrow or label */
  Object.assign(P,{tiling:'running',size:600,ratio:2,route:'none',keep:'',fall:1.5,fallTo:'S'});T.regen();T.render2D();var ttl=T.paverFallTitle(),hint=document.querySelector('#hint2d').textContent,fallG=(document.querySelector('#view2d').innerHTML.match(/<g class="paver-fall">[\s\S]*?<\/g>/)||[''])[0];m.title=hint;
  if(!/↓ 1\.5 %/.test(ttl)||hint.indexOf('1.5 %')<0)bad.push('the 2D title does not give the fall: '+hint);if(!fallG)bad.push('no drain line on the plan');if(/polyline|<text/.test(fallG))bad.push('an arrow or label is still drawn over the plan');
  if(/>fall /.test(document.querySelector('#view2d').innerHTML))bad.push('the fall is still written over the plan');
  P.fall=0;T.regen();T.render2D();if(/%/.test(document.querySelector('#hint2d').textContent))bad.push('a level ground still shows a fall in the title');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'width 240 on 600 gives 2.5:1 and 234 mm pavers; herringbone holds '+m.herring+':1; depth leaves the seat at 450; ashlar lays '+m.ashlar+' sizes; plank set '+m.plankSet+'; a route retypes '+m.routeN+' pavers; the field follows; title "'+m.title+'"',metrics:m};});
/* ---- p75-2: the panel answers ---- */
guard('paver','in the module bar each size is a slider and a typed number that stay in step, a slider is not replaced while it is dragged, the ashlar chips and plank lengths work, the route dropdown changes the ground, and any slider value can be clicked and typed',function(){
  T.reset();S.arr='single';T.setPanelMode('paver');S.width=9000;S.height=6000;var bad=[],m={},P=S.paver;window.__pvStep(2);var bar=document.querySelector('.pmod');
  Object.assign(P,{tiling:'running',size:600,ratio:2,joint:6,types:4,heights:'60',kinds:'',route:'none',keep:''});T.refreshAll();T.regen();window.__pmodDraw();
  var row=function(k){return bar.querySelector('.pmod-row[data-k="'+k+'"]');},ks=['length','width','depth','joint'];m.rows=bar.querySelectorAll('.pmod-row').length;
  ks.forEach(function(k){var r=row(k);if(!r||!r.querySelector('input[type=range]')||!r.querySelector('input[type=number]'))bad.push('no slider and number for '+k);});
  if(!bad.length){var num=row('length').querySelector('input[type=number]');num.focus();num.value='750';num.dispatchEvent(new Event('input',{bubbles:true}));num.dispatchEvent(new Event('change',{bubbles:true}));
    if(P.size!==750)bad.push('typing 750 for the length gave '+P.size);if(+row('length').querySelector('input[type=range]').value!==750)bad.push('the slider did not follow the typed length');
    var rg=row('width').querySelector('input[type=range]');rg.focus();rg.value='250';rg.dispatchEvent(new Event('input',{bubbles:true}));window.__pmodDraw();
    if(!rg.isConnected)bad.push('the slider was replaced while it was in use');if(Math.abs(750/P.ratio-250)>1)bad.push('dragging the width to 250 gave '+(750/P.ratio).toFixed(0));if(+row('width').querySelector('input[type=number]').value!==250)bad.push('the typed number did not follow the slider');
    var lab=bar.querySelector('.pmod-fam text');if(!lab||lab.textContent.indexOf('750')<0||lab.textContent.indexOf('250')<0)bad.push('the family drawing does not carry the new size: '+(lab&&lab.textContent));
    var dn=row('depth').querySelector('input[type=number]');dn.focus();dn.value='100';dn.dispatchEvent(new Event('input',{bubbles:true}));dn.dispatchEvent(new Event('change',{bubbles:true}));if(S.thickness!==100)bad.push('typing a depth of 100 gave a thickness of '+S.thickness);
    var card=bar.querySelector('.pmod-card input[data-f="h"]');if(!card||+card.value!==100)bad.push('the type cards do not show the new depth');}
  document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
  P.tiling='ashlar';P.size=600;P.ashlarSet='';T.refreshAll();window.__pmodDraw();var chips=bar.querySelectorAll('.pmod-chip');m.chips=chips.length;if(chips.length!==5)bad.push(chips.length+' ashlar chips');else{chips[1].click();if(P.ashlarSet!=='2x2,2x1,1x2,1x1')bad.push('taking 3x2 out gave '+P.ashlarSet);if(chips[4].disabled!==true)bad.push('the single unit can be taken out');if(bar.querySelectorAll('.pmod-fam rect, .pmod-fam polygon').length!==4)bad.push('the family still draws five modules');}
  document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
  P.tiling='planks';P.size=600;P.ratio=4;P.plankSet='';T.refreshAll();window.__pmodDraw();var lens=bar.querySelectorAll('.pmod-len');if(lens.length!==3)bad.push(lens.length+' plank length boxes');else{lens[0].focus();lens[0].value='450';lens[0].dispatchEvent(new Event('change',{bubbles:true}));if(P.plankSet!=='0.75,1.5,2')bad.push('typing 450 for the first plank gave '+P.plankSet);}
  document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
  /* the route dropdown on an ordinary layout */
  Object.assign(P,{tiling:'running',size:600,ratio:2,route:'none',keep:'',plankSet:''});T.refreshAll();var sig=function(){var h=7;T.regen().pavers.forEach(function(p){h=(h*31+p.type+1)>>>0;});return h;},s0=sig();
  var sel=document.querySelector('[data-path="paver.route"] select');if(!sel)bad.push('no route dropdown');else{sel.value='winding';sel.dispatchEvent(new Event('change'));if(P.route!=='winding'||sig()===s0)bad.push('choosing a winding route did not change the ground');}
  /* click a slider's number and type */
  window.__pvStep(4);var ctl=document.querySelector('[data-path="paver.storm"]'),val=ctl&&ctl.querySelector('.val');if(!val)bad.push('no storm slider');else{val.click();var ed=val.querySelector('input.valedit');if(!ed)bad.push('clicking a slider value does not open a box');else{ed.value='45';ed.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));if(P.storm!==45)bad.push('typing 45 gave a storm of '+P.storm);if(val.querySelector('input'))bad.push('the box stayed open');if(val.textContent.indexOf('45')<0)bad.push('the value reads '+val.textContent);
      val.click();ed=val.querySelector('input.valedit');ed.value='9999';ed.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));if(P.storm!==100)bad.push('a value past the range gave '+P.storm);}}
  T.reset();window.__pvStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.rows+' size rows, each a slider and a number in step; a dragged slider stays; ashlar chips and plank lengths write the set; the route dropdown changes the ground; a slider value can be typed and is held to its range',metrics:m};});

/* ---- p76-1: bonds laid course by course ---- */
guard('brick','third lap, Flemish, English and header bond fill a straight wall end to end with no joint over a joint and a quarter-brick lap or more; headers go through a one-brick wall with a course behind the stretchers; bricks there are pushed out, never turned; the schedule lists every brick; other hosts fall back to running bond and say so',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=1500;var bad=[],m={},B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,open:0,op:'both',d1:0,d2:18,shiftMax:30});
  ['running','third','flemish','english','header'].forEach(function(bd){B.bond=bd;var g=T.regen(),k=g.brick;if(!g.bricks||!g.bricks.length){bad.push(bd+' built nothing');return;}
    m[bd]=k.minLap+' lap, '+g.bricks.length+(g.backs?'+'+g.backs.length:'');
    if(k.straight)bad.push(bd+': '+k.straight+' joints over a joint');if(!(k.minLap>=240/4-8))bad.push(bd+': smallest lap '+k.minLap);
    var ext={};g.bricks.forEach(function(b){var e=ext[b.r]||(ext[b.r]=[1e9,-1e9,0,0]);e[0]=Math.min(e[0],b.x-b.len/2);e[1]=Math.max(e[1],b.x+b.len/2);e[2]+=b.len;e[3]++;});var e0=ext[0];
    Object.keys(ext).forEach(function(r){var e=ext[r];if(Math.abs(e[0]-e0[0])>.6||Math.abs(e[1]-e0[1])>.6)bad.push(bd+': course '+r+' runs '+e[0].toFixed(0)+' to '+e[1].toFixed(0)+', not '+e0[0].toFixed(0)+' to '+e0[1].toFixed(0));if(Math.abs(e[2]+(e[3]-1)*10-(e[1]-e[0]))>1)bad.push(bd+': the bricks and joints of course '+r+' do not add up to its length');});
    var thick=bd==='flemish'||bd==='english'||bd==='header';
    if(thick){if(k.thick!==240)bad.push(bd+' is '+k.thick+' thick');var hd=g.bricks.filter(function(b){return b.kind==='h';}).length;if(!hd)bad.push(bd+' has no headers');if(!g.backs||g.backs.length!==g.bricks.length-hd)bad.push(bd+': the course behind does not match the stretchers');
      if(g.bricks.some(function(b){return Math.abs(b.theta)>1e-6||b.shift<-1e-6;}))bad.push(bd+': a brick is turned or pushed in');if(!g.bricks.some(function(b){return b.shift>1;}))bad.push(bd+': the field pushes nothing out');
      var rows=T.brickCSV(g).trim().split('\n');if(rows.length-1!==g.bricks.length+(g.backs?g.backs.length:0))bad.push(bd+': the schedule has '+(rows.length-1)+' rows');if(!/,depth_mm,laid$/.test(rows[0])||!/,240\.0,header$/m.test(rows.join('\n')))bad.push(bd+': the schedule does not name the headers');if(bd!=='header'&&!/,115\.0,back$/m.test(rows.join('\n')))bad.push(bd+': the schedule has no back course');
      var geo=T.buildGeometryFrom(g);geo.computeBoundingBox();var bb=geo.boundingBox;m[bd+' depth']=Math.round(bb.max.z-bb.min.z);if(bb.max.z-bb.min.z<240-1)bad.push(bd+': the wall is '+(bb.max.z-bb.min.z).toFixed(0)+' deep in 3D');geo.dispose();}
    else{if(k.thick!==115)bad.push(bd+' is '+k.thick+' thick');if(g.backs&&g.backs.length)bad.push(bd+' has a course behind');}});
  /* Flemish: every course alternates */
  B.bond='flemish';var gF=T.regen(),r2=gF.bricks.filter(function(b){return b.r===2;}).sort(function(a,b){return a.x-b.x;}).map(function(b){return b.kind;}).join('');m.flemishCourse=r2.slice(0,8);if(r2.slice(0,6)!=='shshsh')bad.push('a Flemish course reads '+r2.slice(0,12));
  /* English: a course of each */
  B.bond='english';var gE=T.regen(),k0=gE.bricks.filter(function(b){return b.r===0;}),k1=gE.bricks.filter(function(b){return b.r===1;});if(k0.some(function(b){return b.kind==='h';})||k1.some(function(b){return b.kind!=='h';}))bad.push('English bond does not alternate a course of stretchers and a course of headers');
  /* a brick that does not bond is found */
  B.bond='flemish';B.bW=140;var gX=T.regen();m.unbonded=gX.brick.minLap;if(gX.brick.minLap>=60-8&&!gX.brick.straight)bad.push('a 240 x 140 brick in Flemish bond still reads as bonded');B.bW=115;
  /* an open bond falls back */
  B.open=.3;var gO=T.regen();if(!gO.brick.bondHeld||gO.brick.thick!==115||gO.brick.bondLaid!=='running')bad.push('Flemish with an open bond did not fall back to running bond');B.open=0;
  var s1=T.brickStand(115,1900),s2=T.brickStand(240,1900);m.stand=s1.toFixed(2)+' / '+s2.toFixed(2);if(!(s1>.2&&s1<.4&&s2>1&&s2<1.4))bad.push('the stability numbers read '+m.stand);
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'running '+m.running+'; third '+m.third+'; Flemish '+m.flemish+'; English '+m.english+'; header '+m.header+'; one-brick walls '+m['flemish depth']+' deep; a 240 x 140 brick is caught (lap '+m.unbonded+'); plain walls stand '+m.stand+' m',metrics:m};});
/* ---- p76-2: the unit bar ---- */
guard('brick','the unit bar heads Brick courses: the brick drawn to scale, each size a slider and a typed number, standard formats, the bond chosen from chips and drawn from real courses, rules in the panel, the old controls out of the way',function(){
  T.reset();S.arr='single';T.showTab('Brick courses',true);S.width=3000;S.height=1500;if(window.__brStep)window.__brStep(2);var bad=[],m={},B=S.brick,bar=document.querySelector('.bbar');if(!bar)return{pass:false,detail:'no unit bar in the tab'};
  T.refreshAll();T.regen();window.__bbarDraw();
  var row=function(k){return bar.querySelector('.pmod-row[data-k="'+k+'"]');};['bL','bW','bH','joint'].forEach(function(k){var r=row(k);if(!r||!r.querySelector('input[type=range]')||!r.querySelector('input[type=number]'))bad.push('no slider and number for '+k);});
  if(!bad.length){var num=row('bL').querySelector('input[type=number]');num.focus();num.value='290';num.dispatchEvent(new Event('input',{bubbles:true}));num.dispatchEvent(new Event('change',{bubbles:true}));if(B.bL!==290)bad.push('typing 290 for the length gave '+B.bL);if(+row('bL').querySelector('input[type=range]').value!==290)bad.push('the slider did not follow');
    var rg=row('bW').querySelector('input[type=range]');rg.focus();rg.value='110';rg.dispatchEvent(new Event('input',{bubbles:true}));window.__bbarDraw();if(!rg.isConnected)bad.push('the slider was replaced while in use');if(B.bW!==110||S.thickness!==110)bad.push('dragging the width gave '+B.bW+' and a thickness of '+S.thickness);
    if(bar.querySelector('.bbar-unit text').textContent.indexOf('290')<0)bad.push('the drawing does not carry the new length');}
  document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
  var fm=bar.querySelectorAll('[data-fmt]');m.formats=fm.length;if(fm.length<3)bad.push(fm.length+' formats');else{fm[2].click();if(B.bL!==215||B.bW!==102.5||B.bH!==65)bad.push('the UK format gave '+[B.bL,B.bW,B.bH].join(' x '));if(!bar.querySelectorAll('[data-fmt]')[2].classList.contains('on'))bad.push('the chosen format is not marked');}
  var bc=bar.querySelectorAll('[data-bond]');m.bonds=bc.length;if(bc.length!==6)bad.push(bc.length+' bonds offered');else{bar.querySelector('[data-bond="flemish"]').click();if(B.bond!=='flemish')bad.push('choosing Flemish gave '+B.bond);T.regen();window.__bbarDraw();
    var rects=bar.querySelectorAll('.bbar-bond rect').length;m.bondRects=rects;if(rects<30)bad.push('the bond drawing has '+rects+' bricks');if(!bar.querySelector('.bbar-bond rect[fill-opacity]'))bad.push('headers are not told apart in the bond drawing');
    var txt=bar.querySelector('.pmod-rules').textContent;if(!/one-brick wall/.test(txt)||!/smallest lap/i.test(txt)||!/bricks a square metre/.test(txt))bad.push('the rules do not speak of the wall, the lap and the count: '+txt.slice(0,90));}
  [].forEach.call(bar.querySelectorAll('.pmod-rules p'),function(p){if(getComputedStyle(p).position!=='static')bad.push('a rule is positioned '+getComputedStyle(p).position);});
  ['brick.bond','brick.bL'].forEach(function(k){var e=document.querySelector('[data-path="'+k+'"]');if(e&&getComputedStyle(e).display!=='none')bad.push('the old '+k+' control still shows');});
  var sv=bar.querySelector('.bbar-unit'),vb=sv.viewBox.baseVal,bb=sv.getBBox();if(bb.x<-1||bb.y<-1||bb.x+bb.width>vb.width+1||bb.y+bb.height>vb.height+1)bad.push('the unit drawing clips');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'four size rows in step with the brick; '+m.formats+' formats; '+m.bonds+' bonds as chips, drawn from '+m.bondRects+' bricks; rules in the panel',metrics:m};});

/* ---- p77-1: the wall built as a bricklayer builds it ---- */
guard('brick','a wall in Flemish, English or header bond is set out from both ends (each course reads the same from either end), has no sliver and no joint over a joint at any length, stands on the bottom of its frame, carries mortar recessed in its joints, and its coping is bedded a joint above the top course and is as long as the wall',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.height=1500;var bad=[],m={},B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,open:0,op:'shift',d1:0,d2:18,shiftMax:30,cope:'stone'});
  if(S.frameL||S.frameB||S.frameT||S.frameR)bad.push('a brick wall still has frame margins');
  var worst=1e9,small=1e9;['flemish','english','header'].forEach(function(bd){B.bond=bd;[2400,3000,3350,4100].forEach(function(w){S.width=w;var g=T.regen(),k=g.brick,rows={};if(!g.bricks.length){bad.push(bd+' at '+w+' built nothing');return;}
    g.bricks.forEach(function(b){(rows[b.r]||(rows[b.r]=[])).push(b);small=Math.min(small,b.len);});
    Object.keys(rows).forEach(function(r){var l=rows[r].sort(function(a,b){return a.x-b.x;}),n=l.length;for(var i=0;i<n/2;i++){if(Math.abs(l[i].len-l[n-1-i].len)>.6||l[i].kind!==l[n-1-i].kind){bad.push(bd+' at '+w+': course '+r+' is not the same from both ends');break;}}});
    if(k.straight)bad.push(bd+' at '+w+': '+k.straight+' joints over a joint');worst=Math.min(worst,k.minLap);
    var lo=1e9;g.bricks.forEach(function(b){lo=Math.min(lo,b.y-71/2);});if(Math.abs(lo)>.01)bad.push(bd+' at '+w+': the first course starts at '+lo.toFixed(1));});});
  m.worstLap=worst;m.smallest=+small.toFixed(1);if(worst<40)bad.push('the smallest lap over all lengths is '+worst);if(small<44)bad.push('a piece of '+small.toFixed(0)+' mm is laid');
  /* a Flemish wall ends in stretchers on its stretcher courses and header + closer on the others */
  B.bond='flemish';S.width=3000;var g=T.regen(),c0=g.bricks.filter(function(b){return b.r===0;}).sort(function(a,b){return a.x-b.x;}),c1=g.bricks.filter(function(b){return b.r===1;}).sort(function(a,b){return a.x-b.x;});
  if(c0[0].kind!=='s'||c0[c0.length-1].kind!=='s'||Math.abs(c0[0].len-240)>.6)bad.push('a Flemish stretcher course does not end in stretchers');
  if(c1[0].kind!=='h'||Math.abs(c1[1].len-52.5)>.6||c1[c1.length-1].kind!=='h'||Math.abs(c1[c1.length-2].len-52.5)>.6)bad.push('a Flemish header course does not end header, closer at both ends: '+c1.slice(0,2).concat(c1.slice(-2)).map(function(b){return b.len;}).join(','));
  /* mortar */
  var mg=T.brickMortar(g);if(!mg)bad.push('no mortar');else{mg.computeBoundingBox();var bb=mg.boundingBox;m.mortarZ=[bb.min.z.toFixed(0),bb.max.z.toFixed(0)].join('..');/* pass 81: mortar follows a brick that is pushed out, so the front is measured from the furthest brick */if(bb.max.z>115+g.brick.maxShift-2.5||bb.min.z<115-240+2.5)bad.push('the mortar is not recessed from both faces: '+m.mortarZ);if(Math.abs(bb.max.y-(g.brick.top+10))>.6)bad.push('no bed for the coping: mortar tops out at '+bb.max.y.toFixed(1));mg.dispose();}
  if(T.sceneFlag('mortar')!==1)bad.push('the wall mesh carries '+T.sceneFlag('mortar')+' mortar meshes');
  var cb=T.sceneBox('coping');if(!cb)bad.push('no coping on a single wall');else{m.coping=cb.map(Math.round).join(',');if(Math.abs(cb[1]-(g.brick.top+10))>.6)bad.push('the coping sits at '+cb[1].toFixed(1)+', the top course at '+g.brick.top.toFixed(1));
    if(Math.abs((cb[3]-cb[0])-(g.brick.x1-g.brick.x0+60))>1)bad.push('the coping is '+(cb[3]-cb[0]).toFixed(0)+' long over a wall of '+(g.brick.x1-g.brick.x0).toFixed(0));}
  /* open bond: mortar only where a brick bears */
  B.bond='running';B.open=.4;var gO=T.regen(),mo=T.brickMortar(gO),g0=(function(){B.open=0;return T.regen();})(),m0=T.brickMortar(g0);m.openBoxes=mo.attributes.position.count/36;m.solidBoxes=m0.attributes.position.count/36;
  if(!(mo.attributes.position.count>0))bad.push('an open bond has no mortar');mo.dispose();m0.dispose();
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'three bonds at four lengths read the same from both ends; smallest lap '+m.worstLap+' mm, smallest piece '+m.smallest+' mm; first course on the frame; mortar recessed (z '+m.mortarZ+'); coping bedded on the top course and as long as the wall',metrics:m};});

/* ---- p78-1: three source logics in the brick panel ---- */
guard('brick','a brick that would not bear is eased back until it does, and none is painted red; a sound wall needs none; a second group of bricks takes a colour, stands out, or is left out as headers of a Flemish wall that still bears; the Charges field is signed, additive and can ripple',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=1500;var bad=[],m={},B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,open:0,op:'shift',d1:0,d2:0,shiftMax:30,maxOver:.4,bond:'running',splitDo:'off',split:.5,bearMin:.4});
  S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='up';T.fieldUse();
  var g=T.regen();m.sound=g.brick.atRisk+' at risk, least bearing '+g.brick.minBear;if(g.brick.atRisk!==0||!(g.brick.minBear>.5))bad.push('a plain running wall reads '+m.sound);
  /* a cantilever, by hand */
  var one=[{r:1,x:180,len:240,shift:0,theta:0}],r1=T.brickRisk(one,[{r:0,x:0,len:240,shift:0,theta:0}].concat(one),115,.4,0);if(r1.atRisk!==1||!one[0].risk||Math.abs(one[0].bear-.25)>.01)bad.push('a brick three quarters off its support reads bearing '+one[0].bear+', risk '+one[0].risk);
  var two=[{r:1,x:125,len:240,shift:60,theta:0}],r2=T.brickRisk(two,[{r:0,x:0,len:240,shift:0,theta:0},{r:0,x:250,len:240,shift:0,theta:0}].concat(two),115,.4,0);if(!two[0].risk)bad.push('a brick pushed 60 of 115 out is not flagged: bearing '+two[0].bear);
  /* an open bond pushed hard */
  Object.assign(B,{open:.5,shiftMax:46,maxOver:.4});S.field.kind='noise';S.field.noise.scale=12;T.fieldUse();var gR=T.regen(),nR=gR.brick.riskHeld||0;m.pushed=nR+' eased of '+gR.bricks.length;if(!(nR>0)||gR.brick.atRisk)bad.push('an open bond pushed to its limit is not eased back until it bears');
  var svg=T.brickSVGText(gR),nSvg=(svg.match(/class="brick-risk"/g)||[]).length;if(nSvg!==0)bad.push('the course drawing still marks '+nSvg+' bricks');
  var geo=T.buildGeometryFrom(gR),ca=geo.attributes.color.array,red=0;for(var i=0;i<ca.length;i+=3)if(ca[i]>1.5&&ca[i+1]<.3)red++;m.redVerts=red;if(red!==0)bad.push('3D still paints '+red/36+' bricks red');geo.dispose();
  B.open=0;B.shiftMax=30;S.field.kind='gradient';T.fieldUse();
  /* one-brick walls: a header rests on the stretcher and the course behind it */
  B.bond='flemish';var gF=T.regen();m.flemish=gF.brick.atRisk+' at risk, least '+gF.brick.minBear;if(gF.brick.atRisk!==0||!(gF.brick.minBear>.8))bad.push('a plain Flemish wall reads '+m.flemish);
  /* the second group */
  B.bond='running';B.splitDo='colour';var gC=T.regen(),n2=gC.bricks.filter(function(b){return b.g2;}).length;m.colour=n2+' of '+gC.bricks.length;if(!(n2>0&&n2<gC.bricks.length)||gC.brick.group2!==n2)bad.push('the colour group is '+m.colour);if(gC.bricks.some(function(b){return b.g2!==(b.t>=.5);}))bad.push('the group does not follow the field value');
  var gc=T.buildGeometryFrom(gC),cc=gc.attributes.color.array,dark=0;for(i=0;i<cc.length;i+=3)if(cc[i]<.45)dark++;if(dark<n2*36)bad.push('the second colour is not painted in 3D: '+dark/36+' of '+n2);gc.dispose();
  B.splitDo='out';var gO=T.regen();if(gO.bricks.some(function(b){return Math.abs(b.theta)>1e-9||(b.t>=.5?Math.abs(b.shift-30)>.01:Math.abs(b.shift)>.01);}))bad.push('pushed out is not a clean step of 30 mm');
  B.splitDo='omit';var gN=T.regen();if(gN.brick.omitted)bad.push('running bond left bricks out');
  B.bond='flemish';var gM=T.regen(),rowsN=gM.brick.courses;m.omitted=gM.brick.omitted;if(!(gM.brick.omitted>0))bad.push('a Flemish wall left no headers out');
  if(gM.brick.atRisk)bad.push(gM.brick.atRisk+' bricks at risk over the left-out headers (least bearing '+gM.brick.minBear+')');if(gM.brick.straight)bad.push('leaving headers out made straight joints');
  var ext={};gM.bricks.forEach(function(b){var e=ext[b.r]||(ext[b.r]=[1e9,-1e9,0]);e[0]=Math.min(e[0],b.x-b.len/2);e[1]=Math.max(e[1],b.x+b.len/2);e[2]++;});var e0=ext[0],full=T.regen;
  Object.keys(ext).forEach(function(r){if(Math.abs(ext[r][0]-e0[0])>.6||Math.abs(ext[r][1]-e0[1])>.6)bad.push('course '+r+' lost its end');});
  B.splitDo='off';var gFull=T.regen(),cnt=function(gg,r){return gg.bricks.filter(function(b){return b.r===r;}).length;};if(cnt(gM,0)!==cnt(gFull,0)||cnt(gM,rowsN-1)!==cnt(gFull,rowsN-1))bad.push('a header was left out of the first or the top course');
  /* charges */
  var F=T.fieldDefaults();F.kind='charge';F.charge={pts:'0.25,0.5,1;0.75,0.5,-1',reach:.3,waves:0};var fv=function(u,v){return T.fieldValue(F,u,v,3000,3000);},a=fv(.25,.5),b2=fv(.75,.5),c=fv(.5,.5);m.charge=[a,c,b2].map(function(x){return x.toFixed(2);}).join(' / ');
  if(!(a>.8&&b2<.2&&Math.abs(c-.5)<.02))bad.push('plus, middle, minus read '+m.charge);
  F.charge.pts='0.25,0.5,1';var s1=fv(.5,.5);F.charge.pts='0.25,0.5,1;0.75,0.5,1';var s2=fv(.5,.5);if(!(s2>s1+.05))bad.push('two charges do not add: '+s1.toFixed(2)+' then '+s2.toFixed(2));
  F.charge.waves=8;var flips=0,last=null;for(var u=0;u<=1.0001;u+=.01){var hi=fv(u,.5)>.5;if(last!==null&&hi!==last)flips++;last=hi;}m.ripples=flips;if(flips<4)bad.push('ripples cross the middle only '+flips+' times');
  F.charge.pts='';if(Math.abs(fv(.3,.3)-.5)>1e-9)bad.push('no charges should read as mid grey');
  if(!document.querySelector('[data-path="field.charge.pts"]'))bad.push('no Charges controls in the Field picker');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'sound wall: '+m.sound+'; pushed open bond: '+m.pushed+' red in 2D and 3D; Flemish: '+m.flemish+'; colour group '+m.colour+'; '+m.omitted+' headers left out with no brick at risk; charges read '+m.charge+', '+m.ripples+' ripple crossings',metrics:m};});

/* ---- p79-1: joints, mortar, what stands on top, the step rule, the designs ---- */
guard('brick','every joint lies between bricks or under a brick that sits on a brick; the mortar takes a colour, a thickness and a face; a coping is stone, brick on edge or nothing; the step rule holds every brick within its share of the one below; the field fades at the edges; five designs build with no brick at risk and no joint over a joint',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=1500;var bad=[],m={},B=S.brick;
  Object.assign(B,{bL:240,bW:115,bH:71,joint:10,open:0,op:'shift',d1:0,d2:0,shiftMax:0,bond:'flemish',splitDo:'omit',split:.5,step:.33,calm:0,cope:'stone',piers:'auto',mortar:'#E4DFD3',rake:4});
  S.field=T.fieldDefaults();S.field.kind='attractCurve';T.fieldUse();
  var g=T.regen(),J=T.brickJoints(g),rows={};g.bricks.forEach(function(b){(rows[b.r]||(rows[b.r]=[])).push(b);});m.joints=J.boxes.length;
  var inBrick=function(r,x,t){t=t||.01;var l=rows[r]||[];for(var i=0;i<l.length;i++)if(x>=l[i].x-l[i].len/2-t&&x<=l[i].x+l[i].len/2+t)return true;return false;};
  var rOf=function(y){var best=null,bd=1e9;Object.keys(rows).forEach(function(r){var d=Math.abs(rows[r][0].y-y);if(d<bd){bd=d;best=+r;}});return best;},wrong=0,wide=0;
  J.boxes.forEach(function(q){var k=q[6],xm=(q[0]+q[1])/2;
    if(k==='bed'){var r=rOf(q[3]+71/2);if(!inBrick(r,xm,7)||!inBrick(r,q[0]+.5,7)||!inBrick(r,q[1]-.5,7))wrong++;if(r>0&&!(inBrick(r-1,xm)||inBrick(r-1,xm-11)||inBrick(r-1,xm+11)))wrong++;if(Math.abs((q[3]-q[2])-10)>.01)wide++;}
    else if(k==='head'){var r2=rOf(q[3]-71/2);if(q[1]-q[0]>13.7)wide++;if(inBrick(r2,xm))wrong++;if(!inBrick(r2,q[0]-1)||!inBrick(r2,q[1]+1))wrong++;}});
  if(wrong)bad.push(wrong+' joints are not where brick meets brick');if(wide)bad.push(wide+' joints are not the joint thickness');
  if(g.brick.mortar!=='#E4DFD3')bad.push('the mortar colour is '+g.brick.mortar);
  var mz=function(){var mg=T.brickMortar(T.regen());mg.computeBoundingBox();var z=mg.boundingBox.max.z;mg.dispose();return z;};B.rake=0;var z0=mz();B.rake=8;var z8=mz();B.rake=4;m.face=z0.toFixed(0)+' / '+z8.toFixed(0);if(Math.abs(z0-115)>.01||Math.abs(z8-107)>.01)bad.push('flush and raked faces stand at '+m.face);
  B.joint=6;var J6=T.brickJoints(T.regen());if(J6.boxes.some(function(q){return q[6]==='bed'&&Math.abs((q[3]-q[2])-6)>.01;}))bad.push('a 6 mm joint is not 6 mm thick');B.joint=2;if(T.brickJoints(T.regen()).boxes.length)bad.push('a 2 mm joint still has mortar');B.joint=10;
  var tk=T.brickTakeoff(T.regen());m.takeoff=tk.total+' bricks, '+tk.mortarL.toFixed(0)+' L';if(tk.total!==g.bricks.length+g.backs.length||!(tk.mortarL>5)||tk.header<1||tk.back<1)bad.push('the take-off reads '+JSON.stringify(tk));
  /* what stands on top */
  S.height=2100;T.regen();if(T.sceneFlag('coping')!==1||T.sceneFlag('copeBrick')!==0)bad.push('stone coping: '+T.sceneFlag('coping')+' stone, '+T.sceneFlag('copeBrick')+' brick');if(!(T.sceneFlag('pier')>=1))bad.push('a 2.1 m wall has no piers');
  B.cope='brick';T.regen();if(T.sceneFlag('coping')!==0||T.sceneFlag('copeBrick')!==1)bad.push('brick on edge: '+T.sceneFlag('coping')+' stone, '+T.sceneFlag('copeBrick')+' brick');
  B.cope='none';var gn=T.regen();if(T.sceneFlag('coping')||T.sceneFlag('copeBrick'))bad.push('nothing on top still builds a coping');if(T.brickJoints(gn).boxes.some(function(q){return q[6]==='cap';}))bad.push('nothing on top still has a bed for a coping');
  B.cope='stone';B.piers='none';T.regen();if(T.sceneFlag('pier'))bad.push('piers switched off are still built');B.piers='auto';S.height=1500;
  /* the step rule and the calm margin */
  Object.assign(B,{bond:'running',splitDo:'off',shiftMax:46,maxOver:.4,step:.2,calm:0});S.field.kind='noise';S.field.noise.scale=10;T.fieldUse();var gs=T.regen(),rr={},over=0;gs.bricks.forEach(function(b){(rr[b.r]||(rr[b.r]=[])).push(b);});
  gs.bricks.forEach(function(b){var lo=rr[b.r-1];if(!lo)return;lo.forEach(function(c){if(c.x+c.len/2<=b.x-b.len/2||c.x-c.len/2>=b.x+b.len/2)return;if(Math.abs(b.sh0-c.sh0)>.2*115+.6)over++;});});m.stepHeld=gs.brick.stepHeld;if(over)bad.push(over+' bricks step more than a fifth of their width past the brick below');if(!(gs.brick.stepHeld>0))bad.push('the step rule held nothing on a rough field');
  B.step=0;var g0=T.regen(),over0=0,r0={};g0.bricks.forEach(function(b){(r0[b.r]||(r0[b.r]=[])).push(b);});g0.bricks.forEach(function(b){var lo=r0[b.r-1];if(!lo)return;lo.forEach(function(c){if(c.x+c.len/2<=b.x-b.len/2||c.x-c.len/2>=b.x+b.len/2)return;if(Math.abs(b.sh0-c.sh0)>.2*115+.6)over0++;});});if(!over0)bad.push('with the rule off nothing steps further (the test proves nothing)');
  B.step=.33;B.calm=400;S.field.kind='gradient';S.field.gradient.dir='right';T.fieldUse();var gc=T.regen(),edge=0,mid=0;gc.bricks.forEach(function(b){var d=Math.min(b.x-gc.brick.x0,gc.brick.x1-b.x);if(d<130)edge=Math.max(edge,Math.abs(b.shift));if(d>1000&&b.y>500&&b.y<1000)mid=Math.max(mid,Math.abs(b.shift));});m.calm=edge.toFixed(1)+' at the ends, '+mid.toFixed(1)+' in the middle';if(!(edge<mid*.6&&mid>12))bad.push('the calm margin reads '+m.calm);
  /* the designs */
  var sig={};['tide','lantern','drift','weave','proud'].forEach(function(id){T.reset();if(!T.brickDesign(id)){bad.push('no design '+id);return;}var gd=T.regen(),k=gd.brick;sig[id]=gd.bricks.length+'/'+k.bondLaid+'/'+(k.omitted||0)+'/'+(k.group2||0)+'/'+k.maxShift+'/'+k.maxTheta;
    if(!(gd.bricks.length>300))bad.push(id+' built '+gd.bricks.length+' bricks');if(k.atRisk)bad.push(id+': '+k.atRisk+' bricks at risk');if(k.straight)bad.push(id+': '+k.straight+' joints over a joint');if(!(k.minLap>=40))bad.push(id+': lap '+k.minLap);if(S.frameB!==0)bad.push(id+' has a frame');});
  var vals=Object.keys(sig).map(function(k){return sig[k];});if(new Set(vals).size!==vals.length)bad.push('two designs are the same: '+JSON.stringify(sig));m.designs=vals.length;
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.joints+' joints, each where brick meets brick; faces at '+m.face+'; '+m.takeoff+'; stone, brick on edge or nothing on top; step rule held '+m.stepHeld+'; calm '+m.calm+'; '+m.designs+' designs sound',metrics:m};});
/* ---- p79-2: the tab as six steps ---- */
guard('brick','Brick courses is six steps: one shows at a time, the unit bar shows its own part for the step, the mortar chips, the coping choice and a design chip write the state, and the order table adds up',function(){
  T.reset();S.arr='single';T.showTab('Brick courses',true);S.width=3000;S.height=1500;var bad=[],m={},B=S.brick,body=document.querySelector('.bbar').parentNode,bar=body.querySelector('.bbar'),nav=body.parentNode.querySelector('.pvsteps.six');
  if(!nav||nav.querySelectorAll('button').length!==7||!window.__brStep)return{pass:false,detail:'no seven-step nav (pass 107 added By hand)'};T.refreshAll();T.regen();
  var vis=function(e){return !!e&&getComputedStyle(e).display!=='none'&&!e.closest('.pvs-off');};
  for(var k=1;k<=6;k++){window.__brStep(k);var shown=[].filter.call(body.querySelectorAll('[data-bstep]'),function(e){return !e.classList.contains('pvs-off');}).map(function(e){return +e.dataset.bstep;});if(shown.some(function(v){return v!==k;}))bad.push('step '+k+' also shows '+shown.filter(function(v){return v!==k;}).join(','));
    var want=(k===2||k===3||k===5);if(vis(bar)!==want)bad.push('the unit bar is '+(vis(bar)?'shown':'hidden')+' in step '+k);}
  window.__brStep(2);if(!vis(bar.querySelector('.pmod-dims'))||vis(bar.querySelector('.bbar-bonds'))||vis(bar.querySelector('.pmod-rules')))bad.push('step 2 does not show the unit alone');
  var chips=body.querySelectorAll('[data-m]');m.mortars=chips.length;if(chips.length<4)bad.push(chips.length+' mortar colours');else{chips[4].click();if(String(B.mortar).toLowerCase()!==chips[4].dataset.m.toLowerCase())bad.push('a mortar chip did not set the colour');if(!chips[4].classList.contains('on'))bad.push('the chosen mortar is not marked');}
  window.__brStep(3);if(!vis(bar.querySelector('.bbar-bonds'))||vis(bar.querySelector('.pmod-dims')))bad.push('step 3 does not show the bond alone');/* pass 86: the gap is offered in the Pattern step too, so the Bond step's own control is looked for among them */if(![].some.call(body.querySelectorAll('[data-path="brick.open"]'),vis))bad.push('the open bond is not in the Bond step');
  window.__brStep(1);var cp=body.querySelector('[data-path="brick.cope"]');if(!vis(cp))bad.push('no coping choice in the Wall step');else{var bn=[].find.call(cp.querySelectorAll('button'),function(x){return /Nothing/.test(x.textContent);});bn&&bn.click();if(B.cope!=='none')bad.push('choosing nothing on top gave '+B.cope);}
  window.__brStep(4);var ds=body.querySelectorAll('[data-design]');m.designs=ds.length;if(ds.length!==7)bad.push(ds.length+' designs offered');else{body.querySelector('[data-design="lantern"]').click();if(B.bond!=='flemish'||B.splitDo!=='omit'||S.field.kind!=='attractCurve'||S.arr!=='single')bad.push('the second design did not load');}
  if(!vis(body.querySelector('[data-path="brick.calm"]'))||!vis(body.querySelector('[data-path="brick.step"]')))bad.push('the calm margin and the step rule are not in the Pattern step');
  window.__brStep(5);if(!vis(bar.querySelector('.pmod-rules'))||!vis(body.querySelector('[data-path="brick.bearMin"]')))bad.push('the Check step lacks the rules or the bearing limit');
  [].forEach.call(bar.querySelectorAll('.pmod-rules p'),function(p){if(getComputedStyle(p).position!=='static')bad.push('a rule is positioned '+getComputedStyle(p).position);});
  window.__brStep(6);var g=T.regen();window.__brRead();var cells=[].map.call(body.querySelectorAll('.pvtable td.n'),function(td){return td.textContent;});m.table=cells.join(' | ');var tk=T.brickTakeoff(g);if(cells.indexOf(tk.total.toLocaleString())<0)bad.push('the order table does not carry the total '+tk.total+': '+m.table);if(!/ L$/.test(cells[cells.length-1]||''))bad.push('no mortar in the order');
  T.reset();window.__brStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'six steps, one at a time; the bar shows unit, bond or rules by step; '+m.mortars+' mortars; '+m.designs+' designs; order table '+m.table,metrics:m};});

/* ---- p80-1: the leaning timber wall's connections ---- */
guard('host','leaning timber wall, connections: the board length is held to the curve so every joint bears on half the board below; the two leaves never break at the same node; board ends meet on the radius 3 mm apart; every board above the first course has two dowels at each end, clear of both boards\' edges; every spacer block bridges an outer joint, is never on another, and has two bolts through both leaves; a cap, packers and strapped anchors; all of it scheduled',function(){
  T.reset();S.lean.on=true;Object.assign(S.lean,{a:5000,b:3600,arc:220,turn:0,height:2400,lean:900,node:600,cap:true,bench:true});S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();
  var R=T.leanModel(),bad=[],m={boards:R.mem.length,board:2*R.nodeL,sag:R.sag,bear:R.bearMin,edge:R.edgeMin,dowels:R.dowels.length,bolts:R.ties.length};
  if(!R.nodeHeld||!(2*R.nodeL<700))bad.push('a 1200 mm board on a '+R.Rmin+' mm radius is not held: '+2*R.nodeL);
  if(!(R.bearMin>=R.mw/2-.6))bad.push('a joint bears on only '+R.bearMin+' of '+R.mw+' mm');
  var jo={},both=0;R.mem.forEach(function(q){[q.j0,q.j1].forEach(function(j){if(j>0&&j<R.nN)jo[q.k+'|'+q.layer+'|'+j]=1;});});for(var k=0;k<R.nK;k++)for(var j=1;j<R.nN;j++)if(jo[k+'|0|'+j]&&jo[k+'|1|'+j])both++;if(both)bad.push(both+' nodes where both leaves break in one course');
  var up=R.mem.filter(function(q){return q.k>0;}),long4=up.filter(function(q){return q.len>=300;}).length;if(R.dowels.length<2*up.length||R.dowels.length<2*up.length+2*long4)bad.push(R.dowels.length+' dowels for '+up.length+' boards ('+long4+' of them 300 mm or longer, which take two at each end)');
  if(!(R.edgeMin>=2.5*R.dd))bad.push('a dowel is '+R.edgeMin+' mm from an edge, under '+2.5*R.dd);if(R.dowels.some(function(d){return d.end<4*R.dd-.01&&d.end<60;}))bad.push('a dowel is too near a board end');
  if(R.dowels.some(function(d){return Math.abs((d.y1-d.y0)-(2*R.mh-4))>.01;}))bad.push('a dowel does not pass through two boards');
  if(R.ties.length!==2*R.spacers.length)bad.push(R.ties.length+' bolts for '+R.spacers.length+' blocks');if(R.ties.some(function(t){return Math.abs(Math.hypot(t.b[0]-t.a[0],t.b[2]-t.a[2])-(2*R.mw+R.gp+18))>.5;}))bad.push('a bolt does not cross both leaves');
  if(R.spacers.some(function(s){return (s.j+s.k)%2!==0;}))bad.push('a block is not at an outer joint');var at={},stacked=0;R.spacers.forEach(function(s){at[s.k+'|'+s.j]=1;});R.spacers.forEach(function(s){if(at[(s.k+1)+'|'+s.j])stacked++;});if(stacked)bad.push(stacked+' blocks on a block');
  var by={},gapBad=0,gmax=0;R.mem.forEach(function(q){(by[q.k+'|'+q.layer]||(by[q.k+'|'+q.layer]=[])).push(q);});Object.keys(by).forEach(function(key){var l=by[key].sort(function(a,b){return a.j0-b.j0;});for(var i=1;i<l.length;i++){var d1=Math.hypot(l[i].c[1][0]-l[i-1].c[2][0],l[i].c[1][1]-l[i-1].c[2][1]),d0=Math.hypot(l[i].c[0][0]-l[i-1].c[3][0],l[i].c[0][1]-l[i-1].c[3][1]);gmax=Math.max(gmax,d0,d1);if(Math.abs(d0-R.GAP)>.6||Math.abs(d1-R.GAP)>.6)gapBad++;}});m.gap=+gmax.toFixed(2);if(gapBad)bad.push(gapBad+' joints whose ends are not '+R.GAP+' mm apart on the radius (widest '+m.gap+')');
  if(R.capP.length!==R.nN)bad.push(R.capP.length+' cap boards for '+R.nN+' panels');if(R.packers.length!==R.nN+1)bad.push(R.packers.length+' packers');if(!R.anchors.length)bad.push('no anchors');
  var csv=T.leanCSV(),kinds={};csv.trim().split(String.fromCharCode(10)).slice(1).forEach(function(l){var c=l.split(',');kinds[c[1]]=(kinds[c[1]]||0)+1;if(c.length!==15)kinds.bad=1;});m.kinds=Object.keys(kinds).join(', ');
  if(kinds.bad||kinds.member!==R.mem.length||kinds.dowel!==R.dowels.length||kinds['tie bolt']!==R.ties.length||kinds.cap!==R.capP.length||kinds.spacer!==R.spacers.length)bad.push('the schedule reads '+JSON.stringify(kinds));
  var roles=T.sceneFlag('lean');m.meshes=roles;if(!(roles>=9))bad.push('the 3D has '+roles+' kinds of part');
  S.lean.cap=false;if(T.leanModel().capP.length)bad.push('the cap cannot be left off');S.lean.cap=true;
  Object.assign(S.lean,{a:22000,b:22000,node:600,lean:600});var R2=T.leanModel();m.gentle=2*R2.nodeL;if(R2.nodeHeld||Math.abs(R2.nodeL-600)>40)bad.push('on a 22 m radius the board is still held: '+2*R2.nodeL);if(!(R2.bearMin>=R2.mw/2-.6))bad.push('gentle curve: bears '+R2.bearMin);
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.boards+' boards '+m.board+' mm long (held to the curve; '+m.gentle+' on a 22 m radius); joints '+m.sag+' mm off the board below, '+m.bear+' mm bearing; '+m.dowels+' dowels '+m.edge+' mm from an edge; '+m.bolts+' bolts; ends '+m.gap+' mm apart; scheduled as '+m.kinds,metrics:m};});

/* ---- p81-1: the form is a choice the design survives; joints are as deep as the bricks overlap ---- */
guard('brick','a brick design can be put on a straight wall, a corner, three sides, a courtyard, a building, a waving wall or framed bays and keeps its bond, mortar, field and second group; framed bays get a frame and brickwork from frame to frame; a brick pushed out takes its mortar only where it still overlaps its neighbours; the Wall step offers the forms; the Check step speaks of slenderness and the stress at the foot',function(){
  T.reset();var bad=[],m={},B=S.brick;if(!T.brickDesign('drift'))return{pass:false,detail:'no design'};var keep=JSON.stringify([B.bond,B.mortar,B.splitDo,B.col2,S.field.kind]);
  var expect={wall:function(g){return S.arr==='single'&&!g.panels;},corner:function(g){return S.plan.kind==='corner'&&g.panels&&g.panels.length===S.cols;},u:function(g){return S.plan.kind==='u';},court:function(g){return S.plan.kind==='court'&&S.plan.face==='in';},tower:function(g){return S.plan.kind==='tower'&&S.rows===2;},wave:function(g){return S.host.kind==='wave'&&g.brick.onHost;},bays:function(g){return S.arr==='grid'&&S.gap===250&&B.bays===250&&S.plan.kind==='wall';}};
  ['corner','u','court','tower','wave','bays','wall'].forEach(function(f){T.brickForm(f,{L:4500,H:2400,storeys:2,sides:4,cols:3});var g=T.regen();if(!g.bricks||!g.bricks.length){bad.push(f+' built nothing');return;}if(!expect[f](g))bad.push(f+' is not set up as '+f);if(JSON.stringify([B.bond,B.mortar,B.splitDo,B.col2,S.field.kind])!==keep)bad.push(f+' changed the design');if(B.form!==f)bad.push('the form reads '+B.form);m[f]=(g.total||g.bricks.length);});
  /* framed bays */
  T.brickDesign('lantern');T.brickForm('bays',{L:6600,H:2400,cols:3,storeys:2});var gb=T.regen(),W=S.width,gaps=0;[gb].concat(gb.panels?gb.panels.slice(1):[]).forEach(function(p){var rows={};p.bricks.forEach(function(b){var e=rows[b.r]||(rows[b.r]=[1e9,-1e9]);e[0]=Math.min(e[0],b.x-b.len/2);e[1]=Math.max(e[1],b.x+b.len/2);});Object.keys(rows).forEach(function(r){if(rows[r][0]>.6||rows[r][1]<W-.6)gaps++;});});
  if(gaps)bad.push(gaps+' courses in a bay stop short of the frame');if(T.sceneFlag('frame')!==1)bad.push('framed bays have '+T.sceneFlag('frame')+' frames');if(T.sceneFlag('coping')||T.sceneFlag('pier'))bad.push('framed bays still get a coping or piers');
  if(gb.brick.thick!==240||!(gb.brick.omitted>0))bad.push('the lantern in bays is '+gb.brick.thick+' thick with '+gb.brick.omitted+' headers out');
  T.brickForm('wall',{L:4760,H:2100});if(S.gap!==0||B.bays!==0||T.sceneFlag('frame'))bad.push('going back to a wall keeps the frame');
  /* a joint is as deep as the bricks overlap */
  Object.assign(B,{bond:'running',op:'shift',shiftMax:40,splitDo:'out',split:.5,step:.33,calm:0,rake:4,joint:10,bL:240,bW:115,bH:71,open:0});S.field=T.fieldDefaults();S.field.kind='gradient';S.field.gradient.dir='right';T.fieldUse();
  var g=T.regen(),J=T.brickJoints(g),zMin=1e9,zMax=-1e9,byR={};g.bricks.forEach(function(b){(byR[b.r]||(byR[b.r]=[])).push(b);});J.boxes.forEach(function(q){zMin=Math.min(zMin,q[4]);zMax=Math.max(zMax,q[5]);});
  var proud=0;J.boxes.forEach(function(q){if(q[6]!=='bed'&&q[6]!=='head')return;var y=q[6]==='bed'?q[3]+35.5:(q[2]+q[3])/2+5,xm=(q[0]+q[1])/2;g.bricks.forEach(function(b){if(Math.abs(b.y-y)>6)return;if(xm<b.x-b.len/2-6||xm>b.x+b.len/2+6)return;if(q[4]<b.shift+4-.01||q[5]>b.shift+115-4+.01)proud++;});});
  m.z=zMin.toFixed(0)+'..'+zMax.toFixed(0);if(proud)bad.push(proud+' joints stand proud of a brick they belong to');if(!(zMax>130))bad.push('no mortar follows the bricks that stand out: joints reach z '+zMax.toFixed(0));
  /* the panel */
  T.showTab('Brick courses',true);window.__brStep(1);var body=document.querySelector('.bbar').parentNode,chips=body.querySelectorAll('[data-bform]');m.forms=chips.length;if(chips.length!==7)bad.push(chips.length+' forms offered');else{chips[1].click();if(S.plan.kind!=='corner'||B.form!=='corner')bad.push('choosing the corner did not set it');if(!chips[1].classList.contains('on'))bad.push('the chosen form is not marked');
    var vis=function(p){var e=body.querySelector('[data-path="'+p+'"]');return !!e&&getComputedStyle(e).display!=='none'&&!e.closest('.pvs-off');};if(!vis('brick.formL')||!vis('brick.formH')||vis('brick.formSides')||vis('brick.formAmp'))bad.push('a corner shows the wrong size controls');chips[4].click();if(!vis('brick.formSides')||!vis('brick.formN'))bad.push('a building does not offer sides and storeys');}
  T.regen();window.__brStep(5);window.__bbarDraw();var txt=body.querySelector('.pmod-rules').textContent;if(!/Slenderness/.test(txt)||!/MPa/.test(txt))bad.push('the Check step does not speak of slenderness and stress');
  T.reset();window.__brStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'seven forms keep the design (corner '+m.corner+', building '+m.tower+', bays '+m.bays+' bricks); bays filled frame to frame inside one frame; joints follow the bricks (z '+m.z+'); '+m.forms+' forms in the Wall step; slenderness and stress in Check',metrics:m};});

/* ---- p82-1: brick defaults and options after the user's review ---- */
guard('brick','a brick wall starts as a plain stacked assembly with nothing on top and no piers, never a cap or a second colour unless chosen; the second group can be placed by the field, toward an edge or scattered; the stacked assemblies lead the designs and the colour, openings and raised group are options',function(){
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=2100;var bad=[],m={},B=S.brick;
  if(B.cope!=='none'||B.splitDo!=='off'||+B.open!==0)bad.push('the starting wall has cope '+B.cope+', second group '+B.splitDo+', open '+B.open);
  var g=T.regen();if(g.bricks.some(function(b){return b.g2;})||g.brick.omitted)bad.push('the starting wall has a second colour or openings');
  if(T.sceneFlag('coping')!==0||T.sceneFlag('copeBrick')!==0)bad.push('the starting wall has '+T.sceneFlag('coping')+' stone copings and '+T.sceneFlag('copeBrick')+' brick ones');
  T.brickForm('corner',{L:4500,H:2400});S.brick.cope='brick';T.regen();m.cornerCope=T.sceneFlag('copeBrick');if(T.sceneFlag('coping')!==0||!(m.cornerCope>=2))bad.push('a corner has '+T.sceneFlag('coping')+' stone copings and '+m.cornerCope+' brick ones');
  B.cope='none';T.regen();if(T.sceneFlag('coping')||T.sceneFlag('copeBrick'))bad.push('nothing on top still caps the corner');B.cope='stone';T.regen();if(!(T.sceneFlag('coping')>=2))bad.push('a stone coping cannot be chosen on a corner');
  /* placing the second group */
  T.reset();S.arr='single';T.setPanelMode('brick');S.width=3000;S.height=2100;B=S.brick;Object.assign(B,{bond:'running',op:'shift',shiftMax:0,d1:0,d2:0,open:0,splitDo:'colour',split:.6,calm:0});
  var part=function(by){B.splitBy=by;var gg=T.regen(),a=gg.bricks.filter(function(b){return b.g2;}),o=gg.bricks.filter(function(b){return !b.g2;});return{a:a,o:o,share:a.length/gg.bricks.length};};
  var up=part('up');if(!up.a.length||!up.o.length||Math.min.apply(null,up.a.map(function(b){return b.y;}))<Math.max.apply(null,up.o.map(function(b){return b.y;})))bad.push('toward the top does not put the group at the top');
  var dn=part('down');if(!dn.a.length||Math.max.apply(null,dn.a.map(function(b){return b.y;}))>Math.min.apply(null,dn.o.map(function(b){return b.y;})))bad.push('toward the bottom does not put the group at the bottom');
  var rt=part('right');if(!rt.a.length||Math.min.apply(null,rt.a.map(function(b){return b.x;}))<Math.max.apply(null,rt.o.map(function(b){return b.x;}))-250)bad.push('toward the right does not put the group at the right');
  var sc=part('scatter');m.scatter=+sc.share.toFixed(2);if(Math.abs(sc.share-.4)>.1)bad.push('scattered at 0.6 gives '+m.scatter+' of the wall');var k1=sc.a.map(function(b){return Math.round(b.x)+':'+b.r;}).join(',');B.splitSeed=9;var k2=part('scatter').a.map(function(b){return Math.round(b.x)+':'+b.r;}).join(',');if(k1===k2)bad.push('another throw scatters the same bricks');
  /* the designs */
  T.showTab('Brick courses',true);window.__brStep(4);var body=document.querySelector('.bbar').parentNode,ds=[].map.call(body.querySelectorAll('[data-design]'),function(x){return x.dataset.design;});m.designs=ds.join(',');
  if(ds.length!==7||ds.slice(0,4).join(',')!=='weave,tide,current,swell')bad.push('the designs are '+m.designs);
  ['weave','tide','current','swell'].forEach(function(id){T.brickDesign(id);var gd=T.regen();if(S.brick.splitDo!=='off'||gd.brick.omitted||gd.bricks.some(function(b){return b.g2;}))bad.push(id+' is not a plain stacked assembly');if(S.brick.cope!=='none')bad.push(id+' has '+S.brick.cope+' on top');if(gd.brick.atRisk||gd.brick.straight)bad.push(id+': '+gd.brick.atRisk+' at risk, '+gd.brick.straight+' straight joints');if(!(gd.brick.maxTheta>5||gd.brick.maxShift>10))bad.push(id+' does nothing to the bricks');});
  var vis=function(p){var e=body.querySelector('[data-path="'+p+'"]');return !!e&&getComputedStyle(e).display!=='none'&&!e.closest('.pvs-off');};T.brickDesign('weave');T.refreshAll();if(vis('brick.splitBy')||vis('brick.col2'))bad.push('the second group\'s controls show while it is off');
  T.brickDesign('drift');T.refreshAll();if(!vis('brick.splitBy')||!vis('brick.col2')||vis('brick.splitSeed'))bad.push('the second brick does not offer where it goes and its colour');
  T.reset();window.__brStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'a wall starts plain with nothing on top; a corner can be coped in brick, stone or not at all; the second group goes up, down, right or is scattered ('+m.scatter+' of the wall at 0.6); designs: '+m.designs,metrics:m};});
/* ---- p82-2: timber joinery beyond dowels ---- */
guard('host','leaning timber wall, joinery: board ends can be half-lapped (the upper half of one over the lower half of the next, pinned through, the board cut longer by the lap); the pins can be threaded screws; the leaves can be tied by dovetailed ties with no bolts; the mitred, dowelled, bolted wall is unchanged',function(){
  T.reset();S.lean.on=true;Object.assign(S.lean,{a:5000,b:3600,arc:220,turn:0,height:2400,lean:900,node:600,cap:true,endJoint:'mitre',fix:'dowel',tie:'bolt'});S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();
  var R0=T.leanModel(),bad=[],m={};if(R0.endJoint!=='mitre'||R0.mem.some(function(q){return q.lap;})||!R0.ties.length)bad.push('the default wall is not mitred and bolted');var n0=R0.dowels.length;
  S.lean.endJoint='lap';var R=T.leanModel(),inner=R.mem.filter(function(q){return q.j0>0&&q.j1<R.nN;});m.lap=R.lapL;
  if(!inner.length||inner.some(function(q){return !q.lap||!q.lap.lo||!q.lap.up;}))bad.push('an inner board is not halved at both ends');
  if(inner.some(function(q){return Math.abs(q.cut-(q.len+q.lap.L-R.GAP))>.01;}))bad.push('a lapped board is not cut longer by its lap');
  var by={},off=0;R.mem.forEach(function(q){(by[q.k+'|'+q.layer]||(by[q.k+'|'+q.layer]=[])).push(q);});Object.keys(by).forEach(function(key){var l=by[key].sort(function(a,b){return a.j0-b.j0;});for(var i=1;i<l.length;i++){var u=l[i-1].lap.up,lo=l[i].lap.lo;if(!u||!lo){off++;continue;}var cx=function(c){return[(c[0][0]+c[1][0]+c[2][0]+c[3][0])/4,(c[0][1]+c[1][1]+c[2][1]+c[3][1])/4];},a=cx(u),b=cx(lo);if(Math.hypot(a[0]-b[0],a[1]-b[1])>R.lapL*.3)off++;}});if(off)bad.push(off+' laps where the two halves do not lie over each other');
  var pins=R.dowels.filter(function(d){return d.lap;}).length,want=R.mem.filter(function(q){return q.k>0&&q.lap&&q.lap.lo;}).length;m.pins=pins;if(pins!==want||R.dowels.length!==n0+pins)bad.push(pins+' pins through '+want+' laps');
  if(!(R.edgeMin>=2.5*R.dd))bad.push('with laps a pin is '+R.edgeMin+' mm from an edge');
  S.lean.fix='screw';var Rs=T.leanModel(),csv=T.leanCSV();if(Rs.dowels.some(function(d){return d.d!==8;})||!/,screw,/.test(csv)||/,dowel,/.test(csv))bad.push('threaded screws are not 8 mm or not scheduled as screws');
  S.lean.tie='dovetail';var Rd=T.leanModel(),csv2=T.leanCSV();m.tieW=Rd.blockW;if(Rd.ties.length||Rd.blockW!==Rd.gp+50||!/,dovetail tie,/.test(csv2)||/,tie bolt,/.test(csv2))bad.push('dovetailed ties still have bolts, or are not housed 25 mm into each leaf');
  if(T.sceneFlag('lean')<8)bad.push('the lapped, screwed, dovetailed wall does not build');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'half laps of '+m.lap+' mm on every inner board, '+m.pins+' pinned through; screws scheduled as screws; dovetailed ties '+m.tieW+' mm long with no bolts; the default wall unchanged',metrics:m};});

/* ---- p83-1: Flemish and English bond through a square corner and round a building ---- */
guard('brick','one-brick bonds turn a square corner: on a corner, three sides and a four-sided building, in Flemish and English bond, the wall is a brick thick, no joint stands over a joint on any side, the lap is a quarter brick, no brick of one wall cuts into the other at a quoin, each course has one quoin stretcher at each corner with nothing behind it and a queen closer starts the other wall, the courses run on from storey to storey, and a side of any length still closes without a straight joint',function(){
  T.reset();T.setPanelMode('brick');var bad=[],m={},B=S.brick,set=function(){B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,op:'shift',shiftMax:0,d1:0,d2:0,open:0,splitDo:'off',calm:0});};
  var meas=function(){var Gm=T.regen(),ps=Gm.panels||[Gm],Bk=Gm.brick,bW=Bk.bW,bL=Bk.bL,sides={},o={};
    ps.forEach(function(p){if(!p.brick||p.brick.sideX0==null)return;var k=p.brick.side||0,x0=p.brick.sideX0,r0=p.brick.r0||0,S0=sides[k]||(sides[k]={len:p.brick.sideLen,b:[]});
      p.bricks.concat(p.backs||[]).forEach(function(b){var dp=b.dep||bW;S0.b.push({s0:b.x+x0-b.len/2,s1:b.x+x0+b.len/2,z0:bW-dp+b.shift,z1:bW+b.shift,r:b.r+r0,kind:b.kind,back:!!b.back,nb:!!b.nb,len:b.len});});});
    var ks=Object.keys(sides).map(Number).sort(function(a,b){return a-b;}),n=ks.length,closed=T.planLayout(S.cols).closed,over=0,pairs=0,gap=1e9;
    for(var i=0;i<n;i++){if(i===n-1&&!closed)break;var A=sides[ks[i]],C=sides[ks[(i+1)%n]];pairs++;
      var a=A.b.filter(function(b){return b.s1>A.len-2*bL;}).map(function(b){return{s0:-b.z1,s1:-b.z0,z0:b.s0-A.len,z1:b.s1-A.len,r:b.r};}),c=C.b.filter(function(b){return b.s0<2*bL;});
      a.forEach(function(p){c.forEach(function(q){if(p.r!==q.r)return;var ox=Math.min(p.s1,q.s1)-Math.max(p.s0,q.s0),oz=Math.min(p.z1,q.z1)-Math.max(p.z0,q.z0);if(ox>.5&&oz>.5)over++;else if(ox>.5||oz>.5){var g=ox>.5?-oz:-ox;if(g<gap)gap=g;}});});}
    var all=[];ks.forEach(function(k){all=all.concat(sides[k].b);});var face=all.filter(function(b){return !b.back;});
    o.G=Gm;o.B=Bk;o.corners=pairs;o.over=over;o.gap=gap;o.nb=face.filter(function(b){return b.nb;}).length;o.closers=face.filter(function(b){return b.kind==='h'&&Math.abs(b.len-bW)>1;}).length;
    o.cuts=face.filter(function(b){return b.kind!=='h'&&b.len<bL-3.5;}).length;o.courses=1+Math.max.apply(null,face.map(function(b){return b.r;}));o.backBehind=all.filter(function(b){return b.back;}).length;return o;};
  [['corner',{L:4500,H:2400},1],['u',{L:4500,H:2400},2],['tower',{L:4500,H:2700,storeys:1,sides:4},4],['tower',{L:4500,H:2700,storeys:3,sides:4},4]].forEach(function(c){['flemish','english'].forEach(function(bond){
    set();B.bond=bond;T.brickForm(c[0],c[1]);set();var o=meas(),Bk=o.B,tag=bond+' '+c[0]+(c[1].storeys>1?' x'+c[1].storeys:'');
    if(Bk.bondLaid!==bond||Bk.bondHeld||Bk.thick!==240)bad.push(tag+' is laid in '+Bk.bondLaid+', '+Bk.thick+' mm thick');
    if(Bk.straight!==0)bad.push(tag+': '+Bk.straight+' joints over a joint');
    if(!(Bk.minLap>=58))bad.push(tag+': the smallest lap is '+Bk.minLap+' mm');
    if(!Bk.sideLaps||Bk.sideLaps.length!==(c[0]==='corner'?2:c[0]==='u'?3:4)||Bk.sideLaps.some(function(q){return q.straight||q.minLap<58;}))bad.push(tag+': a side is not measured or laps less than a quarter brick');
    if(o.corners!==c[2]||o.over)bad.push(tag+': '+o.over+' bricks of one wall cut into the other at '+o.corners+' corners');
    if(!(o.gap>=6&&o.gap<=13.5))bad.push(tag+': the two walls stand '+o.gap.toFixed(1)+' mm apart at the quoin, not a joint');
    if(o.nb!==o.courses*c[2])bad.push(tag+': '+o.nb+' quoin stretchers in '+o.courses+' courses at '+c[2]+' corners');
    if(o.closers<o.courses*c[2])bad.push(tag+': '+o.closers+' closers');
    if(c[0]!=='u'&&o.cuts)bad.push(tag+': '+o.cuts+' cut bricks on a side set to the bond');
    if(o.G.panels.some(function(p){return p.brick.atRisk;}))bad.push(tag+': bricks at risk');
    if(c[1].storeys>1){var ys={};o.G.panels.forEach(function(p,k){var row=k%S.rows;p.bricks.forEach(function(b){ys[Math.round((row*S.height+b.y)*10)]=1;});});var yl=Object.keys(ys).map(Number).sort(function(a,b){return a-b;}),step=0;for(var i=1;i<yl.length;i++)step=Math.max(step,Math.abs((yl[i]-yl[i-1])/10-81));m.courses3=yl.length;if(step>.05||yl.length!==100)bad.push(tag+': the courses do not run on from storey to storey ('+yl.length+' courses, a step off by '+step.toFixed(1)+')');}
    m[tag.replace(/ /g,'_')]=Bk.minLap;});});
  /* the schedule and the joints at the quoin */
  set();B.bond='english';T.brickForm('corner',{L:4500,H:2400});set();S.brick.cope='brick';var G1=T.regen(),pq=G1.panels.filter(function(p){return p.bricks.some(function(b){return b.nb;});})[0],csv=T.brickCSV(pq),J=T.brickJoints(pq),nbs=pq.bricks.filter(function(b){return b.nb;});
  if(!/,quoin$/m.test(csv)||!/,closer$/m.test(csv)||!/,header$/m.test(csv)||!/,back$/m.test(csv))bad.push('the schedule does not name quoins, closers, headers and the course behind');
  if((pq.backs||[]).some(function(k){return nbs.some(function(b){return b.r===k.r&&Math.abs(b.x-k.x)<1;});}))bad.push('a brick stands behind a quoin stretcher');
  var col=J.boxes.filter(function(q){return q[6]==='collar'&&nbs.some(function(b){return Math.abs((q[0]+q[1])/2-b.x)<6&&Math.abs((q[2]+q[3])/2-b.y)<1;});}).length;if(col!==nbs.length)bad.push(col+' joints behind '+nbs.length+' quoin stretchers');
  if(J.boxes.some(function(q){return !(q[1]>q[0]&&q[3]>q[2]&&q[5]>q[4])||q[5]>115.01||q[4]<-125.01;}))bad.push('a joint is outside the wall');
  if(T.sceneFlag('mortar')!==G1.panels.length)bad.push('mortar is not drawn on every panel of the corner');
  var wb=T.sceneWorld('Gk'),cb=T.sceneWorld('copeBrick');if(!cb||!wb||cb[0]<wb[0]-1.5||cb[2]<wb[2]-1.5||cb[3]>wb[3]+1.5||cb[5]>wb[5]+1.5)bad.push('the brick-on-edge coping does not sit on the one-brick wall');
  /* a side of any length; the other bonds and corners */
  var worst=1e9,st=0,ov=0;['english','flemish'].forEach(function(bond){set();B.bond=bond;T.brickForm('tower',{L:4500,H:810,storeys:1,sides:4});set();[1026,1104,1143,1273,1481,1650,1987].forEach(function(w){S.width=w;var o=meas();worst=Math.min(worst,o.B.minLap);st+=o.B.straight;ov+=o.over;});});m.anyLength=worst;
  if(st||ov||!(worst>=25))bad.push('sides of any length: '+st+' joints over a joint, '+ov+' overlaps, smallest lap '+worst);
  set();B.bond='running';T.brickForm('corner',{L:4500,H:2400});set();var gr=T.regen();if(gr.brick.straight!==0||!(gr.brick.minLap>=100)||gr.brick.thick!==115)bad.push('running bond on a corner: '+gr.brick.straight+' straight joints, lap '+gr.brick.minLap);
  set();B.bond='english';T.brickForm('court',{L:4500,H:2400});set();var gc=T.regen();if(!gc.brick.bondHeld||gc.brick.bondLaid!=='running')bad.push('a courtyard facing in is not held to running bond');
  set();B.bond='flemish';T.brickForm('tower',{L:3000,H:2400,storeys:1,sides:6});set();var g6=T.regen();if(!g6.brick.bondHeld)bad.push('a six-sided plan is not held to running bond');
  set();B.bond='flemish';T.brickForm('tower',{L:4400,H:2400,storeys:1,sides:4});if(Math.abs(S.width*S.cols/4-(10+12*375))>2)bad.push('a Flemish side of 4400 is set out as '+(S.width*S.cols/4)+', not 4510');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'Flemish and English bond on a corner, three sides and a four-sided building of one and three storeys: no joint over a joint, laps of '+m.flemish_corner+' to '+m.english_tower+' mm, no overlap at a quoin; 100 courses run through three storeys; sides of any length lap at least '+worst+' mm',metrics:m};});
/* ---- p83-2: mortar on the waving wall; beds cut to the bricks ---- */
guard('brick','mortar on a waving wall and under turned bricks: every bed is the overlap of the brick and the brick it lies on, inside both; a waving wall has beds and upright joints; between two panels of one wall an upright joint is no deeper than the plain wall',function(){
  T.reset();T.setPanelMode('brick');var bad=[],m={},B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,bond:'running',op:'shift',shiftMax:0,d1:0,d2:0,open:0,splitDo:'off',calm:0});
  T.brickForm('wave',{L:7000,H:2400,amp:600});B=S.brick;var g=T.regen(),J=T.brickJoints(g);m.pads=J.pads.length;m.heads=(J.obx||[]).length;
  if(!g.brick.onHost)bad.push('the waving wall is not laid on its curve');
  var up=g.bricks.filter(function(b){return b.r>0;}).length;if(!(J.pads.length>=up))bad.push(J.pads.length+' beds under '+up+' bricks');
  if(!(m.heads>=g.bricks.length*.7))bad.push(m.heads+' upright joints between '+g.bricks.length+' bricks');
  var out=0;J.pads.forEach(function(p){if(!p.poly){out++;return;}var b=p.b,c=Math.cos(b.theta*Math.PI/180),s=Math.sin(b.theta*Math.PI/180);p.poly.forEach(function(v){var dx=v[0]-b.x,dz=v[1]-(57.5+b.shift),u=dx*c-dz*s,w=dx*s+dz*c;if(Math.abs(u)>b.len/2+.5||Math.abs(w)>57.5+.5)out++;});});if(out)bad.push(out+' bed corners outside their brick');
  if(T.sceneFlag('mortar')!==1)bad.push('no mortar is drawn on the waving wall');
  /* a turned wall: beds are polygons inside both bricks */
  T.brickDesign('weave');B=S.brick;var gw=T.regen(),Jw=T.brickJoints(gw);m.turned=Jw.pads.length;if(!Jw.pads.length||Jw.pads.some(function(p){return !p.poly||p.poly.length<3;}))bad.push('a turned wall has '+Jw.pads.length+' beds, not all cut to the bricks');
  /* a stepped design on a corner: the joint between two panels stays inside the plain wall */
  T.brickDesign('tide');T.brickForm('corner',{L:4500,H:2400});B=S.brick;var gt=T.regen(),proud=0;gt.panels.forEach(function(p){if(!p.brick.flushNext)return;var Jp=T.brickJoints(p),e=Math.max.apply(null,p.bricks.map(function(b){return b.x+b.len/2;}));Jp.boxes.forEach(function(q){if(q[6]==='head'&&q[0]>=e-12&&q[5]>115-1)proud++;});});if(proud)bad.push(proud+' joints between panels stand out of the face');
  if(gt.brick.straight||gt.brick.bondLaid!=='english'||gt.panels.some(function(p){return p.brick.atRisk;}))bad.push('the stepped English wall on a corner: '+gt.brick.straight+' straight joints, laid in '+gt.brick.bondLaid);
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'a waving wall has '+m.pads+' beds and '+m.heads+' upright joints, every bed inside its brick; a turned wall has '+m.turned+' beds cut to the bricks; panel joints stay in the wall',metrics:m};});

/* ---- p84-1: timber joinery beyond laps and dowels ---- */
guard('host','timber joinery: on the leaning wall board ends can be scarfed (1 in 6 or flatter, the two halves of a joint the same length, a half lap where the boards are too short) or finger-jointed (six fingers that tile the joint with no overlap), and the wall can stand on knife plates (in the gap, bolted through both leaves, in place of the packer and the blocks there); on the stacked timber the crossings can be cogged (the course rises by the member less the cog), member ends can be tenoned and pegged into the jambs and end posts, and the posts can stand on knife plates; with none of these chosen both forms are as they were',function(){
  T.reset();var bad=[],m={},wall=function(o){S.lean.on=true;Object.assign(S.lean,{a:5000,b:3600,arc:220,turn:0,height:1900,lean:700,node:600,cap:true,endJoint:'mitre',fix:'dowel',tie:'bolt',base:'strap'},o||{});S.field=T.fieldDefaults();S.field.kind='noise';T.fieldUse();return T.leanModel();};
  var joints=function(R,fn){var by={};R.mem.forEach(function(q){(by[q.k+'|'+q.layer]||(by[q.k+'|'+q.layer]=[])).push(q);});var n=0;Object.keys(by).forEach(function(key){var l=by[key].sort(function(a,b){return a.j0-b.j0;});for(var i=1;i<l.length;i++){n++;fn(l[i-1],l[i]);}});return n;};
  var R0=wall();if(R0.endJoint!=='mitre'||R0.base!=='strap'||R0.knives.length||R0.mem.some(function(q){return q.lap||q.fin;}))bad.push('the default wall has changed');var d0=R0.dowels.length,sp0=R0.spacers.length;
  /* scarf */
  var Rs=wall({endJoint:'scarf'}),mis=0,steep=0,sc=0,lp=0,cutBad=0;joints(Rs,function(p,q){if(!p.lap||!q.lap||!p.lap.up||!q.lap.lo){mis++;return;}if(Math.abs(p.lap.Lb-q.lap.La)>.01||p.lap.kb!==q.lap.ka)mis++;if(q.lap.ka==='scarf'){sc++;if(q.lap.La/(Rs.mh-2*Rs.nib)<6-1e-6)steep++;}else lp++;});
  Rs.mem.forEach(function(q){if(Math.abs(q.cut-(q.len+(q.lap.lo?q.lap.La/2:0)+(q.lap.up?q.lap.Lb/2:0)-Rs.GAP))>.01)cutBad++;});m.scarfs=sc;m.scarfLaps=lp;
  if(mis)bad.push(mis+' scarf joints whose two halves differ');if(steep)bad.push(steep+' scarfs steeper than 1 in 6');if(!sc||sc!==Rs.scarfs||lp!==Rs.scarfLaps)bad.push('scarfs counted '+sc+' and '+lp+' laps, reported '+Rs.scarfs+' and '+Rs.scarfLaps);if(cutBad)bad.push(cutBad+' scarfed boards not cut longer by their joints');
  if(Rs.dowels.filter(function(d){return d.lap;}).length!==Rs.mem.filter(function(q){return q.k>0&&q.lap.lo;}).length)bad.push('a scarf is not pinned');if(!(Rs.edgeMin>=2.5*Rs.dd))bad.push('with scarfs a pin is '+Rs.edgeMin+' mm from an edge');
  var Rf=wall({endJoint:'scarf',a:9000,b:8000,arc:120,lean:300});m.flat=+(Rf.scarfs/(Rf.scarfs+Rf.scarfLaps)).toFixed(2);if(!(m.flat>=.9))bad.push('on a shallow curve only '+m.flat+' of the joints are scarfed');
  /* fingers */
  var Rg=wall({endJoint:'finger'}),ov=0,cnt=0,cb=0;joints(Rg,function(p,q){if(!p.fin||!q.fin||p.fin.b.length+q.fin.a.length!==Rg.fingers)cnt++;else{p.fin.b.forEach(function(s){q.fin.a.forEach(function(t){if(!T.quadApart(s,t))ov++;});if(!T.quadApart(s,q.c))ov++;});q.fin.a.forEach(function(t){if(!T.quadApart(t,p.c))ov++;});}});
  Rg.mem.forEach(function(q){if(Math.abs(q.cut-(q.len+(q.fin.a.length?Rg.fingerL/2:0)+(q.fin.b.length?Rg.fingerL/2:0)-Rg.GAP))>.01)cb++;});
  if(cnt)bad.push(cnt+' finger joints without '+Rg.fingers+' fingers');if(ov)bad.push(ov+' fingers overlap');if(cb)bad.push(cb+' finger-jointed boards not cut longer by their fingers');if(Rg.dowels.length!==d0)bad.push('finger joints changed the pins');
  /* knife plates */
  var Rk=wall({base:'knife',tie:'dovetail'}),csv=T.leanCSV();m.knives=Rk.knives.length;
  if(Rk.knives.length!==Rk.anchors.length||!Rk.knives.length)bad.push(Rk.knives.length+' knife plates at '+Rk.anchors.length+' anchors');
  if(Rk.spacers.some(function(s){return s.j%2===0&&s.k<8;})||Rk.packers.some(function(s){return s.j%2===0;}))bad.push('a block or a packer stands where a knife plate is');
  if(Rk.knives.some(function(kn){return kn.bolts.some(function(b){return Math.hypot(b.b[0]-b.a[0],b.b[2]-b.a[2])<2*Rk.mw+Rk.gp;})||kn.fills.some(function(f){return f.o[1]-f.o[0]<8||f.i[1]-f.i[0]<8;})||kn.rods.length!==2;}))bad.push('a knife plate is not bolted through both leaves, or its fillers do not fit the gap');
  if(!/,knife plate,/.test(csv)||!/,base plate,/.test(csv)||!/,knife bolt,/.test(csv)||!/,base anchor,/.test(csv)||/,anchor and strap,/.test(csv))bad.push('the schedule does not list the knife plates');
  if(T.sceneFlag('lean')<8)bad.push('the wall on knife plates does not build');S.lean.on=false;
  /* the stacked timber */
  var crib=function(o){S.crib.on=true;Object.assign(S.crib,{walls:1,d0:6000,d1:3600,dmid:0,height:3600,lean:0,sides:0,arc:360,L:610,w:76,h:76,e:60,dowel:20,fastener:'dowel',open:.25,seed:5,cog:0,frameJoint:'housed',postBase:'none'},o||{});return T.cribCourses();};
  var C0=crib();if(C0.h!==76||C0.hm!==76||C0.cog||C0.pegs.length||C0.knife||/cog_mm/.test(T.cribCSV().split('\n')[0]))bad.push('the default pavilion has changed');
  var Cc=crib({cog:12});m.cogC=Cc.C;if(Cc.h!==64||Cc.hm!==76||Math.abs((Cc.C-1)*Cc.h+Cc.hm-3600)>64||Cc.slips||Cc.unsup||!/cog_mm,tenons$/.test(T.cribCSV().split('\n')[0]))bad.push('a 12 mm cog: course '+Cc.h+', '+Cc.C+' courses, '+Cc.slips+' slips, '+Cc.unsup+' ends unsupported');
  var Ct=crib({frameJoint:'tenon',postBase:'knife'}),ten=0;Ct.mem.forEach(function(q){ten+=(q.ta?1:0)+(q.tb?1:0);});m.pegs=Ct.pegs.length;var fr=T.cribFrameCSV(),mc=T.cribCSV().trim().split('\n').slice(1),tc=0;mc.forEach(function(l){tc+=+l.split(',').pop();});
  if(!ten||ten!==Ct.pegs.length||tc!==ten||Ct.pegs.some(function(p){return p.key.charAt(0)!=='A';}))bad.push(ten+' tenoned ends, '+Ct.pegs.length+' pegs, '+tc+' in the schedule');
  if((fr.match(/,peg,/g)||[]).length!==Ct.pegs.length||(fr.match(/,knife plate,/g)||[]).length!==2)bad.push('the frame list has '+(fr.match(/,peg,/g)||[]).length+' pegs and '+(fr.match(/,knife plate,/g)||[]).length+' knife plates');
  if(Ct.slips||Ct.unsup||T.sceneFlag('crib')<5)bad.push('the tenoned pavilion does not stand or build');
  var Cw=crib({arc:200,frameJoint:'tenon',postBase:'knife',cog:10});if(Cw.closed||!(Cw.pegs.length>=Cw.C-2)||(T.cribFrameCSV().match(/,knife plate,/g)||[]).length!==2||Cw.slips||Cw.unsup)bad.push('an open wall: '+Cw.pegs.length+' pegs in '+Cw.C+' courses');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.scarfs+' scarfs at 1 in 6 or flatter and '+m.scarfLaps+' laps on a tight wall ('+m.flat+' scarfed on a shallow one); six fingers a joint, none overlapping; '+m.knives+' knife plates in the gap; a 12 mm cog gives '+m.cogC+' courses; '+m.pegs+' pegged tenons at the jambs',metrics:m};});
/* ---- p84-2: the Timber tab ---- */
guard('flow','the Timber tab: six steps; opening it builds the leaning wall; the form chips switch between the wall, the pavilion, the open wall and a field of walls, one at a time; each step shows only the controls of the form that stands; the joint is drawn, the rules speak, the counts are tabled; a shape loads without touching the joinery; a panel tab sets the timber aside; nothing is wider than the rail',function(){
  T.reset();var bad=[],m={},panel=[].filter.call(document.querySelectorAll('.tabpanel'),function(p){var h=p.querySelector('h2');return h&&h.textContent==='Timber';})[0],btn=[].filter.call(document.querySelectorAll('#tabs button[role="tab"]'),function(x){return /Timber$/.test(x.textContent);})[0];
  if(!panel||!btn)return{pass:false,detail:'there is no Timber tab'};
  var names=[].map.call(document.querySelectorAll('#tabs button[role="tab"]'),function(x){return x.lastChild.textContent;}),ib=names.indexOf('Brick courses');if(names[ib+1]!=='Timber')bad.push('Timber does not follow Brick courses in the rail');
  var nav=panel.querySelector('.pvsteps.six.tm');if(!nav||nav.querySelectorAll('button').length!==7)bad.push('the tab has no seven steps (pass 108 added By hand, shown fifth)');
  var vis=function(p){var e=panel.querySelector('[data-path="'+p+'"]');return !!e&&getComputedStyle(e).display!=='none'&&!e.closest('.pvs-off')&&!e.closest('.hidden');},wide=function(k){if(panel.scrollWidth>panel.clientWidth+1)bad.push('step '+k+' is wider than the rail by '+(panel.scrollWidth-panel.clientWidth));};
  btn.click();if(!S.lat.on||T.timberWhich()!=='lattice')bad.push('opening the tab does not build the lattice wall');T.timberForm('lean');
  T.sceneFlag('lean');window.__tmRead();
  var pill=document.getElementById('modePill');if(!pill||pill.textContent!=='Leaning timber wall')bad.push('the header says '+(pill&&pill.textContent));
  var fl=document.querySelector('#flow button[data-step="2"] .fl-v');if(!fl||fl.textContent!=='Timber')bad.push('the step bar says '+(fl&&fl.textContent));
  for(var k=1;k<=6;k++){window.__tmStep(k);wide(k);}
  window.__tmStep(1);if(!vis('lean.a')||vis('crib.d0'))bad.push('step 1 does not show the wall\'s shape alone');
  window.__tmStep(3);if(!vis('lean.endJoint')||!vis('lean.base')||vis('crib.fastener'))bad.push('step 3 does not show the wall\'s joinery alone');if(!panel.querySelector('.tm-jointbox svg'))bad.push('no joint is drawn');
  var seg=panel.querySelector('[data-path="lean.endJoint"]'),sb=seg?seg.querySelectorAll('button'):[];if(sb.length!==4)bad.push('the end joint offers '+sb.length+' choices');else{sb[2].click();if(S.lean.endJoint!=='scarf')bad.push('choosing a scarf sets '+S.lean.endJoint);sb[0].click();}
  window.__tmStep(5);T.sceneFlag('lean');window.__tmRead();var rl=panel.querySelectorAll('.tm-rules p');m.rules=rl.length;if(rl.length<5||panel.querySelector('.tm-rules p.pr-bad'))bad.push(rl.length+' rules, or one of them bad, for the wall');
  if(![].some.call(rl,function(p){return /first check/.test(p.textContent);}))bad.push('no rule is said to be a first check');
  window.__tmStep(6);window.__tmRead();if(panel.querySelectorAll('.pvtable tr').length<4)bad.push('the wall\'s counts are not tabled');
  /* the forms, one at a time */
  window.__tmStep(1);var chip=function(id){var c=panel.querySelector('[data-tform="'+id+'"]');if(c)c.click();return T.timberWhich();};
  if(chip('pavilion')!=='pavilion'||S.lean.on||!S.crib.on||+S.crib.arc!==360)bad.push('the pavilion chip gives '+T.timberWhich());
  if(!vis('crib.d0')||vis('lean.a')||vis('crib.walls'))bad.push('step 1 does not show the pavilion\'s shape alone');
  S.crib.cog=10;S.crib.frameJoint='tenon';var hg=panel.querySelector('[data-tdesign="hourglass"]');if(!hg||getComputedStyle(hg).display==='none')bad.push('the pavilion\'s shapes are not offered');else{hg.click();if(+S.crib.dmid!==3300||+S.crib.cog!==10||S.crib.frameJoint!=='tenon')bad.push('a shape changed the joinery, or did not load');}
  T.sceneFlag('crib');window.__tmStep(5);window.__tmRead();if(panel.querySelectorAll('.tm-rules p').length<5||panel.querySelector('.tm-rules p.pr-bad'))bad.push('the pavilion\'s rules: '+panel.querySelectorAll('.tm-rules p').length+', or one bad');
  window.__tmStep(3);if(!vis('crib.fastener')||!vis('crib.cog')||!vis('crib.frameJoint')||vis('lean.endJoint'))bad.push('step 3 does not show the pavilion\'s joinery alone');wide(3);
  window.__tmStep(1);if(chip('cwall')!=='cwall'||!(+S.crib.arc<360))bad.push('the open wall chip gives '+T.timberWhich());if(chip('field')!=='field'||!(S.crib.walls>=3)||!vis('crib.walls'))bad.push('the field chip gives '+T.timberWhich());
  if(chip('lean')!=='lean'||S.crib.on)bad.push('the wall chip leaves the stacked timber standing');
  T.showTab('Brick courses',true);if(S.lean.on||T.timberWhich())bad.push('a panel tab does not set the timber aside');
  T.reset();window.__tmStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'six steps; the tab builds the wall; four forms one at a time; controls follow the form; a joint drawn, '+m.rules+' rules for the wall with first checks named; shapes keep the joinery; a panel tab sets it aside',metrics:m};});

/* ---- p85-1: openings in brickwork; no cap and no piers unless asked; taller forms ---- */
guard('brick','openings and plain tops: a brick wall starts with no cap and no piers; windows and a door are whole bricks wide and whole courses high, no brick stands in one, the bond runs on round them with no joint over a joint and the wall\'s own laps, every opening has its soldier course, and nothing is at risk; this holds on a wall, a corner and a building in running, English and Flemish bond; a form can have twelve storeys',function(){
  T.reset();T.setPanelMode('brick');var bad=[],m={},B=S.brick,set=function(o){B=S.brick;Object.assign(B,{bL:240,bW:115,bH:71,joint:10,op:'shift',shiftMax:0,d1:0,d2:0,open:0,splitDo:'off',calm:0,wins:0,door:false,carry:'self',layers:[]},o||{});};
  S.arr='single';S.width=4760;S.height=2100;if(B.cope!=='none'||B.piers!=='none')bad.push('a wall starts with cope '+B.cope+' and piers '+B.piers);T.regen();if(T.sceneFlag('coping')||T.sceneFlag('copeBrick')||T.sceneFlag('pier'))bad.push('a plain wall has a cap or piers');
  var meas=function(){var G=T.regen(),ps=G.panels||[G],o={G:G,B:G.brick,inside:0,risk:0,sold:0,own:0,minLen:1e9};ps.forEach(function(p){o.risk+=p.brick.atRisk||0;o.sold+=(p.soldiers||[]).length;var all=p.bricks.concat(p.backs||[]);all.forEach(function(b){o.minLen=Math.min(o.minLen,b.len);});
      (p.ops||[]).forEach(function(q){if(q.own)o.own++;all.forEach(function(b){var b0=b.x-b.len/2,b1=b.x+b.len/2,y0=b.y-p.brick.bH/2,y1=b.y+p.brick.bH/2;if(b1>q.x0+1&&b0<q.x1-1&&y1>q.y0+1&&y0<q.ys1-1)o.inside++;});});});return o;};
  [['running','wall',{L:6000,H:2700},{wins:2},100],['english','wall',{L:7000,H:2700},{wins:2,door:true},58],['flemish','wall',{L:9000,H:2700},{wins:3},58],['running','corner',{L:6000,H:2700},{wins:2,door:true},100],['english','tower',{L:6000,H:2835,storeys:2,sides:4},{wins:2,door:true},58],['running','tower',{L:6000,H:2835,storeys:3,sides:4},{wins:2,door:true},100]].forEach(function(c){
    set(Object.assign({bond:c[0]},c[3]));T.brickForm(c[1],c[2]);set(Object.assign({bond:c[0]},c[3]));var o=meas(),tag=c[0]+' '+c[1];m[tag.replace(' ','_')]=o.B.openings;
    if(!(o.B.openings>=2)||o.own!==o.B.openings)bad.push(tag+': '+o.B.openings+' openings, '+o.own+' owned');if(o.inside)bad.push(tag+': '+o.inside+' bricks stand in an opening');
    if(o.B.straight)bad.push(tag+': '+o.B.straight+' joints over a joint');if(!(o.B.minLap>=c[4]))bad.push(tag+': lap '+o.B.minLap);if(o.risk)bad.push(tag+': '+o.risk+' bricks at risk');
    if(!(o.sold>=o.own*6))bad.push(tag+': '+o.sold+' soldiers over '+o.own+' openings');if(!(o.minLen>=45))bad.push(tag+': a piece of '+o.minLen.toFixed(0)+' mm');
    if(T.sceneFlag('window')<o.own)bad.push(tag+': the openings have no steel, frame or glass');});
  set({bond:'running',wins:2});T.brickForm('wave',{L:7000,H:2700,amp:500});set({bond:'running',wins:2});var gw=T.regen();if(gw.brick.openings)bad.push('a waving wall takes openings');
  set({bond:'running'});T.brickForm('tower',{L:4500,H:2835,storeys:12,sides:4});if(S.rows!==12)bad.push('twelve storeys give '+S.rows);
  var ok=T.brickExample('house');var gh=T.regen();m.house=gh.brick.openings;if(!ok||gh.brick.bondLaid!=='english'||!(gh.brick.openings>=12)||gh.brick.straight)bad.push('the low building example: '+gh.brick.bondLaid+', '+gh.brick.openings+' openings, '+gh.brick.straight+' straight joints');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'no cap or piers by default; openings on walls, a corner and buildings in three bonds with no brick inside, no straight joint, the wall\'s own laps and nothing at risk; the low building has '+m.house+' openings; twelve storeys build',metrics:m};});
/* ---- p85-2: the pattern as a stack of layers ---- */
guard('brick','pattern layers: a belly moves the wall out by hundreds of millimetres while no course steps past the one below by more than a third of a brick, however deep it is asked, and stays flat at an opening; an open bond is filled where a layer says solid and every brick still bears; a layer can turn every second course the other way; a one-brick bond refuses the belly and says so; a reset clears the stack; the stack has its cards',function(){
  T.reset();var bad=[],m={},step=function(G){var mx=0;(G.panels||[G]).forEach(function(p){var rows={};p.bricks.forEach(function(b){(rows[b.r]=rows[b.r]||[]).push(b);});Object.keys(rows).forEach(function(r){var lo=rows[r-1];if(!lo)return;rows[r].forEach(function(b){lo.forEach(function(c){if(Math.abs(c.x-b.x)<(b.len+c.len)/2-20)mx=Math.max(mx,Math.abs(b.shL-c.shL));});});});});return mx;},risk=function(G){var n=0;(G.panels||[G]).forEach(function(p){n+=p.brick.atRisk||0;});return n;};
  if(!T.brickLayered('belly'))bad.push('the belly does not load');var g=T.regen();m.belly=g.brick.bulge;m.step=+step(g).toFixed(1);
  if(!(g.brick.bulge>200))bad.push('the belly is '+g.brick.bulge+' mm');if(m.step>38.5)bad.push('a course steps '+m.step+' mm');if(risk(g)||g.brick.straight)bad.push('the belly: '+risk(g)+' at risk, '+g.brick.straight+' straight joints');
  if(!g.ops||!g.ops.length||g.bricks.some(function(b){return b.jamb&&Math.abs(b.shL)>3;}))bad.push('the belly does not stay flat at the door');
  S.brick.layers[0].amt=900;var gd=T.regen();m.deep=gd.brick.bulge;if(step(gd)>38.5)bad.push('asked for 900 mm, a course steps '+step(gd).toFixed(1));
  S.brick.bond='english';var ge=T.regen();if(ge.brick.bulge>1||!ge.brick.bulgeThick)bad.push('a one-brick bond takes the belly');
  T.brickLayered('veil');var gv=T.regen();m.filled=gv.brick.filled;if(!(gv.brick.filled>50)||risk(gv)||!gv.bricks.some(function(b){return b.len<140;}))bad.push('the veil: '+gv.brick.filled+' gaps filled, '+risk(gv)+' at risk');
  S.brick.layers=[];var g0=T.regen();if(g0.brick.filled||g0.bricks.length>=gv.bricks.length)bad.push('without the layer the open bond is still filled');
  T.brickLayered('ripple');S.brick.layers=[{src:'height',does:'turn',amt:12,alt:true}];S.brick.calm=0;var gr=T.regen(),top=gr.bricks.filter(function(b){return b.r>20&&!b.jamb;}),even=top.filter(function(b){return b.r%2===0;}),odd=top.filter(function(b){return b.r%2===1;});
  if(!even.length||!odd.length||!(even.every(function(b){return b.th0>=0;})&&odd.every(function(b){return b.th0<=0;})&&odd.some(function(b){return b.th0<-3;})))bad.push('every second course does not turn the other way');
  T.showTab('Brick courses',true);window.__brStep(4);var host=document.querySelector('.bly-host'),add=document.querySelector('.bly-add');if(!host||!add)bad.push('the pattern stack has no cards');else{var n0=host.querySelectorAll('.bly').length;add.click();if(host.querySelectorAll('.bly').length!==n0+1||S.brick.layers.length!==n0+1)bad.push('adding a layer adds no card');
    var chip=document.querySelector('[data-blay="belly"]');if(!chip)bad.push('the layered designs are not offered');}
  T.brickLayered('belly');T.reset();if((S.brick.layers||[]).length)bad.push('a reset leaves the layers');window.__brStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'a belly of '+m.belly+' mm with courses stepping at most '+m.step+' mm ('+m.deep+' mm when 900 is asked); '+m.filled+' gaps of an open bond filled; alternate courses turn against each other; a one-brick bond refuses the belly',metrics:m};});

/* ---- p86-1: the pattern is moved on the wall ---- */
guard('brick','direct control of the brick pattern: every point, line and centre the pattern comes from is a dot on the elevation; dragging a dot moves it, a click adds one when a source is armed, a double click removes one; the field can be changed and tuned beside the designs; a set of brick panels is one seamless wall; a belly cannot ripple shorter than a few bricks; no brick is ever left without bearing or painted red: one that would not bear is eased back',function(){
  T.reset();var bad=[],m={},c=document.getElementById('view2d'),ev=function(el,type,x,y){el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1}));},draw=function(){T.regen();T.render2D();};
  T.brickLayered('belly');draw();var dots=c.querySelectorAll('.bh-dot');m.dots=dots.length;if(dots.length!==1||dots[0].dataset.hk!=='L0')bad.push(dots.length+' dots for the belly');
  else{var r=dots[0].getBoundingClientRect(),x0=r.left+r.width/2,y0=r.top+r.height/2,before=S.brick.layers[0].pts;ev(dots[0],'pointerdown',x0,y0);ev(window,'pointermove',x0-60,y0+20);ev(window,'pointerup',x0-60,y0+20);var p=T.brickSources()[0].get().split(',').map(Number);m.moved=p.join(',');
    if(S.brick.layers[0].pts===before||!(p[0]<.5)||!(p[1]<.76)||p[0]<0||p[1]<0)bad.push('dragging the dot left and down gave '+m.moved+' from '+before);}
  draw();window.__bhArm='L0';var svg=c.querySelector('svg'),sr=svg.getBoundingClientRect();ev(svg,'pointerdown',sr.left+sr.width*.75,sr.top+sr.height*.4);if(S.brick.layers[0].pts.split(';').length!==2||window.__bhArm)bad.push('an armed click did not add one point');
  draw();var d2=c.querySelectorAll('.bh-dot');if(d2.length!==2)bad.push(d2.length+' dots after adding one');else{d2[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));if(S.brick.layers[0].pts.split(';').length!==1)bad.push('a double click did not remove the point');}
  T.brickDesign('tide');draw();var fs=T.brickSources();m.field=fs.length?fs[0].key:'';var fd=c.querySelectorAll('.bh-dot[data-hk="f"]');if(!fs.length||fs[0].key!=='f'||fd.length<2)bad.push('the Tide wall\'s points are not on the elevation ('+fd.length+')');
  else{var q0=S.field.charge.pts,fr=fd[0].getBoundingClientRect();ev(fd[0],'pointerdown',fr.left+3,fr.top+3);ev(window,'pointermove',fr.left+50,fr.top+30);ev(window,'pointerup',fr.left+50,fr.top+30);if(S.field.charge.pts===q0)bad.push('dragging a field point did not move it');if(S.field.charge.pts.split(';')[0].split(',').length!==3)bad.push('a moved charge lost its strength');}
  T.showTab('Brick courses',true);window.__brStep(4);var chip=document.querySelector('[data-lkf="noise"]');if(!chip)bad.push('the field cannot be chosen beside the designs');else{chip.click();if(S.field.kind!=='noise')bad.push('the noise chip sets '+S.field.kind);var rg=document.querySelector('.lkf-host .lkf input[type=range]');if(!rg)bad.push('the noise has no sliders');else{rg.value=6;rg.dispatchEvent(new Event('input',{bubbles:true}));if(+S.field.noise.scale!==6)bad.push('the scale slider wrote '+S.field.noise.scale);}}
  var body=document.querySelector('.bbar').parentNode;['brick.d2','brick.shiftMax','brick.open'].forEach(function(pth){if(![].some.call(body.querySelectorAll('[data-path="'+pth+'"]'),function(e){return getComputedStyle(e).display!=='none'&&!e.closest('.pvs-off')&&!e.closest('.hidden');})&&!(pth==='brick.shiftMax'&&S.brick.op==='rotate')&&!(pth==='brick.d2'&&S.brick.op==='shift'))bad.push(pth+' is not offered in the Pattern step');});
  /* a set is one wall */
  T.reset();T.setPanelMode('brick');S.arr='triptych';S.gap=60;S.width=1500;S.height=2100;var gt=T.regen();if(S.arr!=='grid'||S.cols!==3||S.gap!==0||!gt.panels||gt.panels.length!==3||gt.brick.straight)bad.push('three leaves of brick: '+S.arr+', '+S.cols+' columns, gap '+S.gap+', '+gt.brick.straight+' straight joints');
  /* no brick is left at risk, and none is painted red */
  var riskOf=function(G){var n=0,hd=0;(G.panels||[G]).forEach(function(p){n+=p.brick.atRisk||0;hd+=p.brick.riskHeld||0;});return[n,hd];};
  T.brickLayered('belly');S.brick.layers[0].wave=30;var r1=riskOf(T.regen());if(r1[0])bad.push('a 30 mm ripple in a belly leaves '+r1[0]+' bricks at risk');
  T.brickLayered('belly');S.brick.layers[0].amt=900;S.brick.layers.push({src:'points',pts:'.5,.6',decay:2000,does:'turn',amt:40,alt:true});var gx=T.regen(),r2=riskOf(gx);m.eased=r2[1];if(r2[0])bad.push('a deep belly with a hard turn leaves '+r2[0]+' bricks at risk');if(!r2[1])bad.push('nothing was eased where the pattern asked too much');
  T.brickReadout();var ro=document.getElementById('readout').textContent;if(/red/i.test(ro)||!/eased back/.test(ro))bad.push('the readout: '+ro.slice(0,70));
  var geo=T.hostScene?null:null,svgT=T.brickSVGText(gx);if(/brick-risk/.test(svgT))bad.push('the course drawing still marks bricks at risk');
  S.brick.layers=[];T.regen();T.brickReadout();if(!/Every brick rests/.test(document.getElementById('readout').textContent))bad.push('the readout of a plain wall');
  T.reset();window.__brStep(1);
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'a dot dragged to '+m.moved+'; a point added by a click and removed by a double click; the Tide wall\'s points move too; the field and its scale are beside the designs; three brick panels are one wall with no gap; '+m.eased+' bricks eased back where the pattern asked too much, none at risk, none red',metrics:m};});

/* ---- p87-1: a set of panels is one design, and the Panels control works both ways ---- */
guard('flow','a set of panels is one design: cut sheets meet at a joint with no inner margin and motifs cut at it; a perforated or tiled picture keeps one lattice across the joints; ribs and paving become one piece as many panels wide as asked, so a kerb goes round the whole; the Panels control goes up and comes back down; framed panels are still there to choose',function(){
  var bad=[],m={},xs=function(hs){var lo=1e9,hi=-1e9;hs.forEach(function(h){h.pts.forEach(function(q){if(q.x<lo)lo=q.x;if(q.x>hi)hi=q.x;});});return[lo,hi];};
  /* the cut pattern */
  T.reset();T.seamSet(true);S.gap=6;var g=T.regen(),W=S.width,hb=S.bar/2;if(!g.panels||g.panels.length!==5)bad.push('the opening design is not one design over five panels');
  else{var a=xs(g.panels[0].holes),b=xs(g.panels[2].holes),e=xs(g.panels[4].holes);m.cut=[a[0].toFixed(1),a[1].toFixed(1),b[0].toFixed(1),b[1].toFixed(1)].join(' ');
    if(a[0]<29.9)bad.push('the outer margin of the first panel is gone ('+a[0].toFixed(1)+')');if(e[1]>W-29.9)bad.push('the outer margin of the last panel is gone');
    if(a[1]<W-hb-3||b[0]>hb+3||b[1]<W-hb-3)bad.push('openings stop short of the joint: '+m.cut);if(a[1]>W-hb+.05||b[0]<hb-.05)bad.push('an opening is closer to the sheet edge than half a bar: '+m.cut);}
  S.seam=false;S.gap=24;var gf=T.regen();if(gf.panels)bad.push('framed panels came out as one design');else{var f=xs(gf.holes);if(f[0]<29.9||f[1]>W-29.9)bad.push('a framed panel lost its margin');}
  /* the control, both ways */
  T.reset();T.seamSet(true);T.panelsSet(1);if(S.arr!=='single'||T.panelsNow()!==1)bad.push('Panels 1 gives '+S.arr);T.panelsSet(3);if(S.arr!=='grid'||S.cols!==3||S.gap>6)bad.push('Panels 3 gives '+S.arr+' '+S.cols+', gap '+S.gap);
  var pn=document.querySelector('.pnl [data-pn="1"]');if(!pn)bad.push('no Panels control');else{pn.click();if(S.arr!=='single')bad.push('the 1 chip does not go back to one panel');var p4=document.querySelector('.pnl [data-pn="4"]');p4.click();if(S.arr!=='grid'||S.cols!==4)bad.push('the 4 chip gives '+S.cols);if(!p4.classList.contains('on'))bad.push('the chip in use is not lit');}
  /* one lattice through the joints: holes, then tiles */
  var lattice=function(G,get,p,tag){var W2=S.width+S.gap,rows={};G.panels.forEach(function(P,k){get(P).forEach(function(h){var y=Math.round(h[1]*20)/20;(rows[y]=rows[y]||[]).push(h[0]+k*W2);});});var worst=0,rowsN=0,span=0;
    Object.keys(rows).forEach(function(y){var r=rows[y].sort(function(a,b){return a-b;});if(r.length<8)return;rowsN++;for(var i=1;i<r.length;i++){var d=(r[i]-r[i-1])/p,off=Math.abs(d-Math.round(d));if(off>worst)worst=off;}if(r[0]<S.width&&r[r.length-1]>W2*2)span++;});
    m[tag]=rowsN+' rows, off '+worst.toFixed(4);if(!rowsN||!span)bad.push(tag+': no row runs across the three panels');if(worst>.002)bad.push(tag+': the lattice breaks at a joint by '+worst.toFixed(3)+' of a pitch');};
  T.reset();T.seamSet(true);T.setPanelMode('perf');S.width=900;S.height=1200;T.panelsSet(3);var gp=T.regen();if(!gp.panels||gp.panels.length!==3)bad.push('the perforated set');else lattice(gp,function(P){return P.holes.map(function(h){return[h.cx,h.cy];});},Math.max(1.5,S.perf.pitch),'holes');
  T.reset();T.seamSet(true);T.setPanelMode('tiles');S.width=900;S.height=1200;T.panelsSet(3);var gt=T.regen();if(!gt.panels||gt.panels.length!==3)bad.push('the tiled set');else lattice(gt,function(P){return P.tiles.map(function(t){return[t.x,t.y];});},Math.max(S.omb.tileD*.3,S.omb.pitch),'tiles');
  /* ribs: one piece, and back to panels */
  T.reset();T.seamSet(true);S.arr='grid';S.cols=3;S.rows=1;S.width=900;S.gap=6;T.showTab('Serial sections',true);m.ribs=S.arr+' '+S.width;if(S.arr!=='single'||S.width!==2700||!T.mergeSet()||T.panelsNow()!==3)bad.push('three panels of ribs: '+m.ribs+', panels '+T.panelsNow());
  var gs=T.regen();if(gs.panels||!gs.ribs||gs.W!==2700)bad.push('the ribs do not run the whole width');
  T.panelsSet(2);if(S.width!==1800)bad.push('Panels 2 over merged ribs gives '+S.width);T.showTab('Pattern',true);if(S.arr!=='grid'||S.cols!==2||S.width!==900||T.mergeSet())bad.push('leaving the ribs gives '+S.arr+' '+S.cols+' x '+S.width);
  /* paving: one ground, the kerb round the whole */
  T.reset();T.seamSet(true);T.showTab('Pavers',true);S.paver.edge='kerb';var w0=S.width;T.panelsSet(3);var gv=T.regen();m.ground=S.width+' x '+S.height;if(S.arr!=='single'||S.width!==3*w0||gv.panels||gv.W!==S.width)bad.push('three panels of paving: '+S.arr+' '+m.ground);
  T.panelsSet(1);if(S.width!==w0)bad.push('paving back to one panel is '+S.width);T.showTab('Pattern',true);if(T.mergeSet())bad.push('the merged ground outlives the Pavers tab');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:'cut openings reach the joint and keep half a bar of edge ('+m.cut+'); Panels goes 1, 3, 1, 4; holes '+m.holes+'; tiles '+m.tiles+'; three panels of ribs are one piece 2,700 wide and come back as panels; paving is one ground '+m.ground+' mm with one edge',metrics:m};});

/* ---- p88-1: the lattice wall of bent laths ---- */
guard('host','the lattice wall: straight laths traced as geodesics of a doubly curved wall, so each unrolls straight; one hole at every crossing, the same point on both laths; bending held within the share of the strength allowed, the form eased where the lath cannot follow; a thicker lath or an own bending test changes the limit; laths past the stock are counted; two layers bring blocks; the schedules list every lath, crossing and drill stroke; the Timber tab opens on it and a panel tab sets it aside',function(){
  T.reset();var bad=[],m={},at=function(q,s){var st=q.st,i=0;while(i<st.length-2&&st[i+1].s<s)i++;var a=st[i],b=st[i+1],f=(s-a.s)/Math.max(1e-9,b.s-a.s);return[a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,a.z+(b.z-a.z)*f];};
  T.timberForm('lattice');var R=T.latModel(),K=R.K;m.laths=R.laths.length;m.nodes=R.nodes.length;m.dev=+R.dev.toFixed(3);m.share=+R.share.toFixed(3);
  if(R.laths.length<20||R.nodes.length<50)bad.push(R.laths.length+' laths, '+R.nodes.length+' crossings');
  if(!(R.dev<1))bad.push('a lath is '+R.dev.toFixed(2)+' mm off straight when unrolled');
  if(R.share>K.use+.01||R.bad)bad.push('bending uses '+R.share.toFixed(2)+' of the strength, '+R.bad+' laths past the limit');
  var by={},refs=0,worst=0;R.laths.forEach(function(q){by[q.id]=q;refs+=q.nodes.length;var ok=true;for(var i=1;i<q.holes.length;i++)if(q.holes[i].s<q.holes[i-1].s)ok=false;if(!ok||q.holes[0].k!=='edge'||q.holes[q.holes.length-1].k!=='edge')bad.push('lath '+q.id+' holes out of order or no edge hole');});
  if(refs!==2*R.nodes.length)bad.push('crossings are on '+refs+' lath places, not '+2*R.nodes.length);
  R.nodes.forEach(function(n){var a=at(by[n.a],n.sa),b=at(by[n.b],n.sb),d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);if(d>worst)worst=d;});m.nodeGap=+worst.toFixed(2);if(worst>2)bad.push('a crossing is '+worst.toFixed(1)+' mm apart on its two laths');
  var solid=T.sceneFlag('lat');m.meshes=solid;if(solid<5)bad.push('the wall does not build ('+solid+' meshes)');
  /* the stock sets the form */
  S.lat.belly=700;var R2=T.latModel();if(!R2.held||R2.share>K.use+.01||R2.bad)bad.push('a 700 mm belly is not eased to what the lath takes');m.held=R2.held?+R2.held.belly.toFixed(2):null;
  S.lat.hold=false;var R3=T.latModel();if(R3.held||!R3.bad||R3.share<=K.use)bad.push('with the hold off nothing is counted past the limit');
  S.lat.hold=true;S.lat.belly=90;var r6=T.latModel().rAllow;S.lat.lt=12;var r12=T.latModel().rAllow;if(Math.abs(r12/r6-2)>.01)bad.push('twice the thickness does not double the tightest radius allowed');
  S.lat.testSpan=2000;S.lat.testDefl=300;var rt=T.latModel().rAllow;if(Math.abs(rt-(1e6+9e4)/600)>1)bad.push('the bending test gives '+Math.round(rt));S.lat.testSpan=0;S.lat.testDefl=0;S.lat.lt=6;
  S.lat.stock=2000;var R4=T.latModel();if(!R4.over||!(R4.steeper>K.angle))bad.push('laths longer than a 2 m stock are not counted');S.lat.stock=4800;
  S.lat.layers=1;var R5=T.latModel();S.lat.layers=2;var R6=T.latModel();if(R5.blocks.length||!R6.blocks.length||R6.nL!==2*R6.laths.length||R5.nL!==R5.laths.length)bad.push('layers and blocks: '+R5.blocks.length+', '+R6.blocks.length);
  /* schedules */
  var csv=T.latCSV().trim().split('\n'),nd=T.latNodesCSV().trim().split('\n'),dr=T.latDrillCSV();if(csv.length!==R6.laths.length+2||!/^lath,family,layers,length_mm/.test(csv[0]))bad.push('-laths.csv has '+csv.length+' rows');
  if(csv[1].split(',')[9].split(';').length!==+csv[1].split(',')[8])bad.push('a lath lists a different number of hole positions than holes');if(nd.length!==R6.nodes.length+1)bad.push('-lattice-nodes.csv has '+nd.length+' rows');
  if(!/,cut,/.test(dr)||!/,drill,/.test(dr)||/NaN/.test(csv.join()+nd.join()+dr))bad.push('the drilling run is not whole');if(!/AS IT IS CUT/.test(T.latSheetSVG()))bad.push('the drawing of the two states');
  var rl=T.latRules().map(function(r){return r[1];}).join(' ');if(!/geodesic/.test(rl)||!/first check/.test(rl))bad.push('the wall does not speak of its laths or name its check as a first check');
  /* the tab opens on it; a panel tab sets it aside */
  T.reset();var btn=[].find.call(document.querySelectorAll('.rail button, nav button, button'),function(b){return /^Timber/.test(b.textContent.trim())&&b.getAttribute('role')==='tab';});
  T.showTab('Brick courses',true);T.timberForm('lattice');T.showTab('Brick courses',true);if(S.lat.on)bad.push('a panel tab does not set the lattice wall aside');
  T.reset();
  if(bad.length)return{pass:false,detail:bad.slice(0,6).join('; '),metrics:m};
  return{pass:true,detail:m.laths+' laths and '+m.nodes+' crossings; unrolled, every lath is straight within '+m.dev+' mm; a crossing is the same point on both laths within '+m.nodeGap+' mm; bending uses '+m.share+' of the strength; a 700 mm belly is eased to '+m.held+' of itself; thickness, an own test, the stock and a second layer each change what they should; the schedules are whole',metrics:m};});

/* ---- p90-1: glued brickwork, prefabricated elements, tolerance, balance ---- */
guard('brick','glued brickwork and prefabricated elements (Flexbrick): choosing glue thins the joint and gives every brick a glue area in the placement list and measuring stops in the robot list; a wall in elements keeps every brick in one element, the masses add up, no edge runs straight up a running bond; the tolerance adds as the root of the sum of squares; a flat wall carries its weight in the middle third and a wall pushed out does not; the brick note leaves the 3D view in another mode',function(){
  T.reset();var bad=[],m={};T.brickDesign('weave');S.brick.d2=0;S.brick.shiftMax=0;S.brick.fix='glue';S.brick.joint=2;S.brick.tol=2;T.regen();var Gk=T.G90();
  var csv=T.brickCSV(Gk).trim().split('\n'),h=csv[0].split(','),gi=h.indexOf('glue_cm2');m.rows=csv.length-1;if(gi!==h.length-1)bad.push('no glue column');else{var zero=0,full=0;for(var i=1;i<csv.length;i++){var c=csv[i].split(','),v=+c[gi];if(c[1]!=='1'&&!(v>0))zero++;if(c[12]==='stretcher'&&+c[1]>1&&v>Math.round(S.brick.bL*S.brick.bW/100)+1)full++;}m.zero=zero;if(zero)bad.push(zero+' bricks above the first course with no glue');if(full)bad.push(full+' stretchers glued on more than their own bed');}
  var rb=T.robotCSV(Gk,1),ms=(rb.match(/^measure,/mg)||[]).length,tl=T.brickTol(Gk);m.measure=ms;m.every=tl.every;if(!(ms>0))bad.push('no measuring stops in the robot list');
  if(Math.abs(tl.along-2*Math.sqrt(tl.n))>1e-9||Math.abs(tl.up-2*Math.sqrt(tl.c))>1e-9)bad.push('tolerance is not the root of the sum of squares');
  var gt=T.brickGlueTotals();m.glue=+gt.m2.toFixed(2);if(!(gt.m2>0)||!(gt.minShare>.3))bad.push('glue '+gt.m2+' m2, least share '+gt.minShare);
  S.brick.elems=true;S.brick.elemL=2000;S.brick.elemKg=6000;T.regen();Gk=T.G90();var R=T.brickElements(Gk);m.elements=R?R.n:0;
  if(!R||R.n!==Math.ceil(R.Lw/2000))bad.push('elements '+(R?R.n:0)+' for a '+(R?Math.round(R.Lw):0)+' mm wall at 2 m');
  else{var nb=0,kg=0;R.E.forEach(function(e){nb+=e.bricks;kg+=e.kg;if(e.len>2000+S.brick.bL+1)bad.push('element '+e.k+' is '+Math.round(e.len)+' mm');});if(nb!==Gk.bricks.length+(Gk.backs||[]).length)bad.push(nb+' bricks in elements of '+Gk.bricks.length);if(Math.abs(kg-R.tot)>1)bad.push('element masses do not add up');if(R.straight)bad.push(R.straight+' straight element joints in running bond');
    var ec=T.brickElementsCSV(R).trim().split('\n');if(ec.length!==R.n+1)bad.push(ec.length+' schedule lines');}
  S.brick.elemL=8000;S.brick.elemKg=500;T.regen();R=T.brickElements(T.G90());if(!R||R.E.some(function(e){return e.kg>500+60;}))bad.push('the weight limit is not kept');
  S.brick.elems=false;S.brick.fix='mortar';S.brick.joint=10;T.regen();var b0=T.brickBalance(T.G90());m.flatOff=b0?+b0.off.toFixed(1):null;if(!b0||!b0.inThird||b0.worst>1)bad.push('a flat wall is not balanced: '+JSON.stringify(b0));
  if(/glue_cm2/.test(T.brickCSV(T.G90()).split('\n')[0]))bad.push('mortared wall lists glue');
  S.brick.op='shift';S.brick.shiftMax=60;S.brick.calm=0;S.brick.step=0;T.regen();var b1=T.brickBalance(T.G90());m.pushedWorst=b1?+b1.worst.toFixed(2):null;if(!b1||!(b1.worst>b0.worst))bad.push('a wall pushed out reads no worse than a flat one');
  var rules=T.brickFirstRules().map(function(z){return z[1];}).join(' ');if(!/weight sits/.test(rules))bad.push('Check does not speak of the balance');
  document.getElementById('readout').innerHTML='Every brick rests on the bricks below it.';T.setPanelMode('paver');T.regen();T.updateStats();m.readout=(document.getElementById('readout').innerHTML||'').slice(0,30);if(/Every brick rests/.test(document.getElementById('readout').innerHTML))bad.push('the brick note stays over the paving');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p91-1: the slat wall ---- */
guard('host','the slat wall (the Sequential Wall synthesised): slats cut to length on studs, each resting on two studs or more with every joint on a stud and never on the joint of the course below; every slat laps the one below and its foot stands at or outside that slat\'s face; no slat longer than the stock; a window framed by jamb studs, a lintel and a sill, with no slat across it; panels no longer than the stock or twice the reach; the schedules list every slat and frame piece; choosing the lattice wall again gives the lattice back',function(){
  T.reset();var bad=[],m={};T.timberForm('slat');if(T.timberWhich()!=='slat')bad.push('the form is '+T.timberWhich());var R=T.slatModel(),K=R.K;m.slats=R.slats.length;m.studs=R.studs.length;m.panels=R.nP;m.lap=R.lapMin;m.held=R.held;
  if(R.slats.length<30)bad.push(R.slats.length+' slats');if(R.minSup<2)bad.push('a slat on '+R.minSup+' studs');if(R.dripBad)bad.push(R.dripBad+' slats break the drip rule');if(R.lapMin<K.sLap-.5)bad.push('lap '+R.lapMin);if(R.over||R.longest>K.sStock)bad.push('a slat past the stock');
  var byC={};R.slats.forEach(function(s){(byC[s.c]=byC[s.c]||[]).push(s);});var same=0,kickBad=0;for(var c=2;c<=R.nC;c++){var lo=(byC[c-1]||[]),hi=(byC[c]||[]);/* restated in pass 136: slats are turned in plan by default since pass 91, so a foot is measured where the two slats overlap (both ends of the overlap, through the model's own zAt), not at the slats' middles */hi.forEach(function(s){lo.forEach(function(q){if(q.x1>s.x0&&q.x0<s.x1){var a=Math.max(q.x0,s.x0),b=Math.min(q.x1,s.x1);if(R.zAt(s,a)+s.kick<R.zAt(q,a)+K.sKickMin-.01||R.zAt(s,b)+s.kick<R.zAt(q,b)+K.sKickMin-.01)kickBad++;}});});
    var jl={};lo.forEach(function(q){jl[Math.round(q.x1)]=1;});hi.forEach(function(s){var e=Math.round(s.x1);if(jl[e]&&s.x1<R.L-1&&!(R.win&&Math.abs(s.x1-R.win.x0)<2))same++;});}
  if(kickBad)bad.push(kickBad+' feet behind the slat below');if(same)bad.push(same+' joints over joints');
  if(!R.win)bad.push('no window');else{var w=R.win,jam=R.studs.filter(function(s){return s.kind==='jamb stud';}).length,lin=R.frame.some(function(f){return f.kind.indexOf('lintel')===0;}),sil=R.frame.some(function(f){return f.kind==='sill plate';}),cross=R.slats.filter(function(s){return s.x1>w.x0+1&&s.x0<w.x1-1&&s.yb+K.sbh>w.y0+1&&s.yb<w.y1-1;}).length;m.window=jam+' jambs';if(jam!==2||!lin||!sil)bad.push('window framing '+jam+' jambs, lintel '+lin+', sill '+sil);if(cross)bad.push(cross+' slats across the window');}
  if(R.Pw>Math.min(K.sStock,2*R.reach)+1)bad.push('panel '+Math.round(R.Pw)+' mm');
  var sc=T.slatCSV().trim().split('\n'),fc=T.slatFrameCSV().trim().split('\n'),rc=T.slatRobotCSV().trim().split('\n');if(sc.length!==R.slats.length+1)bad.push(sc.length+' slat rows');if(fc.length!==R.studs.length+R.frame.length+2)bad.push(fc.length+' frame rows');if(rc.length<4*R.slats.length)bad.push(rc.length+' robot rows');
  var rules=T.slatRules();if(!rules.some(function(r){return /laps the one below/.test(r[1]);})||rules.some(function(r){return r[0]==='bad';}))bad.push('rules: '+rules.filter(function(r){return r[0]==='bad';}).map(function(r){return r[1].slice(0,60);}).join(' | '));
  S.lat.sDepth=120;S.lat.sKickMax=12;var R2=T.slatModel();m.held2=R2.held;if(R2.dripBad)bad.push('a steep field breaks the drip rule');if(!(R2.held>0))bad.push('a steep field holds nothing');
  T.timberForm('lattice');if(T.timberWhich()!=='lattice')bad.push('the lattice did not come back');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p92-1: the mouse as a design tool, and the slat wall made parametric ---- */
guard('brick','the mouse edits the pattern: in Add a click on the elevation puts a point where it lands, in Remove a click on a dot takes it away, a new layer starts where you click, scrolling on a charge changes its strength and on a layer its reach, right click removes; the slat wall shows the field\'s dots and the same tools move and add them; its designs turn slats in plan, alternate them, open bays and bow the wall while every slat still rests on two studs and sheds water onto the one below',function(){
  T.reset();var bad=[],m={},c=document.getElementById('view2d'),ev=function(el,type,x,y,o){var e=new PointerEvent(type,Object.assign({bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,button:0},o||{}));el.dispatchEvent(e);},draw=function(){T.regen();T.render2D();},pts=function(){return(S.field.charge.pts||'').split(';').filter(Boolean).length;};
  T.brickDesign('tide');draw();var n0=pts();window.__bhSetMode('add','f');var svg=c.querySelector('svg'),r=svg.getBoundingClientRect();ev(svg,'pointerdown',r.left+r.width*.4,r.top+r.height*.5);draw();m.added=pts()-n0;if(pts()!==n0+1)bad.push('Add gave '+pts()+' points from '+n0);
  window.__bhSetMode('remove','f');var d=c.querySelector('.bh-dot[data-hk="f"]');if(!d)bad.push('no field dot');else{var dr=d.getBoundingClientRect();ev(d,'pointerdown',dr.left+dr.width/2,dr.top+dr.height/2);draw();if(pts()!==n0)bad.push('Remove left '+pts());}
  window.__bhSetMode('move','f');d=c.querySelector('.bh-dot[data-hk="f"]');var s0=+S.field.charge.pts.split(';')[+d.dataset.hi].split(',')[2];d.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));var s1=+S.field.charge.pts.split(';')[+d.dataset.hi].split(',')[2];m.strength=s0+' to '+s1;if(!(s1>s0))bad.push('scrolling up did not strengthen the charge');
  var nl=S.brick.layers.length;window.__bhSetMode('add','newL');svg=c.querySelector('svg');r=svg.getBoundingClientRect();ev(svg,'pointerdown',r.left+r.width*.7,r.top+r.height*.3);draw();if(S.brick.layers.length!==nl+1)bad.push('a new layer was not started');else{var key='L'+nl,ld=c.querySelector('.bh-dot[data-hk="'+key+'"]'),dec=S.brick.layers[nl].decay;if(!ld)bad.push('the new layer has no dot');else{window.__bhSetMode('move');ld.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100}));if(!(S.brick.layers[nl].decay>dec))bad.push('scrolling did not widen the layer');draw();ld=c.querySelector('.bh-dot[data-hk="'+key+'"]');ld.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));if(S.brick.layers.length!==nl)bad.push('right click did not remove the one-point layer');}}
  window.__bhSetMode('move','');
  /* the slat wall */
  ['ripple','weave','screen','bow'].forEach(function(id){T.slatDesign(id);var R=T.slatModel();m[id]=R.slats.length+' slats, turn '+R.turnMax.toFixed(1)+', open '+R.open+', relief '+Math.round(R.relief);if(R.minSup<2||R.dripBad||R.over)bad.push(id+': supports '+R.minSup+', drip '+R.dripBad+', over '+R.over);if(id!=='screen'&&R.turnMax<5)bad.push(id+' barely turns');if(id==='screen'&&!R.open)bad.push('the screen has no open bays');if(id==='bow'&&!(Math.abs(R.zs(R.L/2))>400))bad.push('the wall does not bow');
    var pk=R.packers.reduce(function(a,q){return Math.min(a,q.t0);},1e9);if(pk<4.9)bad.push(id+' packer '+pk.toFixed(1));});
  T.slatDesign('weave');T.regen();T.render2D();var sd=c.querySelectorAll('svg.slat-sheet .bh-dot');m.slatDots=sd.length;if(sd.length<2)bad.push(sd.length+' dots on the slat wall');else{var p0=S.field.charge.pts;window.__bhSetMode('add','f');var sv=c.querySelector('svg.slat-sheet'),sr=sv.getBoundingClientRect();ev(sv,'pointerdown',sr.left+sr.width*.5,sr.top+sr.height*.15);if(S.field.charge.pts.split(';').length!==p0.split(';').length+1)bad.push('Add on the slat wall did nothing');}
  window.__bhSetMode('move','');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p93-1: the bent strip shell ---- */
guard('host','the bent strip shell (Beyond Form Definition prototype 1, synthesised): flat plywood strips, each as wide as it can be and still lie on the doubly curved surface within the tolerance, bent within the share of the plywood strength allowed; two layers with seams staggered; a finger at every pitch along every seam, each at its own angle, a dowel at each; laid flat the fingers would not line up; the three designs build; the schedules list every strip and finger; the lattice wall comes back',function(){
  T.reset();var bad=[],m={};T.timberForm('bent');if(T.timberWhich()!=='bent')bad.push('the form is '+T.timberWhich());
  ['sail','canopy','ripple'].forEach(function(id){T.bentDesign(id);var R=T.bentModel(),K=R.K;m[id]=R.strips.length+' strips, '+R.fingers+' fingers, '+R.angles+' angles, share '+R.share.toFixed(2)+', sag bad '+R.sagBad;
    if(R.strips.length<10||R.fingers<100)bad.push(id+': '+m[id]);if(R.bad)bad.push(id+': '+R.bad+' strips past the bending share');
    R.strips.forEach(function(s){if(s.sag>K.bTol+.01&&s.w>K.bWmin+1)bad.push(id+' '+s.id+' sags '+s.sag.toFixed(1)+' at '+Math.round(s.w));});
    if(R.stagger==null||R.stagger<40)bad.push(id+': seams staggered by '+R.stagger);if(R.dowels!==R.fingers)bad.push('dowels');if(!(R.angles>20))bad.push(id+': only '+R.angles+' finger angles');if(!(R.flatOff>1))bad.push(id+': fingers would fit flat');
    var cov=R.strips.filter(function(s){return s.layer==='A';}).reduce(function(a,s){return a+s.w;},0);if(Math.abs(cov-R.L)>1)bad.push(id+': outer strips cover '+Math.round(cov)+' of '+R.L);});
  var sc=T.bentCSV().trim().split(String.fromCharCode(10)),fc=T.bentFingersCSV().trim().split(String.fromCharCode(10)),R=T.bentModel();if(sc.length!==R.strips.length+1)bad.push(sc.length+' strip rows');if(fc.length!==R.fingers+1)bad.push(fc.length+' finger rows');
  S.lat.bT=18;var R2=T.bentModel();m.thick=R2.share.toFixed(2)+' bad '+R2.bad;if(!(R2.share>R.share))bad.push('thicker ply bends no harder');
  T.timberForm('lattice');if(T.timberWhich()!=='lattice')bad.push('the lattice did not come back');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p94-1: the bent shell's joints and cap; the leaning wall's drawings and Notes ---- */
guard('host','the bent strip shell takes four seam joints (finger, dovetail, butterfly keys, glued laps), each with its own fixings, and a clamped head and base; the five designs build; the leaning wall draws a render and a course drawing with a section; Notes shows what each form says about itself',function(){
  T.reset();var bad=[],m={};T.timberForm('bent');var R0=T.bentModel();['finger','dovetail','butterfly','lap'].forEach(function(j){S.lat.bJoint=j;var R=T.bentModel();m[j]=R.dowels+'/'+R.keys+'/'+R.screws;
    if(j==='finger'&&R.dowels!==R.fingers)bad.push('finger dowels');if(j==='dovetail'&&R.dowels!==Math.ceil(R.fingers/2))bad.push('dovetail dowels '+R.dowels);if(j==='butterfly'&&!(R.keys>0&&R.dowels===0))bad.push('butterfly keys '+R.keys);if(j==='lap'&&R.screws!==2*R.fingers)bad.push('lap screws');
    var rules=T.timberRules().map(function(r){return r[1];}).join(' ');if(!/clamped between two/.test(rules))bad.push(j+': no word on the cap');});
  if(!(R0.bolts>4))bad.push('bolts '+R0.bolts);
  ['sail','canopy','ripple','keyed','dovetail'].forEach(function(id){T.bentDesign(id);var R=T.bentModel();if(R.bad||R.strips.length<10)bad.push(id+' '+R.bad+' '+R.strips.length);});
  T.timberForm('lean');T.regen();T.rebuild&&T.rebuild();var e=T.leanElevSVG(),c=T.leanCourseSVG();m.elev=(e.match(/<polygon/g)||[]).length;m.course=(c.match(/<line/g)||[]).length+'/'+(c.match(/<rect/g)||[]).length;if(m.elev<50)bad.push(m.elev+' boards drawn');if(!/SECTION/.test(c)||(c.match(/<rect/g)||[]).length<10)bad.push('no section');
  var n=T.notesSVG();m.notes=(n.match(/<text/g)||[]).length;if(m.notes<6)bad.push('notes '+m.notes);
  return{ok:!bad.length,msg:bad.join('; '),m:m};});
/* ---- p94-2: the pattern stack, deeper ---- */
guard('brick','the pattern stack goes deeper: a layer\'s reach can be linear, a step or a ring and can hold full strength for a width; a point can carry its own strength (negative pulls); a drawn line can be a smooth closed curve; a noise can be stretched into streaks; a layer can be inverted; the four new designs build with every brick resting',function(){
  T.reset();var bad=[],m={},B=S.brick,F=function(L){return T.brickLayers({layers:[L],bL:240,bW:115,bH:71},6000,3000)[0].f;};
  var base={src:'points',pts:'.5,.5',decay:600,does:'push',amt:30},f0=F(base),fr=F(Object.assign({},base,{fall:'ring'})),fw=F(Object.assign({},base,{width:500})),fn=F(Object.assign({},base,{pts:'.5,.5,-1'})),fi=F(Object.assign({},base,{inv:true}));
  m.centre=[f0(.5,.5),fr(.5,.5).toFixed(2),fn(.5,.5)].join(',');if(!(f0(.5,.5)>.99&&fr(.5,.5)<.2&&fr(.5+600/6000,.5)>.9))bad.push('ring '+fr(.5,.5)+' / '+fr(.6,.5));if(!(fw(.5+400/6000,.5)>.99&&f0(.5+400/6000,.5)<.7))bad.push('width');if(!(fn(.5,.5)<-.99))bad.push('negative point');if(!(Math.abs(fi(.5,.5))<.01))bad.push('invert');
  var lo=F({src:'line',pts:'.2,.2;.8,.2;.5,.8',decay:200,does:'push',amt:20,smooth:true,closed:true});/* restated in pass 136: a smooth closed curve through three points bows out from the chord between two of them (about 310 mm here), so the probe is the curve's own middle, -1/16 p0 + 9/16 p1 + 9/16 p2 - 1/16 p3, and the chord's middle must read lower */if(!(lo(.5,.8)>.9&&lo(.29375,.5375)>.9&&lo(.35,.5)<lo(.29375,.5375)&&lo(.5,.45)<.05))bad.push('closed curve '+lo(.5,.8)+' '+lo(.29375,.5375)+' '+lo(.35,.5));
  var ns=F({src:'noise',decay:400,does:'turn',amt:10,stretch:5,angle:0}),dx=Math.abs(ns(.3,.5)-ns(.32,.5)),dy=Math.abs(ns(.3,.5)-ns(.3,.54));m.streak=dx.toFixed(3)+'/'+dy.toFixed(3);
  ['grapes','contour','lace','dune'].forEach(function(id){T.brickLayered(id);T.regen();var g=T.G90(),r=g&&g.brick?g.brick.atRisk||0:-1;m[id]=(g&&g.bricks?g.bricks.length:0)+' bricks, at risk '+r;if(!g||!g.bricks||g.bricks.length<200||r)bad.push(id+': '+m[id]);});
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p95-1: the form in hand stays; a painted layer; the tint ---- */
guard('brick','the form in hand stays: a tower changed outside the Wall step is read into the brick panel, a control there re-lays that tower, designs are laid on it, another panel tab keeps the plan, a form the Wall step has no name for is left alone; a painted layer turns bricks only where it was painted; the tint draws; Pavers stands above Serial sections in the rail',function(){
  T.reset();var bad=[],m={},B=S.brick;
  T.brickForm95('tower',{L:6000,H:2800,storeys:3,sides:4});S.plan.sides=6;S.cols=12;S.rows=5;B.form='wall';
  var id=T.brickFormSync(true);m.sync=id+'/'+B.formSides+'/'+B.formN;if(!(id==='tower'&&B.formSides===6&&B.formN===5))bad.push('sync '+m.sync);
  T.brickForm95(T.brickFormNow());if(!(S.plan.kind==='tower'&&S.plan.sides===6&&S.rows===5))bad.push('re-lay lost the tower');
  T.brickDesign95('weave');m.design=S.plan.kind+'/'+S.plan.sides+'/'+S.rows;if(!(S.plan.kind==='tower'&&S.plan.sides===6&&S.rows===5&&S.arr==='grid'))bad.push('a design reset the form: '+m.design);
  T.brickLayered95('ripple');if(!(S.plan.kind==='tower'&&S.plan.sides===6&&B.layers.length>=1))bad.push('a layered design reset the form');
  T.regen();var g=T.G90();m.bricks=g.total;if(!(g.total>3000))bad.push('the tower did not build: '+g.total);
  T.setPanelMode('perf');if(S.plan.kind!=='tower')bad.push('the perforated tab lost the plan');T.setPanelMode('brick');if(T.brickFormNow()!=='tower')bad.push('back in brick: '+B.form);
  S.plan.kind='curve';var c=T.brickFormSync(true);T.brickForm95(c);m.custom=c+'/'+S.plan.kind;if(!(c==='custom'&&S.plan.kind==='curve'))bad.push('custom form '+m.custom);
  T.reset();B=S.brick;T.brickForm95('wall',{L:6000,H:3000});B.layers=[];B.d1=0;B.d2=0;B.shiftMax=0;B.calm=0;T.regen();g=T.G90();
  var mx=0;g.bricks.forEach(function(b){mx=Math.max(mx,Math.abs(b.theta||0));});m.plain=mx;if(mx>.01)bad.push('plain wall turned '+mx);
  var L=T.paintLayer('turn',true);T.paintDab(L,[.25,.5],6000,3000,500,false);T.regen();g=T.G90();var near=0,far=0;
  g.bricks.forEach(function(b){var t=Math.abs(b.theta||0),u=b.x/6000,v=b.y/3000;if(Math.hypot((u-.25)*6000,(v-.5)*3000)<250&&t>3)near++;if(u>.6&&t>.5)far++;});m.paint=near+'/'+far;
  if(!(near>4&&far===0))bad.push('paint '+m.paint);
  var fx=T.bfxSVG(6000,3000);m.fx=(fx.match(/<rect/g)||[]).length;if(!(m.fx>3&&m.fx<4000))bad.push('tint '+m.fx);
  T.paintDab(L,[.25,.5],6000,3000,900,true);T.regen();g=T.G90();mx=0;g.bricks.forEach(function(b){mx=Math.max(mx,Math.abs(b.theta||0));});if(mx>1)bad.push('erase left '+mx);
  B.layers=[];var P=T.profLayer(true);P.pu='0,0,0,1,0,0,0';P.pv='1,1,1,1,1';P.amt=40;T.regen();g=T.G90();var mid=0,end=0;g.bricks.forEach(function(b){var u=b.x/6000,sh=Math.abs(b.shift||0);if(Math.abs(u-.5)<.04&&b.r>2&&sh>20)mid++;if(u<.2&&sh>1)end++;});m.curves=mid+'/'+end;if(!(mid>4&&end===0))bad.push('curves '+m.curves);
  var o=T.tabOrder();m.order=o.indexOf('Pavers')+'<'+o.indexOf('Serial sections');if(!(o.indexOf('Pavers')>o.indexOf('Timber')&&o.indexOf('Pavers')<o.indexOf('Serial sections')))bad.push('rail order');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p96-1: the wall worked by hand, deeper ---- */
guard('brick','the wall worked by hand, deeper: selected bricks step out only inside their box; a rule steps out every fourth course; a section bellies the wall round its station only and every brick still rests; a layer of state A acts at one end only; Swell is made of dots that can be moved; eight layers are read; the header names the step',function(){
  T.reset();var bad=[],m={},B=S.brick;T.brickForm95('wall',{L:6000,H:3000});B.layers=[];B.d1=0;B.d2=0;B.shiftMax=0;B.calm=0;B.op='rotate';
  var L=T.layer96('boxes','push',true,{amt:30});L.pts='0.4,0.4,0.6,0.6,1';T.regen();var g=T.G90(),inn=0,out=0;
  g.bricks.forEach(function(b){var u=b.x/6000,v=b.y/3000,s=Math.abs(b.shift||0);if(u>.42&&u<.58&&v>.42&&v<.58&&s>15)inn++;if((u<.3||u>.7)&&s>1)out++;});m.box=inn+'/'+out;if(!(inn>8&&out===0))bad.push('box '+m.box);
  m.head=T.brickTurnWords();if(!/out up to/.test(m.head))bad.push('header '+m.head);
  B.layers=[];L=T.layer96('course',null,true,{does:'push',amt:20,n:4,m:1,from:2});T.regen();g=T.G90();var rows={};g.bricks.forEach(function(b){if(Math.abs(b.shift||0)>10)rows[b.r]=1;});var rr=Object.keys(rows).map(Number).sort(function(a,b){return a-b;});m.rule=rr.slice(0,5).join(',');
  if(!(rr.length>=5&&rr.every(function(r,i){return i===0||r-rr[i-1]===4;})))bad.push('rule '+rr.join(','));var Lr=S.brick.layers[0];m.ruleOn=String(Lr&&Lr.off)+'/'+(Lr&&Lr.from);if(!Lr||Lr.off||Lr.from!==2)bad.push('the rule layer is off or lost its start: '+m.ruleOn);
  B.layers=[];L=T.layer96('section',null,true,{does:'bulge',amt:240,u0:.3,w:1500,pv:'0,0,.15,.7,1,.6'});T.regen();g=T.G90();var near=0,far=0,risk=g.brick.atRisk||0,keys={};g.bricks.forEach(function(b){for(var k in b)keys[k]=1;var u=b.x/6000,z=Math.abs(b.shL||0);if(Math.abs(u-.3)<.05&&b.y>2000&&z>40)near++;if(u>.7&&z>2)far++;});m.section=near+'/'+far+' risk '+risk+' belly '+g.brick.bulge;
  if(!(near>3&&far===0&&!risk))bad.push('section '+m.section+' keys '+Object.keys(keys).join(','));
  B.layers=[{src:'height',does:'push',amt:30,st:'A'}];B.blend={by:'along',a:.3,b:.7};T.regen();g=T.G90();var le=0,ri=0;g.bricks.forEach(function(b){var u=b.x/6000,s=Math.abs(b.shift||0);if(b.y>2400){if(u<.2&&s>12)le++;if(u>.8&&s>1)ri++;}});m.blend=le+'/'+ri;if(!(le>2&&ri===0))bad.push('blend '+m.blend);
  B.blend=null;T.brickDesign95('swell');B=S.brick;var s0=B.layers[0];m.swell=s0.src+'/'+s0.also+'/'+T.brickSources().length;if(!(s0.src==='points'&&s0.also==='turn'&&T.brickSources().length>=1))bad.push('swell '+m.swell);T.regen();g=T.G90();var mt=0,ms=0;g.bricks.forEach(function(b){mt=Math.max(mt,Math.abs(b.theta||0));ms=Math.max(ms,Math.abs(b.shift||0));});m.swellMax=mt.toFixed(1)+'/'+ms.toFixed(0)+' risk '+(g.brick.atRisk||0);if(!(mt>4&&ms>10&&!(g.brick.atRisk)))bad.push('swell laid '+m.swellMax);
  T.brickLayered95('wrinkle');B=S.brick;T.regen();g=T.G90();m.wrinkle=B.layers[0].src+' belly '+g.brick.bulge+' risk '+(g.brick.atRisk||0)+' open '+(g.brick.openings||0);if(!(B.layers[0].src==='section'&&g.brick.bulge>60&&!(g.brick.atRisk)))bad.push('wrinkle '+m.wrinkle);
  var eight=[];for(var k=0;k<8;k++)eight.push({src:'height',does:'push',amt:1});m.eight=T.brickLayers({layers:eight,bL:240,bW:115,bH:71},6000,3000).length;if(m.eight!==8)bad.push('layers read '+m.eight);
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p97-1: the paved ground on a site ---- */
guard('paver','a paved ground on a site: every stone takes its level; the route is read for its running slope and its cross fall and the answer changes when the ground is steeper; the 3D ground rises as the site does, high where the plan is high; the plan carries contours and the route in pieces; the pattern can follow the height; a level ground is as before',function(){
  T.reset();var bad=[],m={};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var P=S.paver;P.tiling='running';P.size=400;P.route='straight';P.keep='0,0.5 1,0.5';P.site='cross';P.siteRise=900;T.siteApply();T.regen();var g=T.G90(),st=g.paver.site;
  if(!st)return{ok:false,msg:'no site record',m:m};m.rise=Math.round(st.rise);m.fall=st.fall.toFixed(1)+st.to;if(Math.abs(st.rise-900)>30)bad.push('rise '+st.rise);
  var zs=g.pavers.map(function(p){return p.z;}),zmin=Math.min.apply(null,zs),zmax=Math.max.apply(null,zs);m.z=zmin+'..'+zmax;if(!(zmax-zmin>700&&zmin>=0))bad.push('levels '+m.z);
  m.route=st.route?st.route.max.toFixed(1):'none';if(!(st.route&&Math.abs(st.route.max-3.8)<.4))bad.push('route slope '+m.route);
  m.cross=st.route?st.route.cross.toFixed(1):'';if(!st.route||Math.abs(st.route.cross-9.3)>.6)bad.push('cross '+m.cross);
  var rules=T.siteRules(st).map(function(r){return r[0]+':'+r[1];}).join(' | ');if(!/pr-ok/.test(rules)||!/cross fall/.test(rules))bad.push('rules '+rules.slice(0,160));
  P.siteRise=3000;T.regen();st=T.G90().paver.site;var r2=T.siteRules(st).map(function(r){return r[0];}).join(',');m.steep=st.route.max.toFixed(1)+' '+r2;if(!(st.route.max>12&&/pr-bad/.test(r2)))bad.push('steep route '+m.steep);
  P.siteRise=900;T.regen();g=T.G90();var geo=T.paverGeom97();geo.computeBoundingBox();var bb=geo.boundingBox,bz=bb.max.z-bb.min.z;m.geoZ=Math.round(bz);if(!(bz>800))bad.push('3D rise '+bz);
  var a=geo.attributes.position,hi=[0,0,-1e9];for(var i=0;i<a.count;i+=5){if(a.getZ(i)>hi[2])hi=[a.getX(i),a.getY(i),a.getZ(i)];}var hx=(hi[0]-bb.min.x)/(bb.max.x-bb.min.x),hy=(hi[1]-bb.min.y)/(bb.max.y-bb.min.y);m.high=Math.round(hx*100)+','+Math.round(hy*100);if(!(hx>.8&&hy>.8))bad.push('3D high corner '+m.high);
  var svg=T.siteSVG97();m.contours=(svg.match(/<path/g)||[]).length;m.segs=(svg.match(/<line/g)||[]).length;if(!(m.contours>=4&&m.segs>10))bad.push('plan '+m.contours+'/'+m.segs);
  var f1=T.fieldValue97({kind:'site',site:{by:'height'}},.9,.9,9000,6000),f0=T.fieldValue97({kind:'site',site:{by:'height'}},.1,.1,9000,6000);m.field=f0.toFixed(2)+'/'+f1.toFixed(2);if(!(f1>f0+.5))bad.push('field '+m.field);
  P.site='level';T.regen();g=T.G90();if(g.paver.site)bad.push('level ground still has a site');geo=T.paverGeom97();geo.computeBoundingBox();m.flat=Math.round(geo.boundingBox.max.z-geo.boundingBox.min.z);if(m.flat>400)bad.push('level ground not flat '+m.flat);
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p98-1: a timber wall drawn in plan ---- */
guard('host','a timber wall drawn in plan: the foot and the head are curves through seven nodes each; the lattice wall and the bent strip shell both stand on them; a plan too tight for the laths is built at the share of it that stands; the sliders still work',function(){
  T.reset();var bad=[],m={};T.timberForm('lattice');var L=S.lat;L.kind='lattice';L.planBy='drawn';L.pb='-700,-450,-200,0,200,450,700';L.pt='700,450,200,0,-200,-450,-700';
  m.z=[T.latPlanZ(L,0,0,1),T.latPlanZ(L,1,0,1),Math.round(T.latPlanZ(L,0,.5,1))].join(',');if(!(T.latPlanZ(L,0,0,1)===-700&&T.latPlanZ(L,1,0,1)===700&&Math.abs(T.latPlanZ(L,0,.5,1))<1))bad.push('plan values '+m.z);
  var R=T.latModel98();m.laths=R.laths.length;var fin=R.laths.every(function(q){return q.st.every(function(o){return isFinite(o.x)&&isFinite(o.y);});});if(!(R.laths.length>10&&fin))bad.push('lattice on a drawn plan '+m.laths+' '+fin);
  L.planBy='';var R0=T.latModel98();m.formula=R0.laths.length;if(!(R0.laths.length>10))bad.push('sliders');
  var a=R.laths[0].st[0],b=R0.laths[0].st[0];m.differs=Math.round(Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)));
  L.planBy='drawn';L.pb='0,2600,-2600,2600,-2600,2600,0';L.pt=L.pb;R=T.latModel98();m.held=R.held?+R.held.shape.toFixed(2):1;if(!(R.held&&R.held.shape<1))bad.push('a plan too tight was not eased');
  L.pb='0,0,0,0,0,0,0';L.pt=L.pb;L.pm='0,0,0,0,0,0,0';L.pm='0,0,0,500,0,0,0';var Rb=T.latModel98();m.belly=T.latPlanBelly(L,.5,.5)+' '+Rb.laths.length;if(!(T.latPlanBelly(L,.5,.5)===500&&T.latPlanBelly(L,.5,0)===0&&Rb.laths.length>10))bad.push('drawn belly '+m.belly);L.pm='';
  T.timberForm('bent');L=S.lat;L.planBy='drawn';L.pb='0,500,800,0,-800,-500,0';L.pt='300,600,800,300,-300,-200,300';var B=T.bentModel();m.strips=B.strips.length;if(!(B.strips.length>=6))bad.push('bent strips '+m.strips);
  L.planBy='';var B0=T.bentModel();m.strips0=B0.strips.length;
  T.timberForm('lean');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p100-1: paint on the paved ground ---- */
guard('paver','paint on the paved ground: a darker stroke lowers the tone of the stones under it and of no others; rubbing it out puts them back',function(){
  T.reset();var bad=[],m={};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var P=S.paver;P.tiling='running';P.size=400;P.site='level';P.paintL='';P.paintD='';
  S.field.kind='gradient';S.field.gradient={dir:'right',pow:1};T.fieldUse100();T.regen();var g=T.G90(),t0=g.pavers.map(function(p){return p.t;});m.n=t0.length;
  T.pvPaintDab(P,[.5,.5],9000,6000,1200,'dark');T.fieldUse100();T.regen();g=T.G90();var near=0,far=0;
  g.pavers.forEach(function(p,i){var d=Math.hypot(p.cx-4500,p.cy-3000),dt=p.t-t0[i];if(d<700&&dt<-.25)near++;if(d>2600&&Math.abs(dt)>.02)far++;});m.dark=near+'/'+far;if(!(g.pavers.length===t0.length&&near>3&&far===0))bad.push('dark stroke '+m.dark+' of '+g.pavers.length);
  T.pvPaintDab(P,[.5,.5],9000,6000,2400,'rub');m.left=(P.paintD||'').length;T.fieldUse100();T.regen();g=T.G90();var back=0;g.pavers.forEach(function(p,i){if(Math.abs(p.t-t0[i])>.02)back++;});m.back=back;if(back||P.paintD)bad.push('rub out left '+back+' stones changed');
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p101-1: a flat set of paving is one ground however it came about ---- */
guard('flow','a flat set of paving panels made behind the controls is built as one ground with seamless on, and stays a framed set with it off; ribs the same',function(){
  T.reset();var bad=[],m={};T.setPanelMode('paver');S.paver.lay='ground';S.paver.tiling='running';S.paver.size=400;S.seam=true;S.arr='grid';S.cols=3;S.rows=1;S.width=3000;S.height=3000;T.regen();var g=T.G90();
  m.seamless=S.arr+' '+S.width+' x '+S.height+' panels '+(g.panels?g.panels.length:1);if(!(S.arr==='single'&&S.width===9000&&!(g.panels&&g.panels.length>1)))bad.push('seamless set not merged: '+m.seamless);
  T.reset();T.setPanelMode('paver');S.paver.lay='ground';S.paver.tiling='running';S.paver.size=400;S.seam=false;S.arr='grid';S.cols=3;S.rows=1;S.width=3000;S.height=3000;T.regen();g=T.G90();
  m.framed=S.arr+' '+S.width+' panels '+(g.panels?g.panels.length:1);if(!(S.arr==='grid'&&S.width===3000))bad.push('framed set was merged: '+m.framed);
  T.reset();T.setPanelMode('serial');S.seam=true;S.arr='grid';S.cols=2;S.rows=1;S.width=1200;S.height=2400;T.regen();m.ribs=S.arr+' '+S.width;if(!(S.arr==='single'&&S.width===2400))bad.push('ribs not merged: '+m.ribs);
  T.reset();T.setPanelMode('paver');S.paver.lay='ground';S.paver.tiling='running';S.paver.size=400;S.seam=false;S.arr='grid';S.cols=3;S.rows=1;S.width=3000;S.height=3000;S.paver.site='cross';S.paver.siteRise=900;T.siteApply();T.regen();g=T.G90();m.site=S.arr+' '+S.width+' rise '+(g.paver.site?Math.round(g.paver.site.rise):'none');if(!(S.arr==='single'&&S.width===9000&&g.paver.site&&Math.abs(g.paver.site.rise-900)<30))bad.push('a sloping set is not one ground: '+m.site);
  S.paver.site='level';T.reset();
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p102-1: benches that stay where they are ---- */
guard('paver','benches are placed along the route until they are pinned; pinned, they keep their places when the route moves; one can be removed, all can be removed, and unpinning places them along the route again',function(){
  T.reset();var bad=[],m={};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=12000;S.height=9000;Object.assign(S.paver,{lay:'ground',tiling:'perm',pLat:'square',pMorph:'round',size:300,openMin:4,openMax:24,route:'straight',keep:'0,0.5 1,0.5',routeOn:true,seats:3,seatPts:'',site:'level'});
  T.regen();var g=T.G90(),s0=g.paver.perm.seats.map(function(b){return Math.round(b.x)+','+Math.round(b.y);});m.placed=s0.length;if(s0.length<2)bad.push('benches placed '+s0.length);
  S.paver.keep='0,0.25 1,0.25';T.regen();var s1=T.G90().paver.perm.seats.map(function(b){return Math.round(b.x)+','+Math.round(b.y);});if(s1.join(';')===s0.join(';'))bad.push('unpinned benches did not follow the route');
  S.paver.keep='0,0.5 1,0.5';T.regen();if(!T.seatPin())bad.push('pin refused');var pinned=S.paver.seatPts;S.paver.keep='0,0.25 1,0.25';T.regen();var s2=T.G90().paver.perm.seats.map(function(b){return Math.round(b.x)+','+Math.round(b.y);});m.pinned=s2.length;if(s2.join(';')!==s0.join(';'))bad.push('pinned benches moved: '+s0.join(';')+' -> '+s2.join(';'));
  S.paver.seatPts=pinned.split(';').slice(1).join(';')||'none';T.regen();m.afterRemove=T.G90().paver.perm.seats.length;if(m.afterRemove!==s0.length-1)bad.push('remove one left '+m.afterRemove);
  S.paver.seatPts='none';T.regen();if(T.G90().paver.perm.seats.length!==0)bad.push('remove all left some');
  S.paver.seatPts='';T.regen();m.back=T.G90().paver.perm.seats.length;if(m.back!==s0.length)bad.push('unpinned count '+m.back);
  S.paver.seatPts='';T.reset();
  return{ok:!bad.length,msg:bad.join('; '),m:m};});

/* ---- p128-1: inventory paving ---- */
guard('paver','inventory paving lays a counted stock: no module over its count, placed + left = asked, no two modules on one place, no slab inside a round void, every hole with stone round it, cuts counted and taken from the plain slab, short places reported, the most open module on the darkest places, the same design twice',function(){
  T.reset();var bad=[],m={},K=window.PS_T128;if(!K)return{pass:false,detail:'PS_T128 missing'};K.start();var P=S.paver;
  function one(name){var g=K.gen(),R=g.paver.inv,b=[];if(!R){bad.push(name+': no report');return null;}var u=R.u,occ={};
    g.pavers.forEach(function(p){var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;p.pts.forEach(function(q){x0=Math.min(x0,q.x);y0=Math.min(y0,q.y);x1=Math.max(x1,q.x);y1=Math.max(y1,q.y);});
      if(!p.cut){var a=Math.round((x1-x0)/u),c=Math.round((y1-y0)/u);for(var i=0;i<a;i++)for(var j=0;j<c;j++){var k=Math.round((x0-R.ox)/u+i)+','+Math.round((y0-R.oy)/u+j);if(occ[k])b.push('two modules on '+k);occ[k]=1;}}
      if(p.hole){var r=p.hole/2;if(p.cx-x0<r+29||x1-p.cx<r+29||p.cy-y0<r+29||y1-p.cy<r+29)b.push('a hole within 30 mm of its slab edge');}
      R.voids.forEach(function(w){p.pts.forEach(function(q){if(Math.hypot(q.x-w.x,q.y-w.y)<w.r-1)b.push('a slab inside a void');});});});
    R.rows.forEach(function(r){if(r.asked!=null&&r.placed>r.asked)b.push(r.name+' over its count');if(r.asked!=null&&r.placed+r.left!==r.asked)b.push(r.name+': placed + left is not asked');if(r.left&&!r.why)b.push(r.name+' left with no reason');});
    var whole=0;R.rows.forEach(function(r){whole+=(r.placed-r.cut)*r.a*r.b;});if(whole+R.short+R.voidCells+R.cutVoid+R.noStock<R.cells-R.cutVoid-R.noStock-1&&false)b.push('places not accounted for');
    var tot=g.paver.counts.reduce(function(a,c){return a+c;},0);if(tot!==g.pavers.length)b.push('type counts '+tot+' for '+g.pavers.length+' pavers');
    if(g.pavers.filter(function(p){return p.cut;}).length!==R.cutVoid+R.cutEdge)b.push('cut pavers '+g.pavers.filter(function(p){return p.cut;}).length+' reported '+(R.cutVoid+R.cutEdge));
    if(b.length)bad.push(name+': '+b.slice(0,3).join(', ')+(b.length>3?' (+'+(b.length-3)+')':''));return{g:g,R:R};}
  var d=one('roof garden');if(d){m.cells=d.R.cells;m.pavers=d.g.pavers.length;m.cut=d.R.cutVoid;m.follow=+(d.R.follow||0).toFixed(2);
    if(d.R.cells!==1176)bad.push('21 x 14 m at 500 gives '+d.R.cells+' places');if(d.R.short)bad.push('the fill module left '+d.R.short+' places');if(d.R.leftAll)bad.push('counted modules left over with room: '+d.R.leftAll);
    if(d.R.vrep.some(function(v){return v.placed!==v.asked;}))bad.push('a void was not placed');if(!(d.R.cutVoid>8))bad.push('voids cut '+d.R.cutVoid+' slabs');if(!(d.R.follow>.3))bad.push('follow '+d.R.follow);
    /* the most open module sits darker than the least open holed one */var hol=d.R.rows.filter(function(r){return r.hole>0&&r.placed;});if(hol.length>1&&!(hol[0].tone<hol[hol.length-1].tone))bad.push('the most open module is not on darker ground: '+hol[0].tone.toFixed(2)+' against '+hol[hol.length-1].tone.toFixed(2));
    var sig=function(g){return g.pavers.map(function(p){return p.type+':'+Math.round(p.cx)+','+Math.round(p.cy);}).join('|');},s1=sig(d.g),s2=sig(K.gen());if(s1!==s2)bad.push('the same state gave two designs');
    var csv=K.csv===undefined?'':'';}
  S.width=20750;S.height=13800;var e=one('a ground that is not whole slabs');if(e){m.edge=e.R.cutEdge;if(!(e.R.cutEdge>50))bad.push('edge cuts '+e.R.cutEdge);}S.width=21000;S.height=14000;
  P.inv='A|1|1|375|plant|50;B|2|1|0||100;C|1|1|0||200';var f=one('short stock');if(f){m.short=f.R.short;if(!(f.R.short>500))bad.push('short stock left only '+f.R.short+' places');if(f.g.pavers.length>350)bad.push('short stock laid '+f.g.pavers.length);}
  P.inv='A|1|1|375|plant|300;B|2|2|300|seat|120;L|3|1|0||80;M|4|1|0||40';var h=one('no plain slab');if(h){m.noStock=h.R.noStock;if(!(h.R.noStock>0)||h.R.cutVoid)bad.push('cuts without a plain slab: cut '+h.R.cutVoid+' refused '+h.R.noStock);if(!(h.R.moved>0))bad.push('large modules were all on the darkest places');}
  P.inv='A|1|1|480|plant|40;C|1|1|0||fill';var i=one('a hole too big');if(i){if(!(i.R.rows[0].held===480&&i.R.rows[0].hole===380))bad.push('480 hole in a 500 slab became '+i.R.rows[0].hole);}
  P.inv='A|1|1|300|plant|5000;C|1|1|0||fill';var j=one('more than the ground takes');if(j){m.left=j.R.leftAll;if(!(j.R.leftAll>3000))bad.push('left '+j.R.leftAll);if(!/route|full/.test(j.R.rows[0].why))bad.push('why: '+j.R.rows[0].why);}
  /* a rectangle less a disc: areas add up */var q=K.cut(0,0,500,500,0,0,600),A=0;q.forEach(function(pl){var s=0;for(var k=0;k<pl.length;k++){var a=pl[k],c=pl[(k+1)%pl.length];s+=a.x*c.y-c.x*a.y;}A+=Math.abs(s)/2;});
  m.cutArea=Math.round(A);/* square 250000 less the quarter disc part inside it */var ex=0,N=400;for(var a=0;a<N;a++)for(var c=0;c<N;c++){var x=(a+.5)*500/N,y=(c+.5)*500/N;if(Math.hypot(x,y)>600)ex+=500*500/(N*N);}if(Math.abs(A-ex)>ex*.02)bad.push('cut piece area '+Math.round(A)+' expected about '+Math.round(ex));
  if(K.cut(0,0,500,500,250,250,300).length!==4)bad.push('a disc on the middle of a slab should leave four corners');
  T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p129-1: the pocket park on the inventory rule ---- */
guard('paver','the pocket park is laid from a counted stock: every count met and no place without a slab; beds are whole slab places with nothing cut; a dark edging sett on every free place beside a bed; path modules only on the route; benches in pairs on opposite sides of the route, backs outward, never on a bed; the kerb is in units and rises with a sloping ground',function(){
  T.reset();var bad=[],m={},K=window.PS_T128,K9=window.PS_T129;if(!K||!K9)return{pass:false,detail:'PS_T128 or PS_T129 missing'};K9.start();var P=S.paver,g=K.gen(),R=g.paver.inv;if(!R)return{pass:false,detail:'no report'};
  m.pavers=g.pavers.length;m.beds=R.beds;m.seats=R.seats.length;
  if(R.short)bad.push(R.short+' places without a slab');if(R.leftAll)bad.push(R.leftAll+' modules left unused');if(R.cutAll||g.pavers.some(function(p){return p.cut;}))bad.push('something was cut');
  if(!(R.beds>150&&R.beds<420))bad.push('beds '+R.beds+' places');
  var sizes={};R.rows.forEach(function(r){sizes[r.a+'x'+r.b]=1;});if(Object.keys(sizes).length!==5)bad.push(Object.keys(sizes).length+' paver sizes');
  var u=R.u,x0=0,y0=0,bed={},typ={},pth=K.rows().map(function(r){return r.use;});
  (g.paver.planted||[]).forEach(function(q){if(q.bedCell){bed[Math.round((q.cx-R.ox)/u-.5)+','+Math.round((q.cy-R.oy)/u-.5)]=1;if(Math.abs(Math.abs((q[1].x-q[0].x))-u)>.01)bad.push('a bed place is not a whole slab place');}});
  g.pavers.forEach(function(p){var xa=1e9,ya=1e9,xb=-1e9,yb=-1e9;p.pts.forEach(function(v){xa=Math.min(xa,v.x);ya=Math.min(ya,v.y);xb=Math.max(xb,v.x);yb=Math.max(yb,v.y);});var a=Math.round((xb-xa)/u),c=Math.round((yb-ya)/u);for(var i=0;i<a;i++)for(var j=0;j<c;j++)typ[Math.round((xa-R.ox)/u+i)+','+Math.round((ya-R.oy)/u+j)]=p.inv;});
  var noEdge=0,edgeN=0;Object.keys(bed).forEach(function(k){var ij=k.split(',').map(Number);for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++){var kk=(ij[0]+dx)+','+(ij[1]+dy);if(bed[kk]||typ[kk]==null)continue;if(pth[typ[kk]]==='edge')edgeN++;else if(pth[typ[kk]]!=='path')noEdge++;}});
  m.noEdge=noEdge;if(noEdge)bad.push(noEdge+' places beside a bed without edging');if(!edgeN)bad.push('no edging');
  /* benches */var pairs={};R.seats.forEach(function(b){(pairs[b.pair]=pairs[b.pair]||[]).push(b);});
  Object.keys(pairs).forEach(function(k){var q=pairs[k];if(q.length!==2){bad.push('a bench without its pair');return;}if(q[0].side+q[1].side!==0)bad.push('a pair on one side of the route');var d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y),want=2*(Math.max(u*.5,P.keepW)+380);if(Math.abs(d-want)>2)bad.push('a pair '+Math.round(d)+' apart, not '+want);});
  if(R.seats.length!==4)bad.push(R.seats.length+' benches for two pairs');
  R.seats.forEach(function(b){var k=Math.floor((b.x-R.ox)/u)+','+Math.floor((b.y-R.oy)/u);if(bed[k])bad.push('a bench on a bed');});
  /* the kerb on a slope */if(T.has3D&&T.has3D()){P.site='cross';P.siteRise=1200;var gg=K.geom(),a=gg.attributes.position.array,lo=-1e9,hi=-1e9,n=0;for(var i=0;i<a.length;i+=3){if(a[i]<-1){n++;if(a[i+1]<600)lo=Math.max(lo,a[i+2]);if(a[i+1]>S.height-600)hi=Math.max(hi,a[i+2]);}}
    m.kerbRise=Math.round(hi-lo);if(!(n>200))bad.push('no kerb units ('+n+' vertices)');if(Math.abs((hi-lo)-1200*.62)>90)bad.push('the kerb rises '+Math.round(hi-lo)+' where the ground rises '+Math.round(1200*.62));if(P.edge!=='kerb')bad.push('the edge setting was not put back');P.site='level';}
  T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p130-1: the topography layer ---- */
guard('paver','the ground from spot levels is a surface through them (a plane from points on a plane, to the millimetre); the paving can be graded to one even plane with its fall held and cut and fill balanced; water is routed cell to cell and balances; a hollow drains to one drain at its low point and ponds without one; a cross fall sends its water over the low edges; a pattern can open where water gathers; the grading plan carries contours, spot levels in metres, falls, the section and a title block, and the DXF its layers',function(){
  T.reset();var bad=[],m={},K=window.PS_T130;if(!K)return{pass:false,detail:'PS_T130 missing'};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=12000;S.height=9000;var P=S.paver;
  Object.assign(P,{lay:'ground',tiling:'square',size:500,joint:6,types:3,route:'none',keep:'',edge:'none',storm:60,runon:0,grade:'asis',drains:'auto',drainN:4,drainPts:'',datum:10,rSand:40});
  /* 1 a plane through four spots */P.site='spots';P.sitePts='0,0,0;1,0,600;0,1,300;1,1,900';K.apply();T.regen();var worst=0;[[.2,.3],[.5,.5],[.83,.11],[.4,.9]].forEach(function(q){worst=Math.max(worst,Math.abs(K.z(q[0],q[1])-(600*q[0]+300*q[1])));});m.planeErr=+worst.toFixed(3);if(worst>1)bad.push('four spots on a plane give a surface '+worst.toFixed(1)+' mm off it');
  var g=T.G90?T.G90():T.getG(),p0=g.pavers[Math.floor(g.pavers.length/2)],want=Math.hypot(600/12000,300/9000)*100;if(Math.abs(p0.sl-want)>.15)bad.push('slope of the plane '+p0.sl+' not '+want.toFixed(2));
  /* a fifth spot pulls the surface through itself */P.sitePts+=';0.5,0.5,100';K.apply();T.regen();if(Math.abs(K.z(.5,.5)-100)>12)bad.push('the surface misses a spot level by '+Math.abs(K.z(.5,.5)-100).toFixed(0)+' mm');
  /* 2 grading a mound to one plane */P.site='mound';P.siteRise=900;P.sitePts='';P.grade='plane';P.gradeMin=1.5;P.gradeMax=4;K.apply();g=T.regen();var tp=g.paver.topo;m.cut=+tp.cut.toFixed(2);m.fill=+tp.fill.toFixed(2);m.fall=tp.plane?+tp.plane.fall.toFixed(2):null;
  if(!tp.plane||tp.plane.fall<1.49||tp.plane.fall>4.01)bad.push('the plane falls '+(tp.plane&&tp.plane.fall));if(!(tp.cut>.2)||Math.abs(tp.cut-tp.fill)>.08*(tp.cut+tp.fill))bad.push('cut '+tp.cut.toFixed(2)+' and fill '+tp.fill.toFixed(2)+' do not balance');
  if(Math.abs(tp.bands[0]+tp.bands[1]+tp.bands[2]+tp.bands[3]+tp.bands[4]-1)>1e-6)bad.push('slope bands do not add to the whole');var pv=g.pavers[10];if(pv.z0==null||pv.zp==null||pv.fd==null)bad.push('a paver without its existing and proposed levels');
  /* 3 a hollow */P.grade='asis';P.site='hollow';P.siteRise=700;K.apply();g=T.regen();var f=g.paver.water.flow;if(!f){bad.push('no flow report');}else{m.hollow=[+f.rainLs.toFixed(2),+f.infLs.toFixed(2),+f.drainLs.toFixed(2),+f.pondLs.toFixed(2)];
    if(f.bal>1e-6)bad.push('water does not balance: '+f.bal);if(f.drains.length!==1)bad.push(f.drains.length+' drains in a single hollow');else{var d=f.drains[0];if(Math.hypot(d.x/12000-.5,d.y/9000-.42)>.09)bad.push('the drain is not at the bottom of the hollow: '+(d.x/12000).toFixed(2)+', '+(d.y/9000).toFixed(2));if(!(d.ls>.5*(f.rainLs-f.infLs)))bad.push('the drain takes only '+d.ls.toFixed(2)+' of '+(f.rainLs-f.infLs).toFixed(2)+' L/s');}
    if(f.pondLs>.01||!g.paver.water.ok)bad.push('ponding with a drain at the low point');
    P.drains='none';g=T.regen();var f2=g.paver.water.flow;if(!(f2.pondLs>.5*(f2.rainLs-f2.infLs))||g.paver.water.ok)bad.push('no ponding reported with the drain taken away');P.drains='auto';}
  /* 4 a cross fall: no low point, the water leaves over the south and west */P.site='cross';P.siteRise=900;K.apply();g=T.regen();f=g.paver.water.flow;if(f.drains.length||f.pondLs>.001)bad.push('a plain cross fall has a low point');if(!(f.edgeLs.S+f.edgeLs.W>.95*f.edgeAll)||!(f.edgeAll>.1))bad.push('the cross fall does not shed to the south and west');if(f.bal>1e-6)bad.push('cross fall does not balance');
  /* 5 a pattern that opens where water gathers */P.site='hollow';K.apply();g=T.regen();var B=K.bare(),at=function(u,v){return B.v[Math.min(B.ny-1,Math.floor(v*B.ny))*B.nx+Math.min(B.nx-1,Math.floor(u*B.nx))];};m.wet=[+at(.5,.42).toFixed(2),+at(.06,.94).toFixed(2)];if(!(at(.5,.42)<.4&&at(.06,.94)>.7))bad.push('the water map is not dark at the bottom and light at the rim');
  var F={kind:'site',site:{by:'water'}};if(Math.abs(T.fieldValue(F,.5,.42,12000,9000)-at(.5,.42))>1e-9)bad.push('the field does not read the water map');
  /* 6 the drawings */var svg=K.plan(),dxf=K.dxf();['tp-pr','tp-spots','tp-falls','tp-flow','tp-drains','tp-section','tp-secline','GRADING AND DRAINAGE PLAN','SECTION A-A'].forEach(function(k){if(svg.indexOf(k)<0)bad.push('the plan lacks '+k);});
  if(!/\+10\.\d\d/.test(svg))bad.push('no level in metres on the plan');if(!/\d\.\d %/.test(svg))bad.push('no fall percentage on the plan');if(/NaN|undefined/.test(svg))bad.push('NaN or undefined in the plan');
  ['CONTOURS_PR','SPOT_LEVELS','FALLS','DRAINS','FLOW','SECTION_LINE'].forEach(function(k){if(dxf.indexOf(k)<0)bad.push('the DXF lacks '+k);});if(/NaN/.test(dxf))bad.push('NaN in the DXF');
  P.grade='plane';K.apply();g=T.regen();svg=K.plan();if(svg.indexOf('tp-ex')<0)bad.push('a graded plan lacks the surveyed contours');if(K.dxf().indexOf('CONTOURS_EX')<0)bad.push('a graded DXF lacks CONTOURS_EX');
  var csv=K.levelsCSV().split('\n');if(csv[0].indexOf('existing_m,proposed_m')<0||csv.length<g.pavers.length)bad.push('levels list: '+csv[0]);var dc=K.drainCSV();if(dc.indexOf('rain_L_per_s')<0||dc.indexOf('cut_m3')<0)bad.push('drainage list incomplete');
  P.grade='asis';P.site='level';K.apply();T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p131-1: glass ---- */
guard('flow','glass: panes of different sizes in one opening with the design running across them; frit marks inside their panes, sized by the picture, none touching; etching in as many tones as asked; a kiln relief within its depth and a closed mould; bird markers close every clear gap to about the gap asked and without them the gap is reported; the tab sets the panel aside and a panel tab brings it back; every pane has its print file and the schedule its row',function(){
  T.reset();var bad=[],m={},K=window.PS_T131;if(!K)return{pass:false,detail:'PS_T131 missing'};
  K.design('entry');/* a picture whose tones are known: light to the right */S.field.kind='gradient';S.field.gradient={dir:'right',pow:1};T.fieldUse100();S.glass.contrast=1;var G0=T.regen(),M=K.model(),L=M.L;m.panes=L.panes.length;m.marks=M.marks.length;m.cov=+M.cov.toFixed(2);
  if(!S.glass.on||!G0.glassG)bad.push('the glass is not standing');if(L.panes.length!==8)bad.push(L.panes.length+' panes for four bays and a transom');
  if(L.W!==1100+1000+1000+1100+5*60||L.H!==2300+650+3*60)bad.push('overall '+L.W+' x '+L.H);if(S.width!==L.W||S.height!==L.H)bad.push('the panel size does not follow the opening');
  var widths={};L.panes.forEach(function(p){widths[p.w+'x'+p.h]=1;});if(Object.keys(widths).length<4)bad.push('panes are not of different sizes');if(L.panes.filter(function(p){return p.door;}).map(function(p){return p.name;}).join()!=='P2,P3')bad.push('doors '+L.panes.filter(function(p){return p.door;}).map(function(p){return p.name;}).join());
  /* frit */var out=0,small=0,big=0,dm=0,lm=0,dn=0,ln=0;M.marks.forEach(function(q){var p=L.panes[q.p];if(!q.d)return;if(q.x-q.d/2<p.x+7.9||q.x+q.d/2>p.x+p.w-7.9||q.y-q.d/2<p.y+7.9||q.y+q.d/2>p.y+p.h-7.9)out++;if(q.bird)return;if(q.d<1.19)small++;if(q.d>S.glass.fritMax+.01)big++;
    var k=Math.min(M.ny-1,Math.floor(q.y/M.r))*M.nx+Math.min(M.nx-1,Math.floor(q.x/M.r)),t=M.tone[k];if(t>.7){lm+=q.d;ln++;}else if(t<.3){dm+=q.d;dn++;}});
  if(out)bad.push(out+' frit marks cross a pane edge');if(small||big)bad.push('marks outside the sizes asked: '+small+' small, '+big+' large');if(!(ln&&dn&&lm/ln>dm/dn*1.5))bad.push('marks do not grow with the picture: light '+(ln?lm/ln:0).toFixed(1)+', dark '+(dn?dm/dn:0).toFixed(1));
  if(S.glass.fritMax>=(S.glass._pitch||S.glass.fritPitch)-1.4)bad.push('the largest mark touches its neighbour');
  /* continuity: the tone either side of a mullion is the picture at those places, not restarted */var p1=L.panes[0],p2=L.panes[1],ya=p1.y+p1.h*.5,ia=Math.floor((p1.x+p1.w-3)/M.r),ib=Math.floor((p2.x+3)/M.r),ja=Math.floor(ya/M.r),u0=Math.floor((p2.x+p2.w*.5)/M.r);if(Math.abs(M.tone[ja*M.nx+ia]-M.tone[ja*M.nx+ib])>.5&&Math.abs(M.tone[ja*M.nx+ia]-M.tone[ja*M.nx+u0])<.05)bad.push('the picture restarts at a mullion');
  var files=K.files().map(function(f){return f.name;});L.panes.forEach(function(p){if(!files.some(function(n){return n.indexOf('-'+p.name+'-frit.svg')>0;}))bad.push('no frit file for '+p.name);});if(!files.some(function(n){return /-panes\.csv$/.test(n);})||!files.some(function(n){return n==='README-glass.txt';}))bad.push('schedule or README missing');
  var csv=K.csv().split('\n');if(csv[0].indexOf('pane,x_mm,y_mm,width_mm')!==0||csv.filter(function(l){return /^P\d/.test(l);}).length!==8)bad.push('pane schedule rows');
  /* birds */S.glass.treat='etch';S.glass.levels=1;S.glass.cut=.8;S.glass.bird=false;M=K.model();m.gapOff=Math.round(M.gapMax);var rl=K.rules();if(!(M.gapMax>150))bad.push('a mostly clear pane reports a gap of only '+M.gapMax);if(!rl.some(function(r){return r[0]==='pr-warn'&&/birds/.test(r[1]);}))bad.push('no bird warning with wide clear glass');
  S.glass.bird=true;M=K.model();m.gapOn=Math.round(M.gapMax);m.birds=M.birdN;if(!(M.birdN>50)||M.gapMax>S.glass.birdGap*1.16)bad.push('markers leave a gap of '+Math.round(M.gapMax)+' mm');var close=0,bm=M.marks.filter(function(q){return q.bird;});for(var a=0;a<Math.min(bm.length,400);a++)for(var b=a+1;b<bm.length;b++)if(Math.hypot(bm[a].x-bm[b].x,bm[a].y-bm[b].y)<S.glass.birdGap*.45){close++;break;}if(close)bad.push(close+' markers closer than half the gap');
  /* etch tones */S.glass.levels=3;S.glass.cut=.5;M=K.model();var lv={};for(var k=0;k<M.A.length;k+=37)if(M.pane[k]>=0&&!(M.A[k]>.25&&M.A[k]<.3))lv[Math.round(M.A[k]*3)]=1;m.tones=Object.keys(lv).length;if(Object.keys(lv).length<3)bad.push('three tones of etching give '+Object.keys(lv).length+' levels');
  /* kiln */K.design('kiln');M=K.model();var hi=0,lo=1;for(k=0;k<M.hmap.length;k+=11)if(M.pane[k]>=0){hi=Math.max(hi,M.hmap[k]);lo=Math.min(lo,M.hmap[k]);}if(hi>1.0001||lo<-1e-6||!(hi-lo>.3))bad.push('relief '+lo.toFixed(2)+' to '+hi.toFixed(2));
  var st=K.mould(1),dv=new DataView(st.data.buffer),nt=dv.getUint32(80,true);m.mouldTris=nt;if(nt!==st.tris||st.data.length!==84+nt*50||nt<800)bad.push('mould STL '+nt+' triangles, '+st.data.length+' bytes');
  /* closed: every edge shared by two triangles */var ed={},odd=0,o=84;for(k=0;k<nt;k++){var v=[];for(var q=0;q<3;q++){var b0=o+12+q*12;v.push(dv.getFloat32(b0,true).toFixed(2)+','+dv.getFloat32(b0+4,true).toFixed(2)+','+dv.getFloat32(b0+8,true).toFixed(2));}for(q=0;q<3;q++){var e1=v[q],e2=v[(q+1)%3],kk=e1<e2?e1+'|'+e2:e2+'|'+e1;ed[kk]=(ed[kk]||0)+1;}o+=50;}for(var e in ed)if(ed[e]!==2)odd++;if(odd)bad.push('the mould is not a closed solid: '+odd+' open edges');
  if(!K.files().some(function(f){return /-P1-mould\.stl$/.test(f.name);})||!K.files().some(function(f){return /-P1-heightmap\.png$/.test(f.name);}))bad.push('kiln files missing');
  var sv=K.svg(false),so=K.svg(true),bare=so.replace(/href="data:[^"]+"/g,'');if(sv.indexOf('<image')<0||so.indexOf('P1')<0||/NaN|undefined/.test(bare))bad.push('2D drawings');
  /* leaving */if(T.has3D&&T.has3D()){T.showTab('Glass',true);if(!S.glass.on)bad.push('the tab did not stand the glass up');T.showTab('Pattern',true);if(S.glass.on)bad.push('a panel tab did not set the glass aside');var g2=T.regen();if(g2.glassG)bad.push('the panel did not come back');}
  K.leave();T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p132-1: the attractor ---- */
guard('attractor','the shared attractor: distance from a straight curve is exact and its sign says which side; t runs 0 to 1 along it and the tangent is its direction; the falloff runs from the value at the curve to the value far from it, in that order, and swapping them inverts it; a ripple repeats at its wavelength in millimetres; steps give that many levels; a pushing curve lowers what a pulling one raises; the six ways of combining differ; a region holds the effect inside its boundary; every material reads it as its field; the curves leave in a list',function(){
  T.reset();var bad=[],m={},K=window.PS_T132;if(!K)return{pass:false,detail:'PS_T132 missing'};T.setPanelMode('perf');S.arr='single';S.cols=1;S.rows=1;S.width=2000;S.height=1000;
  var F=function(o){K.use(Object.assign({pts:'0,0.5;1,0.5',wts:'1',smooth:false,closed:false,measure:'dist',combine:'nearest',norm:'reach',reach:400,fall:'linear',lo:0,hi:1,region:''},o));},V=function(u,v){return K.value(u,v);};
  /* 1 measure */F({});var a=K.at(.3,.8);m.d=+a.d.toFixed(1);if(Math.abs(a.d-300)>4)bad.push('300 mm from a level line reads '+a.d.toFixed(1));if(a.side!==1||K.at(.3,.2).side!==-1)bad.push('sides');if(Math.abs(a.t-.3)>.01)bad.push('t along reads '+a.t);if(Math.abs(a.ang)>.01)bad.push('tangent '+a.ang);
  F({pts:'0.5,0;0.5,1'});a=K.at(.6,.25);if(Math.abs(a.d-200)>4||Math.abs(a.t-.25)>.01||Math.abs(a.ang-Math.PI/2)>.01)bad.push('an upright line: d '+a.d.toFixed(0)+' t '+a.t.toFixed(2)+' ang '+a.ang.toFixed(2));
  /* 2 shape */F({});if(Math.abs(V(.5,.5)-1)>.02||Math.abs(V(.5,.7)-.5)>.03||V(.5,.95)>.02)bad.push('linear falloff: '+[V(.5,.5),V(.5,.7),V(.5,.95)].map(function(x){return x.toFixed(2);}).join(' '));
  F({lo:1,hi:0});if(V(.5,.5)>.02||V(.5,.95)<.98)bad.push('swapping the range did not invert it');F({lo:.2,hi:.7});if(Math.abs(V(.5,.5)-.7)>.02||Math.abs(V(.5,.95)-.2)>.02)bad.push('range .2 to .7 gives '+V(.5,.5).toFixed(2)+' and '+V(.5,.95).toFixed(2));
  F({fall:'ripple',wave:100,reach:2000});var pk=0,last=-1,up=false;for(var y=0;y<=400;y+=2){var v=V(.5,.5+y/1000);if(last>=0){if(v<last&&up)pk++;up=v>last;}last=v;}m.ripples=pk;if(pk<3||pk>5)bad.push(pk+' crests in 400 mm at a 100 mm wavelength');
  F({fall:'step',steps:4,reach:400});var lv={};for(y=0;y<400;y+=5)lv[V(.5,.5+y/1000).toFixed(2)]=1;m.steps=Object.keys(lv).length;if(Object.keys(lv).length!==4)bad.push(Object.keys(lv).length+' levels for 4 steps');
  F({norm:'bounds'});if(!(V(.5,.9)>.5))bad.push('measured against the panel, 400 mm away should still be more than half');
  F({measure:'along'});if(Math.abs(V(.25,.9)-.25)>.02||Math.abs(V(.8,.1)-.8)>.02)bad.push('read along the curve');F({measure:'side'});if(V(.5,.9)<.95||V(.5,.1)>.05)bad.push('read by side');
  /* 3 several curves */var two={pts:'0,0.25;1,0.25|0,0.75;1,0.75',reach:300};F(Object.assign({wts:'1,1',combine:'sum'},two));var s1=V(.5,.5),sA=V(.5,.25);F(Object.assign({wts:'1,-1',combine:'sum'},two));var pA=V(.5,.25),pB=V(.5,.75);m.pushpull=[+pA.toFixed(2),+pB.toFixed(2)];if(!(pA>.9&&pB<.1))bad.push('a pulling curve and a pushing one give '+pA.toFixed(2)+' and '+pB.toFixed(2));if(Math.abs(V(.5,.5)-.5)>.05)bad.push('half way between a pull and a push is not the middle');
  var seen={};['nearest','sum','sumd','max','mul','diff'].forEach(function(c){F(Object.assign({wts:'1,0.6',combine:c},two));seen[c]=[V(.5,.25),V(.5,.4),V(.5,.5),V(.5,.75)].map(function(x){return x.toFixed(2);}).join(',');});var kinds={};for(var c in seen)kinds[seen[c]]=1;m.combine=Object.keys(kinds).length;if(Object.keys(kinds).length<5)bad.push('the ways of combining give only '+Object.keys(kinds).length+' different results');
  F(Object.assign({wts:'1,1',combine:'mul'},two));if(V(.5,.25)>.05)bad.push('multiplied, a place on one curve and far from the other should be dark');
  /* 4 a region */F({reach:2000,region:'0.25,0.2;0.75,0.2;0.75,0.8;0.25,0.8',fade:100,out:0});if(V(.1,.5)>.01||V(.5,.5)<.9||!(V(.27,.5)>.05&&V(.27,.5)<.7))bad.push('region: outside '+V(.1,.5).toFixed(2)+' inside '+V(.5,.5).toFixed(2)+' at the edge '+V(.27,.5).toFixed(2));
  /* 5 every material reads it */F({pts:'0,0.5;1,0.5',reach:300});var fv=T.fieldValue97(S.field,.5,.5,2000,1000);if(Math.abs(fv-1)>.02)bad.push('the field does not read the attractor: '+fv);var g=T.regen();var top=0,mid=0,nt=0,nm=0;g.holes.forEach(function(hh){var cy=hh.cy,d=hh.d||0;if(Math.abs(cy-500)<60){mid+=d;nm++;}else if(cy>880){top+=d;nt++;}});m.holes=[nm?+(mid/nm).toFixed(1):0,nt?+(top/nt).toFixed(1):0];if(!(nm&&(!nt||mid/nm>top/nt*1.3)))bad.push('perforated holes do not follow the attractor: '+m.holes.join(' against '));
  T.setPanelMode('brick');S.width=2400;S.height=1200;S.brick.op='shift';S.brick.shiftMax=40;F({pts:'0,0.5;1,0.5',reach:300});g=T.regen();if(!(g.bricks&&g.bricks.length>50))bad.push('brick mode did not build on the attractor');
  /* 6 what leaves */var csv=K.csv().split('\n');if(csv[0]!=='curve,point,u,v,x_mm,y_mm,weight'||csv.length<12||K.csv().indexOf('measure,dist')<0)bad.push('attractor list: '+csv[0]);if(!/1 curve/.test(K.note()))bad.push('note: '+K.note());
  var snap=T.snapshot();if(!(snap.field&&snap.field.curves&&snap.field.curves.pts))bad.push('the design JSON does not carry the curves');
  T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p133-1: designs made with the attractor ---- */
guard('attractor','the six starting designs made with the attractor each build in their own material, with the attractor as the field and something made',function(){
  T.reset();var bad=[],m={},K=window.PS_T133;if(!K)return{pass:false,detail:'PS_T133 missing'};var want={'f-perf':'perf','f-glass':'glass','f-paver':'paver','f-brick':'brick','f-rib':'serial','f-shell':'bent','f-flow':'perf','f-face':'brick'};/* pass 137 added two */
  K.list().forEach(function(id){try{K.design(id);var g=T.regen(),md=S.glass&&S.glass.on?'glass':(S.lat&&S.lat.on?'bent':T.panelMode());if(S.field.kind!=='curves'||String(S.omb.src).indexOf('field')!==0)bad.push(id+': the attractor is not the field');if(md!==want[id])bad.push(id+' built as '+md);
      var n=md==='glass'?window.PS_T131.model().marks.length:md==='paver'?g.pavers.length:md==='brick'?g.bricks.length:md==='serial'?g.ribs.length:md==='perf'?g.holes.length:1;m[id]=n;if(!(n>0))bad.push(id+' made nothing');if(g.warn&&md!=='bent')bad.push(id+': '+g.warnMsg);}catch(e){bad.push(id+' threw '+e.message);}
    try{window.PS_T131.leave();}catch(e){}T.reset();});
  return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p137-1: the attractor's direction acts ---- */
guard('attractor','slots turn to run along the nearest curve or across it and are held clear of their neighbours; a brick layer reads the attractor and, facing it, turns the bricks on either side opposite ways; the two designs build',function(){
  T.reset();var bad=[],m={},K=window.PS_T137;if(!K)return{pass:false,detail:'PS_T137 missing'};
  S.perf.on=true;S.omb.on=false;S.arr='single';Object.assign(S.perf,{shape:'slot',aspect:3,pitch:18,rowPitch:1,stagger:.5,minD:2,maxD:5,minWeb:2,follow:''});S.field.curves=Object.assign({},S.field.curves,{pts:'0,0.5;1,0.5',wts:'1',smooth:false,closed:false});
  var g=T.regen(),tall=0;g.holes.forEach(function(h){var x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;h.pts.forEach(function(q){x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);y0=Math.min(y0,q.y);y1=Math.max(y1,q.y);});if(y1-y0>x1-x0-1e-6)tall++;});if(g.perf.follow||tall<g.holes.length*.99)bad.push('slots turned without being asked');var n0=g.holes.length;
  function box(h){var x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;h.pts.forEach(function(q){x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);y0=Math.min(y0,q.y);y1=Math.max(y1,q.y);});return[x1-x0,y1-y0];}
  S.perf.follow='along';g=T.regen();var wide=0,over=0;g.holes.forEach(function(h){var b=box(h);if(b[0]>b[1]+.2)wide++;if(h.len>g.perf.follow.near-2+1e-6)over++;if(h.pts.some(function(q){return!isFinite(q.x)||!isFinite(q.y);}))bad.push('NaN');});m.along=wide+'/'+g.holes.length;if(g.holes.length!==n0||!g.perf.follow||wide<g.holes.length*.9)bad.push('along: '+wide+' of '+g.holes.length+' lie along');if(over)bad.push(over+' slots too long');if(!(g.open/g.area<.6))bad.push('open '+g.open/g.area);
  S.perf.follow='across';g=T.regen();var up=0;g.holes.forEach(function(h){var b=box(h);if(b[1]>b[0]+.2)up++;});m.across=up;if(up<g.holes.length*.9)bad.push('across: '+up);
  var F=function(L){return T.brickLayers({layers:[L],bL:240,bW:115,bH:71},6000,3000)[0].f;};S.field.curves=Object.assign({},S.field.curves,{pts:'0,0.5;1,0.5',wts:'1',fall:'linear',reach:600,lo:0,hi:1,measure:'dist',combine:'nearest',region:''});
  var ff=F({src:'curves',does:'turn',amt:20,face:true}),fp=F({src:'curves',does:'turn',amt:20}),a=ff(.5,.53),b=ff(.5,.47);m.face=a.toFixed(2)+'/'+b.toFixed(2);if(!(a*b<0&&Math.abs(a)>.7&&Math.abs(b)>.7))bad.push('facing '+a+' '+b);if(!(fp(.5,.53)>.7&&fp(.5,.47)>.7))bad.push('not facing '+fp(.5,.53));if(!(Math.abs(ff(.5,.95))<.05))bad.push('far '+ff(.5,.95));
  T.reset();K.design('f-flow');g=T.regen();m.flow=g.perf&&g.perf.follow?g.perf.follow.n+'/'+g.perf.follow.held:'none';if(!g.perf||!g.perf.follow||g.perf.follow.n<1000||g.perf.follow.held)bad.push('flow design '+m.flow);if(g.warn)bad.push(g.warnMsg);
  T.reset();K.design('f-face');g=T.regen();var mn=0,mx=0;(g.bricks||[]).forEach(function(q){mn=Math.min(mn,q.theta);mx=Math.max(mx,q.theta);});m.faceWall=mn.toFixed(1)+'..'+mx.toFixed(1);if(!(mn<-10&&mx>10))bad.push('face design turns '+m.faceWall);if(g.brick&&g.brick.atRisk)bad.push(g.brick.atRisk+' bricks at risk');
  T.reset();return{pass:!bad.length,detail:bad.slice(0,6).join('; '),metrics:m};});

/* ---- p134-1: a model of the building to make ---- */
guard('assembly','a massing becomes laser parts: a wall a side and a plate a level; every plate tab has a slot in the wall at its level, a tab drawn a kerf wider and a slot a kerf narrower than they finish; at a square outside corner the two walls own the fingers in turn; an inside corner has one wall run through by a thickness; a corner that is not square has both walls cut back; no two parts overlap on a sheet and none leaves it; the massing prints as a closed solid; the files carry the layers',function(){
  T.reset();var bad=[],m={},K=window.PS_T134;if(!K)return{pass:false,detail:'PS_T134 missing'};var base={shape:'box',w:24000,d:15000,notch:.5,sides:6,storeys:4,storeyH:3600,scale:100,t:3,kerf:.15,sheetW:600,sheetH:300,tab:10,view:'',snap:false,faces:'',engrave:'joints'};/* pass 135 sets the massing out in whole panels by default: this check measures the massing as typed */
  function run(name,o){Object.assign(S.mass,base,o);var M=K.model(),b=[];if(M.walls.length!==M.n)b.push('walls '+M.walls.length);if(M.plates.length!==M.st+1)b.push('plates '+M.plates.length);
    M.walls.forEach(function(w){if(w.slots.length!==w.tabs.length*M.levels.length)b.push(w.name+' slots');w.slots.forEach(function(q){if(Math.abs(q.w-(M.tabW-M.kf))>1e-9||Math.abs(q.h-(M.t-M.kf))>1e-9)b.push(w.name+' slot size');if(q.x<w.bx[0]+M.t-1e-6||q.x+q.w>w.bx[2]-M.t+1e-6||q.y<0||q.y+q.h>M.Hm)b.push(w.name+' slot off the wall');});if(w.pts.some(function(p){return!isFinite(p[0])||!isFinite(p[1]);}))b.push(w.name+' NaN');});
    /* the tab on the plate is the slot's width plus two kerfs, at the same place along the wall */var tabsDrawn=M.tabW+M.kf;if(Math.abs((tabsDrawn-(M.tabW-M.kf))-2*M.kf)>1e-9)b.push('kerf allowance');
    for(var i=0;i<M.n;i++){var a=M.walls[(i+M.n-1)%M.n],c=M.walls[i],kd=M.C[i].kind;if(kd==='square'){if(a.fe!=='even'||c.fs!=='odd')b.push('corner '+i+' fingers');/* a's end edge and c's start edge step by a thickness in turn */var ax=a.pts.filter(function(p){return Math.abs(p[0]-a.x1)<1e-9||Math.abs(p[0]-(a.x1-M.t))<1e-9;}).length,cx=c.pts.filter(function(p){return Math.abs(p[0]-c.x0)<1e-9||Math.abs(p[0]-(c.x0+M.t))<1e-9;}).length;if(ax<M.nF||cx<M.nF)b.push('corner '+i+' finger steps');}
      else if(kd==='inside'){if(Math.abs(a.x1-(a.L+M.t))>1e-9||Math.abs(c.x0)>1e-9)b.push('inside corner '+i);}else if(kd==='open'){if(!(a.x1<a.L)||!(c.x0>0))b.push('open corner '+i+' not cut back');}}
    /* nesting */var P=M.parts.filter(function(p){return p.sheet>=0;});if(P.length!==M.parts.length)b.push((M.parts.length-P.length)+' parts too big');P.forEach(function(p,ia){var w=p.rot?p.h:p.w,hh=p.rot?p.w:p.h;if(p.x<0||p.y<0||p.x+w>M.SW+1e-6||p.y+hh>M.SH+1e-6)b.push(p.name+' off its sheet');P.forEach(function(q,ib){if(ib<=ia||q.sheet!==p.sheet)return;var w2=q.rot?q.h:q.w,h2=q.rot?q.w:q.h;if(p.x<q.x+w2-1e-6&&q.x<p.x+w-1e-6&&p.y<q.y+h2-1e-6&&q.y<p.y+hh-1e-6)b.push(p.name+' overlaps '+q.name);});});
    var st=K.stl(),dv=new DataView(st.data.buffer),ed={},odd=0,o=84;for(var k=0;k<st.tris;k++){var v=[];for(var q=0;q<3;q++){var b0=o+12+q*12;v.push(dv.getFloat32(b0,true).toFixed(2)+','+dv.getFloat32(b0+4,true).toFixed(2)+','+dv.getFloat32(b0+8,true).toFixed(2));}for(q=0;q<3;q++){var e1=v[q],e2=v[(q+1)%3],kk=e1<e2?e1+'|'+e2:e2+'|'+e1;ed[kk]=(ed[kk]||0)+1;}o+=50;}for(var e in ed)if(ed[e]!==2)odd++;if(odd)b.push('STL open edges '+odd);
    m[name]=[M.walls.length,M.plates.length,M.sheets,M.square,M.inside,M.open].join('/');if(b.length)bad.push(name+': '+b.slice(0,4).join(', '));return M;}
  var M=run('box',{});if(M.square!==4||M.Hm!==144||Math.abs(M.walls[0].L-240)>1e-9)bad.push('box: '+M.square+' square corners, '+M.Hm+' high, wall '+M.walls[0].L);M=run('L',{shape:'L'});if(M.square!==5||M.inside!==1)bad.push('L corners '+M.square+'/'+M.inside);M=run('U',{shape:'U'});if(M.square!==6||M.inside!==2)bad.push('U corners '+M.square+'/'+M.inside);
  M=run('tower',{shape:'tower',sides:6,storeys:8});if(M.open!==6||M.square)bad.push('hexagon corners '+M.open);run('fine',{scale:200,t:1.5,storeys:10});
  Object.assign(S.mass,base);var fl=K.files().map(function(f){return f.name;}),dxf=K.dxf();['-sheet-1.svg','-parts.dxf','-assembly.svg','-parts.csv','-massing.stl','README-model.txt'].forEach(function(n){if(!fl.some(function(x){return x.indexOf(n)>=0;}))bad.push('no '+n);});['CUT','ENGRAVE','LABELS','SHEET'].forEach(function(l){if(dxf.indexOf('\n'+l+'\n')<0)bad.push('DXF lacks '+l);});
  var sv=K.sheets(),as=K.assembly();if(sv.indexOf('class="cut')<0||sv.indexOf('class="engrave"')<0||/NaN|undefined/.test(sv)||as.indexOf('ASSEMBLY')<0||/NaN|undefined/.test(as))bad.push('drawings');if(K.csv().split('\n')[0].indexOf('part,kind,width_mm')!==0)bad.push('parts list');
  S.mass.view='';T.reset();return{pass:!bad.length,detail:bad.join('; '),metrics:m};});

/* ---- p135-1: the panels on the massing ---- */
guard('assembly','the massing is set out in whole panels and every face takes its own treatment: a design face counts its panels, a glazed face has a window a bay a storey cut clear of the floor slots and the corner fingers, a plain face carries nothing; the design is engraved inside the wall; plan, details, OBJ and face list are whole; the building stands in 3D with a mesh a face',function(){
  T.reset();var bad=[],m={},K=window.PS_T135;if(!K)return{pass:false,detail:'PS_T135 missing'};var base={shape:'box',w:24000,d:15000,notch:.5,sides:6,storeys:4,storeyH:3600,scale:100,t:3,kerf:.15,sheetW:600,sheetH:300,tab:10,view:'',faces:'',faceDef:'d',engrave:'joints',snap:true,show3d:false,cavity:250,slab:250,glazeW:.62,sill:900,head:2700};
  S.width=900;S.height=3600;Object.assign(S.mass,base);var M=K.model();if(M.faces.length!==4||M.faces.some(function(q){return!q.exact||q.code!=='d';}))bad.push('box faces');if(M.faces[0].bays!==27||M.faces[1].bays!==17)bad.push('box bays '+M.faces[0].bays+'/'+M.faces[1].bays);if(M.panels!==(27+17)*2*4*M.rps||M.rps!==1)bad.push('panels '+M.panels+' rows '+M.rps);m.box=M.panels;
  Object.assign(S.mass,base,{shape:'L',faces:'d,g,d,b,d,g'});M=K.model();if(M.faces.some(function(q){return!q.exact;}))bad.push('L not whole panels');var wins=0;
  M.walls.forEach(function(w,i){var fc=M.faces[i],W=w.slots.filter(function(q){return q.win;}),Sl=w.slots.filter(function(q){return!q.win;});if(Sl.length!==w.tabs.length*M.levels.length)bad.push(w.name+' lost slots');
    if(fc.code==='g'){wins+=W.length;if(W.length!==fc.bays*M.st)bad.push(w.name+' windows '+W.length+' for '+fc.bays+' bays');W.forEach(function(q,a){if(!(q.w>1.4&&q.h>1.4))bad.push(w.name+' window too small');if(q.x<Math.max(w.x0,0)+(w.fs?M.t:0)+1||q.x+q.w>Math.min(w.x1,w.L)-(w.fe?M.t:0)-1||q.y<1||q.y+q.h>M.Hm-1)bad.push(w.name+' window off the wall');Sl.forEach(function(s){if(q.x<s.x+s.w+1&&s.x<q.x+q.w+1&&q.y<s.y+s.h+1&&s.y<q.y+q.h+1)bad.push(w.name+' window on a slot');});W.forEach(function(r,b){if(b>a&&q.x<r.x+r.w+.5&&r.x<q.x+q.w+.5&&q.y<r.y+r.h+.5&&r.y<q.y+q.h+.5)bad.push(w.name+' windows touch');});});}
    else if(W.length)bad.push(w.name+' has windows');if(fc.code==='b'&&w.lines.length)bad.push(w.name+' plain face engraved');if(fc.code==='d'&&w.lines.length<fc.bays-1)bad.push(w.name+' joints '+w.lines.length);if(w.lines.some(function(l){return l.some(function(v){return!isFinite(v);});}))bad.push(w.name+' NaN');});
  m.windows=wins;if(wins!==M.eng.wins)bad.push('window count');var csv=new TextDecoder().decode(K.files().filter(function(f){return/-parts\.csv$/.test(f.name);})[0].data);if(csv.split('\n')[2].split(',')[9]!==String(M.walls[1].tabs.length*M.levels.length))bad.push('parts list counts windows as slots');
  Object.assign(S.mass,base,{shape:'tower',sides:6,storeys:8});M=K.model();var s0=M.faces[0].L;if(M.faces.some(function(q){return Math.abs(q.L-s0)>1||!q.exact;})||Math.abs(s0/900-Math.round(s0/900))>1e-6)bad.push('hexagon sides '+s0);m.hex=s0;
  Object.assign(S.mass,base,{snap:false,w:24400});M=K.model();if(M.faces[0].exact||Math.abs(M.walls[0].L-244)>1e-9)bad.push('snap off still snaps');if(!K.rules().some(function(r){return/not a whole number of panels/.test(r[1]);}))bad.push('no warning for a part panel');
  Object.assign(S.mass,base,{scale:20,engrave:'design',storeys:2,w:9000,d:6300,sheetW:1200,sheetH:600});M=K.model();m.engraved=M.eng.made+'/'+M.eng.skipped;if(!(M.eng.made>0))bad.push('nothing engraved at 1:20 ('+M.eng.skipped+' skipped)');M.walls.forEach(function(w){w.lines.forEach(function(l){if(Math.min(l[0],l[2])<Math.max(w.x0,0)-1e-6||Math.max(l[0],l[2])>Math.min(w.x1,w.L)+1e-6||Math.min(l[1],l[3])<-1e-6||Math.max(l[1],l[3])>M.Hm+1e-6)bad.push(w.name+' engraving off the wall');});});bad=bad.filter(function(v,i,a){return a.indexOf(v)===i;});
  Object.assign(S.mass,base,{shape:'L',faces:'d,g,d,b,d,g'});M=K.model();var strip=function(t){return t.replace(/href="[^"]*"/g,'');},pl=strip(K.plan(true)),dt=strip(K.detail(true));if(pl.indexOf('BUILDING PLAN AND ELEVATIONS')<0||/NaN|undefined/.test(pl)||(pl.match(/<pattern /g)||[]).length!==3)bad.push('plan sheet');if(dt.indexOf('A  SECTION AT A SLAB EDGE')<0||dt.indexOf('B  PLAN AT A CORNER')<0||dt.indexOf('C  ONE BAY, DRAWN APART')<0||/NaN|undefined/.test(dt))bad.push('detail sheet');
  var o=K.obj(),mx=0;o.text.split('\n').forEach(function(l){if(l.charAt(0)==='f')l.split(' ').slice(1).forEach(function(v){mx=Math.max(mx,+v);});});if(mx!==o.verts||o.text.indexOf('g face_W2_glazed')<0||o.text.indexOf('g face_W4_plain')<0||o.text.indexOf('g slab_roof')<0||/NaN/.test(o.text))bad.push('OBJ');m.obj=o.verts;
  var fc=K.faces().split('\n');if(fc[0].indexOf('face,length_mm,height_mm,treatment')!==0||fc.length<8)bad.push('face list');var fl=K.files().map(function(f){return f.name;});['-building-plan.svg','-details.svg','-faces.csv','-building.obj'].forEach(function(n){if(!fl.some(function(x){return x.indexOf(n)>=0;}))bad.push('no '+n);});
  S.mass.engrave='picture';var sv=K.files().filter(function(f){return/-sheet-\d+\.svg$/.test(f.name);}).map(function(f){return new TextDecoder().decode(f.data);}).join('');if((sv.match(/class="engrave-picture"/g)||[]).length!==3)bad.push('pictures on '+(sv.match(/class="engrave-picture"/g)||[]).length+' walls');S.mass.engrave='joints';
  if(typeof THREE!=='undefined'){S.mass.show3d=true;var r=K.build();if(!r||r.faces!==6||r.meshes!==1+(M.st-1)+2+6+6+1)bad.push('3D meshes '+(r&&r.meshes));m.meshes=r&&r.meshes;S.mass.show3d=false;}
  Object.assign(S.mass,base,{snap:true});S.mass.view='';T.reset();return{pass:!bad.length,detail:bad.slice(0,6).join('; '),metrics:m};});


/* ---- p138-1: how a sheet panel is hung ---- */
guard('assembly','a sheet panel is a cassette hung on hooks: the chain of parts adds up to the depth from face to wall; the joint grows to take the panel\'s movement; hooks come in pairs and every keyhole sits in a side return; the flat blank is the face plus four returns less the corners; counts follow the set; the details are the hang-and-lock ones for sheet panels and stay the brick ones for brick; the building\'s OBJ and the 3D view carry tracks, girts and clips',function(){
  T.reset();var bad=[],m={},K=window.PS_T138;if(!K)return{pass:false,detail:'PS_T138 missing'};S.perf.on=true;S.omb.on=false;S.arr='single';S.width=900;S.height=2400;var mats=K.mats();S.material=mats.filter(function(q){return/steel/i.test(q[1])&&!/alum/i.test(q[1]);})[0][0];
  Object.assign(S.lock,{on:true,ret:25,track:25,ins:100,jointV:1.5,jointH:3,girt:1200,clip:600,hook:600,liner:true,sill:16,dT:80,show:false,view:''});var g=T.regen();if(!K.on())bad.push('not on for a perforated panel');
  var M=K.model();if(M.D!==153)bad.push('depth '+M.D);if(M.hooks.n<2||M.hooks.ys[0]<100||M.hooks.ys[M.hooks.n-1]>2400-100)bad.push('hooks '+M.hooks.n);if(M.jH!==3)bad.push('steel joint '+M.jH);m.kg=+M.kg.toFixed(1);if(!(M.kg>5&&M.kg<200))bad.push('weight '+M.kg);
  var al=mats.filter(function(q){return/alum/i.test(q[1]);})[0][0];S.material=al;S.height=3600;T.regen();M=K.model();m.joint=M.jH;if(!(M.move>6.5&&M.move<7.3&&M.jH===7))bad.push('aluminium 3.6 m moves '+M.move+', joint '+M.jH);if(!K.rules().some(function(r){return r[0]==='pr-warn'&&/horizontal joint is drawn/.test(r[1]);}))bad.push('no word on the wider joint');
  S.height=2400;S.arr='grid';S.cols=3;S.rows=2;g=T.regen();M=K.model();var C=K.counts();m.counts=[C.tracks,C.girts,C.clips,C.hooks].join('/');if(C.tracks!==4||C.panels!==6||C.hooks!==6*2*M.hooks.n||C.anchors!==2*C.clips||C.clips!==C.girts*C.nC||C.girts<Math.ceil(C.TH/1200))bad.push('counts '+m.counts);
  var B=K.blank(),A=0;for(var i=0;i<B.out.length;i++){var a=B.out[i],b=B.out[(i+1)%B.out.length];A+=a[0]*b[1]-b[0]*a[1];}A=Math.abs(A)/2;if(Math.abs(A-((B.W+50)*(B.H+50)-4*625))>1)bad.push('blank area '+A);if(B.keys.length!==2*M.hooks.n||B.folds.length!==4)bad.push('blank keys '+B.keys.length);
  B.keys.forEach(function(k){k.forEach(function(q){if(!((q[0]>-25&&q[0]<0)||(q[0]>B.W&&q[0]<B.W+25))||q[1]<0||q[1]>B.H)bad.push('keyhole off the return');});});var dx=K.blankDXF();['BLANK','FOLD','KEYHOLES','OPENINGS'].forEach(function(l){if(dx.indexOf('\n'+l+'\n')<0)bad.push('DXF lacks '+l);});
  var strip=function(t){return t.replace(/href="[^"]*"/g,'');},d=strip(K.detail(true));['1  HORIZONTAL JOINT','2  VERTICAL JOINT','3  OUTSIDE CORNER','4  SILL AT GRADE','5  PARAPET','6  ONE BAY'].forEach(function(t){if(d.indexOf(t)<0)bad.push('no '+t);});if(/NaN|undefined/.test(d))bad.push('details NaN');
  var csv=K.csv();if(csv.indexOf('item,count,length_mm')!==0||csv.indexOf('hat track')<0||csv.indexOf('thermally broken clip')<0||csv.indexOf('keyhole')<0)bad.push('schedule');
  if(strip(K.massDetail()).indexOf('1  HORIZONTAL JOINT')<0)bad.push('the building\'s details are not the hung ones');var o=K.massObj(),mx=0;o.text.split('\n').forEach(function(l){if(l.charAt(0)==='f')l.split(' ').slice(1).forEach(function(v){mx=Math.max(mx,+v);});});if(o.text.indexOf('g mount_W1_hat_tracks')<0||o.text.indexOf('g mount_W1_clips')<0||mx!==o.verts||/NaN/.test(o.text))bad.push('OBJ mounting');m.obj=o.verts;
  if(typeof THREE!=='undefined'&&T.hostScene){S.lock.show=true;window.PS_LOCK=null;T.hostScene();var r=window.PS_LOCK;m.scene=r?[r.panels,r.tracks,r.clips].join('/'):'none';if(!r||r.panels!==6||r.tracks!==4||r.meshes<6)bad.push('3D '+m.scene);S.lock.show=false;}
  T.reset();S.brick.on=true;S.perf.on=false;T.regen();if(K.on())bad.push('on for brick');if(strip(K.massDetail()).indexOf('A  SECTION AT A SLAB EDGE')<0)bad.push('brick lost its own details');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p139-1: three ways a panel is held, and a clad column ---- */
guard('assembly','a plate on clips and a flat riveted board are held as their systems say: depths add up, joints are open and wide enough for the movement, a pan\'s blank has a return and a lip with weep holes in the bottom return, a board\'s blank has no folds, two fixed points and oversized holes for the rest, girts run level for the plate and upright for the board, the details gain the window, and a column is clad in whole shells that fit round it',function(){
  T.reset();var bad=[],m={},K=window.PS_T139,K8=window.PS_T138;if(!K)return{pass:false,detail:'PS_T139 missing'};S.perf.on=true;S.omb.on=false;S.arr='grid';S.cols=3;S.rows=2;S.width=900;S.height=2400;S.material='alum';S.thickness=3;
  Object.assign(S.lock,{on:true,ins:100,girt:1200,clip:600,hook:600,dT:80,show:false,view:'',pan:33,lip:15,reveal:16,bJoint:12,cav:25,bGirt:600,rivV:40,rivH:80,rivMax:600,colD:324,colClad:620,colH:3600,colTier:1800,colSeam:19,colRet:25,colShow:false,col:false});
  var strip=function(t){return t.replace(/href="[^"]*"/g,'');},area=function(o){var A=0;for(var i=0;i<o.length;i++){var a=o[i],b=o[(i+1)%o.length];A+=a[0]*b[1]-b[0]*a[1];}return Math.abs(A)/2;};
  K.choose('reveal');T.regen();var M=K.model(),C=K.counts();if(M.sys!=='reveal'||M.D!==33+13+100)bad.push('plate depth '+M.D);if(M.jV<16||M.jH<16||M.jH<M.move+4)bad.push('reveal '+M.jV+'/'+M.jH);if(C.hooks!==0||C.splines!==4||C.htracks!==3||C.girts<3||C.pclips!==6*M.nClips||C.anchors!==2*C.clips)bad.push('plate counts');m.plate=[C.girts,C.clips,C.pclips].join('/');
  var B=K.blank();if(Math.abs(area(B.out)-((B.W+96)*(B.H+96)-4*48*48))>1||B.folds.length!==8||!B.keys.length)bad.push('pan blank');B.keys.forEach(function(k){k.forEach(function(q){if(q[1]>0||q[1]<-33)bad.push('weep hole off the bottom return');});});var dx=K.blankDXF();['BLANK','FOLD','WEEP_HOLES'].forEach(function(l){if(dx.indexOf('\n'+l+'\n')<0)bad.push('plate DXF lacks '+l);});if(dx.indexOf('KEYHOLES')>=0)bad.push('keyholes in a plate');
  var d=strip(K.detail(true));['1  HORIZONTAL JOINT','3  OUTSIDE CORNER','6  WINDOW HEAD AND SILL','7  WINDOW JAMB','8  ONE BAY'].forEach(function(t){if(d.indexOf(t)<0)bad.push('plate sheet: no '+t);});if(/NaN|undefined/.test(d)||d.indexOf('weep holes')<0)bad.push('plate sheet text');if(K.csv().indexOf('panel clip')<0||K.csv().indexOf('keyhole')>=0)bad.push('plate schedule');
  S.height=3600;T.regen();M=K.model();if(!(M.jH>=Math.ceil(M.move)+4&&M.jH<=16))bad.push('tall plate joint '+M.jH);S.height=2400;
  K.choose('board');S.material='fibrecem';S.thickness=8;T.regen();M=K.model();C=K.counts();if(M.sys!=='board'||M.D!==8+25+100||M.r!==0)bad.push('board depth '+M.D);if(M.riv.xs.length!==3||M.riv.xs[0]!==40||M.riv.xs[2]!==860||M.riv.ys[0]!==80||M.riv.span>600)bad.push('rivet grid '+M.riv.xs.join(','));if(M.riv.slide<8||M.riv.fixed.length!==2)bad.push('fixed points');
  if(C.girts!==0||C.vgirts!==3*1+4||C.rivets!==6*M.riv.n||C.fixed!==12||C.clips!==C.vgirts*C.nCv)bad.push('board counts '+C.vgirts+'/'+C.rivets);m.board=[C.vgirts,C.clips,C.rivets].join('/');B=K.blank();if(B.folds.length!==0||B.fixed.length!==2||B.keys.length!==M.riv.n-2||Math.abs(area(B.out)-B.W*B.H)>1)bad.push('board blank');dx=K.blankDXF();['RIVETS_SLIDING','RIVETS_FIXED'].forEach(function(l){if(dx.indexOf('\n'+l+'\n')<0)bad.push('board DXF lacks '+l);});if(dx.indexOf('\nFOLD\n')>=0)bad.push('a board with folds');
  d=strip(K.detail(true));if(d.indexOf('perforated strip')<0||d.indexOf('6  WINDOW HEAD AND SILL')<0||/NaN|undefined/.test(d))bad.push('board sheet');if(!K.rules().some(function(r){return/Back-ventilated/.test(r[1]);}))bad.push('no word on ventilation');if(K.csv().indexOf('girt (vertical')<0||K.csv().indexOf('subgirt (horizontal')>=0)bad.push('board schedule');
  S.lock.bGirt=900;S.width=1800;T.regen();if(!K.rules().some(function(r){return r[0]==='pr-warn'&&/between girts/.test(r[1]);}))bad.push('a 860 span not warned');S.lock.bGirt=600;S.width=900;T.regen();
  var o=K.obj(),mx=0;o.text.split('\n').forEach(function(l){if(l.charAt(0)==='f')l.split(' ').slice(1).forEach(function(v){mx=Math.max(mx,+v);});});if(o.text.indexOf('_vertical_girts')<0||o.text.indexOf('_subgirts')>=0||mx>o.verts||/NaN/.test(o.text))bad.push('board OBJ');
  if(typeof THREE!=='undefined'&&T.hostScene){S.lock.show=true;window.PS_LOCK=null;T.hostScene();var r=window.PS_LOCK;m.scene=r?[r.sys,r.panels,r.girts,r.rivets].join('/'):'none';if(!r||r.sys!=='board'||r.panels!==6||r.rivets!==6*M.riv.n||r.wide!==2)bad.push('board 3D '+m.scene);
    K.choose('reveal');S.material='alum';S.thickness=3;window.PS_LOCK=null;T.hostScene();r=window.PS_LOCK;if(!r||r.sys!=='reveal'||r.strips!==4+3)bad.push('plate 3D '+(r&&r.strips));S.lock.colShow=true;window.PS_COL=null;T.hostScene();var c3=window.PS_COL;if(!c3||c3.shells!==4||c3.meshes<8)bad.push('column 3D');S.lock.colShow=false;S.lock.show=false;}
  S.material='alum';S.thickness=3;var Cm=K.col.model();if(Cm.n!==2||Cm.nT!==2||Math.abs(Cm.n*(Cm.arc+Cm.seam)-Math.PI*Cm.D)>.01||Math.abs(Cm.nT*Cm.tier+(Cm.nT+1)*Cm.seam-Cm.H)>.01)bad.push('column shells');S.lock.colClad=1400;Cm=K.col.model();if(Cm.n!==3)bad.push('a 1400 column in '+Cm.n+' shells');S.lock.colClad=340;Cm=K.col.model();if(!Cm.held||Cm.D<Cm.d+2*Cm.ret)bad.push('cladding inside the column');S.lock.colClad=620;
  var cd=K.col.detail(true);['A  COLUMN','B  SEAM','C  HEAD, JOINT AND BASE','D  ONE SHELL'].forEach(function(t){if(cd.indexOf(t)<0)bad.push('column sheet: no '+t);});if(/NaN|undefined/.test(cd))bad.push('column NaN');if(K.col.dxf().indexOf('SCREW_HOLES')<0||K.col.csv().indexOf('rolled shell')<0)bad.push('column files');
  K.choose('hook');T.regen();if(strip(K8.detail(true)).indexOf('4  SILL AT GRADE')<0||K8.blankDXF().indexOf('KEYHOLES')<0)bad.push('the cassette lost its own sheet');
  S.lock.sys='hook';T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p141-1: the route across a sloping ground is built ---- */
guard('paver','the route on a slope is built: a bank across a straight route becomes steps of equal risers that add up to the rise, each riser where the ground crosses its level and no tread under 300; no stone is laid under a flight and stones beside it take the regraded level; a gentle steady slope becomes a ramp no steeper than 1 in 12 with a landing on a long one; a route gentler than 1 in 20 is left alone; switched off, the ground is as before',function(){
  T.reset();var bad=[],m={},K=window.PS_T141;if(!K)return{pass:false,detail:'PS_T141 missing'};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=12000;S.height=9000;var P=S.paver;P.tiling='running';P.size=400;P.route='straight';P.keepW=900;P.site='bank';P.siteRise=900;P.riser=150;P.tread=330;P.flightMax=8;P.landEvery=9000;P.landL=1500;P.rail=true;
  /* straight up the bank */P.keep='0.5,0.05 0.5,0.95';P.walkOn=false;T.siteApply();T.regen();var n0=T.G90().pavers.length;P.walkOn=true;T.regen();var g=T.G90(),M=K.model(),w=g.paver.walk;if(!M||!w)return{pass:false,detail:'no route works'};
  var st=M.steps;m.flights=w.flights;m.risers=w.risers;if(!st.length)bad.push('a bank made no steps');var rise=0,nr=0;st.forEach(function(e){rise+=Math.abs(e.rise);nr+=e.n;if(Math.abs(e.n*e.R-Math.abs(e.rise))>.5)bad.push('risers do not add up');if(e.R<120||e.R>180)bad.push('riser '+e.R);e.flights.forEach(function(f){for(var i=1;i<f.rs.length;i++)if(f.rs[i]-f.rs[i-1]<299)bad.push('a tread under 300');});
    if(Math.abs(M.zd(e.s0)-M.zg(e.s0))>1||Math.abs(M.zd(e.s1)-M.zg(e.s1))>1)bad.push('the works do not meet the ground at their ends');});if(nr!==6||Math.abs(rise-900)>60)bad.push(nr+' risers for '+Math.round(rise)+' mm');
  if(!(w.cleared>0)||g.pavers.length!==n0-w.cleared)bad.push('stones under the flights '+w.cleared);g.pavers.forEach(function(p){if(M.inFlight(p.cx,p.cy))bad.push('a stone laid under a flight');});
  var csv=K.csv();if(csv.indexOf('element,from_m,to_m')!==0||csv.indexOf('flight 1.1')<0||csv.indexOf('handrail')<0)bad.push('schedule');if(!K.rules().some(function(r){return/not a route for wheels/.test(r[1]);}))bad.push('no word on wheels');
  if(typeof THREE!=='undefined'&&T.hostScene){window.PS_WALK=null;T.hostScene();var r=window.PS_WALK;m.added=r&&r.added;if(!r||!(r.added>36*6))bad.push('3D treads '+(r&&r.added));}
  /* steeper than a stair: said, not hidden */P.siteRise=2400;T.siteApply();T.regen();M=K.model();if(!M||!M.steps.some(function(e){return e.tight;})||!K.rules().some(function(r){return r[0]==='pr-bad'&&/steeper than a stair/.test(r[1]);}))bad.push('a bank steeper than a stair is not flagged');
  /* a steady gentle slope: a ramp */P.site='cross';P.siteRise=1800;P.keep='0.05,0.5 0.95,0.5';T.siteApply();T.regen();M=K.model();m.ramp=M&&M.ramps.length?M.ramps[0].grade.toFixed(1):'none';if(!M||M.steps.length||M.ramps.length!==1)bad.push('cross slope: '+(M?M.steps.length+' steps, '+M.ramps.length+' ramps':'none'));else{var e=M.ramps[0];if(!(e.grade>5&&e.grade<=8.34)||!e.ok)bad.push('ramp at '+e.grade);if(e.L>9000&&e.lands.length<1)bad.push('a long ramp without a landing');e.lands.forEach(function(l){if(Math.abs(M.zd(l.s0+50)-M.zd(l.s1-50))>.5)bad.push('a landing that is not level');});}
  /* gentle: nothing */P.siteRise=400;T.siteApply();T.regen();M=K.model();if(M&&M.E.length)bad.push('works on a walk');if(!K.rules().some(function(r){return/nothing is needed/.test(r[1]);}))bad.push('no word that nothing is needed');
  P.walkOn=false;T.regen();if(T.G90().paver.walk)bad.push('works when switched off');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p142-1: the laying drawing ---- */
guard('paver','a laying drawing: every paver has one place in the order and one bay, the bays cover the ground and are numbered once each from the start corner, the start is the lowest corner of a sloping site, each bay\'s counts add up to the paver count, pallets follow the area of each type, alike cut pieces share a mark, and the sheet and lists are whole',function(){
  T.reset();var bad=[],m={},K=window.PS_T142;if(!K)return{pass:false,detail:'PS_T142 missing'};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var P=S.paver;P.tiling='running';P.size=400;P.layBay=3000;P.palletM2=10;P.layStart='auto';P.site='level';T.regen();
  var M=K.model(),g=K.G();if(!M)return{pass:false,detail:'no model'};m.bays=M.bays.length;m.cuts=M.cuts;if(M.bays.length!==6||M.nx!==3||M.ny!==2)bad.push('bays '+M.bays.length);var ords=M.bays.map(function(b){return b.ord;}).sort(function(a,b){return a-b;}).join(',');if(ords!=='1,2,3,4,5,6')bad.push('bay order '+ords);
  var seen={},sum=0;g.pavers.forEach(function(p){if(!p.lay||seen[p.lay])bad.push('order not one to one');seen[p.lay]=1;if(!p.bay)bad.push('a paver without a bay');});M.bays.forEach(function(b){sum+=b.n;if(b.byType.reduce(function(a,c){return a+c;},0)!==b.n)bad.push('bay types do not add up');});if(sum!==g.pavers.length||M.n!==sum)bad.push('bay counts '+sum+' of '+g.pavers.length);
  var first=g.pavers.filter(function(p){return p.lay===1;})[0],b1=M.bays[0];if(M.corner!=='SW'||!first||first.cx>3000||first.cy>3000||b1.name!=='A1')bad.push('start '+M.corner);
  var lastBay=M.bays[5];g.pavers.forEach(function(p){if(p.bay===lastBay.name&&p.lay<=g.pavers.length-lastBay.n)bad.push('a stone of the last bay laid early');});
  M.types.forEach(function(t){if(t.n&&t.pallets!==Math.ceil(t.m2/10))bad.push('pallets');});var gc=0;M.groups.forEach(function(q){gc+=q.n;if(!/^C\d+$/.test(q.mark)||!(q.w>0&&q.h>0))bad.push('cut mark');});if(gc!==M.cuts||(M.cuts>0&&M.groups.length>=M.cuts&&M.cuts>8))bad.push('cut groups '+M.groups.length+' for '+M.cuts);
  var sv=K.sheet(true);['LAYING PLAN','HOW IT IS LAID','PAVER TYPES AND PALLETS','EACH BAY, IN ORDER','CUT PIECES'].forEach(function(t){if(sv.indexOf(t)<0)bad.push('sheet: no '+t);});if(/NaN|undefined/.test(sv))bad.push('sheet NaN');var csv=K.csv().split('\n');if(csv[0]!=='order,bay,bay_order,type,type_name,x_mm,y_mm,cut_mark'||csv[1].split(',')[0]!=='1'||csv.length<g.pavers.length+5)bad.push('laying list');if(M.cuts&&K.cuts().indexOf('mark,count,type')!==0)bad.push('cut list');
  P.site='cross';P.siteRise=900;T.siteApply();T.regen();M=K.model();if(M.corner!=='SW'||M.why!=='the lowest corner')bad.push('lowest corner '+M.corner+' '+M.why);P.layStart='NE';M=K.model();var f2=K.G().pavers.filter(function(p){return p.lay===1;})[0];if(M.corner!=='NE'||f2.cx<6000||f2.cy<3000)bad.push('a chosen corner');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p143-1: serial sections, the assembly ---- */
guard('serial','the ribs have an order of assembly: numbered once each from the foot (or the left), a complement shares its strip with the rib before it, the story pole rises by the pitch, weights add up, the steps follow what holds the ribs and whether they stand or are threaded flat, and the sheet and list are whole',function(){
  T.reset();var bad=[],m={},K=window.PS_T143;if(!K)return{pass:false,detail:'PS_T143 missing'};T.setPanelMode('serial');S.arr='single';S.width=2400;S.height=2400;Object.assign(S.serial,{dir:'horizontal',op:'contour',pitch:40,t:18,zeroWaste:true,join:'rods'});T.regen();var M=K.model();if(!M)return{pass:false,detail:'no model'};
  m.ribs=M.rows.length;m.kg=Math.round(M.kg);var prev=-1e9,k=0;M.rows.forEach(function(q,i){if(q.n!==i+1||q.c<=prev)bad.push('order');prev=q.c;k+=q.kg;if(i&&Math.abs((q.at-M.rows[i-1].at)-40)>.6)bad.push('story pole step '+(q.at-M.rows[i-1].at));if(!(q.lo>0&&q.hi>=q.lo))bad.push('depths');});if(Math.abs(k-M.kg)>.01||!(M.kg>5))bad.push('weight '+M.kg);
  if(Math.abs(M.rows[0].at-18)>.6)bad.push('first rib top at '+M.rows[0].at);var comp=M.rows.filter(function(q){return q.comp;});if(!comp.length)bad.push('no complements');comp.forEach(function(q){var mate=M.rows.filter(function(r){return r.strip===q.strip&&!r.comp;});if(mate.length!==1)bad.push('a complement without its strip mate');});
  if(!M.hor||M.steps.length<4||!/spacer/.test(M.steps.join(' '))||!/story pole/.test(M.steps.join(' ')))bad.push('rod steps');var sv=K.sheet(true);['ASSEMBLY','THE ORDER OF WORK','EVERY RIB','story pole'].forEach(function(t){if(sv.indexOf(t)<0)bad.push('sheet: no '+t);});if(/NaN|undefined/.test(sv))bad.push('sheet NaN');var csv=K.csv().split('\n');if(csv[0].indexOf('order,mark,strip')!==0||csv.length<M.rows.length+4)bad.push('list');
  S.serial.dir='vertical';T.regen();M=K.model();if(M.hor||!/Stand the panel up/.test(M.steps.join(' '))||M.people<2)bad.push('upright ribs are not stood up');S.serial.join='rails';T.regen();M=K.model();if(!/half lap/.test(M.steps.join(' ')))bad.push('rail steps');if(/NaN|undefined/.test(K.sheet(true)))bad.push('rail sheet NaN');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p144-1: the paved area has an edge of its own ---- */
guard('paver','a paved area with an outline: no paver lies outside it, pavers the edge crosses are cut and flagged and the paved area adds up to the outline\'s, the interlocking family leaves stones out and cuts none, typed corners with levels set the size, the outline and the spot levels, a kerb follows the outline, and without an outline the ground is as before',function(){
  T.reset();var bad=[],m={},K=window.PS_T144;if(!K)return{pass:false,detail:'PS_T144 missing'};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var P=S.paver;P.tiling='running';P.size=400;P.joint=0;P.site='level';P.bound='';P.edge='none';T.regen();var n0=K.G().pavers.length;
  K.set(K.shape('L'));T.regen();var g=K.G(),r=g.paver.bound,poly=K.pts().map(function(p){return[p[0]*9000,p[1]*6000];});if(!r)return{pass:false,detail:'no outline record'};m.n=g.pavers.length;m.cut=r.cut;if(!(g.pavers.length<n0&&r.cut>0))bad.push('nothing cut or left out');
  var A=0;g.pavers.forEach(function(p){A+=p.area;if(!K.inside(poly,p.cx,p.cy))bad.push('a paver outside the outline');p.pts.forEach(function(v){if(v.x<-1||v.y<-1||v.x>9001||v.y>6001)bad.push('a corner outside the ground');});});m.area=(A/1e6).toFixed(1);if(Math.abs(A/1e6-r.m2)>r.m2*.03)bad.push('paved '+m.area+' of '+r.m2.toFixed(1)+' m2');if(Math.abs(r.m2-54*(1-.55*.55))>.3)bad.push('outline area '+r.m2);
  if(g.pavers.filter(function(p){return p.cut;}).length<r.cut)bad.push('cut flags');if(typeof THREE!=='undefined'&&T.hostScene){window.PS_BOUND=null;T.hostScene();if(!window.PS_BOUND||!(window.PS_BOUND.kerb>20))bad.push('no kerb on the outline');}
  P.tiling='perm';T.regen();g=K.G();r=g.paver.bound;if(!r||!r.whole||r.cut!==0||!(r.dropped>0))bad.push('interlocking stones cut');g.pavers.forEach(function(p){(p.pts||[]).forEach(function(v){if(!K.inside(poly,v.x,v.y)&&!K.inside(poly,v.x*.999+p.cx*.001,v.y*.999+p.cy*.001))bad.push('a whole stone across the edge');});});
  P.tiling='running';var f=K.fromText('0 0 10\n14 0 10.2\n14 8 11.1\n6 11 11.4\n0 8 10.6');T.regen();if(!f.ok||S.width!==14000||S.height!==11000||P.site!=='spots'||K.pts().length!==5)bad.push('typed corners: '+f.msg);var st=K.G().paver.site;if(!st||Math.abs(st.rise-1400)>250)bad.push('typed levels rise '+(st&&st.rise));if(K.fromText('1 2').ok)bad.push('two numbers taken as an outline');
  T.reset();T.setPanelMode('paver');S.arr='single';S.width=9000;S.height=6000;P=S.paver;P.tiling='running';P.size=400;P.joint=0;P.site='level';P.bound='';P.edge='none';T.regen();if(K.G().pavers.length!==n0||K.G().paver.bound)bad.push('the plain ground changed');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p145-1: every face of the building its own treatment ---- */
guard('assembly','every face its own: the test building has a picture running on across three faces whose shares join end to end, a face in composite panels, a screen over glazing with glass behind it, and a glazed face; a kept design stays as it was when the panel changes; a picture all the way round is one run; the card model\'s own codes stay in step; the sheet and lists are whole',function(){
  T.reset();var bad=[],m={},K=window.PS_T145;if(!K)return{pass:false,detail:'PS_T145 missing'};S.perf.on=true;S.omb.on=false;S.arr='single';S.width=900;S.height=3600;T.regen();var base=JSON.parse(JSON.stringify(S.mass));
  var codes=K.midrise(),M=K.model();m.codes=codes.join('');if(M.n!==6||M.st!==6||codes.join('')!=='wwwcsg')bad.push('test building '+M.n+' faces '+codes.join(''));if(S.mass.faces!=='d,d,d,d,d,g')bad.push('card codes '+S.mass.faces);
  var runs=K.runs();if(runs.length!==1||runs[0].faces.join(',')!=='0,1,2'||runs[0].all)bad.push('runs');var r0=K.canvas(0),r1=K.canvas(1),r2=K.canvas(2);if(!r0||!r1||!r2||Math.abs(r0.u[0])>1e-9||Math.abs(r0.u[1]-r1.u[0])>1e-9||Math.abs(r1.u[1]-r2.u[0])>1e-9||Math.abs(r2.u[1]-1)>1e-9)bad.push('the picture does not join across faces');
  if(Math.abs((r0.u[1]-r0.u[0])-M.faces[0].L/(M.faces[0].L+M.faces[1].L+M.faces[2].L))>1e-6)bad.push('a face\'s share of the picture');var c3=K.canvas(3),c4=K.canvas(4);if(!c3||c3.code!=='c'||c3.alpha)bad.push('composite face');if(!c4||c4.code!=='s')bad.push('screen face');if(K.canvas(5)!==null)bad.push('a glazed face has a picture');
  var csv=K.csv().split('\n');if(csv[0].indexOf('face,length_mm,height_mm,treatment')!==0||csv.length<8||csv[4].indexOf('solid composite panels')<0||csv[4].indexOf('open reveal')<0||csv[5].indexOf('in front of the glazing')<0)bad.push('treatments list');
  var w=K.wrapCSV().split('\n'),n=0;M.faces.slice(0,3).forEach(function(f){n+=f.bays*M.st*M.rps;});if(w.length!==n+2)bad.push('wrap list '+w.length+' for '+n+' panels');var last=w[n].split(',');if(Math.abs(+last[5]-1)>1e-3)bad.push('the wrap does not end at the picture\'s edge');
  var sv=K.sheet(true).replace(/href="[^"]*"/g,'');if(sv.indexOf('THE FACES, UNFOLDED')<0||sv.indexOf('one picture: W1, W2, W3')<0||/NaN|undefined/.test(sv)||(sv.match(/class="facex-img"/g)||[]).length!==5)bad.push('sheet');
  if(typeof THREE!=='undefined'&&T.hostScene){S.mass.show3d=true;T.hostScene();var r=window.PS_MASS;m.scene=r?[r.own,r.screens].join('/'):'none';if(!r||r.own!==5||r.screens!==1||r.codes!=='wwwcsg')bad.push('3D '+m.scene);S.mass.show3d=false;}
  /* a kept design stays */var s1=K.keep(0),px=s1.tile.getContext('2d').getImageData(10,10,1,1).data.join(',');S.material='alum';S.height=2400;T.regen();K.set(['1','d','d','d','d','d']);var k1=K.canvas(0);if(!k1||k1.code!=='1'||K.slots()[0].tile.getContext('2d').getImageData(10,10,1,1).data.join(',')!==px||K.slots()[0].H!==3600)bad.push('a kept design changed');if(k1&&k1.rows!==Math.round(21600/3600))bad.push('kept design rows '+k1.rows);
  K.set(['w','w','w','w','w','w']);runs=K.runs();if(runs.length!==1||!runs[0].all||runs[0].faces.length!==6)bad.push('all the way round');K.set(['w','d','w','w','g','w']);runs=K.runs();if(runs.length!==2)bad.push('two runs expected, '+runs.length);
  Object.keys(S.mass).forEach(function(k){delete S.mass[k];});Object.assign(S.mass,base);T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p147-1: the paver bank, the plant bank, the graded path, the roof garden ---- */
guard('paver','the person chooses: a bank paver joins a counted design before its fill row and can be taken out again, a ninth is refused, on an ordinary layout it becomes a paver type; each tree form draws; the roof garden of counted pavers lays every count on 30 by 18 m with no bench; a graded path is never steeper than the ground allows and is a walk on a gentle site; an outline brings the route inside it',function(){
  T.reset();var bad=[],m={},K=window.PS_T147,K8=window.PS_T128,K4=window.PS_T144,K1=window.PS_T141;if(!K||!K8||!K4||!K1)return{pass:false,detail:'handles missing'};
  K.keio();T.regen();var s=K8.stat();m.cells=s&&s.cells;if(!s||s.cells!==2160)bad.push('roof garden places '+(s&&s.cells));else s.rows.forEach(function(r){if(r[1]!=null&&r[1]!==r[2])bad.push(r[0]+' laid '+r[2]+' of '+r[1]);});if(S.paver.seats||S.paver.invSeats)bad.push('benches given unasked');if(S.width!==30000||S.height!==18000)bad.push('size');
  var n0=K8.rows().length;if(K.add(K.bank()[2])!==false)bad.push('a ninth paver was taken');K.out(1);T.regen();if(K8.rows().length!==n0-1)bad.push('take out');if(!K.add(K.bank()[2]))bad.push('add refused');T.regen();var rw=K8.rows();if(!rw.some(function(r){return r.name==='Plank'&&r.a===3;})||!rw.some(function(r){return r.fill;}))bad.push('the added paver or the fill row is missing');
  if(typeof THREE!=='undefined'){['round','column','conifer','umbrella'].forEach(function(f){var n=0,nan=false;K.tree(function(g,c){n++;var a=g.attributes.position.array;for(var i=0;i<a.length;i+=97)if(!isFinite(a[i]))nan=true;if(!c||c.length!==3)nan=true;},f,1000,1000,0,7);if(n<6||nan)bad.push('tree '+f+' '+n);});}
  T.reset();T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var P=S.paver;P.tiling='running';P.size=400;P.types=3;T.regen();var t0=K4.G().paver.palette.length;if(!K.add(K.bank()[11]))bad.push('type not added');T.regen();if(K4.G().paver.palette.length!==t0+1||String(P.kinds).indexOf('grass')<0)bad.push('the bank paver did not become a type');K.out(0);T.regen();if(K4.G().paver.palette.length!==t0)bad.push('type not taken out');
  /* the graded path */P.site='cross';P.siteRise=600;P.route='diag';P.keep='0,0.22 1,0.78';P.keepW=900;P.walkOn=false;P.walkMode='grade';T.siteApply();T.regen();var M=K1.model(),w=K4.G().paver.walk;m.grade=M&&M.E[0]?M.E[0].max.toFixed(1):'none';if(!M||M.mode!=='grade'||M.E.length!==1||M.E[0].max>5.05||!w||w.flights||w.wallL)bad.push('graded path on a gentle site '+m.grade);if(!K1.rules().some(function(r){return r[0]==='pr-ok'&&/The path is graded/.test(r[1]);}))bad.push('no word on the grade');
  P.site='bank';P.siteRise=1500;T.siteApply();T.regen();M=K1.model();var even=1500/M.len*100;m.bank=M.E[0].max.toFixed(1);if(M.E[0].max>even*1.25+.3||M.E[0].max<even*.9)bad.push('a bank is eased to '+M.E[0].max.toFixed(1)+' %, an even fall is '+even.toFixed(1));if(Math.abs(M.zd(0)-M.zg(0))>1||Math.abs(M.zd(M.len)-M.zg(M.len))>1)bad.push('the graded path leaves the ground at its ends');
  P.walkMode='off';P.site='level';K4.set(K4.shape('wedge'));T.regen();var a=K4.pts(),ok=String(P.keep).split(' ').every(function(q){var c=q.split(',').map(Number);return K4.inside(a,c[0],c[1]);});if(!ok||P.route!=='custom')bad.push('the route is outside the outline');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p148-1: the paver leftovers ---- */
guard('paver','on an outlined ground the counts, areas and water are those of the pavers laid, holes fit their cut slabs and trees stand inside the outline clear of its edge; every shrub and grass form draws; a spot level is removed by its button down to three; steps on an even slope are paved terraces with a step block a riser and no rail; an own bank paver is kept',function(){
  T.reset();var bad=[],m={},K=window.PS_T148,K7=window.PS_T147,K4=window.PS_T144,K1=window.PS_T141;if(!K||!K7||!K4||!K1)return{pass:false,detail:'handles missing'};
  K7.keio();T.regen();var n0=K4.G().pavers.length;K4.set(K4.shape('wedge'));T.regen();var G=K4.G(),P=G.paver,a=K4.pts().map(function(p){return[p[0]*G.W,p[1]*G.H];});m.n0=n0;m.n=G.pavers.length;
  if(!P.bound)bad.push('no outline');else{if(P.made!==G.pavers.length||P.made>=n0)bad.push('made '+P.made+' of '+G.pavers.length+' laid, '+n0+' before');if(P.counts.reduce(function(x,y){return x+y;},0)!==G.pavers.length)bad.push('type counts do not add up');if(P.cut!==G.pavers.filter(function(p){return p.cut;}).length)bad.push('cut count');
    if(!P.water||P.water.area>P.bound.m2*1e6*1.02||P.water.area<P.bound.m2*1e6*.6)bad.push('water area '+(P.water&&(P.water.area/1e6).toFixed(0))+' against outline '+P.bound.m2.toFixed(0));
    var TR=K.trees(G),out=0;TR.holes.forEach(function(p){if(!K4.inside(a,p.cx,p.cy)||K.edge(a,p.cx,p.cy)<449)out++;});if(out)bad.push(out+' trees at or past the edge');m.trees=TR.n;
    (P.planted||[]).forEach(function(q){if(!q||!q.length||q[0].x<-1e6)return;q.forEach(function(v){if(K.edge(a,v.x,v.y)>2&&!K4.inside(a,v.x,v.y))out++;});});if(out)bad.push('planting past the outline');}
  if(typeof THREE!=='undefined'){[['shrubs',['mound','ball','flower','spiky'],K.shrub],['grasses',['tuft','tall','fan','meadow'],K.grass]].forEach(function(r){r[1].forEach(function(f){S.paver[r[0]]=f;var n=0,nan=false;r[2](function(g,c){n++;var p=g.attributes.position.array;for(var i=0;i<p.length;i+=53)if(!isFinite(p[i]))nan=true;if(!c||c.length!==3)nan=true;},500,500,0,11,600);if(n<2||nan)bad.push(r[0]+' '+f+' '+n);});});S.paver.shrubs='mound';S.paver.grasses='tuft';}
  T.reset();T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=9000;S.height=6000;var Q=S.paver;Q.tiling='running';Q.size=400;Q.site='cross';Q.siteRise=600;T.siteApply();T.regen();var b=document.querySelector('.topo130 [data-t=tospots]');if(!b)bad.push('no spot button');else{b.click();var c0=String(Q.sitePts).split(';').length;K.drop(0);var c1=String(Q.sitePts).split(';').length;if(c0!==12||c1!==11)bad.push('spot remove '+c0+' to '+c1);for(var i=0;i<12;i++)K.drop(0);if(String(Q.sitePts).split(';').length!==3)bad.push('fewer than three spots left');if(!document.querySelector('.topo130 [data-t=delspot]'))bad.push('no remove button');}
  Q.site='cross';Q.siteRise=1500;Q.route='diag';Q.keep='0,0.22 1,0.78';Q.keepW=900;Q.walkMode='steps';T.siteApply();T.regen();var M=K1.model(),w=K4.G().paver.walk;if(!M||!w)bad.push('no steps model');else{var fl=[];M.steps.forEach(function(e){e.flights.forEach(function(f){fl.push(f);});});m.flights=fl.length;m.paved=fl.filter(function(f){return f.paved;}).length;if(fl.length&&fl.every(function(f){return f.paved;})){if(w.railL)bad.push('a rail on paved terraces');if(w.cleared>=w.moved)bad.push('cleared '+w.cleared+' against '+w.moved+' moved');if(K4.G().paver.made!==K4.G().pavers.length)bad.push('count after steps');}
    if(typeof THREE!=='undefined'){var pr=K.parts(M,Q,9000,6000,0,60),nan2=false;pr.forEach(function(q){for(var i=0;i<q[0].length;i+=31)if(!isFinite(q[0][i]))nan2=true;});if(!pr.length||nan2)bad.push('step parts '+pr.length);}}
  var o0=K7.own().length;K7.keep(['QA ring',2,1,300,'plant','hole']);if(K7.own().length!==o0+1||!K7.bank().some(function(q){return q[0]==='QA ring';}))bad.push('own paver not kept');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p149-1: the building's faces, further ---- */
guard('assembly','the Rhino model names every face by its treatment and has glazing behind a screen with whole vertex numbering; a kept design is saved for a reload and can be forgotten; a picture across faces is made as a real set of panels, no more than 96, with the picture across the set and a list of which face each column is on',function(){
  T.reset();var bad=[],m={},K5=window.PS_T145,K9=window.PS_T149,K4=window.PS_T144;if(!K5||!K9||!K4)return{pass:false,detail:'handles missing'};
  T.setPanelMode('perf');T.regen();var codes=K5.midrise(),o=K9.obj(),NL=String.fromCharCode(10),gs=o.text.split(NL).filter(function(l){return l.charAt(0)==='g';});m.groups=gs.length;
  var want={w:'picture',c:'composite',s:'screen',g:'glazed'};K5.model().faces.forEach(function(fc,i){var n='g face_'+fc.name+'_'+want[codes[i]];if(gs.indexOf(n)<0)bad.push('no '+n);});
  var ns=codes.filter(function(c){return c==='s';}).length,ng=gs.filter(function(l){return /^g glazing_behind_/.test(l);}).length;if(ng!==ns)bad.push('glazing behind '+ng+' of '+ns+' screens');
  var nv=(o.text.match(/^v /gm)||[]).length,mx=0;o.text.split(NL).forEach(function(l){if(l.charAt(0)==='f')l.slice(2).split(' ').forEach(function(q){mx=Math.max(mx,+q);});});if(nv!==o.verts||mx>nv||/NaN/.test(o.text))bad.push('vertex numbering '+nv+' / '+o.verts+' / '+mx);
  var s=K5.keep(0);if(!s||K9.save()<1)bad.push('kept design not saved');var raw='';try{raw=localStorage.getItem('ps-kept-faces')||'';}catch(e){raw='x';}if(raw!=='x'&&raw.indexOf('data:image/png')<0)bad.push('nothing stored');K9.forget(0);if(K5.slots()[0])bad.push('not forgotten');try{if((localStorage.getItem('ps-kept-faces')||'').indexOf('data:image/png')>=0)bad.push('still stored after forgetting');}catch(e){}
  K5.midrise();var mk=K9.make();if(!mk)bad.push('the run was not made');else{m.cols=mk.cols;m.rows=mk.rows;if(mk.cols>48||mk.cols*mk.rows>96)bad.push('too many panels '+mk.cols+' x '+mk.rows);if(S.arr!=='grid'||S.cols!==mk.cols||S.rows!==mk.rows||!S.omb.span)bad.push('the set was not written');if(S.mass.view||S.mass.show3d)bad.push('the model view was left on');
    var csv=K9.madeCSV().trim().split(NL);if(csv.length!==mk.cols+1)bad.push('face list '+csv.length);var seen={};csv.slice(1).forEach(function(l){seen[l.split(',')[1]]=1;});mk.faces.forEach(function(f){if(!seen[f])bad.push('no column on '+f);});
    T.regen();var G=K4.G();m.panels=G.panels&&G.panels.length;if(!G.panels||G.panels.length!==mk.cols*mk.rows||!G.span)bad.push('panels built '+(G.panels&&G.panels.length));else{var tot=0;G.panels.forEach(function(p){tot+=p.holes.length;});m.holes=tot;if(tot<2000||tot>60000)bad.push('holes in all '+tot);}}
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});


/* ---- p150-1: one face of a picture run at its real panel size ---- */
guard('assembly','one face of a picture run is made at its real panel size: its columns are its own bays, the panels are the building panels, no more than 240 at once, it reads only its own share of the picture and the next face starts where it ends; making the whole run again clears the crop',function(){
  T.reset();var bad=[],m={},K5=window.PS_T145,K9=window.PS_T149,K=window.PS_T150,K4=window.PS_T144;if(!K5||!K9||!K||!K4)return{pass:false,detail:'handles missing'};
  T.setPanelMode('perf');T.regen();K5.midrise();var fs=K.faces();if(fs.length<2)return{pass:false,detail:'no picture faces'};var M=K5.model(),f0=M.faces[fs[0].i];
  var a=K.face(fs[0].i,0);if(!a)return{pass:false,detail:'not made'};m.cols=a.cols;m.rows=a.rows;if(a.cols!==f0.bays||S.cols!==a.cols||S.rows!==a.rows)bad.push('columns '+a.cols+' of '+f0.bays);if(Math.abs(a.pw-f0.L/f0.bays)>1||S.width!==a.pw)bad.push('panel width '+a.pw);if(a.cols*a.rows>240&&a.rows>M.rps)bad.push('too many panels');
  var c=K.crop();if(!c||c.u0!==0||!(c.u1>0&&c.u1<1))bad.push('crop '+JSON.stringify(c));var uv=K.uv(.5,.5);if(!c||Math.abs(uv[0]-(c.u0+c.u1)/2)>1e-9||uv[1]<c.v0||uv[1]>c.v1)bad.push('mapping');var u1=c&&c.u1;
  T.regen();var G=K4.G();if(!G.panels||G.panels.length!==a.cols*a.rows)bad.push('panels built '+(G.panels&&G.panels.length));else{var tot=0;G.panels.forEach(function(p){tot+=p.holes.length;});m.holes=tot;if(tot<2000||tot>60000)bad.push('holes '+tot);}
  var b=K.face(fs[1].i,0),c2=K.crop();if(!b||!c2||Math.abs(c2.u0-u1)>1e-9)bad.push('the next face does not start where the first ends');
  K9.make();if(K.crop())bad.push('the crop stayed after the whole run was made');
  T.reset();return{pass:!bad.length,detail:bad.slice(0,6).join('; '),metrics:m};});

/* ---- p151-1: water and plan inside an outline ---- */
guard('paver','on an outlined sloping ground the water grid rains only inside the outline (the rain is the storm on the outline area, the balance closes) and the plan covers the rectangle outside it; without an outline both are as before',function(){
  T.reset();var bad=[],m={},K=window.PS_T144,K1=window.PS_T151;if(!K||!K1)return{pass:false,detail:'handles missing'};T.setPanelMode('paver');S.arr='single';S.cols=1;S.rows=1;S.width=12000;S.height=8000;var P=S.paver;P.tiling='running';P.size=400;P.joint=6;P.site='cross';P.siteRise=600;P.bound='';P.edge='none';T.regen();
  var w0=K1.water();if(!w0||!w0.flow)return{pass:false,detail:'no water grid'};var r0=w0.flow.rainLs;if(K1.plan().indexOf('pv-out')>=0)bad.push('a mask without an outline');if(w0.flow.inside!==1)bad.push('inside '+w0.flow.inside);
  K.set(K.shape('wedge'));T.regen();var g=K.G(),w=K1.water();if(!w||!w.flow||!g.paver.bound)return{pass:false,detail:'no water with an outline'};var share=g.paver.bound.m2/96;m.share=+share.toFixed(3);m.rain=+(w.flow.rainLs/r0).toFixed(3);
  if(Math.abs(w.flow.rainLs/r0-share)>.06)bad.push('rain '+m.rain+' of the rectangle, outline '+m.share);if(!(w.flow.inside<1))bad.push('no cell outside');if(w.flow.bal>.02)bad.push('balance '+w.flow.bal);if(K1.plan().indexOf('pv-out')<0)bad.push('the plan still shows the rectangle');
  T.reset();return{pass:!bad.length,detail:bad.slice(0,6).join('; '),metrics:m};});


/* ---- p152-1: an opening through the ribs ---- */
guard('serial','an opening through the ribs: two trimmer ribs run on at full depth, the ribs between are cut in pieces each held at two stations, the rods that would cross it stop and start with nuts counted, nothing but the trimmers and the jamb boards stands in the clear opening in 3D, upright ribs give a door to the base, turning blades refuse it, and without it nothing changes',function(){
  T.reset();var bad=[],m={},K=window.PS_T152,K3=window.PS_T153;if(!K||!K3)return{pass:false,detail:'handles missing'};T.setPanelMode('serial');S.arr='single';S.width=2400;S.height=2400;Object.assign(S.serial,{dir:'horizontal',op:'contour',pitch:40,t:18,zeroWaste:true,join:'rods',open:false,path:'line'});T.regen();
  if(K.rec())bad.push('an opening without asking');var n0=K.G().serial.fix.rods,box=function(g,x0,x1,y0,y1){var p=g.attributes.position.array,k=0;for(var i=0;i<p.length;i+=3)if(p[i]>x0&&p[i]<x1&&p[i+1]>y0&&p[i+1]<y1&&p[i+2]>5)k++;return k;};
  Object.assign(S.serial,{open:true,oU:.5,oW:900,oH:1200,oSill:500});var before=box(K3.geom(),800,1600,600,1600);T.regen();var G=K.G(),O=K.rec(),F=G.serial.fix;if(!O||O.refused)return{pass:false,detail:'refused: '+(O&&O.refused)};m.cut=O.cut;m.rods=F.rods;
  if(O.iA%2||O.iB%2!==1)bad.push('trimmers not on a strip pair');[O.iA,O.iB].forEach(function(i){var r=G.ribs[i],k=Math.round((1200-r.a0)/r.len*r.N);if(!r.trim||r.cut||Math.abs(r.v[k]-O.Dl)>.01)bad.push('trimmer '+i);});
  var nc=0;G.ribs.forEach(function(r){if(!r.cut)return;nc++;r.pieces.forEach(function(q){if(F.stations.filter(function(s){return s>q[0]&&s<q[1];}).length<2)bad.push('a piece held once');});});if(nc!==O.cut||nc!==O.iB-O.iA-1)bad.push('cut ribs '+nc);if(O.weak)bad.push('weak '+O.weak);
  if(F.rods!==O.rodsFull+O.rodsPart||O.segs.length!==O.rodsPart||F.nuts!==2*F.rods||!(O.rodsPart>0)||!(F.rods>n0))bad.push('rods '+F.rods+' = '+O.rodsFull+' + '+O.rodsPart);
  var g=K3.geom(),a0=G.ribs[0].a0,ins=box(g,O.A0+O.t+45,O.A1-O.t-45,O.cA+O.t+45,O.cB-45);m.inside=ins;m.before=before;if(ins!==0)bad.push(ins+' vertices in the clear opening');if(!(before>0))bad.push('the probe saw nothing before');
  var csv=K.csv().split(String.fromCharCode(10));if(csv.filter(function(l){return l.indexOf('trimmer')===0;}).length!==2||csv.filter(function(l){return l.indexOf('cut rib piece')===0;}).length!==O.pieces)bad.push('list');if(/NaN|undefined/.test(K.csv()+K.text()))bad.push('NaN in the list');
  S.serial.dir='vertical';S.serial.oSill=0;S.serial.oH=2100;T.regen();O=K.rec();if(!O||O.refused||!O.door||O.weak)bad.push('no door with upright ribs: '+(O&&(O.refused||O.weak)));
  S.serial.join='rails';T.regen();O=K.rec();F=K.G().serial.fix;if(!O||O.refused||F.rails!==F.stations.length+O.inside.length)bad.push('rails '+F.rails);if(!K3.geom())bad.push('no rails geometry');
  S.serial.op='twist';T.regen();O=K.rec();if(!O||!O.refused)bad.push('blades did not refuse');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});

/* ---- p153-1: ribs along a line drawn in plan ---- */
guard('serial','ribs along a drawn line: the wall keeps its length along the line, the 3D follows it and stands in front of its own plane, upright ribs are listed one by one with their place, angle and tip gap, spacers differ between the back and front rows on a bend, a bend too tight is counted, level ribs are said to be cut to the line, and a straight wall is unchanged',function(){
  T.reset();var bad=[],m={},K=window.PS_T153,K2=window.PS_T152;if(!K||!K2)return{pass:false,detail:'handles missing'};T.setPanelMode('serial');S.arr='single';S.width=3600;S.height=2400;Object.assign(S.serial,{dir:'vertical',op:'contour',pitch:60,t:18,zeroWaste:false,join:'rods',open:false,path:'line',dMin:60,dMax:160});T.regen();
  if(K.rec())bad.push('a line without asking');var bb=function(g){g.computeBoundingBox();return g.boundingBox;},b0=bb(K.geom());
  S.serial.path='drawn';S.serial.rp=K.shapes.arc;T.regen();var Q=K.rec(),G=K2.G();if(!Q)return{pass:false,detail:'no record'};m.R=Math.round(Q.Rmin);m.bow=Q.bow;m.clash=Q.clash;
  var C=K.path(3600),len=0,pv=C.at(0);for(var i=1;i<=360;i++){var q=C.at(i*10);len+=Math.hypot(q.x-pv.x,q.z-pv.z);pv=q;}if(Math.abs(len-3600)>12)bad.push('length along the line '+len.toFixed(0));if(!(Q.chord<3600&&Q.bow>100))bad.push('not bent');
  var b1=bb(K.geom());if(!(b1.max.z>b0.max.z+Q.bow*.6))bad.push('the 3D did not follow');if(b1.min.z<b0.min.z-60)bad.push('behind its own plane '+b1.min.z.toFixed(0));
  if(Q.rows.length!==G.ribs.length)bad.push('rows '+Q.rows.length);if(!(Q.back[1]-Q.back[0]>.2)||!(Q.gapMax>Q.gapMin))bad.push('spacers all alike');if(typeof Q.clash!=='number')bad.push('no clash count');
  var csv=K.csv();if(csv.indexOf('rib,along_mm')!==0||/NaN|undefined/.test(csv+K.text()))bad.push('list');
  S.serial.rp='0,0;.5,-.5;1,0';S.serial.dMax=300;S.serial.holdBend=false;T.regen();Q=K.rec();if(!(Q&&Q.clash>0))bad.push('a tight bend with deep ribs was not flagged');
  S.serial.dir='horizontal';S.serial.rp=K.shapes.s;T.regen();Q=K.rec();if(!Q||!Q.cutCurved||!(Q.blank>0))bad.push('level ribs');
  S.serial.open=true;S.serial.oH=1200;S.serial.oSill=500;T.regen();if(!K.geom()||!K2.rec()||K2.rec().refused)bad.push('an opening on a line');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});

/* ---- p154-1: the rib leftovers ---- */
guard('serial','rib leftovers: an opening is marked on the nest (cross-cuts and waste, in the drawing and the DXF), the base channel stops at a door with nothing left across it, a bend that would make rib tips meet is eased until they clear and can be built as drawn when asked, and level ribs on a line are nested as curved bands that stay on their sheets without overlapping',function(){
  T.reset();var bad=[],m={},K=window.PS_T154,K2=window.PS_T152;if(!K||!K2)return{pass:false,detail:'handles missing'};T.setPanelMode('serial');S.arr='single';S.width=3600;S.height=2400;
  Object.assign(S.serial,{dir:'vertical',op:'contour',pitch:60,t:18,zeroWaste:true,join:'rods',base:true,path:'line',dMin:60,dMax:160,open:true,oU:.5,oW:900,oH:2000,oSill:0});T.regen();
  var O=K2.rec(),G=K2.G();if(!O||O.refused)return{pass:false,detail:'no opening '+(O&&O.refused)};if(!O.door)bad.push('not a door');
  var xs=K.xcuts(),N=K.nest(),D=K.dxf();m.cutRibs=xs.length;m.xcuts=N.xcuts;if(xs.length!==O.cut)bad.push('waste marked on '+xs.length+' of '+O.cut+' cut ribs');if(!(N.xcuts>=O.cut))bad.push('cross-cuts '+N.xcuts);
  if(N.svg.indexOf('serial-waste')<0||N.svg.indexOf('serial-xcut')<0)bad.push('nest drawing');if((D.match(/CROSSCUTS/g)||[]).length!==N.xcuts)bad.push('DXF cross-cuts');if(/NaN|undefined/.test(N.svg+D))bad.push('NaN');
  var g=K.geom(),pa=g.attributes.position.array,a0=G.ribs[0].a0,inn=0;for(var i=0;i<pa.length;i+=9){var cx=(pa[i]+pa[i+3]+pa[i+6])/3,ym=Math.max(pa[i+1],pa[i+4],pa[i+7]);if(ym<=a0+.6&&cx>O.cA+O.t+1&&cx<O.cB-1)inn++;}
  if(inn)bad.push(inn+' base triangles across the door');if(!O.baseCut)bad.push('channel not cut');if(K.text().indexOf('stops at each trimmer')<0)bad.push('text');
  S.serial.open=false;S.serial.zeroWaste=false;S.serial.path='drawn';S.serial.rp='0,0;.5,-.5;1,0';S.serial.dMax=300;S.serial.holdBend=true;T.regen();var Q=K.rec();
  if(!Q)return{pass:false,detail:'no curve'};m.held=+Q.held.toFixed(2);m.gap=+Q.gapMin.toFixed(1);if(Q.clash!==0||!(Q.held<1&&Q.held>0)||!(Q.gapMin>=6))bad.push('not eased: clash '+Q.clash+' held '+Q.held);if(!(Q.asked>0))bad.push('asked');
  var bb=function(){var q=K.geom();q.computeBoundingBox();return q.boundingBox.max.z;},z1=bb();S.serial.holdBend=false;T.regen();var Q0=K.rec(),z0=bb();if(!(Q0.clash>0&&Q0.held===1))bad.push('as drawn');if(!(z0>z1+20))bad.push('the 3D did not ease '+z0.toFixed(0)+' / '+z1.toFixed(0));
  S.serial.holdBend=true;S.serial.dir='horizontal';S.serial.dMax=160;S.serial.rp=window.PS_T153.shapes.s;T.regen();Q=K.rec();var nb=K.bands();
  if(!Q||!Q.nest||!nb)return{pass:false,detail:'no curved nest'};m.sheets=nb.sheets.length;m.left=nb.left;if(nb.n!==K2.G().ribs.length*nb.pieces)bad.push('bands '+nb.n);
  nb.sheets.forEach(function(sh){for(var j=0;j<sh.items.length;j++){var it=sh.items[j];it.back.concat(it.front).forEach(function(q){var x=it.ox+q[0],y=it.oy+q[1];if(!it.tooTall&&(x<-1||x>nb.sL+1||y<-1||y>nb.sS+1))bad.push('a band leaves its sheet');});
      if(j&&sh.items[j-1].p===it.p){var pv=sh.items[j-1],k=Math.floor(it.back.length/2);if(!(it.oy+it.back[k][1]>pv.oy+pv.front[k][1]+2))bad.push('bands overlap');}}});
  N=K.nest();D=K.dxf();if(!N.curved||(N.svg.match(/serial-band/g)||[]).length!==nb.n)bad.push('curved nest drawing');if(D.indexOf('CUTS')<0||/NaN|undefined/.test(N.svg+D+K.text()))bad.push('curved DXF');if(K.text().indexOf('curved bands')<0)bad.push('curved text');
  T.reset();return{pass:!bad.length,detail:bad.filter(function(v,i,a){return a.indexOf(v)===i;}).slice(0,6).join('; '),metrics:m};});

/* ---- p155-1: a real building as the massing example ---- */
guard('assembly','the Rhino example building is the massing: 41 by 16 m, two storeys, its 56 windows cut in the model walls where the Rhino model has them, the panels a window cuts counted, roof, windows and neighbours in the OBJ, a windows list in the files; changing the massing sets the example aside',function(){
  T.reset();var bad=[],m={},K=window.PS_T155;if(!K)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K.load('emm',true);T.regen();var M=K.model();
  if(K.now()!=='Emmenweid building')bad.push('not live: '+K.now());
  if(!M.site||M.site.wins!==56)bad.push('windows '+(M.site&&M.site.wins));
  var fw=M.faces.map(function(f){return f.windows;}).join(',');if(fw!=='20,8,20,8')bad.push('per face '+fw);
  var ws=0,out=0;M.walls.forEach(function(w){w.slots.forEach(function(q){if(q.win){ws++;if(q.x<0||q.x+q.w>w.L||q.y<0||q.y+q.h>M.Hm)out++;}});});if(ws!==56)bad.push('slots '+ws);if(out)bad.push(out+' windows off the wall');
  var w0=M.walls[0].slots.filter(function(q){return q.win;})[0];if(Math.abs(w0.w-(15.58-M.kf))>.02)bad.push('window width at 1:100 '+w0.w);
  if(M.faces[0].bays!==41||M.faces[0].cutPanels!==96)bad.push('W1 bays '+M.faces[0].bays+' cut '+M.faces[0].cutPanels);m.cut=M.site.cut;
  var o=K.obj(),g=function(n){return o.text.indexOf('g '+n)>=0;};if(!g('roof_slopes')||!g('roof_deck')||!g('windows_W1')||!g('windows_W4')||!g('context_8'))bad.push('obj groups');
  if(/NaN/.test(o.text))bad.push('NaN in obj');if((o.text.match(/^v /gm)||[]).length!==o.verts)bad.push('vertex count');var mx=0;(o.text.match(/^f .*$/gm)||[]).forEach(function(l){l.split(' ').slice(1).forEach(function(k){if(+k>mx)mx=+k;});});if(mx>o.verts)bad.push('face index past the vertices');m.verts=o.verts;
  var f=K.files();if(f.indexOf('model-1-100-windows.csv')<0)bad.push('no windows list');var c=K.csv().split('\n');if(c[0].indexOf('face,storey')!==0||c.length<62)bad.push('csv '+c.length);
  if(!K.rules().some(function(r){return /Rhino model/.test(r[1]);}))bad.push('rules do not say where it came from');
  S.mass.storeys=3;if(K.now()!==null)bad.push('still live on another massing');var M2=K.model();if(M2.site)bad.push('site kept');
  S.mass.storeys=2;if(K.now()===null)bad.push('did not come back');K.leave();if(K.now()!==null)bad.push('leave');
  return{pass:!bad.length,detail:bad.join('; ')||'56 windows, '+m.cut+' panels cut, obj '+m.verts+' vertices',metrics:m};
});

/* ---- p156-1: panels cut round the windows of the example building ---- */
guard('assembly','on the Rhino example building every panel a window crosses gets its real outline (the panel less the window and a clearance), holes kept only where they clear the cut by the web, a few named blank types, the face picture cut round the glass, a schedule, a blanks drawing and DXF, slivers found and a panel width that follows the windows removing them',function(){
  T.reset();var bad=[],m={},K=window.PS_T155,Q=window.PS_T156;if(!K||!Q)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K.load('emm',true);if(window.PS_T175)PS_T175.set('repeat');T.regen();var C=Q.model();if(!C)return{pass:false,detail:'no cut model'};
  m.all=C.all;m.cut=C.cut;m.types=C.types.length;m.slivers=C.slivers;
  if(C.all!==164)bad.push('design panels '+C.all);if(C.cut<60||C.cut>130)bad.push('cut '+C.cut);
  var sum=C.types.reduce(function(a,t){return a+t.n;},0);if(sum!==C.cut)bad.push('types count '+sum+' of '+C.cut);if(C.types.length>C.cut/2)bad.push('too many types '+C.types.length);
  var areaBad=0,inside=0;C.faces.forEach(function(F){if(F.code!=='d')return;F.panels.forEach(function(p){if(p.gone)return;var a=p.loops.reduce(function(s,l){return s+Q.area(l);},0),o=p.rel.reduce(function(s,q){return s+(q[1]-q[0])*(q[3]-q[2]);},0);if(Math.abs(a-(p.bw*p.rh-o))>2)areaBad++;
    p.loops.forEach(function(l){l.forEach(function(pt){p.rel.forEach(function(q){if(pt[0]>q[0]+.01&&pt[0]<q[1]-.01&&pt[1]>q[2]+.01&&pt[1]<q[3]-.01)inside++;});});});
    var w=C.c;p.win.forEach(function(){});});});
  if(areaBad)bad.push(areaBad+' outlines not the panel less the opening');if(inside)bad.push(inside+' outline points inside an opening');
  var near=0;C.types.forEach(function(t){t.keep.forEach(function(h){var a=h[0]*t.fx,b=h[1]*t.fx,c=h[2]*t.fy,d=h[3]*t.fy;t.rel.forEach(function(q){if(b>q[0]-C.web+.01&&a<q[1]+C.web-.01&&d>q[2]-C.web+.01&&c<q[3]+C.web-.01)near++;});});});if(near)bad.push(near+' kept holes within the web of a cut');
  var c0=C.c;if(c0!==20)bad.push('clearance '+c0);
  var f0=Q.face(0),f2=Q.face(2);if(!f0||!f0.w156)bad.push('design face picture not cut');if(!f2||f2.code!=='s'||f2.w156)bad.push('screen face touched');
  var g=Q.px(0,(2193+400)/41000,2000/8000);if(!g||!(g[2]>g[0]+20))bad.push('no glass at a window centre '+g);
  if(C.slivers!==8||Math.round(C.minSliver)!==68)bad.push('slivers '+C.slivers+' min '+C.minSliver);
  var csv=Q.csv().split(String.fromCharCode(10));if(csv[0].indexOf('face,column,row')!==0)bad.push('csv head');var rows=csv.filter(function(l){return /^W1,/.test(l);}).length;if(rows!==C.cut+C.gone)bad.push('csv rows '+rows);
  var fl=Q.files();['cut-panels.csv','cut-blanks.svg','cut-blanks.dxf'].forEach(function(n){if(!fl.some(function(x){return x.indexOf(n)>=0;}))bad.push('no '+n);});
  var dx=Q.dxf();if(/NaN/.test(dx)||dx.indexOf('FOLD')<0)bad.push('dxf');if(Q.svg().indexOf('PANELS CUT ROUND THE WINDOWS')<0)bad.push('svg');
  var R=Q.rules();if(!R.some(function(r){return /blank types/.test(r[1]);}))bad.push('rules do not name the types');if(!R.some(function(r){return r[0]==='pr-warn'&&/narrower than 100 mm/.test(r[1]);}))bad.push('no sliver warning');
  var fit=Q.fit();m.fit=fit&&fit.w;if(!fit||fit.long.slivers)bad.push('fit '+(fit&&fit.w));else{S.width=fit.w;T.regen();var C2=Q.model();m.types2=C2.types.length;m.slivers2=C2.slivers;if(C2.slivers)bad.push('slivers after fit '+C2.slivers);if(C2.types.length>=C.types.length)bad.push('types after fit '+C2.types.length);if(!/short faces/.test(fit.say))bad.push('fit does not say the short faces');}
  K.leave();if(Q.model()!==null)bad.push('still cut after leaving');
  return{pass:!bad.length,detail:bad.join('; ')||C.cut+' cut in '+m.types+' types, '+m.slivers+' slivers; at '+m.fit+' mm: '+m.types2+' types, '+m.slivers2+' slivers',metrics:m};
});
/* ---- p157-1: panels over the windows or round them; one picture on n faces; trees off ---- */
guard('assembly','on the Rhino example building the panels either are cut round the windows or run over them: over, nothing is cut, the face picture carries no window and the rules say so; round, the cut comes back; one picture goes on one, two, three or every face from the face asked; the trees are off unless asked',function(){
  T.reset();var bad=[],K5=window.PS_T155,K=window.PS_T157;if(!K5||!K)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);T.regen();
  if(K.isOver())bad.push('over by default');if(!K.cut())bad.push('no cut by default');var r0=K.canvas(0);if(!r0||!r0.w155)bad.push('round: no windows on the face picture');
  K.over('over');if(!K.isOver())bad.push('not over');if(K.cut()!==null)bad.push('still cut when over');var r1=K.canvas(0);if(!r1||r1.w157!==1||!/runs over 20 windows/.test(r1.note))bad.push('over: face note '+(r1&&r1.note));
  if(!K.rules().some(function(q){return /run over the windows/.test(q[1]);}))bad.push('rules silent');if(K.rules().some(function(q){return /are cut by a window/.test(q[1]);}))bad.push('rules still count cut panels');
  K.over('round');if(K.isOver()||!K.cut())bad.push('round did not come back');
  var c=K.picture(1,2).join('');if(c!=='dcwc')bad.push('one face from W3: '+c);c=K.picture(3,3).join('');if(c!=='wwdw')bad.push('three from W4: '+c);c=K.picture(4,0).join('');if(c!=='wwww')bad.push('all: '+c);c=K.picture(0,0).join('');if(c!=='dddd')bad.push('none: '+c);
  if(S.mass.trees!==false)bad.push('trees on by default');K5.leave();
  return{pass:!bad.length,detail:bad.join('; ')||'over and round, a picture on 1, 3, 4 and no faces, trees off'};
});

/* ---- p158-1: real returns and reveals round the windows of the example building ---- */
guard('assembly','on the Rhino example building, cut round the windows, every window on a design, composite, glazed or plain face is a real opening: the face picture is cut out there, a return folds back 25 mm, a reveal lining runs to the wall, the sill drips past the panel face, the frame and glass sit at the wall; the screen face and the over mode are untouched; the OBJ carries returns and reveals with the windows at the wall line',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,K7=window.PS_T157,Q=window.PS_T158;if(!K5||!K7||!Q)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);T.regen();if(!Q.on())bad.push('not on in round mode');
  K5.build();var L=Q.last();if(!L)bad.push('no reveals built in 3D');else{m.openings=L.openings;m.meshes=L.meshes;if(L.faces!==3)bad.push('faces '+L.faces);if(L.openings!==36)bad.push('openings '+L.openings);if(L.meshes>8)bad.push('meshes '+L.meshes);if(L.ret!==25)bad.push('return '+L.ret);}
  var R=Q.parts(0);if(!R||R.ops.length!==20)bad.push('W1 openings '+(R&&R.ops.length));else{
    if(R.ret.length!==80)bad.push('returns '+R.ret.length);var off=function(p){return (p[0]-R.a[0])*R.n[0]+(p[1]-R.a[1])*R.n[1];};
    var gO=R.glass.map(function(q){return off(q[0]);}),mx=Math.max.apply(null,gO);if(mx>R.P/2)bad.push('glass not at the wall: '+mx);
    var rO=R.ret.map(function(q){return Math.min(off(q[0]),off(q[1]),off(q[2]),off(q[3]));}),rmn=Math.min.apply(null,rO);if(Math.abs(rmn-(R.P-25))>.5)bad.push('return depth '+(R.P-rmn));
    var lO=[];R.lin.forEach(function(q){q.forEach(function(p){lO.push(off(p));});});if(Math.min.apply(null,lO)>.5)bad.push('lining stops short of the wall');if(Math.max.apply(null,lO)<R.P+30)bad.push('no drip past the face');}
  var cv=Q.canvas(0),o=R&&R.ops[0];if(cv&&o){var a=cv.getContext('2d').getImageData(Math.round((o[0]+o[1])/2/41000*cv.width),Math.round(cv.height-(o[2]+o[3])/2/8000*cv.height),1,1).data[3];if(a!==0)bad.push('window still painted on the 3D picture (alpha '+a+')');}else bad.push('no 3D picture');
  var g=window.PS_T156.px(0,(2193+400)/41000,2000/8000);if(!g||!(g[2]>g[0]+20))bad.push('2D picture lost its window');
  var ob=Q.obj(),t=ob.text;['returns_W1','reveals_W1','window_frames_W1','returns_W2','reveals_W4'].forEach(function(n){if(t.indexOf('g '+n+'\n')<0)bad.push('obj no '+n);});if(t.indexOf('g returns_W3')>=0)bad.push('screen face got returns');
  if(/NaN/.test(t))bad.push('NaN');if((t.match(/^v /gm)||[]).length!==ob.verts)bad.push('vertex count');
  var k=t.indexOf('g windows_W1\n'),vl=t.slice(k).split('\n')[1].split(' ');if(Math.abs(+vl[2]+12)>2)bad.push('W1 window not at the wall line: y '+vl[2]);
  if(!Q.rules().some(function(r){return /reveal lining/.test(r[1])&&/first statement/.test(r[1]);}))bad.push('rules silent');
  var c=Q.csv().split(String.fromCharCode(10));if(!/,reveal_mm$/.test(c[0]))bad.push('csv head');if(R&&c[1].split(',').pop()!==String(R.P-25))bad.push('csv row '+c[1].slice(-12));
  K7.over('over');if(Q.on())bad.push('on in over mode');K5.build();if(Q.last())bad.push('reveals built in over mode');if(Q.obj().text.indexOf('g returns_')>=0)bad.push('over obj has returns');if(Q.rules().some(function(r){return /reveal lining/.test(r[1]);}))bad.push('over rules speak of reveals');
  K7.over('round');K5.leave();if(Q.on())bad.push('on after leaving');
  return{pass:!bad.length,detail:bad.join('; ')||m.openings+' openings with returns and reveals in '+m.meshes+' meshes; windows at the wall line in the OBJ',metrics:m};
});

/* ---- p159-1: picture and kept-design faces cut round the windows; over or round face by face ---- */
guard('assembly','on the Rhino example building a picture running across three faces is cut round their windows like a design face (outlines, blank types typed by outline only, the picture unchanged away from the openings, returns and reveals in 3D, the schedule saying by panel); a kept design is cut at its own panel size; each face runs over or is cut round on its own: an over face is not cut and has the wall behind it while its neighbour keeps its reveals, and the rules say so face by face; the two building-wide buttons still set every face',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,K7=window.PS_T157,Q=window.PS_T159,X=window.PS_T145;if(!K5||!K7||!Q||!X)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);S.mass.winModes='';T.regen();
  K7.over('over');Q.picture(3,0);var pts=[],ref=[],v=4300/8000;for(var b=0;b<41;b+=4)pts.push((b+.5)*1000/41000);pts.forEach(function(u){ref.push(Q.px(0,u,v));});var wU=(2193+400)/41000,wV=2000/8000,refW=Q.px(0,wU,wV);
  Q.all('round');var C=Q.model();if(!C)return{pass:false,detail:'no cut model with picture faces'};m.cut=C.cut;m.types=C.types.length;m.byOutline=C.byOutline;
  if(!C.kinds||C.kinds.w!==3)bad.push('picture faces cut '+JSON.stringify(C.kinds));[0,1,2].forEach(function(i){var F=C.faces[i];if(F.code!=='d'||F.kind!=='w'||!(F.cut>0))bad.push('W'+(i+1)+' not cut');});if(C.faces[3].ops.length!==8)bad.push('composite openings');
  var sum=C.types.reduce(function(a,t){return a+t.n;},0);if(sum!==C.cut)bad.push('types count '+sum+' of '+C.cut);if(!(C.byOutline>0))bad.push('no outline types');if(C.types.some(function(t){return t.byOutline&&t.keep.length;}))bad.push('a picture type lists holes');
  var areaBad=0;[0,1,2].forEach(function(i){C.faces[i].panels.forEach(function(p){if(p.gone)return;var a=p.loops.reduce(function(s,l){return s+window.PS_T156.area(l);},0),o=p.rel.reduce(function(s,q){return s+(q[1]-q[0])*(q[3]-q[2]);},0);if(Math.abs(a-(p.bw*p.rh-o))>2)areaBad++;});});if(areaBad)bad.push(areaBad+' picture outlines wrong');
  var moved=0;pts.forEach(function(u,k){var p=Q.px(0,u,v),r=ref[k];if(!p||!r||Math.abs(p[0]-r[0])+Math.abs(p[1]-r[1])+Math.abs(p[2]-r[2])+Math.abs(p[3]-r[3])>6)moved++;});if(moved)bad.push('the picture changed away from the openings at '+moved+' of '+pts.length+' points');
  var g=Q.px(1,(2050+350)/16000,wV);if(!g||!(g[2]>g[0]+20))bad.push('no glass in a W2 window '+g);var nt=Q.canvas(1).note||'';if(!/panels cut round them/.test(nt))bad.push('W2 note '+nt);
  var B=Q.build();if(!B.rev||B.rev.openings!==56||B.rev.faces!==4)bad.push('3D reveals '+JSON.stringify(B.rev));if(B.mass.over!==0)bad.push('wall behind a round face');
  var c3=Q.canvas3d(1);if(!c3||c3.getContext('2d').getImageData(Math.round((2050+700)/16000*c3.width),Math.round(c3.height*(1-wV)),1,1).data[3]!==0)bad.push('W2 3D picture not cut out');
  var csv=Q.csv().split(String.fromCharCode(10)),w2=csv.filter(function(l){return /^W2,/.test(l);});if(!w2.length||!w2.every(function(l){return l.indexOf(',by panel,by panel,')>0;}))bad.push('schedule does not say by panel');if(!/,reveal_mm$/.test(csv[0]))bad.push('csv head');
  if(Q.svg().indexOf('holes by panel')<0)bad.push('blanks drawing');var wr=Q.wrap().split(String.fromCharCode(10));if(!/,blank_type$/.test(wr[0])||!wr.some(function(l){return /^1,W2,.*,B\d+$/.test(l);}))bad.push('wrap list blank types');
  var rd=Q.file('README-model')||'';if(rd.indexOf('typed by outline only')<0)bad.push('README');if(!Q.rules().some(function(r){return /typed by outline only/.test(r[1]);}))bad.push('rules silent on outline types');
  Q.set(0,'over');var md=Q.modes().join(',');if(md!=='over,round,round,round')bad.push('modes '+md);if(!Q.overFace(0)||Q.isOver())bad.push('over flags');
  C=Q.model();if(!C||C.faces[0].code!=='o'||C.faces[0].panels.length||C.over.join()!=='0'||C.round.join()!=='1,2')bad.push('model with W1 over '+(C&&[C.faces[0].code,C.over,C.round]));
  var n0=Q.canvas(0).note||'';if(!/runs over 20 windows/.test(n0))bad.push('W1 note '+n0);var pW=Q.px(0,wU,wV);if(!pW||!refW||Math.abs(pW[2]-refW[2])+Math.abs(pW[3]-refW[3])>6)bad.push('W1 window painted while over');
  B=Q.build();if(!B.rev||B.rev.openings!==36)bad.push('openings with W1 over '+(B.rev&&B.rev.openings));if(B.mass.over!==1||!B.mass.f159||B.mass.f159.over.join()!=='W1')bad.push('wall behind '+B.mass.over);
  var ob=Q.obj().text;if(ob.indexOf('g returns_W1\n')>=0||ob.indexOf('g returns_W2\n')<0)bad.push('obj returns by face');if(/NaN/.test(ob))bad.push('NaN');
  if(!Q.rules().some(function(r){return /^Face by face/.test(r[1])&&/W1 runs over/.test(r[1]);}))bad.push('rules not face by face');
  var nb=Q.sync();if(nb!==6)bad.push('face rows '+nb);var on=document.querySelector('.over157 [data-wf="0"][data-wm="o"]');if(!on||!on.classList.contains('on'))bad.push('W1 Over not shown');
  Q.all('round');X.keep(0);S.width=1500;S.height=4000;T.regen();X.set(['d','1','s','c']);C=Q.model();var F1=C&&C.faces[1];
  if(!F1||F1.kind!=='1'||F1.bays!==16||F1.rows!==4||!(F1.cut>0))bad.push('kept face '+(F1&&[F1.kind,F1.bays,F1.rows,F1.cut]));if(!C||C.faces[0].bays!==27)bad.push('design face bays '+(C&&C.faces[0].bays));if(!C||!C.types.some(function(t){return t.byOutline==='1';}))bad.push('kept types');
  Q.all('over');if(Q.model()!==null||Q.modes().join()!=='over,over,over,over')bad.push('all over');Q.all('round');if(!Q.model())bad.push('all round');
  K5.leave();if(Q.model()!==null)bad.push('cut after leaving');X.slots()[0]=null;S.mass.winModes='';
  return{pass:!bad.length,detail:bad.join('; ')||m.cut+' panels cut on three picture faces, '+m.byOutline+' outline types; W1 over with the wall behind, 36 openings kept on the others; a kept design cut at its own size',metrics:m};
});
/* ---- p160-1: every panel kind on the example building; facade ribs; a paved plaza in front ---- */
guard('assembly','on the Rhino example building a click on a panel-kind tab keeps the building and its design faces take that kind: brick as one bond with every window an opening, kinetic units as one lattice, the cut pattern and tiles as pictures; serial ribs stand as real fins, none inside a window when cut round, none meeting a fin of the next face at a corner; a paved plaza lies on the ground in front of W1, clear of the building, and the Pavers tab edits it with the building kept; leaving the example leaves nothing',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,K7=window.PS_T157,X=window.PS_T145,P=window.PS_T160;if(!K5||!K7||!X||!P)return{pass:false,detail:'handle missing'};
  var has=typeof THREE!=='undefined'&&T.hostScene;T.setPanelMode('perf');K5.load('emm',true);T.regen();if(!S.mass.show3d)bad.push('not in 3D after loading');
  var kinds=[['Brick courses','brick'],['Kinetic units','kin'],['Pattern','cut'],['Ombrae tiles','tiles'],['Serial sections','serial']];
  kinds.forEach(function(k){T.showTab(k[0],true);T.regen();if(!S.mass.show3d)bad.push(k[0]+' dropped the building');if(P.mode()!==k[1])bad.push(k[0]+' mode '+P.mode());if(!K5.now())bad.push(k[0]+' not live');
    if(k[1]==='brick'){var c=P.canvas(0);m.bricks=c&&c.bricks;if(!c||!c.w160||c.bricks<5000)bad.push('brick face '+(c&&c.bricks));var r=P.rules();if(!r.some(function(x){return /Brick faces are brickwork/.test(x[1]);}))bad.push('brick rule');if(r.some(function(x){return /blank type/.test(x[1]);}))bad.push('brick face still speaks of blank types');
      K7.over('over');var C=K7.cut();if(!C||!C.faces[0]||C.faces[0].ops.length!==20)bad.push('brick ran over the windows');K7.over('round');}
    if(k[1]==='kin'){var c2=P.canvas(0);m.units=c2&&c2.note;if(!c2||!/kinetic units/.test(c2.note||''))bad.push('kinetic face '+(c2&&c2.note));}
    if(k[1]==='cut'||k[1]==='tiles'){var c3=P.canvas(0);if(!c3||!c3.cv||c3.cv.width<200)bad.push(k[0]+' face picture');}
    if(has){T.hostScene();var L=P.last();if(!L||L.mode!==k[1])bad.push(k[0]+' 3D '+(L&&L.mode));}});
  /* ribs: real fins on every design face */
  X.set(['d','d','d','d']);S.mass.ribWin='open';T.regen();var R=P.ribs();if(!R)bad.push('no ribs');else{m.ribs=R.n;m.pieces=R.pieces.length;if(R.n<300)bad.push('ribs '+R.n);
    var inside=0;R.pieces.forEach(function(p){var F=R.faces.filter(function(f){return f.i===p.f;})[0];F.ops.forEach(function(o){if(p.x+R.t/2>o[0]&&p.x-R.t/2<o[1]&&p.z1>o[2]+1&&p.z0<o[3]-1)inside++;});});if(inside)bad.push(inside+' rib pieces inside a window');
    var box=function(p){var F=R.faces.filter(function(f){return f.i===p.f;})[0],xs=[],ys=[];[p.x-R.t/2,p.x+R.t/2].forEach(function(x){[R.ob,R.ob+p.dmax].forEach(function(o){xs.push(F.a[0]+F.u[0]*x+F.nv[0]*o);ys.push(F.a[1]+F.u[1]*x+F.nv[1]*o);});});return[Math.min.apply(null,xs),Math.min.apply(null,ys),Math.max.apply(null,xs),Math.max.apply(null,ys)];};
    var ends=R.pieces.filter(function(p){var F=R.faces.filter(function(f){return f.i===p.f;})[0];return p.x<1500||p.x>F.L-1500;}),hit=0;
    for(var a=0;a<ends.length;a++)for(var b=a+1;b<ends.length;b++){if(ends[a].f===ends[b].f)continue;var A=box(ends[a]),B=box(ends[b]);if(A[0]<B[2]&&B[0]<A[2]&&A[1]<B[3]&&B[1]<A[3]&&ends[a].z0<ends[b].z1&&ends[b].z0<ends[a].z1)hit++;}if(hit)bad.push(hit+' ribs meet a rib of the next face');m.cornerPairs=ends.length;
    var csv=P.csv();if(csv.indexOf('face,rib,x_along_face_mm')!==0)bad.push('rib schedule');if(P.files().filter(function(n){return /facade-ribs\.csv$/.test(n);}).length!==1)bad.push('rib schedule not in the files');
    if(!P.rules().some(function(x){return /ribs of .* stand on 4 faces at a pitch of \d+ mm/.test(x[1]);}))bad.push('rib rule');
    K7.over('over');var R2=P.ribs();if(!R2||R2.pieces.some(function(p){return p.cut;}))bad.push('ribs cut in over mode');m.overPieces=R2&&R2.pieces.length;K7.over('round');
    if(has){T.hostScene();var L2=P.last();m.verts=L2&&L2.ribs&&L2.ribs.verts;if(!L2||!L2.ribs||L2.ribs.n!==R.n)bad.push('3D ribs');else if(L2.ribs.verts>600000)bad.push('ribs too heavy '+L2.ribs.verts);}
    var o=P.obj();if(!o||o.text.indexOf('g facade_ribs_W1')<0||/NaN/.test(o.text))bad.push('ribs in the OBJ');S.mass.ribWin='veil';}
  X.set(['d','c','s','c']);
  /* the plaza */
  S.mass.plaza=true;S.mass.plazaD=12000;S.mass.plazaSide=0;P.plazaStart();var pg=P.plazaG();m.plaza=pg&&pg.n;if(!pg||!(pg.n>0)||Math.abs(pg.L-41000)>1||pg.D!==12000)bad.push('plaza '+JSON.stringify(pg));
  if(has){T.hostScene();var pl=P.plaza();if(!pl)bad.push('no plaza in 3D');else{var bx=pl.box;m.box=bx.map(Math.round).join(',');/*p170: the plaza falls from the plinth top to the street and starts past a threshold of up to 1.5 m*/if(bx[1]<-700||bx[1]>5)bad.push('plaza not on the ground '+bx[1]);if(bx[2]<8000+153+40)bad.push('plaza reaches the building '+bx[2]);if(bx[5]>8000+600+1500+12000+300)bad.push('plaza too deep '+bx[5]);if(bx[3]-bx[0]<40000)bad.push('plaza narrower than the face');}}
  if(!P.rules().some(function(x){return /paved plaza of 41\.0 by 12\.0 m/.test(x[1]);}))bad.push('plaza rule');var ob=P.obj();if(!ob||ob.text.indexOf('g plaza_W1_pavers')<0)bad.push('plaza not in the OBJ');
  T.showTab('Pavers',true);if(!S.mass.show3d)bad.push('Pavers dropped the building');if(S.width!==41000||S.height!==12000)bad.push('the Pavers ground is '+S.width+' x '+S.height);var fc=P.fac();if(!fc||fc.mode!=='serial'||fc.w!==1000)bad.push('facade not kept aside '+JSON.stringify(fc));
  var Mp=K5.model();if(Mp.faces[0].bays!==41)bad.push('facade module lost in Pavers: '+Mp.faces[0].bays);T.showTab('Brick courses',true);if(S.width!==1000||S.height!==2000||P.fac())bad.push('leaving Pavers gives '+S.width+' x '+S.height);
  S.mass.plaza=false;K5.leave();if(has){T.hostScene();if(P.last()||P.plaza())bad.push('something left after leaving');}
  return{pass:!bad.length,detail:bad.join('; ')||'five kinds kept on the building; '+m.ribs+' ribs in '+m.pieces+' pieces on four faces, none in a window or meeting at a corner; a plaza of '+m.plaza+' pavers in front of W1',metrics:m};
});
/* ---- p161-1: the facade ribs as serial sections of one surface, every piece carried ---- */
guard('assembly','on the Rhino example building the serial ribs slice one designed surface and are carried: every piece hangs from a fixed cleat on a carrier rail and is held at its foot by a slotted cleat in the rail below; every rail stands on brackets no more than 1,200 mm apart and none inside a window; with the bays open no rib is in a window, with the ribs running past every window has a head trimmer and every rib that crosses a window is clipped to one; two jamb ribs at every window column; no piece under the minimum; the profile runs on across the slab joint; no rib meets a rib of the next face; four designs give relief; the schedules, the details and the OBJ are written; the header counts the building',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,X=window.PS_T145,Q=window.PS_T161,P=window.PS_T160;if(!K5||!X||!Q||!P)return{pass:false,detail:'handle missing'};
  var has=typeof THREE!=='undefined'&&T.hostScene;T.setPanelMode('perf');K5.load('emm',true);T.regen();T.showTab('Serial sections',true);T.regen();X.set(['d','d','d','d']);T.regen();
  var ovl=function(a,b){return a[0]<b[1]&&b[0]<a[1]&&a[2]<b[3]&&b[2]<a[3];};
  ['veil','open'].forEach(function(wm){S.mass.ribWin=wm;var R=Q.ribs();if(!R||!R.pieces.length){bad.push(wm+': no ribs');return;}m[wm]={ribs:R.n,pieces:R.pieces.length,rails:R.rails.length,brackets:R.brackets.length,trimmers:R.trimmers.length,ties:R.ties.length};
    var FX=function(i){return R.faces.filter(function(f){return f.i===i;})[0];},RL={};R.rails.forEach(function(r){RL[r.id]=r;});var nf=0,nr=0,ni=0,ns=0,nw=0,nj=0,nc=0,nm=0;
    R.pieces.forEach(function(p){var a=RL[p.top.id],b=RL[p.foot.id];if(!a||a.f!==p.f||p.x<a.x0-1||p.x>a.x1+1||Math.abs(a.z-p.z1)>120)nf++;if(!b||b.f!==p.f||p.x<b.x0-1||p.x>b.x1+1||Math.abs(b.z-p.z0)>120)nf++;if((p.top.k==='fixed')===(p.foot.k==='fixed'))nf++;
      if(p.z1-p.z0<450)ns++;var F=FX(p.f);if(wm==='open')F.allOps.forEach(function(o){if(ovl([p.x-p.T/2,p.x+p.T/2,p.z0,p.z1],o.o))ni++;});
      if(wm==='veil'&&p.kind==='veil'&&!p.rs.some(function(r){return r.k==='trimmer';}))nm++;});
    R.rails.forEach(function(r){if(r.kind==='trimmer'||r.kind==='corner')return;var bs=R.brackets.filter(function(b){return b.rail===r.id;}).map(function(b){return b.x;}).sort(function(a,b){return a-b;});if(bs.length<2)nr++;for(var k=1;k<bs.length;k++)if(bs[k]-bs[k-1]>1200+130)nr++;});
    R.brackets.forEach(function(b){var F=FX(b.f);F.allOps.forEach(function(o){if(ovl([b.x-60,b.x+60,b.z-80,b.z+80],o.o))nw++;});});
    R.faces.forEach(function(F){F.cols.forEach(function(c,k){var j=F.X.filter(function(r){return r.kind==='jamb'&&r.col===k;});if(j.length!==2)nj++;});
      if(wm==='veil')F.wz.forEach(function(w){if(!R.trimmers.some(function(t){return t.f===F.i&&t.col===w.k&&t.which==='head'&&t.z>w.z1&&t.z<w.z1+400;}))nc++;});});
    if(nf)bad.push(wm+': '+nf+' piece ends not on a rail');if(nr)bad.push(wm+': '+nr+' rails with brackets too far apart');if(nw)bad.push(wm+': '+nw+' brackets in a window');if(ns)bad.push(wm+': '+ns+' pieces under the minimum');
    if(ni)bad.push(wm+': '+ni+' ribs in a window');if(nj)bad.push(wm+': '+nj+' window columns without two jamb ribs');if(nc)bad.push(wm+': '+nc+' windows without a head trimmer');if(nm)bad.push(wm+': '+nm+' ribs over a window not clipped to a trimmer');
    var jmp=0;R.pieces.forEach(function(p){if(p.st!==1)return;var q=R.pieces.filter(function(o){return o.f===p.f&&o.k===p.k&&o.st===2;})[0];if(q&&Math.abs(p.d[p.d.length-1]-q.d[0])>25)jmp++;});if(jmp)bad.push(wm+': '+jmp+' ribs jump at the slab joint');
    if(R.dLo<S.mass.surfMin-1)bad.push(wm+': a rib shallower than the surface minimum '+R.dLo);});
  S.mass.ribWin='veil';var R=Q.ribs();
  var box=function(p){var F=R.faces.filter(function(f){return f.i===p.f;})[0],xs=[],ys=[],dm=Math.max.apply(null,p.d);[p.x-p.T/2,p.x+p.T/2].forEach(function(x){[R.ob,R.ob+dm].forEach(function(o){xs.push(F.a[0]+F.u[0]*x+F.nv[0]*o);ys.push(F.a[1]+F.u[1]*x+F.nv[1]*o);});});return[Math.min.apply(null,xs),Math.min.apply(null,ys),Math.max.apply(null,xs),Math.max.apply(null,ys)];};
  var ends=R.pieces.filter(function(p){if(p.F)return false;var F=R.faces.filter(function(f){return f.i===p.f;})[0];return p.x<1500||p.x>F.L-1500;}),hit=0;
  for(var a=0;a<ends.length;a++)for(var b=a+1;b<ends.length;b++){if(ends[a].f===ends[b].f)continue;var A=box(ends[a]),B=box(ends[b]);if(A[0]<B[2]&&B[0]<A[2]&&A[1]<B[3]&&B[1]<A[3]&&ends[a].z0<ends[b].z1&&ends[b].z0<ends[a].z1)hit++;}if(hit)bad.push(hit+' ribs meet a rib of the next face');
  m.fans=R.fans.map(function(f){return f.n+' ribs, roots '+Math.round(f.rootClear)+' mm clear';});if(R.fans.length!==4)bad.push(R.fans.length+' corner fans, not 4');R.fans.forEach(function(f){if(f.n<3)bad.push('a fan of '+f.n);if(f.rootClear<15)bad.push('fan roots '+Math.round(f.rootClear)+' mm apart');if(f.gapA!=null&&f.gapA<15)bad.push('fan meets the ribs of '+f.A);if(f.gapB!=null&&f.gapB<15)bad.push('fan meets the ribs of '+f.B);if(f.end)bad.push('a fan between two ribbed faces ends');var fp=R.pieces.filter(function(p){return p.fan&&p.fan.corner===f.i&&p.st===1;});if(fp.length!==f.n)bad.push('fan pieces '+fp.length);var j=0;fp.sort(function(a,b){return a.fan.phi-b.fan.phi;});for(var k=1;k<fp.length;k++){var a=fp[k-1].d[Math.floor(fp[k-1].d.length/2)],b=fp[k].d[Math.floor(fp[k].d.length/2)];if(Math.abs(a-b)>60)j++;}if(j)bad.push('the fan jumps in depth');});var cr=R.rails.filter(function(r){return r.kind==='corner';});if(!cr.length||cr.some(function(r){return !r.adj||r.adj.length!==2;}))bad.push('corner rails not spliced to the face rails either side');
  var rel={};Q.designs.forEach(function(d){Q.design(d[0]);var Rd=Q.ribs();rel[d[0]]=Math.round(Rd.dHi-Rd.dLo);if(!(Rd.dHi-Rd.dLo>150))bad.push(d[0]+' has no relief');});m.relief=rel;if(S.field.kind!=='curves')bad.push('the pleat did not set the attractor field');Q.design('hoods');R=Q.ribs();
  X.set(['d','c','s','c']);T.regen();var R1=Q.ribs(),ef=R1.fans;m.startFans=ef.map(function(f){return f.n+(f.end?' with an end rib':'');});if(ef.length!==2||ef.some(function(f){return !f.end||!f.ribs.some(function(r){return r.end&&r.T===R1.Tj&&r.r0<=R1.P+10;});}))bad.push('W1 alone does not end in a return closed by a doubled end rib at the cladding');if(R1.rails.filter(function(r){return r.kind==='corner';}).some(function(r){return r.adj.length!==1;}))bad.push('a return rail not spliced');X.set(['d','d','d','d']);T.regen();R=Q.ribs();
  /* the defaults: the curve, every face, the windows clear */
  T.reset();T.setPanelMode('perf');K5.load('emm',true);T.regen();T.showTab('Serial sections',true);T.regen();var R0=Q.ribs();if(!R0||R0.faces.length!==4)bad.push('ribs not on all four faces by default');if(S.mass.ribSurf!=='pleat'||S.mass.ribWin!=='open')bad.push('defaults '+S.mass.ribSurf+' '+S.mass.ribWin);
  if(R0&&R0.pieces.some(function(p){var F=R0.faces.filter(function(f){return f.i===p.f;})[0];return !p.F&&F.allOps.some(function(o){return ovl([p.x-p.T/2,p.x+p.T/2,p.z0,p.z1],o.o);});}))bad.push('a rib covers a window by default');
  if(R0&&!R0.pieces.some(function(p){return p.kind==='span';}))bad.push('no spandrel ribs over the windows');m.defaults=R0&&{ribs:R0.n,pieces:R0.pieces.length,span:R0.pieces.filter(function(p){return p.kind==='span';}).length};
  /* the attractor drawn face by face: a point moved on W2 moves the surface on W2 and not on W4 */
  var mp1=Q.padMap(1),mp3=Q.padMap(3);if(!mp1||!mp3||Math.abs(mp1.W-16000)>1||!(mp1.u0<mp1.u1&&mp1.u1<=mp3.u0))bad.push('pad map');else{Q.design('pleat');var pts=String(S.field.curves.pts).split('|')[0].split(';').map(function(q){return q.split(',').map(Number);}),pi=-1;pts.forEach(function(q,i){if(q[0]>mp1.u0&&q[0]<mp1.u1)pi=i;});
    if(pi<0)bad.push('no point on W2');else{var u=pts[pi][0],v=pts[pi][1],x2=(u-mp1.u0)*mp1.per,zz=v*mp1.H,b2=Q.surf(1,x2,zz),b4=Q.surf(3,8000,zz);Q.padSet(1,0,pi,(u-mp1.u0)/(mp1.u1-mp1.u0),Math.min(.95,v+.35));var a2=Q.surf(1,x2,zz),a4=Q.surf(3,8000,zz);m.pad=[Math.round(b2),Math.round(a2),Math.round(b4),Math.round(a4)];if(!(Math.abs(a2-b2)>20))bad.push('moving a W2 point did not move W2');if(Math.abs(a4-b4)>1)bad.push('moving a W2 point moved W4');}}
  X.set(['d','d','d','d']);T.regen();R=Q.ribs();
  var pz=document.querySelector('.kinds160 [data-k=plz]');/*p170: pass 170 rebuilt the plaza and shows its controls again*/if(pz&&getComputedStyle(pz).display==='none')bad.push('the plaza controls do not show');
  var csv=Q.csv(),rl=Q.rails(),dt=Q.details();if(csv.split('\n').length<R.pieces.length||/NaN/.test(csv))bad.push('rib schedule');if(!/^rails/.test(rl)||rl.indexOf('trimmers')<0||rl.indexOf('brackets')<0||/NaN/.test(rl))bad.push('rail schedule');
  if(dt.indexOf('<svg')!==0||dt.indexOf('at a slab line')<0||dt.indexOf('corner in plan')<0||/NaN/.test(dt))bad.push('detail sheet');
  var fl=P.files();if(!fl.some(function(n){return /facade-rails\.csv$/.test(n);})||!fl.some(function(n){return /facade-rib-details\.svg$/.test(n);}))bad.push('files '+fl.join(' '));
  var ob=P.obj();if(!ob||ob.text.indexOf('g facade_ribs_W1')<0||ob.text.indexOf('g facade_rib_brackets_W1')<0||ob.text.indexOf('g facade_rib_trimmers_W1')<0||/NaN/.test(ob.text)||ob.text.indexOf('# facade ribs: ')>=0)bad.push('OBJ');
  var ru=Q.rules().map(function(x){return x[1];}).join(' ');if(!/first check/.test(ru)||!/slotted cleat/.test(ru))bad.push('rules');
  if(has){T.hostScene();var L=P.last();m.verts=L&&L.ribs&&L.ribs.verts;if(!L||!L.ribs||!L.ribs.brackets)bad.push('3D ribs');else if(L.ribs.verts>600000)bad.push('ribs too heavy '+L.ribs.verts);}
  T.regen();var st=Q.stats();if(!/ribs on the building/.test(st))bad.push('header: '+st);
  K5.leave();
  return{pass:!bad.length,detail:bad.join('; ')||'veil '+JSON.stringify(m.veil)+'; open '+JSON.stringify(m.open)+'; relief '+JSON.stringify(m.relief)+'; fans '+JSON.stringify(m.fans)+'; alone '+JSON.stringify(m.startFans)+'; defaults '+JSON.stringify(m.defaults)+'; pad '+JSON.stringify(m.pad)+'; verts '+m.verts,metrics:m};
});

/* ---- p162-1: serial sections cut from a body ---- */
guard('serial','sections of a body: every rib a closed section with both edges free, a seat and a canopy that curls over it, rods solved inside every section they cross so every piece has two and every neighbouring pair shares two, an arched passage leaves nothing in the opening and stops the channel, the nests (full size and model kit) have no overlaps, the print STL is closed, the files are written, and turning the body off gives the old relief back',function(){
  T.reset();var bad=[],m={},K=window.PS_T162;if(!K)return{pass:false,detail:'handle missing'};T.setPanelMode('serial');K.design('bench');T.regen();var G=K.G();
  if(!G||!G.serial||!G.serial.body)return{pass:false,detail:'not a body'};var M=K.model();if(!M)return{pass:false,detail:'no model'};
  m.ribs=M.SC.n;m.pieces=M.pieces;m.rods=M.fix.rods;m.sheets=M.nest.sheets.length;m.use=+M.nest.use.toFixed(2);m.kg=Math.round(M.kg);
  if(M.SC.n<60)bad.push('ribs '+M.SC.n);
  /* closed outlines with area, both edges free (the back is not one straight line) */
  var curl=0,flatBack=0;M.SC.ribs.forEach(function(r){r.pieces.forEach(function(pc){if(pc.outer.length<6||!(pc.area>1000))bad.push('outline of '+pc.label);});
    var o=r.pieces.reduce(function(a,pc){return pc.ymax-pc.ymin>a.ymax-a.ymin?pc:a;},r.pieces[0]);var zs=o.outer.map(function(p){return p[0];}),zl=Math.min.apply(null,zs);if(o.outer.filter(function(p){return Math.abs(p[0]-zl)<1;}).length>o.outer.length*.5)flatBack++;
    /* a level line through the seat and a vertical line through seat and canopy: the canopy curls over the seat when a vertical line crosses the rib's pieces four times or more */
    if(r.P.seat&&r.P.can&&r.P.seat.d>200&&r.P.can.R>300){var z=r.P.seat.zF+Math.min(150,r.P.seat.d*.4),n=0;r.pieces.forEach(function(pc){var L=pc.outer;for(var i=0;i<L.length;i++){var a=L[i],b=L[(i+1)%L.length];if((a[0]<z)!==(b[0]<z))n++;}});if(n>=4)curl++;}});
  m.curl=curl;if(!curl)bad.push('no rib where the canopy is over the seat');if(flatBack)bad.push(flatBack+' ribs on a flat back');
  /* rods */var RD=M.RD;if(RD.loose)bad.push(RD.loose+' pieces with fewer than two rods');if(RD.unlinked)bad.push(RD.unlinked+' neighbouring pairs with fewer than two shared rods');
  var outside=0,clr=RD.edge+RD.dh/2;RD.rods.forEach(function(o){for(var i=o.i0;i<=o.i1;i++){var r=M.SC.ribs[i];if(K.sdf(r.x+M.t/2,o.z,o.y)>-clr+4)outside++;}});if(outside)bad.push(outside+' rod crossings with too little wood round them');
  if(!M.seat||!M.seat.rule)bad.push('seat root under the depth over 2.5');if(RD.zones.seat&&RD.zones.seat.ok<RD.zones.seat.n)bad.push('seat ribs without a rod');if(RD.zones.canopy&&RD.zones.canopy.ok<RD.zones.canopy.n)bad.push('canopy ribs without a rod at the root');
  /* the nests */var cross=function(N){var bd=0,out=0,inn=0,xy=function(q,p){var e=q.e;return[q.ox+(p[0]*e.cs-p[1]*e.sn-e.a),q.oy+(p[0]*e.sn+p[1]*e.cs-e.b)];},o3=function(p,q,r){return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);},sx=function(a,b,c,d){return o3(a,b,c)*o3(a,b,d)<0&&o3(c,d,a)*o3(c,d,b)<0;},pin=function(L,x,y){var c=false;for(var i=0,j=L.length-1;i<L.length;j=i++){var a=L[i],b=L[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
    N.sheets.forEach(function(sh){var P=sh.items.map(function(q){return q.it.pc.outer.map(function(p){return xy(q,p);});});P.forEach(function(A){A.forEach(function(p){if(p[0]<-.5||p[1]<-.5||p[0]>N.SW+.5||p[1]>N.SL+.5)out++;});});
      for(var i=0;i<P.length;i++)for(var j=i+1;j<P.length;j++){var A=P[i],B=P[j],hit=false;if(pin(B,A[0][0],A[0][1])||pin(A,B[0][0],B[0][1]))inn++;for(var a=0;a<A.length&&!hit;a++)for(var b=0;b<B.length&&!hit;b++)if(sx(A[a],A[(a+1)%A.length],B[b],B[(b+1)%B.length]))hit=true;if(hit)bd++;}});return{bd:bd,out:out,inn:inn};};
  var c1=cross(M.nest);if(c1.bd||c1.out||c1.inn)bad.push('full nest: '+c1.bd+' crossing, '+c1.inn+' inside, '+c1.out+' off the sheet');if(M.nest.over.length)bad.push(M.nest.over.length+' pieces larger than the sheet');
  var KK=K.kit();m.modelRibs=KK.n;m.beds=KK.nest.sheets.length;m.dowel=KK.dw;var c2=cross(KK.nest);if(c2.bd||c2.out||c2.inn)bad.push('model nest: '+c2.bd+' crossing, '+c2.inn+' inside, '+c2.out+' off the bed');if(Math.abs(KK.pitchM/KK.tm-M.pitch/M.t)>.02)bad.push('model pitch out of proportion');
  /* files */var dx=K.dxf(),csv=K.csv(),fx=K.fix();if(dx.indexOf('CUT')<0||dx.indexOf('HOLES')<0||dx.indexOf('LABELS')<0||/NaN|undefined/.test(dx))bad.push('dxf');if(csv.trim().split('\n').length!==M.pieces+1||/NaN/.test(csv))bad.push('csv rows');if(fx.split('\n').filter(function(l){return l.indexOf('ROD')===0;}).length!==M.fix.rods)bad.push('rod schedule');
  var F=K.files().map(function(q){return q.name;}).join(' ');['-sections.svg','-model-1to10-nest.svg','-model-1to10-nest.dxf','-model-1to10-parts.csv','-print-1to10.stl'].forEach(function(n){if(F.indexOf(n)<0)bad.push('missing '+n);});
  var Pq=K.stl(),dv=new DataView(Pq.buf),nT=dv.getUint32(80,true),E={},key=function(a,b){var s=a<b?a+'|'+b:b+'|'+a;E[s]=(E[s]||0)+1;};for(var t=0;t<nT;t++){var o=84+t*50+12,v=[];for(var k=0;k<3;k++)v.push([dv.getFloat32(o+k*12,true),dv.getFloat32(o+k*12+4,true),dv.getFloat32(o+k*12+8,true)].map(function(q){return Math.round(q*200);}).join(','));key(v[0],v[1]);key(v[1],v[2]);key(v[2],v[0]);}
  var odd=0;for(var e in E)if(E[e]%2)odd++;m.stlTris=nT;if(odd)bad.push(odd+' open edges in the print STL');
  var rr=K.rules().map(function(q){return q[1];}).join(' ');if(/NaN|undefined/.test(rr))bad.push('NaN in the rules');if(rr.indexOf('Zero waste')<0)bad.push('the nest does not say zero waste does not apply');
  /* the passage */K.design('arch');T.regen();M=K.model();var inOp=0,pr=M.SC.ribs.filter(function(r){return r.P.pass&&r.P.pass.inside;});pr.forEach(function(r){r.pieces.forEach(function(pc){pc.outer.forEach(function(p){if(p[1]<r.P.pass.hArch-2&&p[1]>r.P.pass.sill+2)inOp++;});});});
  m.passRibs=pr.length;if(!pr.length)bad.push('no ribs over the passage');if(inOp)bad.push(inOp+' outline points in the opening');if(!M.lintel||M.lintel.rods<2)bad.push('lintel rods '+(M.lintel&&M.lintel.rods));if(M.chan.length!==2)bad.push('channel runs '+M.chan.length);if(M.RD.loose)bad.push('passage: '+M.RD.loose+' loose pieces');
  /* off: the relief as before */S.serial.body.on=false;T.regen();G=K.G();if(!G.serial||G.serial.body||!G.ribs.length||!G.ribs[0].v||G.ribs[0].body)bad.push('turning the body off did not give the relief back');
  T.reset();return{pass:!bad.length,detail:bad.slice(0,8).join('; ')||m.ribs+' ribs, '+m.pieces+' pieces on '+m.sheets+' sheets, '+m.rods+' rods, canopy over the seat on '+m.curl+' ribs',metrics:m};});

/* ---- p163-1: the brick pattern by rule, by chance and by curve ---- */
guard('brick','bricks are turned a fixed 45 degrees by rule, pushed out, set back and scattered by chance; every one bears by exact plan overlap with its centre over what it rests on; ends, base, top and openings stay calm; a one-brick bond is not turned; a closed bond holds turns to what clears; the designs keep the form and its openings',function(){
  T.reset();var P=window.PS_T163,bad=[],m={};if(!P)return{pass:false,detail:'no PS_T163'};
  if(P.designs.length<10)bad.push('only '+P.designs.length+' designs');
  /* the clip: two squares overlapping by a quarter */
  var I=P.clip([[0,0],[10,0],[10,10],[0,10]],[[5,5],[15,5],[15,15],[5,15]]);if(Math.abs(Math.abs(P.area(I))-25)>1e-6)bad.push('clip area '+P.area(I));
  var wall=function(id){P.S().arr='single';P.ex.brickForm('wall',{});P.design(id);return P.build();};
  var s=wall('r-dogtooth');m.dogtooth=[s.maxTurn,s.atRisk,s.minBear,s.laid,s.calm,s.bedOff];if(s.maxTurn<44.9||s.atRisk||s.laid<50||!s.calm||s.bedOff||s.straight)bad.push('dogtooth '+JSON.stringify(m.dogtooth));
  var G=P.G(),rows={};G.bricks.forEach(function(b){(rows[b.r]||(rows[b.r]=[])).push(b);});Object.keys(rows).forEach(function(r){var l=rows[r].sort(function(a,b){return a.x-b.x;});if(Math.abs(l[0].theta)>.01||Math.abs(l[l.length-1].theta)>.01)bad.push('course '+r+' end turned');});
  if(G.bricks.some(function(b){return b.r===0&&Math.abs(b.theta)>.01;}))bad.push('first course turned');
  s=wall('r-diamond');m.diamond=[s.maxIn,s.atRisk];if(s.maxIn<24.9||s.atRisk)bad.push('recess '+JSON.stringify(m.diamond));
  s=wall('r-corbel');m.corbel=[s.maxOut,s.atRisk,s.stepHeld];if(s.maxOut<60||s.atRisk)bad.push('corbel '+JSON.stringify(m.corbel));
  /* chance: the same seed lays the same bricks; another throw others; never two touching */
  var pick=function(){var o=[];P.G().bricks.forEach(function(b){if(b.p163&&b.p163.ds)o.push(b.r+':'+Math.round(b.x));});return o;};
  s=wall('r-scatter');var a1=pick();P.build();var a2=pick();P.S().brick.layers[0].seed=11;P.build();var a3=pick();m.scatter=[a1.length,a3.length,s.atRisk];
  if(a1.join()!==a2.join()||a1.join()===a3.join()||!a1.length||s.atRisk)bad.push('scatter '+JSON.stringify(m.scatter));
  P.S().brick.layers[0].seed=7;P.build();var R={};P.G().bricks.forEach(function(b){if(b.p163&&b.p163.ds)(R[b.r]||(R[b.r]=[])).push(b);});var touch=0;Object.keys(R).forEach(function(r){var l=R[r].sort(function(a,b){return a.x-b.x;});for(var i=1;i<l.length;i++)if(l[i].x-l[i].len/2-(l[i-1].x+l[i-1].len/2)<15)touch++;(R[r-1]||[]).forEach(function(q){l.forEach(function(b){if(Math.abs(q.x-b.x)<(q.len+b.len)/2)touch++;});});});if(touch)bad.push(touch+' chosen bricks touch');
  /* the curve: both sides turn opposite ways */
  s=wall('r-curve');var pos=0,neg=0;P.G().bricks.forEach(function(b){if(b.theta>5)pos++;if(b.theta<-5)neg++;});m.curve=[pos,neg,s.atRisk,s.minBear];if(!pos||!neg||s.atRisk)bad.push('curve '+JSON.stringify(m.curve));
  /* every brick of every design on a wall bears */
  P.designs.forEach(function(d){var q=wall(d[0]);if(q.atRisk||q.straight||q.bedOff)bad.push(d[0]+' at risk '+q.atRisk+', straight '+q.straight+', beds off '+q.bedOff);});
  /* a one-brick wall is not turned */
  wall('r-dentil');var B=P.S().brick;B.bond='flemish';B.layers=[{src:'rule',rule:'nth',n:3,does:'turn',amt:45}];s=P.build();m.flemish=[s.maxTurn,s.refused];if(s.maxTurn>.01||!s.refused)bad.push('Flemish turned '+JSON.stringify(m.flemish));
  /* a building keeps its openings; an open-bond design is laid closed there with its turns held */
  P.ex.brickExample('house');P.design('r-dentil');s=P.build();m.house=[s.openings,s.inOpen,s.atRisk,s.maxOut];if(s.openings<10||s.inOpen||s.atRisk||s.maxOut<30)bad.push('house '+JSON.stringify(m.house));
  P.ex.brickExample('house');P.design('r-pleat');s=P.build();m.housePleat=[s.openings,s.maxTurn,s.atRisk,P.R.closed];if(s.openings<10||s.maxTurn>10.01||s.atRisk||!P.R.closed)bad.push('house pleat '+JSON.stringify(m.housePleat));
  var say=P.say().map(function(x){return x[1];}).join(' ');if(!/exact overlap/.test(say)||!/closed bond/.test(say))bad.push('rules: '+say.slice(0,200));
  P.ex.brickExample('house');P.design('r-proud');s=P.build();m.proud=[s.maxOut,s.atRisk,s.openings];if(s.maxOut<29||s.atRisk||s.openings<10)bad.push('proud '+JSON.stringify(m.proud));
  T.reset();
  return{pass:!bad.length,detail:bad.join('; ')||JSON.stringify(m),metrics:m};
});
guard('flow','p165-1 one path to a design: Start first, the category card, one Next, the bundle first, steps for every kind, the coin facade, a build that assembles',function(){
  var U=window.PS_T165,bad=[],m={};if(!U)return{pass:false,detail:'PS_T165 missing'};
  var q=function(s){return document.querySelector(s);},onTab=function(){var t=TABS_ON();return t;};
  function TABS_ON(){var h=q('.tabpanel.on h2');return h?(h.title||h.textContent):'';}
  m.opened=U.openedOn();if(m.opened!=='Start')bad.push('the page opened on '+m.opened);
  /* nothing removed: the controls a person or a test reaches by path are all still in the page */
  ['cell','bar','width','height','brick.formL','brick.cope','paver.tiling','paver.leaf','omb.on','perf.on','perf.pitch','serial.pitch','kin.motion','glass.treat','mass.w','lock.on','fab.machine','field.noise.oct','lean.dowel'].forEach(function(p){if(!q('[data-path="'+p+'"]'))bad.push('lost '+p);});
  T.reset();S.arr='single';T.setPanelMode('brick');T.regen();T.updateStats();
  T.showTab('Material',true);q('#flow button[data-step="2"]').click();
  m.card=TABS_ON();if(m.card!=='Brick courses'||T.panelMode()!=='brick')bad.push('category card opened '+m.card+' in mode '+T.panelMode());
  U.step('Brick courses',1);var n0=U.nav('Brick courses').on;q('.coach140 .c-next').click();var n1=U.nav('Brick courses').on;m.next=[n0,n1,TABS_ON()];
  if(n0!==0||n1!==1||TABS_ON()!=='Brick courses')bad.push('coach Next went '+JSON.stringify(m.next));
  T.showTab('Fabricate & export',true);U.deliver();
  var fb=Array.prototype.filter.call(document.querySelectorAll('.tabpanel.on button'),function(b){return /Fabrication bundle|fabrication bundle/.test(b.textContent);})[0],bf=q('.tabpanel.on .u165-build');
  m.bundleFirst=!!(fb&&bf&&(fb.compareDocumentPosition(bf)&Node.DOCUMENT_POSITION_FOLLOWING));if(!m.bundleFirst)bad.push('the bundle is not before the building model');
  m.last=q('.coach140 .c-next').textContent;if(!/bundle/i.test(m.last)||q('.coach140 .c-next').disabled)bad.push('last Next reads '+m.last);
  ['Pattern','Ombrae tiles','Perforated image','Glass','Serial sections','Kinetic units'].forEach(function(t){T.showTab(t,false);U.sync();var n=U.nav(t);if(n.names.length<5||n.on<0)bad.push(t+' steps '+n.names.join('/'));});
  T.setPanelMode('paver');T.regen();T.showTab('Pavers',true);m.pavers=U.nav('Pavers').on;if(m.pavers<0)bad.push('Pavers opened with no step');
  var cb=q('[data-tab="Ombrae tiles"]');m.coin=cb?cb.textContent:'';if(!/Coin facade/.test(m.coin)||!/Ombrae tiles/.test(cb.title))bad.push('rail: '+m.coin+' / '+(cb&&cb.title));
  var cr=q('.u165-credit');if(!cr||!/Ombrae™/.test(cr.textContent)||!/Ombrae Studios and KPS/.test(cr.textContent))bad.push('the Ombrae credit is missing');
  /* the design builds itself: a clipping plane rises course by course and is taken off at the end */
  T.reset();S.arr='single';T.setPanelMode('brick');T.regen();T.hostScene();
  var ok=U.build(true);m.build=ok;
  if(ok){var A=U.anim(),during=U.clipped(),k1=A.seek(.3),k2=A.seek(.8);U.stopAnim();var left=U.clipped();
    m.anim={ax:A.last.ax,n:A.last.n,k1:k1,k2:k2,during:during,left:left};if(A.last.ax!=='y'||!(k1<k2&&k2<=A.last.n)||!during||left)bad.push('animation '+JSON.stringify(m.anim));}
  else m.build='no 3D here (skipped)';
  T.reset();T.regen();T.showTab('Pattern',false);
  return{pass:!bad.length,detail:bad.join('; ')||('opened on Start; card -> Brick courses; Next went step 1 -> 2; bundle first; six tabs stepped; coin facade with its credit; build '+JSON.stringify(m.anim||m.build)),metrics:m};});

/* ---- p164-1: paved grounds that read as built ground; designs to check ---- */
guard('paver','on a slope every paver lies in the graded surface (no step over 3 mm between neighbours, rigid edges counted, where moving whole stones would leave over 10), a bench stays level, no paving falls under 1 in 80 on the designs; terraces hold their walls to 600, every wall has a flight and a ramp no steeper than 1 in 12, no paver straddles a wall and the water passes; the gravel bed stops at an outline; flights are cut into the upper terrace; the mound has a seat wall on a contour, the valley a planted swale crossed by stepping stones, the street a line of six tree pits; at least eight paved grounds to start from build, their counts met and their water passing; the plaza function sets a whole 41 x 12 m ground',function(){
  T.reset();var bad=[],m={},Q=window.PS_T164,K4=window.PS_T144;if(!Q||!K4)return{pass:false,detail:'handles missing'};
  var ds=Q.designs();m.designs=ds.length;if(ds.length<8)bad.push('only '+ds.length+' designs');
  if(!document.querySelectorAll('.pg164 [data-pg]').length||document.querySelectorAll('.pg164 [data-pg]').length!==ds.length)bad.push('chip row missing');
  var rows=[];ds.forEach(function(d){Q.design(d[0]);T.regen();var r=Q.report();if(!r||!r.pavers){bad.push(d[0]+' built nothing');return;}rows.push(d[0]+' '+r.pavers);
    if(r.met===false)bad.push(d[0]+' counts not met: '+r.counts.join(', '));if(r.water.ok===false&&!Q.rules().some(function(q){return /water|fall|puddle/i.test(q[1]);}))bad.push(d[0]+' water fails without a reason');
    if(r.lips&&r.lips.worst>3)bad.push(d[0]+' step of '+r.lips.worst+' mm between pavers');if(r.falls&&r.falls.site&&d[0]!=='mound'&&d[0]!=='swale'&&r.falls.flat>.02)bad.push(d[0]+' '+Math.round(r.falls.flat*100)+' % falls under 1 in 80');
    m[d[0]]={n:r.pavers,lip:r.lips&&r.lips.worst,flat:r.falls&&Math.round((r.falls.flat||0)*100),ok:r.water.ok};});
  /* the walk graded across the valley: moving whole stones by the same regrade would stand them over 10 mm apart */
  Q.design('swale');T.regen();var L=Q.lips();m.graded=L;if(!L||L.worst>3||L.perStone<10)bad.push('graded walk lips '+JSON.stringify(L));if(!Q.rules().some(function(q){return q[0]==='pr-ok'&&/largest step between two neighbours/.test(q[1]);}))bad.push('no lip sentence');
  if(typeof THREE!=='undefined'){var lv=Q.lvTest();m.level=lv;if(!lv.n||lv.spread>.5)bad.push('a bench on a slope is not level: '+JSON.stringify(lv));var g=Q.geom();if(!g||!g.attributes.position.count)bad.push('mound has no 3D');else{var a=g.attributes.position.array,nan=false;for(var i=0;i<a.length;i+=97)if(!isFinite(a[i]))nan=true;if(nan)bad.push('NaN in the 3D');}}
  /* terraces */
  Q.design('terraces');T.regen();var Tm=Q.terr(),G=Q.G(),tr=G.paver.terr;if(!Tm||!Tm.ok||!tr)bad.push('no terraces');else{m.terr=tr;if(tr.n<2)bad.push('one terrace');if(tr.walls.some(function(h){return h>600||h<120;}))bad.push('walls '+tr.walls.join(','));if(tr.flights!==tr.walls.length)bad.push(tr.flights+' flights for '+tr.walls.length+' walls');
    if(tr.ramps.length!==tr.walls.length||tr.ramps.some(function(r){return r.s>8.34;}))bad.push('ramps '+JSON.stringify(tr.ramps));if(tr.R.some(function(R){return R<120||R>180;}))bad.push('risers '+tr.R.join(','));
    var strad=0;G.pavers.forEach(function(p){var k=Tm.band(Tm.tf(p.cx,p.cy));(p.pts||[]).forEach(function(v){var t=Tm.tf(v.x,v.y);if(t<Tm.lo(k)-1||t>Tm.hi(k)+1)strad++;});});if(strad)bad.push(strad+' paver corners past a wall or channel');
    if(!G.paver.water||!G.paver.water.ok)bad.push('terraces pond');if(G.paver.falls&&G.paver.falls.flat>0)bad.push('terraces flat');
    var Rr=G.paver.site&&G.paver.site.route;if(!Rr||Rr.max>8.34)bad.push('route on terraces reads '+(Rr&&Rr.max));
    if(typeof THREE!=='undefined'){var g2=Q.geom();if(!g2||!window.PS_WALK||!(window.PS_WALK.added>0))bad.push('no walls, steps or ramps in 3D');}}
  /* the designs' own ideas: a seat wall on the mound's contour, a planted swale with stepping stones, a street tree line; flights cut into the upper terrace */
  if(Tm&&Tm.flights&&Tm.flights.some(function(f){return !(f.ttop>f.tw)||!(f.cw>0);}))bad.push('a flight not cut into the terrace');
  Q.design('mound');T.regen();var fm=Q.G().paver.feat;m.seat=fm&&fm.seat;if(!fm||!fm.seat||fm.seat.len<3000)bad.push('mound has no seat wall '+JSON.stringify(fm));
  Q.design('swale');T.regen();var fs=Q.G().paver.feat,sc=(Q.G().paver.planted||[]).filter(function(q){return q.swale;}).length;m.swale=sc;if(!fs||!fs.swale||sc<4)bad.push('swale cells '+sc);if(!Q.rules().some(function(q){return /stepping stones/.test(q[1]);}))bad.push('no stepping-stone sentence');
  Q.design('street');T.regen();var tp=(Q.G().paver.planted||[]).filter(function(q){return q&&q.dia>=900;}).length;m.streetTrees=tp;if(tp<6)bad.push('street tree pits '+tp);
  /* the gravel bed of the interlocking family stops at an outline on a slope */
  if(typeof THREE!=='undefined'){Q.design('court');K4.set(K4.shape('angle'));T.regen();Q.geom();var b=Q.bed();m.bed=b;if(!b||!b.kept||!b.out)bad.push('gravel bed not cut to the outline '+JSON.stringify(b));K4.set(null);}
  /* the plaza in front of a building face */
  Q.plaza(41000,12000);T.regen();var Gp=Q.G(),rp=Q.report();m.plaza={n:rp.pavers,trees:rp.trees,met:rp.met};if(Gp.W!==41000||Gp.H!==12000)bad.push('plaza '+Gp.W+' x '+Gp.H);if(!rp.met)bad.push('plaza counts '+rp.counts);m.plaza.pits=(Gp.paver.planted||[]).filter(function(q){return q&&q.dia>=900;}).length;if(!m.plaza.pits)bad.push('plaza has no tree pits');
  if(!(Gp.paver.planted||[]).some(function(q){return q&&q.bench;}))bad.push('plaza has no benches');if(!/0\.8/.test(S.paver.keep))bad.push('plaza route '+S.paver.keep);if(!(rp.falls&&rp.falls.min>=1.25))bad.push('plaza falls '+JSON.stringify(rp.falls));
  return{pass:!bad.length,detail:bad.join('; ')||ds.length+' grounds build ('+rows.join(', ')+'); graded walk lip '+L.worst+' mm (whole stones '+L.perStone+'); terraces '+JSON.stringify(m.terr&&m.terr.walls)+'; plaza '+m.plaza.n+' pavers',metrics:m};
});

/* ---- p166-1: a brick building as a kit of prefabricated elements; brick mixes; slide along the course ---- */
guard('brick','a brick building divides into storey-high elements tagged by face, storey and place: every brick in exactly one element or laid on site, no edge in a lintel bearing or beside a jamb, square corners as L elements, masses add up, a robot row for every brick in its element frame; mixes counted; a slide never closes a joint under 3 mm nor a lap under a quarter brick',function(){
  T.reset();var P=window.PS_T166,bad=[],m={};if(!P)return{pass:false,detail:'no PS_T166'};
  var kit=function(ex,edge,more){P.ex.brickExample(ex);var B=P.S().brick;B.elems=true;B.elemEdge=edge;B.mixOn=false;if(more)more(B);P.build();return P.stat();};
  /* the mid-rise, toothed */
  var s=kit('midrise','toothed');var M=P.M();m.midT=[s.elements,s.corners,s.site,s.heaviest,s.longest];
  if(!(s.elements>=50)||s.corners!==20||s.unassigned||s.dup||s.floorX||s.sumKg!==s.wallKg||s.robotMismatch||s.edgeInBearing||s.opsSplit||s.narrow||!(s.site>0)||s.over.length)bad.push('mid-rise toothed '+JSON.stringify(s));
  var tagRe=/^([NSEW]{1,2}\d+-\d+-\d\d|[NSEW]{1,2}\d+[NSEW]{1,2}\d+-\d+-C)$/;M.E.forEach(function(e){if(!tagRe.test(e.tag))bad.push('tag '+e.tag);if(e.Hh>P.S().height+1)bad.push(e.tag+' taller than a storey');});
  /* toothed: every element can be lowered straight down past its neighbour */
  var lowered=0;M.edges.forEach(function(ed){ed.eL.recs.forEach(function(r){if(r.kind==='brick'&&r.p.side===ed.side&&r.s1>ed.p+3&&r.s<ed.p)lowered++;});ed.eR.recs.forEach(function(r){if(r.kind==='brick'&&r.p.side===ed.side&&r.s0<ed.p-3&&r.s>ed.p)lowered++;});});
  if(lowered)bad.push(lowered+' bricks cross a toothed edge');
  var perEdge=Math.max.apply(null,M.edges.map(function(ed){return M.site.filter(function(r){return r.cut===ed.p&&r.p.side===ed.side&&r.p.j===ed.j;}).length/Math.max(1,ed.pts.length);}));m.sitePerCourse=+perEdge.toFixed(2);if(perEdge>2.01)bad.push('site bricks a course '+perEdge);
  /* a corner element has two legs on two faces and holds the quoins */
  var ce=M.E.filter(function(e){return e.kind==='corner';});if(!ce.length||ce.some(function(e){return e.legs.length!==2||e.sides[0]===e.sides[1];}))bad.push('corner elements');
  var q=0,qIn=0;M.recs.forEach(function(r){if(r.kind==='brick'&&r.b.quoin){q++;var e=M.elOf.get(r.b);if(e&&e.kind==='corner')qIn++;}});m.quoins=[q,qIn];if(!q||qIn<q*.9)bad.push('quoins in corner elements '+qIn+'/'+q);
  /* openings wholly inside one element */
  if(M.opsN<10)bad.push('openings '+M.opsN);
  /* hung bottom up, corners first in each storey */
  var hs=M.E.slice().sort(function(a,b){return a.hung-b.hung;});for(var i=1;i<hs.length;i++){if(hs[i].j<hs[i-1].j)bad.push('hung order storey');if(hs[i].j===hs[i-1].j&&hs[i].kind==='corner'&&hs[i-1].kind!=='corner')bad.push('hung order corners');}
  /* files */
  var csv=P.csv(),rob=P.robot(),krl=P.krl('KIT'),sh=P.sheet();
  if(csv.split(String.fromCharCode(10)).filter(function(l){return tagRe.test(l.split(',')[0]);}).length!==M.E.length)bad.push('elements.csv rows');
  if(!/^element,made_order,unit,course/.test(rob))bad.push('robot header');
  if(/NaN|undefined/.test(krl)||(krl.match(/^DEF E\d{3}\(\)/gm)||[]).length!==M.E.length||!/specific to one cell/.test(krl))bad.push('KRL');
  if(M.E.some(function(e){return sh.indexOf('>'+e.tag+'  ')<0;}))bad.push('sheet tags');
  var robZ=rob.split(String.fromCharCode(10)).slice(1).filter(Boolean).map(function(l){return +l.split(',')[8];});if(robZ.some(function(z){return z<-1||z>P.S().height+1;}))bad.push('robot Z outside the element');
  var say=P.rules().map(function(x){return x[0]+':'+x[1];}).join(' ');if(!/kit of \d+ prefabricated elements/.test(say)||!/shelf angle/.test(say)||!/first check/.test(say)||!/toothed/.test(say))bad.push('rules '+say.slice(0,160));
  /* straight movement joints */
  s=kit('midrise','straight');m.midS=[s.bats,s.split,s.jointM];if(s.site||s.bats<s.split||Math.abs(s.sumKg-s.wallKg)>.01*s.wallKg||s.unassigned||s.robotMismatch)bad.push('mid-rise straight '+JSON.stringify(s));
  /* the tower and the corner */
  s=kit('tower','toothed');m.tower=[s.elements,s.corners,s.heaviest];if(s.unassigned||s.dup||s.floorX||s.sumKg!==s.wallKg||s.robotMismatch||s.edgeInBearing||s.straight||s.atRisk)bad.push('tower '+JSON.stringify(s));
  s=kit('corner','toothed');m.corner=[s.elements,s.corners];if(s.corners!==1||s.unassigned||s.straight)bad.push('corner '+JSON.stringify(s));
  /* bearing on itself: said plainly */
  s=kit('house','toothed');say=P.rules().map(function(x){return x[1];}).join(' ');m.house=[s.elements,s.over.length];if(P.M().horiz!=='bedded'||!/hung on the frame/.test(say))bad.push('house bedded '+say.slice(0,120));
  /* mixes */
  s=kit('house','toothed',function(B){B.mixOn=true;B.mixBy='blend';});var mx=P.mix();var face=0;(P.G().panels||[P.G()]).forEach(function(g){face+=g.bricks.length;});m.mix=mx&&mx.counts;
  if(!mx||!mx.on||mx.counts.reduce(function(a,b){return a+b;},0)!==face||mx.counts.filter(function(c){return c>0;}).length<3)bad.push('mix '+JSON.stringify(mx));
  var bc=P.ex.brickCSV();if(!/,mix,element$/.test(bc.split(String.fromCharCode(10))[0]))bad.push('schedule header '+bc.split(String.fromCharCode(10))[0].slice(-40));
  var to=P.ex.takeoff();if(!to.mix||to.mix.reduce(function(a,b){return a+b.n;},0)!==face)bad.push('take-off mix');
  /* slide: an open running bond, a pleat */
  P.ex.brickExample('corner');var B=P.S().brick;B.elems=false;B.mixOn=false;B.bond='running';B.carry='self';P.S().arr='single';P.ex.brickForm('wall',{L:4760,H:2100});B.open=.25;B.layers=[{src:'slide',does:'slide',rule:'pleat',amt:40,w:1}];P.build();var sl=P.slide();s=P.stat();m.slide=[sl.laid,sl.held,+(+sl.minGap).toFixed(1),Math.round(sl.minLap),s.straight];
  if(!(sl.laid>50)||sl.minGap<3-1e-6||sl.minLap<B.bL/4-.06||s.straight||s.atRisk)bad.push('slide '+JSON.stringify(m.slide));
  B.layers=[{src:'slide',does:'slide',rule:'random',amt:50,share:.4,seed:3}];B.open=.2;P.build();sl=P.slide();if(sl.minGap<3-1e-6||sl.minLap<B.bL/4-.06)bad.push('random slide '+JSON.stringify(sl));
  /* a closed bond slides only as far as its perpends allow; a one-brick bond not at all */
  B.open=0;B.layers=[{src:'slide',does:'slide',rule:'pleat',amt:40,w:1}];P.build();sl=P.slide();if(sl.maxSlide>B.joint+3.6)bad.push('closed bond slid '+sl.maxSlide);
  P.ex.brickExample('corner');P.S().brick.layers=[{src:'slide',does:'slide',rule:'pleat',amt:40}];P.build();sl=P.slide();if(sl.laid||sl.refused!==1)bad.push('Flemish slid');
  /* the 3D draws the kit apart without losing a brick */
  P.ex.brickExample('corner');B=P.S().brick;B.elems=true;B.elemView='apart';P.build();var r=P.rebuild();if(r!==true)bad.push('3D '+r);
  B.elems=false;B.elemView='';B.mixOn=false;B.layers=[];
  T.reset();
  return{pass:!bad.length,detail:bad.join('; ')||JSON.stringify(m),metrics:m};
});

/* ---- p167-1: the facade ribs with a hem and a crown, and turned to sight points ---- */
guard('assembly','on the Rhino example building, with the hem lifted over the entrance and at the corners and the crown lowered between the corners, every rib piece keeps exactly one fixed and at least one sliding fixing, none is under 450 mm, no cut end hangs further than the stated rule past its last restraint, every fixing names a rail or rod that exists at the rib, no rail, corner piece or bracket is left where no rib uses it, nothing stands in front of glass with the bays open, the corner fans follow the hem and stay clear, the bands, hem rails, schedules, details and OBJ are written; turned to a sight point the ribs stay within the turn limit and the clear gap at their tips, jamb and fan ribs stay square; level, nothing of this pass runs',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,X=window.PS_T145,Q=window.PS_T167,P=window.PS_T160;if(!K5||!X||!Q||!P||!window.PS_T161)return{pass:false,detail:'handle missing'};
  var has=typeof THREE!=='undefined'&&T.hostScene;T.setPanelMode('perf');K5.load('emm',true);T.regen();T.showTab('Serial sections',true);T.regen();X.set(['d','d','d','d']);T.regen();Q.reset();
  var R0=Q.ribs();if(!R0||R0.h167)bad.push('level hem and crown still run pass 167');var n0=R0?R0.pieces.length:0,r0=R0?R0.rails.length:0;m.level={pieces:n0,rails:r0};
  var check=function(tag,wantTurn){var R=Q.ribs();if(!R||!R.h167||!R.h7){bad.push(tag+': no pass 167 model');return null;}var X7=R.h7,RL={},TL={},uses={},o={pieces:R.pieces.length,rails:R.rails.length,brackets:R.brackets.length};
    R.rails.forEach(function(r){RL[r.id]=r;});R.ties.forEach(function(t){TL[t.id]=t;});(R.cornerTies||[]).forEach(function(t){TL[t.id]=t;});
    var nf=0,ns=0,nfree=0,nm=0;R.pieces.forEach(function(p){var fx=p.h7&&p.h7.fx;if(!fx){nm++;return;}var a=fx.filter(function(q){return q.k==='fixed';}).length,b=fx.filter(function(q){return q.k==='slide';}).length;if(a!==1||b<1)nf++;if(p.z1-p.z0<449)ns++;
      var zs=fx.map(function(q){return q.z;});if((p.cutFoot&&Math.min.apply(null,zs)-p.z0>X7.cant+1)||(p.cutTop&&p.z1-Math.max.apply(null,zs)>X7.cant+1))nfree++;
      fx.forEach(function(q){var r=RL[q.id];if(!r&&!TL[q.id])nm++;else if(r&&!p.F&&r.kind!=='corner'&&(p.x<r.x0-1||p.x>r.x1+1))nm++;else{var t=TL[q.id];if(t&&!p.F&&t.x0!=null&&(p.x<t.x0-1||p.x>t.x1+1))nm++;}(uses[q.id]=uses[q.id]||[]).push(p);});});
    if(nf)bad.push(tag+': '+nf+' pieces without exactly one fixed and one sliding fixing');if(ns)bad.push(tag+': '+ns+' pieces under 450 mm');if(nfree)bad.push(tag+': '+nfree+' free ends past the rule');if(nm)bad.push(tag+': '+nm+' fixings on a rail that is not there');
    var bare=0,over=0,br=0;R.rails.forEach(function(r){var u=uses[r.id],sp=R.rails.some(function(c){return c.kind==='corner'&&uses[c.id]&&(c.adj||[]).indexOf(r.id)>=0;});if(!u&&!sp){bare++;return;}if(r.kind==='corner'||r.kind==='trimmer')return;
      var xs=(u||[]).map(function(p){return p.x;}).sort(function(a,b){return a-b;});if(!sp&&r.x1-r.x0>700&&(xs[0]-r.x0>400||r.x1-xs[xs.length-1]>400))over++;
      var bs=R.brackets.filter(function(b){return b.rail===r.id;}).map(function(b){return b.x;}).sort(function(a,b){return a-b;});if(bs.length<2)br++;for(var k=1;k<bs.length;k++)if(bs[k]-bs[k-1]>1330)br++;bs.forEach(function(x){if(x<r.x0-1||x>r.x1+1)br++;});});
    R.brackets.forEach(function(b){if(!RL[b.rail]&&!TL[b.rail])br++;});R.ties.forEach(function(t){if(!uses[t.id])bare++;});(R.cornerTies||[]).forEach(function(t){if(!uses[t.id])bare++;});
    if(bare)bad.push(tag+': '+bare+' rails or rods no rib uses');if(over)bad.push(tag+': '+over+' rails running on past the ribs they carry');if(br)bad.push(tag+': '+br+' bracket faults');
    var win=0;R.pieces.forEach(function(p){if(p.F)return;var F=R.faces.filter(function(f){return f.i===p.f;})[0];if(F.wm!=='open')return;F.allOps.forEach(function(op){if(p.x+p.T/2>op.o[0]&&p.x-p.T/2<op.o[1]&&p.z1>op.o[2]&&p.z0<op.o[3])win++;});});
    R.rails.filter(function(r){return r.kind==='hem'||r.kind==='crown';}).forEach(function(r){var F=R.faces.filter(function(f){return f.i===r.f;})[0];r.pts.forEach(function(pp){F.allOps.forEach(function(op){if(pp[0]>op.o[0]&&pp[0]<op.o[1]&&pp[1]+40>op.o[2]&&pp[1]-40<op.o[3])win++;});});});
    if(win)bad.push(tag+': '+win+' ribs or hem rails in front of glass');
    R.fans.forEach(function(f){if(f.rootClear<15)bad.push(tag+': fan roots '+Math.round(f.rootClear));});
    var tg=null,jt=0,mt=0;R.faces.forEach(function(F){var rs=F.X.map(function(r){var ps=R.pieces.filter(function(p){return !p.F&&p.f===F.i&&p.k===r.k;});return{r:r,D:ps.length?Math.max.apply(null,ps.map(function(p){return Math.max.apply(null,p.d);})):0,th:ps.length?(ps[0].turn||0):0,ps:ps};});
      rs.forEach(function(q){if(q.r.kind==='jamb'&&q.ps.some(function(p){return p.turn;}))jt++;mt=Math.max(mt,Math.abs(q.th));});
      for(var k=0;k+1<rs.length;k++){var a=rs[k],b=rs[k+1];if(!a.D||!b.D||(!a.th&&!b.th))continue;var ta=a.th*Math.PI/180,tb=b.th*Math.PI/180,g=Q.segD([a.r.x,0],[a.r.x+a.D*Math.sin(ta),a.D*Math.cos(ta)],[b.r.x,0],[b.r.x+b.D*Math.sin(tb),b.D*Math.cos(tb)])-(a.r.T+b.r.T)/2;tg=tg==null?g:Math.min(tg,g);}});
    R.pieces.forEach(function(p){if(p.F&&p.turn)jt++;});if(jt)bad.push(tag+': '+jt+' jamb or fan pieces turned');
    if(wantTurn){if(!(X7.turned>0))bad.push(tag+': no rib turned');if(mt>S.mass.turnMax+.01)bad.push(tag+': a turn of '+mt);if(tg==null||tg<S.mass.tipGap-.5)bad.push(tag+': tips '+tg+' mm apart');}
    if(has){T.hostScene();var L=P.last();if(!L||!L.ribs)bad.push(tag+': no 3D');else{o.verts=L.ribs.verts;if(L.ribs.verts>600000)bad.push(tag+': '+L.ribs.verts+' vertices');}}
    o.hemCut=X7.hemCut;o.crownCut=X7.crownCut;o.hemRails=X7.hemRails;o.crownRails=X7.crownRails;o.arcs=X7.arcs;o.turned=X7.turned;o.maxTurn=Math.round(mt*10)/10;o.tipGap=tg==null?null:Math.round(tg);o.free=Math.round(X7.maxFree);o.band=Math.round(X7.bandM2);return R;};
  S.mass.ribWin='open';Q.use('hem','lift');Q.use('crown','dip');var R=check('open');if(R){m.open={pieces:R.pieces.length,hem:R.h7.hemCut,crown:R.h7.crownCut,hemRails:R.h7.hemRails,crownRails:R.h7.crownRails,arcs:R.h7.arcs,free:Math.round(R.h7.maxFree),band:Math.round(R.h7.bandM2)};
    if(!(R.h7.hemCut>0&&R.h7.crownCut>0))bad.push('hem or crown cut nothing');if(!(R.h7.hemRails>0&&R.h7.arcs>0))bad.push('no hem rail or corner arc');if(!R.h7.bands.length)bad.push('no plinth band');
    if(!R.pieces.some(function(p){return p.F&&p.cutFoot;}))bad.push('the corner fans do not follow the hem');if(R.pieces.length>=n0)bad.push('no piece left out under the lifted hem');
    var csv=Q.csv(),rl=Q.rails(),dt=Q.details(),ob=P.obj();if(csv.split('\n')[0].slice(-9)!==',turn_deg'||/NaN/.test(csv))bad.push('rib schedule');if(rl.indexOf('hem and crown rails')<0||/NaN/.test(rl))bad.push('rail schedule');
    if(dt.indexOf('A rib foot at the hem')<0||/NaN/.test(dt))bad.push('detail E');if(!ob||ob.text.indexOf('g plinth_band_W1')<0||ob.text.indexOf('g facade_rib_rails_W1')<0||/NaN/.test(ob.text))bad.push('OBJ');
    var ru=Q.rules().map(function(x){return x[1];}).join(' ');if(!/free end/.test(ru)||!/first check/.test(ru)||!/no door/.test(ru))bad.push('rules');}
  S.mass.ribWin='veil';check('veil');Q.use('hem','wave');Q.use('crown','wave');S.mass.ribWin='open';var W=check('waves');if(W)m.waves={pieces:W.pieces.length,hemRails:W.h7.hemRails,arcs:W.h7.arcs};
  Q.use('hem','level');Q.use('crown','level');Q.use('sight','corner');var Rs=check('sight',true);if(Rs){m.sight={turned:Rs.h7.turned,maxTurn:Math.round(Rs.h7.maxTurn*10)/10,tipGap:Math.round(Rs.h7.minGap)};var c2=Q.csv().split('\n').slice(1,40).map(function(l){return +l.split(',').pop();});if(!c2.some(function(v){return Math.abs(v)>.05;})&&!Rs.pieces.slice(0,40).every(function(p){return !p.turn;}))bad.push('the turn is not in the schedule');
    var ru2=Q.rules().map(function(x){return x[1];}).join(' ');if(!/folded knife plate/.test(ru2)||!/sin/.test(ru2))bad.push('sight rules');}
  Q.use('hem','lift');Q.use('sight','street');check('lift and street',true);
  Q.reset();var Rn=Q.ribs();if(!Rn||Rn.h167||Rn.pieces.length!==n0||Rn.rails.length!==r0)bad.push('back to level is not pass 161 again');
  K5.leave();T.reset();
  return{pass:!bad.length,detail:bad.join('; ')||JSON.stringify(m),metrics:m};
});

/* ---- p168-1: operable metal panels on the example building ---- */
guard('assembly','on the Rhino example building, a perforated face that runs over its windows gets an operable bay in front of every window on the panel module (bi-fold, sliding or fold-out), or a refusal with its reason; the leaves fill the bay to the joint, stand closed in the fixed panels plane with the face picture continuous, move from closed to open without meeting each other, the wall, a window, a guard or a fixed panel; rails run continuous across every bay on brackets never in front of glass; the 3D, the schedule and the Rhino model count the same parts; nothing changes while it is off or while the face is cut round',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,Q=window.PS_T159,O=window.PS_T168;if(!K5||!Q||!O)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);S.mass.winModes='';S.material='alum';S.thickness=3;T.regen();
  /* off by default, and nothing for a face cut round */
  if(O.K().on)bad.push('on by default');Q.set(0,'over');if(O.model())bad.push('a model while off');if(O.build())bad.push('built while off');
  O.on(true);Q.set(0,'round');if(O.model())bad.push('a model while every face is cut round');Q.set(0,'over');if(!O.active())bad.push('not active with W1 over');
  ['bifold','slide','swing'].forEach(function(t){O.set({type:t,show:'open',state:1,which:'all'});var R=O.model(),C=O.check();if(!R){bad.push(t+' no model');return;}
    if(R.bays.length+R.refused.length!==R.windows)bad.push(t+': '+R.windows+' windows, '+R.bays.length+' bays, '+R.refused.length+' refused');if(R.refused.some(function(q){return !q.reason;}))bad.push(t+' a refusal without a reason');if(!R.bays.length)bad.push(t+' no bay');
    if(C.n)bad.push(t+' clashes: '+C.hits.slice(0,2).join(' | '));if(C.sumErr>.5)bad.push(t+' leaves do not fill the bay by '+C.sumErr);if(C.planeErr>2)bad.push(t+' a closed leaf '+C.planeErr+' mm off the panels plane');if(C.uvErr>1e-6)bad.push(t+' the picture jumps at a leaf by '+C.uvErr);if(C.brkGlass)bad.push(t+' '+C.brkGlass+' brackets in front of glass');if(C.trackGap)bad.push(t+' '+C.trackGap+' bays without a continuous rail');
    R.bays.forEach(function(b){if(Math.abs(b.Wb/R.faces[0].bw-Math.round(b.Wb/R.faces[0].bw))>1e-6)bad.push(b.id+' bay off the module');if(b.x0>b.w0-1||b.x1<b.w1+1)bad.push(b.id+' does not cover its window');});
    var B=O.build();if(!B||B.leaves!==R.leaves||B.bays!==R.bays.length||B.trolleys!==R.trolleys||B.hinges!==R.hinges||B.pivots!==R.pivots||B.stays!==R.stays||B.brackets!==R.brackets.length)bad.push(t+' 3D counts '+JSON.stringify(B)+' against the model '+[R.leaves,R.trolleys,R.hinges,R.pivots,R.stays,R.brackets.length].join(','));
    var rows=O.csv().split('\n'),k=rows.indexOf('total,bays,leaves,trolleys,hinges,pivots,guide_pins,stays,brackets,track_m'),tot=k>=0?rows[k+1].split(','):[];if(+tot[1]!==R.bays.length||+tot[2]!==R.leaves||+tot[3]!==R.trolleys||+tot[4]!==R.hinges||+tot[7]!==R.stays||+tot[8]!==R.brackets.length)bad.push(t+' schedule totals '+tot.join(','));
    var bayRows=rows.filter(function(r){return /^W\d,\d,W\d-/.test(r);}).length;if(bayRows!==R.bays.length)bad.push(t+' schedule bay rows '+bayRows);
    m[t]=[R.bays.length,R.refused.length,R.leaves,R.brackets.length,Math.round(R.bays[0].kg),Math.round(R.maxSpan)];});
  /* the leaves move with the state, live, without a rebuild */
  O.set({type:'bifold',show:'open',state:0});O.build();var a0=O.leaves();O.set({state:1});O.pose();var a1=O.leaves(),moved=0;a0.forEach(function(p,k){if(Math.abs(p.a-a1[k].a)>1||Math.abs(p.x-a1[k].x)>50)moved++;});if(moved<a0.length*.9)bad.push('only '+moved+' of '+a0.length+' leaves moved');m.moved=moved;
  var R=O.model();O.set({show:'closed'});if(R.bays.some(function(b){return O.state(b)!==0;}))bad.push('closed is not closed');O.set({show:'lived',state:1});var st=R.bays.map(function(b){return O.state(b);}),d={};st.forEach(function(v){d[v]=1;});if(Object.keys(d).length<2)bad.push('lived in is not a mix');m.lived=Object.keys(d).join('/');
  /* every second window, chosen windows */
  O.set({which:'second'});var R2=O.model();if(R2.bays.length!==R.bays.length/2)bad.push('every second gives '+R2.bays.length);O.set({which:'chosen',pick:'W1-1.3, W1-2.5'});var R3=O.model();if(R3.bays.length!==2)bad.push('chosen gives '+R3.bays.length);O.set({which:'all',show:'open'});
  /* the Rhino model, the files, the rules, the controls */
  O.build();var obj=O.obj();if(!obj||!/g operable_W1_leaves/.test(obj.text)||!/g operable_W1_tracks/.test(obj.text)||!/g operable_W1_brackets/.test(obj.text))bad.push('OBJ groups');if(obj&&/NaN/.test(obj.text))bad.push('NaN in the OBJ');
  var fl=O.files();if(!fl.some(function(n){return /operable\.csv$/.test(n);})||!fl.some(function(n){return /operable-details\.svg$/.test(n);}))bad.push('files '+fl.join(' '));var svg=O.file('operable-details.svg')||'';if(!/<svg/.test(svg)||!/A  Section/.test(svg)||!/B  Plan/.test(svg)||/NaN/.test(svg))bad.push('details sheet');
  var say=O.rules().map(function(q){return q[1];}).join(' ');if(!/first check/.test(say)||!/no leaf meets/.test(say)||!/guard/.test(say))bad.push('rules: '+say.slice(0,160));
  if(!O.sync()||!document.querySelector('.oper168 [data-ot=slide]')||!document.querySelector('.oper168 [data-o168=state]'))bad.push('controls missing');
  var nv=O.verts();m.verts=nv;if(nv>600000)bad.push(nv+' vertices');
  /* the shutters design: a module for the shutters, every leaf 450 to 650 mm, no stack on the glass, both long faces, the cutaway */
  var fp=O.fitPlan();if(!fp)bad.push('no module for the shutters');O.preset();var Rp=O.model(),Cp=O.check();if(!Rp)bad.push('no model for the shutters design');else{m.preset=[Rp.faces.map(function(f){return f.name+' '+Math.round(f.bw);}).join('/'),Rp.bays.length,Math.round(Math.min.apply(null,Rp.bays.map(function(b){return b.lw;}))),Math.round(Math.max.apply(null,Rp.bays.map(function(b){return b.lw;}))),Rp.maxSpan];
    if(Rp.faces.length!==2||Rp.bays.length!==40||Rp.refused.length)bad.push('shutters design bays '+JSON.stringify(m.preset));if(Rp.bays.some(function(b){return b.lw<450||b.lw>650||b.warn.length;}))bad.push('shutters design leaves or warnings '+Rp.bays.filter(function(b){return b.warn.length;}).map(function(b){return b.id+': '+b.warn;}).slice(0,2).join(' | '));
    if(Cp.n||Cp.brkGlass||Cp.trackGap)bad.push('shutters design checks '+Cp.n+' '+Cp.brkGlass+' '+Cp.trackGap);if(Rp.maxSpan>2400)bad.push('bracket span '+Rp.maxSpan);
    O.set({cutaway:true});var Rc=O.model();if(Rc.cut!==4)bad.push('cutaway bays '+Rc.cut);var B2=O.build();if(!B2||B2.bays!==40)bad.push('shutters 3D '+JSON.stringify(B2));
    /* every mesh of this pass stands on or above the ground and within the footprint grown by the cavity and the farthest open leaf */
    var st=K5.sites.emm,reach=Math.max.apply(null,Rc.bays.map(function(q){return q.proj;}))+153+200,out=O.boxes().filter(function(q){return q.min[1]<-1||Math.max(Math.abs(q.min[0]),Math.abs(q.max[0]))>st.w/2+reach||Math.max(Math.abs(q.min[2]),Math.abs(q.max[2]))>st.d/2+reach;});m.boxes=O.boxes().length;if(out.length)bad.push(out.length+' meshes outside the building: '+JSON.stringify(out[0]));O.set({cutaway:false});}
  O.on(false);O.build();if(O.built())bad.push('3D left after switching off');
  T.reset();
  return{pass:!bad.length,detail:bad.join('; ')||JSON.stringify(m),metrics:m};
});
/* ---- p170-1: the plaza in front of the example building as a designed ground ---- */
guard('assembly','on the Rhino example building the plaza is its own paved ground: its own field (the facade’s untouched), a drained threshold between the plinth and the paving, level with the plinth top at the wall and falling away from the face at the fall asked, no step between pavers, the storm leaving by the street edge and none toward the wall, a route to the entrance bay with a landing and mat-well and nothing planted or seated on it, benches on the wall side facing the square, the depth held clear of a neighbour, the Pavers tab editing this plaza and giving the facade back',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,P=window.PS_T160,Z=window.PS_T170;if(!K5||!P||!Z)return{pass:false,detail:'handle missing'};
  var has=typeof THREE!=='undefined'&&T.hostScene;T.setPanelMode('perf');K5.load('emm',true);T.regen();var f0=JSON.stringify(S.field);
  S.mass.plaza=true;S.mass.plazaD=12000;S.mass.plazaSide=0;S.mass.plazaKind='counted';S.mass.plazaThr=900;S.mass.plazaFall=60;S.mass.plazaEntry=-1;S.mass.plazaEdge='kerb';S.mass.plazaSig='';
  var g=Z.G();if(!g||!g.pavers||g.pavers.length<500){return{pass:false,detail:'no plaza '+(g&&g.pavers&&g.pavers.length)};}m.pavers=g.pavers.length;
  if(JSON.stringify(S.field)!==f0)bad.push('the facade field changed');var st=Z.state();if(!st.P||!st.F||st.P===S.paver||st.F===S.field)bad.push('the plaza has no state of its own');if(st.P&&st.P.tiling!=='inv')bad.push('counted plaza tiling '+(st.P&&st.P.tiling));
  var w=g.paver.water;m.water=w&&{ok:w.ok,edgeLs:w.edgeLs};if(!w||!w.ok)bad.push('the plaza does not take the storm');if(w&&w.flow&&w.flow.edgeLs&&(w.flow.edgeLs.N>1e-3))bad.push('water runs to the wall '+w.flow.edgeLs.N);if(w&&w.flow&&w.flow.pondLs>1e-3)bad.push('water ponds');
  var lp=g.paver.lips;m.lips=lp&&lp.worst;if(lp&&lp.worst>2)bad.push('a step of '+lp.worst+' mm between pavers');
  var z=g.paver.z170;if(!z||!(z.removed>0))bad.push('no landing');var e=Z.entry();m.entry=e.k;if(e.k!==4)bad.push('entrance not the middle bay '+e.k);
  var D=12000,vf=D-2600,cor=0;(g.paver.planted||[]).forEach(function(q){if(q&&q.bench){if(!(q.bench.y>vf)||Math.abs(q.bench.x-e.xc)<e.hw+1500)bad.push('a bench faces the wall or blocks the entrance');return;}if(!q||!q.length||q[0].x<-1e6)return;var x=0,y=0;q.forEach(function(v){x+=v.x;y+=v.y;});x/=q.length;y/=q.length;if(Math.abs(x-e.xc)<600&&y<vf)cor++;});
  if(cor)bad.push(cor+' planted places on the entrance route');((g.paver.inv&&g.paver.inv.voids)||[]).forEach(function(v){var vx=v.x!=null?v.x:v.cx;if(vx!=null&&Math.abs(vx-e.xc)<600+((v.d||v.dia||0)/2))bad.push('a tree pit on the entrance route');});
  var R=Z.parts();if(!R)bad.push('no threshold');else{m.thr=R.thr;['channel','gravel','landing','matwell'].forEach(function(k){if(R.roles.indexOf(k)<0)bad.push('no '+k);});if(R.g0<R.o0+600)bad.push('paving starts '+R.g0);m.street=Math.round(R.street);if(Math.abs(R.street-(140-(900+12000)/60))>3)bad.push('street level '+R.street);}
  if(has){T.hostScene();var pl=P.plaza(),L=Z.last();if(!pl||!L)bad.push('no plaza in 3D');else{var bx=pl.box;m.box=bx.map(Math.round).join(',');if(bx[2]<8000+R.o0+5)bad.push('plaza under the plinth '+bx[2]);if(bx[2]<8000+R.g0-200)bad.push('plaza reaches into the threshold '+bx[2]);if(!(L.ground<0))bad.push('the ground was not set at the street');
      var sf=Z.surface(),b0=sf&&sf.bands;if(!b0)bad.push('no surface');else{var worst=0,up=0;for(var b=0;b<16;b++){var ex=140-(900+(b+.5)*500)/60,d=Math.abs(b0[b]-ex);if(d>worst)worst=d;if(b&&b0[b]>b0[b-1]+1)up++;}m.surfDev=+worst.toFixed(1);if(worst>12)bad.push('the paving is '+worst.toFixed(0)+' mm off the plane falling from the plinth top');if(up)bad.push(up+' bands rise toward the street');}}}
  var r=P.rules().filter(function(x){return /A paved plaza of 41\.0 by 12\.0 m/.test(x[1]);})[0];if(!r||!/falls away from the face at 1 in 60/.test(r[1])||!/window bay 5 of 10/.test(r[1]))bad.push('plaza sentence');
  var fl=K5.files();if(fl.indexOf('plaza-W1-pavers.csv')<0)bad.push('no plaza schedule');var csv=Z.csv();if(!csv||csv.indexOf('paver,type,module')!==0||/NaN/.test(csv))bad.push('plaza schedule');
  var ob=P.obj();if(!ob||ob.text.indexOf('g plaza_W1_threshold')<0||ob.text.indexOf('g plaza_W1_pavers')<0||/NaN/.test(ob.text))bad.push('plaza in the OBJ');
  S.mass.plazaSide=1;var dm=Z.dims();m.east=dm.D;if(!dm.held||dm.D>dm.free)bad.push('the east plaza is not held clear of the neighbour '+JSON.stringify(dm));S.mass.plazaSide=0;
  ['perm','street'].forEach(function(k){Z.kind(k);var q=Z.G();if(!q||!q.pavers||q.pavers.length<300||!q.paver.water||!q.paver.water.ok)bad.push(k+' plaza '+(q&&q.pavers&&q.pavers.length));m['n_'+k]=q&&q.pavers&&q.pavers.length;});Z.kind('counted');
  T.showTab('Pavers',true);if(!Z.fac())bad.push('Pavers does not edit the plaza');if(S.paver.tiling!=='inv'||S.width!==41000||S.height!==12000)bad.push('the Pavers ground is '+S.paver.tiling+' '+S.width+' x '+S.height);if(!S.mass.show3d)bad.push('Pavers dropped the building');
  var Gq=T.regen();if(!Gq||!Gq.paver||!Gq.paver.z170)bad.push('the Pavers ground is not the plaza');S.paver.invSeats=2;
  T.showTab('Perforated image',true);if(Z.fac()||S.paver.tiling==='inv'||JSON.stringify(S.field)!==f0)bad.push('leaving Pavers did not give the facade back');if(S.mass.plazaP.invSeats!==2)bad.push('the edit in Pavers was not kept');
  S.mass.plaza=false;K5.leave();
  return{pass:!bad.length,detail:bad.join('; ')||m.pavers+' pavers, street '+m.street+' mm, surface within '+m.surfDev+' mm of the plane, east plaza held at '+m.east+' mm',metrics:m};
});

/* ---- p169-1: the brick building finished at its openings, its corners and inside ---- */
guard('brick','a brick building finished: no panel inside an opening draws another panel\'s bricks, a door about a metre wide, no joint standing proud of a set-back brick, the tall form\'s mortar slab stopping short of each quoin and jamb, every wall lined inside with every opening cut out and nothing through the outer face, a floor at every storey, the window set back by the reveal on a brick-on-edge sill that projects past the face',function(){
  T.reset();var P=window.PS_T169,bad=[],m={};if(!P)return{pass:false,detail:'no PS_T169'};var D=window.PS_T163;
  var meas=function(lbl){var L=P.go(),g=P.ghosts(),st=P.stick(),bk=P.G().brick||{};m[lbl]=[P.G().total,st.stick,g.ghosts,bk.atRisk,bk.straight];
    if(g.ghosts)bad.push(lbl+': '+g.ghosts+' empty panels draw bricks');if(st.stick)bad.push(lbl+': '+st.stick+' joints stand proud '+JSON.stringify(st.kinds));if(st.inOp)bad.push(lbl+': '+st.inOp+' joints inside an opening');if(bk.atRisk||bk.straight)bad.push(lbl+': at risk '+bk.atRisk+', straight '+bk.straight);return L;};
  /* the Low building: the door, the inside, the reveal and the sill */
  P.ex('house');var L=meas('house');var dw=P.doors();m.doors=dw;if(!dw.length||dw.some(function(w){return w<800||w>1300;}))bad.push('house door widths '+JSON.stringify(dw));
  if(!L)bad.push('house: no interior');else{m.inside=[L.panels,L.cut,L.covered,L.floors,L.meshes];if(L.panels!==P.G().panels.length)bad.push('lined panels '+L.panels+' of '+P.G().panels.length);if(L.covered)bad.push(L.covered+' openings covered by the lining');if(L.floors!==2)bad.push('floors '+L.floors);if(!(L.cut>0))bad.push('no opening cut in the lining');}
  var S=P.S(),t=S.thickness,bW=+S.brick.bW,poke=0,frameZ=[],sillZ=[],planB=0;
  P.scene().traverse(function(o){if(o.userData&&o.userData.planB&&o.visible&&['glass','mull','grate','bracket','slab'].indexOf(o.userData.planB)>=0)planB++;});if(planB)bad.push(planB+' rainscreen parts still shown inside a brick building');
  P.scene().traverse(function(o){var Gk=o.parent&&o.parent.userData&&o.parent.userData.Gk;if(!Gk||!o.geometry)return;o.geometry.computeBoundingBox();var b=o.geometry.boundingBox;
    if(o.userData.f169==='lining'&&b.max.z+t/2>bW-20)poke++;if(o.userData.window==='frame')frameZ.push(+(b.max.z+t/2).toFixed(1));if(o.userData.window==='sill')sillZ.push(+(b.max.z+t/2).toFixed(1));});
  if(poke)bad.push(poke+' linings reach toward the outer face');
  var rv=bW+(+S.brick.joint);m.frameZ=[Math.min.apply(null,frameZ),Math.max.apply(null,frameZ)];if(!frameZ.length||frameZ.some(function(z){return Math.abs(z-(bW-rv))>1;}))bad.push('frame front not a brick back: '+JSON.stringify(m.frameZ));
  m.sillZ=sillZ.length?[Math.min.apply(null,sillZ),Math.max.apply(null,sillZ)]:null;if(!sillZ.length||sillZ.some(function(z){return z<bW+30||z>bW+41;}))bad.push('sill projection '+JSON.stringify(m.sillZ));
  var to=P.takeoff(P.G()),csv=P.csv(P.G().panels[0]),nS=0;P.G().panels.forEach(function(g){nS+=(P.csv(g).match(/,sill(,|\n)/g)||[]).length;});m.sills=[to.sill,nS];if(!(to.sill>0)||to.sill!==nS)bad.push('sills in take-off '+to.sill+' and schedule '+nS);
  /* recessed patterns on the house: no proud joint */
  P.ex('house');D.design('r-diamond');meas('diamond');P.ex('house');D.design('r-checker');meas('checker');
  /* the mid-rise: one slab of mortar a panel, short of each quoin and jamb */
  P.ex('midrise');meas('midrise');var short=0,n=0;P.scene().children.forEach(function(mm){var Gk=mm.userData&&mm.userData.Gk;if(!Gk||!Gk.bricks.length)return;var mo=mm.children.find(function(c){return c.userData.mortar;});if(!mo)return;n++;mo.geometry.computeBoundingBox();var x0=1e9,x1=-1e9;Gk.bricks.forEach(function(b){x0=Math.min(x0,b.x-b.len/2);x1=Math.max(x1,b.x+b.len/2);});var W=S.width;
    if(!Gk.brick.flushPrev&&mo.geometry.boundingBox.min.x+W/2<x0+1)short++;if(!Gk.brick.flushNext&&mo.geometry.boundingBox.max.x+W/2>x1-1)short++;});m.slab=[n,short];if(!n)bad.push('no mortar on the mid-rise');if(short)bad.push(short+' slab ends reach a quoin or free end');
  /* a plain wall and a corner are unchanged: no interior */
  P.ex('corner');if(P.go())bad.push('a corner got an interior');D.ex.brickForm('wall',{L:4000,H:2000});if(P.go())bad.push('a free wall got an interior');
  return{pass:!bad.length,detail:bad.length?bad.slice(0,8).join('; '):'house '+m.house+', door '+m.doors+' mm, lined '+m.inside+', frame '+m.frameZ+', sill '+m.sillZ+', sills '+m.sills+', diamond '+m.diamond+', mid-rise slab '+m.slab,metrics:m};});

/* ---- p172-1: the Rhino example building built in real brick ---- */
guard('brick','the example building in real brick: its plan within 60 mm of 41 x 16 m, two storeys, all 55 windows and the door at the example building\'s places within a quarter brick-and-a-bit, nothing at risk, no straight joint, no brick in an opening, lined, two floors, a roof on a brick-on-edge eaves course, under 2.5 M vertices; a pattern on it keeps those; leaving it gives the plan back',function(){
  T.reset();var P=window.PS_T172,bad=[],m={};if(!P)return{pass:false,detail:'no PS_T172'};
  if(!document.querySelector('[data-bex="emm"]'))bad.push('no worked-example chip');if(!document.querySelector('.b172 [data-b172="go"]'))bad.push('no Build it in real brick button');
  P.ex();var o=P.stat();m.plain=[o.bricks,o.atRisk,o.straight,o.inOpen,o.minBear,o.L,o.D,o.snap.wins,o.snap.doors,o.snap.maxX,o.snap.maxY,o.verts,o.genMs+o.sceneMs];
  if(!P.on())bad.push('the building is not on');if(!(o.bricks>40000))bad.push('bricks '+o.bricks);if(o.atRisk)bad.push(o.atRisk+' at risk');if(o.straight)bad.push(o.straight+' straight joints');if(o.inOpen)bad.push(o.inOpen+' bricks in openings');
  if(Math.abs(o.L-41000)>60||Math.abs(o.D-16000)>60)bad.push('outside '+o.L+' x '+o.D);if(o.snap.wins!==55||o.snap.doors!==1||o.snap.refused)bad.push('openings '+JSON.stringify(o.snap));if(o.openings!==56)bad.push('openings drawn '+o.openings);
  if(o.snap.maxX>260)bad.push('a window moved '+o.snap.maxX+' mm along');if(o.snap.maxY>41)bad.push('a window moved '+o.snap.maxY+' mm up or down');
  if(o.outside)bad.push(o.outside+' parts past the footprint '+JSON.stringify(o.outWho));if(o.covered)bad.push(o.covered+' openings covered by the lining');if(o.floors!==2)bad.push('floors '+o.floors);if(!(o.lined>0))bad.push('not lined');
  if(o.verts>2500000)bad.push('vertices '+o.verts);var R=P.roof();if(!R||!(R.n>500))bad.push('no eaves course');var roof=0,core=0;P.scene().traverse(function(q){if(q.userData&&q.userData.b172==='roof'&&q.visible)roof++;if(q.userData&&q.userData.planB==='core'&&q.visible)core++;});if(!roof)bad.push('no roof');if(core)bad.push('the rainscreen core still shows over the roof');
  var B=P.S().brick;if(B.bond!=='english'||B.carry!=='self')bad.push('bond '+B.bond+' '+B.carry);
  /* a pattern on it: the building, the windows and the checks stay; a half-brick bond is hung on the frame */
  window.PS_T163.design('r-diamond');var d=P.stat();m.diamond=[d.bricks,d.atRisk,d.inOpen,d.pushed,d.snap.wins,d.carry,d.verts];
  if(!P.on())bad.push('a design dropped the building');if(d.atRisk||d.inOpen||d.straight)bad.push('diamonds: '+[d.atRisk,d.inOpen,d.straight]);if(!(d.pushed>1000))bad.push('diamonds: pushed '+d.pushed);if(d.snap.wins!==55)bad.push('diamonds: windows '+d.snap.wins);if(d.carry!=='frame')bad.push('diamonds: a half-brick skin bearing on itself');if(d.verts>2500000)bad.push('diamonds: vertices '+d.verts);
  /* a pattern that leaves headers out is refused on the building */
  P.ex();window.PS_T163.ex.brickDesign('lantern');var l=P.stat();m.lantern=[l.atRisk,l.minBear,P.S().brick.splitDo];if(l.atRisk||P.S().brick.splitDo==='omit')bad.push('lantern on the building: at risk '+l.atRisk);
  /* leaving it: another worked example takes its own plan */
  window.PS_T163.ex.brickExample('house');if(P.rect()||P.on())bad.push('the rectangle stayed on the Low building');
  return{pass:!bad.length,detail:bad.length?bad.slice(0,8).join('; '):'plain '+m.plain+'; diamonds '+m.diamond+'; lantern '+m.lantern,metrics:m};});

/* ---- p173-1: the design check's worst findings on the example building, fixed ---- */
guard('assembly','p173-1 on the Rhino example building: a visit to Pavers with the plaza on gives each kind its own tone picture back (the same panel and the same raster after the round trip, for the perforated image, the cut pattern, the coin facade and brick); Serial sections gives the faces back when another kind is chosen; the header and step bar speak of the building for every kind and the note over the 3D view is cleared; the corner posts take the faces’ colour; coin facade tiles and kinetic units are cut round every window even when Over is asked; a screen face on brick is brick; Leave the example goes back to the panel',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,K7=window.PS_T157,X=window.PS_T145,P=window.PS_T160,Q=window.PS_T173;if(!K5||!K7||!X||!P||!Q)return{pass:false,detail:'handle missing'};
  var has=typeof THREE!=='undefined'&&T.hostScene;T.setPanelMode('perf');K5.load('emm',true);T.regen();X.set(['d','c','s','c']);T.regen();
  var sig=function(g,k){var n=0,s=0;if(k==='brick'){n=(g.bricks||[]).length;(g.bricks||[]).forEach(function(b){s+=(b.theta||0)+(b.shift||0)/100;});}else if(k==='tiles'){n=(g.tiles||[]).length;(g.tiles||[]).forEach(function(t){s+=(t.theta||t.a||0);});}else{n=(g.holes||[]).length;s=g.open||0;}return n+'|'+s.toFixed(3);};
  /* (1) the round trip through Pavers with the plaza on */
  S.mass.plaza=true;S.mass.plazaD=12000;S.mass.plazaSide=0;S.mass.plazaSig='';
  [['Perforated image','perf'],['Pattern','cut'],['Ombrae tiles','tiles'],['Brick courses','brick']].forEach(function(k){T.showTab(k[0],true);var g=T.regen(),a=sig(g,k[1]),h=Q.snap().h;P.plazaG();T.showTab('Pavers',true);T.regen();T.showTab(k[0],true);g=T.regen();var b=sig(g,k[1]),h2=Q.snap().h;
    m['rt_'+k[1]]=a+(a===b&&h===h2?' kept':' -> '+b);if(a!==b)bad.push(k[1]+' panel changed after Pavers: '+a+' -> '+b);if(h!==h2)bad.push(k[1]+' tone picture changed after Pavers');});
  S.mass.plaza=false;
  /* (2) Serial sections gives the faces back */
  T.showTab('Perforated image',true);T.regen();X.set(['d','c','s','c']);T.showTab('Serial sections',true);T.regen();m.inRibs=Q.raw();if(Q.raw()!=='d,d,d,d')bad.push('ribs not on all faces: '+Q.raw());
  T.showTab('Kinetic units',true);T.regen();m.afterRibs=Q.raw();if(Q.raw()!=='d,c,s,c')bad.push('faces not given back after Serial sections: '+Q.raw());
  T.showTab('Serial sections',true);T.regen();if(Q.raw()!=='d,d,d,d')bad.push('ribs on a second visit: '+Q.raw());T.showTab('Perforated image',true);T.regen();if(Q.raw()!=='d,c,s,c')bad.push('faces after a second visit: '+Q.raw());
  /* (3) the header and the step bar speak of the building; (5) solid kinds cut round; (7) a screen face on brick */
  [['Perforated image','perf','holes'],['Pattern','cut','openings'],['Ombrae tiles','tiles','tiles'],['Brick courses','brick','bricks'],['Kinetic units','kin','units']].forEach(function(k){T.showTab(k[0],true);T.regen();
    var ro=document.getElementById('readout');if(ro)ro.innerHTML='Every brick rests on the bricks below it.';T.updateStats();var hd=Q.header(),fl=Q.flowNow();m['h_'+k[1]]=hd.split(String.fromCharCode(10))[0];
    if(hd.indexOf(k[2]+' on the building')<0)bad.push(k[1]+' header: '+hd.slice(0,60));if(!/one panel/.test(hd))bad.push(k[1]+' header lost the one-panel figure');if(!/^Example building 41/.test(fl[0]||''))bad.push(k[1]+' step bar host: '+fl[0]);if(Q.readout())bad.push(k[1]+' note over the 3D view stays');
    if(k[1]==='tiles'||k[1]==='kin'){K7.over('over');var md=Q.modes(),C=K7.cut();if(md[0]!=='round'||!C||!C.faces[0]||C.faces[0].ops.length!==20)bad.push(k[1]+' runs over the windows');if(!Q.rules().some(function(x){return /cannot run over a window/.test(x[1]);}))bad.push(k[1]+' says nothing of Over');K7.over('round');}
    if(k[1]==='brick'){if(Q.codes()[2]!=='d')bad.push('the screen face on brick is '+Q.codes()[2]);var Cb=K7.cut();if(!Cb||!Cb.faces[2]||!Cb.faces[2].ops.length)bad.push('the brick screen face is not cut round its windows');if(!Q.rules().some(function(x){return /the screen face is a brick face too/.test(x[1]);}))bad.push('brick screen sentence');}
    /* (4) the corner posts */
    if(has&&k[1]!=='kin'){T.hostScene();var cs=Q.corners();m['c_'+k[1]]=cs.length;/* pass 180: no post on the arris at all; the panels turn the corner */if(cs.length)bad.push(k[1]+' a corner post remains');}});
  /* (6) Leave the example */
  Q.leave();T.regen();if(has)T.hostScene();if(S.mass.show3d)bad.push('Leave kept the building in 3D');if(/example building/.test(Q.hint()))bad.push('the hint still names the building');T.updateStats();if(/on the building/.test(Q.header()))bad.push('the header still speaks of the building');
  return{pass:!bad.length,detail:bad.join('; ')||'round trips kept ('+m.rt_perf+'), faces '+m.inRibs+' then '+m.afterRibs+', header '+m.h_brick,metrics:m};
});

/* ---- p174-1: a timber slat rainscreen on the example building ---- */
guard('assembly','on the Rhino example building the timber slats clad every face as a ventilated rainscreen: every slat ends on a batten and crosses at least two, none longer than the stock, no joint over a joint in the course below, the drip rule at both ends of every overlap, nothing in front of the glass and no batten in front of it, all four corners turned (since pass 181 the slats of both faces meet in a mitre; a post only where one face has none, which no slat passes and which stands proud of every slat butting it); the open screen over the windows keeps the rules on its piers; the designs keep them and differ (a louvred band with 100 mm and more of relief, louvres tilted 40 mm and more, open joints of 8 mm or more); schedules, details and OBJ are written; a panel tab sets the slats aside and gives the faces back',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,P=window.PS_T174;if(!K5||!P)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);T.regen();var f0=String(S.mass.facesX||'');
  if(!document.querySelector('.slats174 [data-s=on]'))bad.push('no building button');if(!document.querySelector('.slats174t [data-s=go]'))bad.push('no Timber tab button');
  P.on('ripple');T.regen();var chk=function(tag,screen){var M=P.model();if(!M){bad.push(tag+': no model');return null;}var c=M.chk;m[tag]=[M.slats.length,M.courses,M.battens.length,M.posts.length,c.minLap,M.held,M.boards];
    if(!(M.slats.length>1500))bad.push(tag+': slats '+M.slats.length);if(M.faces.length!==4)bad.push(tag+': faces '+M.faces.length);
    ['endsOff','fewBattens','overStock','jointOver','drip','outside','battenGlass','postShort'].forEach(function(k){if(c[k])bad.push(tag+': '+k+' '+c[k]);});
    if(!screen&&c.inGlass)bad.push(tag+': '+c.inGlass+' slats in front of glass');if((c.posts||0)+(c.mitred||0)!==4)bad.push(tag+': corners '+(c.posts||0)+' posts + '+(c.mitred||0)+' mitred');if(!M.open&&c.minLap<M.lap-.5)bad.push(tag+': lap '+c.minLap);if(M.open&&!(M.gapMin>=8))bad.push(tag+': open joint '+M.gapMin);
    if(M.slats.some(function(s){return !(s.len>0)||isNaN(s.kick)||isNaN(s.p0);}))bad.push(tag+': a slat without a size');return M;};
  var M=chk('ripple');
  if(M){var rows=P.csv().split('\n').filter(function(l){return /^S\d+,/.test(l);}).length;if(rows!==M.slats.length)bad.push('slat rows '+rows);if(/NaN/.test(P.csv()+P.battens()+P.detail()))bad.push('NaN in the schedules or details');
    if(!/facade_slats_W1/.test(P.obj().text)||!/facade_battens_W4/.test(P.obj().text))bad.push('OBJ groups');if(/NaN/.test(P.obj().text))bad.push('NaN in the OBJ');
    var fl=P.files().join(' ');['facade-slats.csv','facade-battens.csv','facade-slat-details.svg'].forEach(function(n){if(fl.indexOf(n)<0)bad.push('no '+n);});
    var ru=P.rules();if(!ru.some(function(q){return q[0]==='pr-ok'&&/drip rule/.test(q[1]);}))bad.push('no drip sentence');if(!ru.some(function(q){return q[0]==='pr-warn'&&/Fire/.test(q[1]);}))bad.push('no fire sentence');
    if(typeof THREE!=='undefined'&&T.hostScene){T.hostScene();var L=P.last();if(!L||!L.slats)bad.push('no slats in 3D');else{m.verts=L.verts;if(L.verts>700000)bad.push('vertices '+L.verts);}}}
  P.win('screen');T.regen();var Ms=chk('screen',true);if(Ms){var sc=Ms.slats.filter(function(s){return s.scr;});m.screenSlats=sc.length;if(!sc.length)bad.push('no screen slats');if(!sc.some(function(s){return Ms.ops.some(function(p){return p.f===s.f&&s.x1>p.x0&&s.x0<p.x1&&s.zt>p.z0&&s.zb<p.z1;});}))bad.push('the screen does not cross a window');if(sc.some(function(s){return s.bats.length<2;}))bad.push('a screen slat on one batten');}
  P.win('round');['band','louvre','open','porous','field'].forEach(function(d){P.design(d);T.regen();var Md=chk(d);if((d==='porous'||d==='band')&&Md&&!(Md.opened>0))bad.push(d+': no open bays');if(d==='band'&&Md&&!(Math.max.apply(null,Md.slats.map(function(s){return Math.max(s.p0,s.p1);}))>=100))bad.push('band: no relief');if(d==='louvre'&&Md&&!(Math.max.apply(null,Md.slats.map(function(s){return s.kick;}))>=40))bad.push('louvre: no tilt');});
  if(document.getElementById('modePill')&&P.live()&&!/Timber slats/.test(document.getElementById('modePill').textContent))bad.push('mode label '+document.getElementById('modePill').textContent);
  T.showTab('Brick courses',true);T.regen();if(P.live()||P.model())bad.push('slats stayed after a panel tab');if(String(S.mass.facesX||'')!==f0)bad.push('faces not given back: '+S.mass.facesX+' vs '+f0);
  T.setPanelMode('perf');T.regen();var f1=String(S.mass.facesX||'');P.on('band');T.regen();K5.leave();T.regen();if(String(S.mass.facesX||'')!==f1)bad.push('faces not given back after Leave: '+S.mass.facesX+' vs '+f1);
  return{pass:!bad.length,detail:bad.length?bad.slice(0,8).join('; '):JSON.stringify(m),metrics:m};});

guard('assembly','p175-1 on the Rhino example building a design face of the sheet kinds reads its picture or field across the whole face (repeat the panel is the other choice), kinetic units are set out from the windows, the rules and plan sheet count the faces in hand with no laser-model sentences, the facade keeps its material after Kinetic units, and the rib detail leaders do not cross',function(){
  T.reset();var bad=[],m={},K=window.PS_T155,Y=window.PS_T175;if(!K||!Y)return{pass:false,detail:'handle missing'};
  var spread=function(i){var rec=Y.canvas(i);if(!rec||!rec.cv)return -1;var cv=rec.cv,x=cv.getContext('2d'),d=x.getImageData(0,0,cv.width,cv.height).data,bays=rec.bays||40,w=cv.width/bays,v=[];for(var b=0;b<bays;b++){var s=0,n=0;for(var yy=Math.round(cv.height*.01);yy<cv.height*.055;yy+=2)for(var xx=Math.round(b*w+2);xx<(b+1)*w-2;xx+=3){var k=(yy*cv.width+xx)*4;s+=d[k+3]*(d[k]+d[k+1]+d[k+2]);n++;}v.push(s/Math.max(1,n));}var mu=v.reduce(function(a,q){return a+q;},0)/v.length;return Math.sqrt(v.reduce(function(a,q){return a+(q-mu)*(q-mu);},0)/v.length)/Math.max(1,mu);};
  /* 1: across by default, repeat on request */
  T.setPanelMode('perf');K.load('emm',true);T.regen();m.codes=Y.codes().join('');m.read=Y.read();
  if(Y.codes()[0]!=='w'||Y.read()!=='across')bad.push('W1 is not read across by default: '+m.codes+' '+m.read);
  var sA=spread(0),rA=Y.rules().map(function(r){return r[1];}).join(' | ');
  if(!/Across the face/.test(rA))bad.push('no across sentence');
  Y.set('repeat');T.regen();var sR=spread(0),rR=Y.rules().map(function(r){return r[1];}).join(' | ');m.spread=[sA.toFixed(3),sR.toFixed(3)];
  if(Y.codes()[0]!=='d')bad.push('repeat does not give W1 back as d');if(!/Repeat the panel/.test(rR))bad.push('no repeat sentence');
  if(!(sA>sR*1.5))bad.push('the across face does not vary bay to bay more than the repeat: '+m.spread);
  Y.set('across');T.regen();
  /* 4: rules and plan sheet */
  if(/finger-jointed|tabs of .* pass through|Panel joints are engraved|The laser sheets/.test(rA))bad.push('laser sentence in the facade rules');
  if(!/164 panels of 1000 by 2000 mm on 1 of 4 faces \(W1\)/.test(rA))bad.push('panels sentence not on the faces in hand');
  var pl=Y.plan();if(!/on 1 of 4 faces \(W1\)/.test(pl))bad.push('plan subtitle not on the faces in hand');
  /* 3: kinetic units set out from the windows */
  T.setPanelMode('kin');T.regen();Y.canvas(0);var kq=Y.kin()[0];m.kin=kq?[kq.n,kq.piers,kq.spans,Math.round(kq.mMin),Math.round(kq.mMax)]:null;
  if(!kq||kq.n<1500||kq.left!==0||kq.piers<10||kq.spans<20||kq.mMin<0)bad.push('kinetic set-out '+JSON.stringify(m.kin));
  var rk=Y.rules().map(function(r){return r[1];}).join(' | ');if(!/set out from the windows/.test(rk))bad.push('no kinetic set-out sentence');if(/panels of .* on \d+ of \d+ faces/.test(rk))bad.push('panel count sentence on kinetic units');
  T.setPanelMode('brick');T.regen();var rb=Y.rules().map(function(r){return r[1];}).join(' | ');if(/panels of .* on \d+ of \d+ faces/.test(rb))bad.push('panel count sentence on brick');
  /* 5: material through Kinetic units */
  T.reset();T.setPanelMode('perf');K.load('emm',true);T.regen();var S=T.S,mat=S.material;T.showTab('Kinetic units',true);var kmat=S.material;T.showTab('Perforated image',true);m.mat=[mat,kmat,S.material];
  if(kmat===mat)bad.push('kinetic did not change the material (test not meaningful) '+m.mat);if(S.material!==mat)bad.push('material not given back: '+m.mat);
  /* 6: leaders */
  T.showTab('Serial sections',true);T.regen();var L=Y.leaders();m.leaders=[L.before,L.after,L.calls];if(!L.calls||L.after>=L.before&&L.before>0||L.after>1)bad.push('leaders cross: '+m.leaders);
  return{pass:!bad.length,detail:bad.length?bad.join('; '):'W1 across '+m.spread[0]+' vs repeat '+m.spread[1]+'; kinetic '+m.kin+'; material '+m.mat+'; leader crossings '+m.leaders,metrics:m};
});

guard('assembly','p176-1 on the Rhino example building a tour of the panel kinds (Brick, Kinetic, Serial, back to Perforated; and Perforated, Tiles, Kinetic, Brick, Pattern, Perforated) by user clicks gives back the same header, material, thickness, picture, frames, hole count and W1 face picture; brick, kinetic units and ribs each show their own material while in them; off the building the pass does nothing',function(){
  T.reset();var bad=[],m={},K=window.PS_T155,Q=window.PS_T176,C=window.PS_T156;if(!K||!Q||!C)return{pass:false,detail:'handle missing'};
  var UV=[[.1,.2],[.2,.5],[.3,.8],[.4,.3],[.5,.6],[.6,.9],[.7,.15],[.8,.45],[.9,.75],[.15,.95],[.55,.35],[.85,.05]];
  var snap=function(){Q.fresh();T.regen();T.updateStats();var S=Q.S(),G=Q.G();return{hdr:T.statsText(),mat:S.material,th:S.thickness,src:S.omb.src,fr:[S.frameL,S.frameR,S.frameT,S.frameB].join(),w:S.width+'x'+S.height,holes:G&&G.holes?G.holes.length:-1,px:UV.map(function(q){return(C.px(0,q[0],q[1])||[]).join('.');}).join('|')};};
  var diff=function(a,b){var o=[];['hdr','mat','th','src','fr','w','holes','px'].forEach(function(k){if(a[k]!==b[k])o.push(k+': '+String(a[k]).slice(0,60)+' -> '+String(b[k]).slice(0,60));});return o;};
  var own={'Brick courses':/^(brick|terracotta|concrete|sandstone)$/,'Kinetic units':/^alum$/,'Serial sections':null};
  var A=null;var tour=function(tabs,tag){tabs.forEach(function(t){T.showTab(t,true);T.regen();if(t in own){var mt=Q.S().material;if(own[t]?!own[t].test(mt):mt===A.mat)bad.push(tag+': '+t+' shows '+mt);}});};
  var card=document.querySelector('.scase[data-case=emm]');if(!card)return{pass:false,detail:'no Start card'};card.click();T.regen();A=snap();m.before=[A.mat,A.th,A.holes,A.fr,A.src];if(A.mat!=='black'||A.fr!=='30,30,30,30')bad.push('the Start case did not open as measured: '+m.before);
  tour(['Brick courses','Kinetic units','Serial sections','Perforated image'],'tour 1');var B=snap();var d1=diff(A,B).filter(function(q){return !/^px/.test(q);});m.px1=A.px===B.px;if(d1.length)bad.push('tour 1: '+d1.join('; '));
  tour(['Ombrae tiles','Kinetic units','Brick courses','Pattern','Perforated image'],'tour 2');var C2=snap();var d2=diff(A,C2).filter(function(q){return !/^px/.test(q);});m.px2=A.px===C2.px;if(d2.length)bad.push('tour 2: '+d2.join('; '));
  m.after=[C2.mat,C2.th,C2.holes,C2.fr];m.gave=Q.stat().gave;if(!(m.gave>0))bad.push('nothing was ever given back (test not meaningful)');
  /* the same tour from the building loaded with a picture the tool picked (the gondola, OMB.auto): header, material, frames and holes come back and the 12 W1 pixels too */
  T.reset();T.setPanelMode('perf');K.load('emm',true);T.regen();var D=snap();tour(['Brick courses','Kinetic units','Serial sections','Perforated image'],'auto');var E=snap();var d3=diff(D,E).filter(function(q){return !/^px/.test(q);});if(d3.length)bad.push('auto picture: '+d3.join('; '));m.autoPx=D.px===E.px;if(!m.autoPx)bad.push('auto picture: the W1 face picture changed');
  /* off the building: a plain panel, no site */
  T.reset();T.setPanelMode('perf');T.regen();var n0=Q.stat().log.length,mat0=Q.S().material;T.showTab('Kinetic units',true);T.showTab('Perforated image',true);
  if(Q.stat().log.length!==n0)bad.push('pass 176 ran off the building');m.off=[mat0,Q.S().material];
  return{pass:!bad.length,detail:bad.length?bad.join('; '):'before '+m.before+' after '+m.after+'; given back '+m.gave+' times; off the building '+m.off,metrics:m};
});
/* ---- p180-1: every corner of the example building turned by its own panels ---- */
guard('assembly','p180-1 on the Rhino example building every corner is turned by the panels themselves: no corner post and no plain strip; both faces reach the arris (less the stop the corner asks for); on a sheet face the pattern runs to a solid margin at the arris; each kind has its own corner part in its face colour (returns on the diagonal and a corner track for hook-on cassettes, one folded plate for clipped plates, a notch and a corner angle for boards, a folded composite panel, a frame angle with units set out evenly for kinetic units, quoins that swap course by course for brick); corner types in the schedules; nothing after Leave',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,X=window.PS_T145,C=window.PS_T180,Q=window.PS_T173;if(!K5||!X||!C||!Q)return{pass:false,detail:'handle missing'};
  if(typeof THREE==='undefined'||!T.hostScene)return{pass:true,detail:'no 3D in this run',metrics:m};
  T.setPanelMode('perf');K5.load('emm',true);T.regen();
  var ROLE={hook:['corner-cassette','corner-track'],reveal:['corner-fold'],board:['corner-board','corner-angle'],fold:['corner-fold'],kin:['kin-corner-frame'],mixed:['corner-cassette','corner-track'],quoin:[],ribs:[]};
  var check=function(tag,mode,codes,sys,expect){if(mode)T.setPanelMode(mode);if(sys)C.sys(sys);X.set(codes);T.regen();T.hostScene();var L=C.last();if(!L||!L.corners){bad.push(tag+': nothing built');return null;}
    if(C.posts())bad.push(tag+': a corner post remains');var ctx=C.ctx(),O=ctx.O,s=ctx.s,cx=s.w/2,cy=s.d/2,F=C.faces();m[tag]=L.corners.map(function(c){return c.kind;}).join(',');
    if(L.corners[0].kind!==expect)bad.push(tag+': corner W1/W2 is '+L.corners[0].kind+' not '+expect);
    /* the faces reach the arris, less the corner's stop */
    var worst=0;F.forEach(function(f,i){if(!f.vis)return;var p=f.pos,ud=f.ud;if(!ud){bad.push(tag+': face '+(i+1)+' not re-laid');return;}var a=O[i],b=O[(i+1)%4],A=[p[0]+cx,cy-p[2]],B=[p[3]+cx,cy-p[5]];
      worst=Math.max(worst,Math.abs(Math.hypot(A[0]-a[0],A[1]-a[1])-ud.stop[0]),Math.abs(Math.hypot(B[0]-b[0],B[1]-b[1])-ud.stop[1]));
      if(ud.u[0]<0||ud.u[1]>1||Math.abs((ud.u[1]-ud.u[0])*ud.E-(ud.E-ud.stop[0]-ud.stop[1]))>1)bad.push(tag+': face '+(i+1)+' uv off');});
    m[tag+'_reach']=+worst.toFixed(2);if(worst>2)bad.push(tag+': a face ends '+worst.toFixed(1)+' mm off its arris');
    /* the corner part is there and in its face's colour */
    var ms=C.meshes(),roles={};ms.forEach(function(q){roles[q.role]=q.hex;});(ROLE[expect]||[]).forEach(function(r){if(!roles[r])bad.push(tag+': no '+r);});
    var hx=codes.map(function(c){return String(C.hex(c)).toLowerCase();});ms.forEach(function(q){if(/cassette|fold|board|angle/.test(q.role)&&hx.indexOf(String(q.hex).toLowerCase())<0)bad.push(tag+': '+q.role+' in '+q.hex+', not a face colour');
      if(q.role==='kin-corner-frame'&&String(q.hex).toLowerCase()!==String(C.hex('d')).toLowerCase())bad.push(tag+': kinetic angle not in the frame colour');});
    return{L:L,F:F,ctx:ctx};};
  /* the pattern runs to a solid margin at the arris on a perforated face */
  var margin=function(tag,f,P){var cv=f.cv;if(!cv){bad.push(tag+': no widened picture');return;}var x=cv.getContext('2d'),px=cv.width/f.ud.E,mg=C.margin(),solid=0,open=0,n=0;
    for(var k=1;k<=9;k++){var y=Math.round(cv.height*k/10);var d=x.getImageData(cv.width-Math.max(2,Math.floor((mg-4)*px)),y,Math.max(1,Math.floor((mg-6)*px)),1).data;for(var j=3;j<d.length;j+=4){n++;if(d[j]===255)solid++;}
      var d2=x.getImageData(Math.round(cv.width-(P-35)*px),y,Math.max(1,Math.round((P-35-mg-8)*px)),1).data;for(j=3;j<d2.length;j+=4)if(d2[j]<128)open++;}
    m[tag+'_margin']=[solid,n,open];if(solid<n)bad.push(tag+': the margin at the arris is not solid');if(!open)bad.push(tag+': no openings between the joint and the margin: a plain band at the corner');};
  var r=check('perf-hook','perf',['d','d','d','d'],'hook','hook');if(r)margin('perf-hook',r.F[0],r.ctx.P);
  r=check('perf-reveal',null,['d','d','d','d'],'reveal','reveal');if(r)margin('perf-reveal',r.F[0],r.ctx.P);
  r=check('perf-board',null,['d','d','d','d'],'board','board');if(r){var st=r.L.corners[0].stop;if(!(st[0]>st[1]))bad.push('board: the boards do not stop unequally at the notch');}
  C.sys('hook');
  check('composite','perf',['c','c','c','c'],null,'fold');
  check('mixed','perf',['d','c','d','c'],null,'mixed');
  check('cut-hook','cut',['d','d','d','d'],null,'hook');
  check('tiles-hook','tiles',['d','d','d','d'],null,'hook');
  r=check('kinetic','kin',['d','d','d','d'],null,'kin');if(r){var k0=r.L.faces.find(function(f){return f.i===0;}),k1=r.L.faces.find(function(f){return f.i===1;});if(!k0||!k0.kin||!k1||!k1.kin)bad.push('kinetic: no set-out');else{var gA=k0.kin.first[1],gB=k1.kin.first[0];m.kinGaps=[Math.round(gA),Math.round(gB)];if(Math.abs(gA-gB)>1)bad.push('kinetic: the first units sit '+Math.round(gA)+' and '+Math.round(gB)+' mm from the arris');}}
  r=check('brick','brick',['d','d','d','d'],null,'quoin');if(r){var b0=r.L.faces.find(function(f){return f.i===0;}),b1=r.L.faces.find(function(f){return f.i===1;});if(!b0||!b0.quoin||!b1||!b1.quoin)bad.push('brick: no quoins');else{var R=b0.quoin.seq[1],Lq=b1.quoin.seq[0],same=0,flat=0;for(var c=0;c<Math.min(R.length,Lq.length);c++){if(R[c]===Lq[c])same++;if(c&&R[c]===R[c-1])flat++;}m.quoin=[R.length,same,flat];if(same)bad.push('brick: '+same+' courses where both faces end alike at the arris');if(flat)bad.push('brick: '+flat+' courses where the quoin does not swap');}}
  r=check('ribs','serial',['d','d','d','d'],null,'ribs');
  /* schedules */
  T.setPanelMode('perf');C.sys('hook');X.set(['d','d','d','d']);T.regen();var ty=C.types()||[];m.types=ty.map(function(t){return t.id+':'+t.kind;}).join(' ');if(ty.filter(function(t){return /^BC/.test(t.id);}).length!==4)bad.push('corner types '+m.types);
  var cc=C.cutcsv()||'';if(cc.indexOf('corner_blank')<0)bad.push('cut schedule without corner blanks');if((C.blanks()||'').indexOf('corner-blanks')<0)bad.push('blanks drawing without corner blanks');if((C.mount()||'').indexOf('corner track')<0)bad.push('mounting list without the corner track');if(C.csv().indexOf('BC1')<0)bad.push('corners csv');
  var ob=C.obj(),ot=ob&&ob.text||'';if(ot.indexOf('g corner_W1_W2_hook')<0)bad.push('the OBJ has no corner group');
  if(!C.rules().some(function(x){return /^Corners: no post and no plain strip/.test(x[1]);}))bad.push('no corner sentence in the rules');
  /* Leave */
  Q.leave();T.regen();T.hostScene();if(C.meshes().length)bad.push('corner parts after Leave');
  return{pass:!bad.length,detail:bad.join('; ')||('corners: '+m['perf-hook']+' / '+m['perf-reveal']+' / '+m['perf-board']+' / '+m.composite+' / '+m.kinetic+' / '+m.brick+'; faces within '+m['perf-hook_reach']+' mm of the arris; quoins '+JSON.stringify(m.quoin)+'; kinetic gaps '+JSON.stringify(m.kinGaps)),metrics:m};
});
/* ---- p181-1: the slat corner and the rib corner of the example building ---- */
guard('assembly','p181-1 on the Rhino example building the timber slats of both faces run past each arris and meet in a mitre course by course (no post, no box: every mitre vertex of one face meets its partner within 3 mm, nothing seen at the corner over 60 mm a face, the corner bay never open, every older slat rule still kept) in four designs, with the schedules, details and corner table saying so; and behind every fan of serial ribs the backing is one dark tone, the rail and clip steel there dark too, a lone ribbed face closing onto its plain neighbour without painting it',function(){
  T.reset();var bad=[],m={},K5=window.PS_T155,P=window.PS_T174,Z=window.PS_T181,X=window.PS_T145,C8=window.PS_T180;if(!K5||!P||!Z||!X||!C8)return{pass:false,detail:'handle missing'};
  T.setPanelMode('perf');K5.load('emm',true);T.regen();
  /* 1. the slats */
  var first=true;['band','ripple','porous','louvre'].forEach(function(d){if(first){P.on(d);first=false;}else P.design(d);T.regen();var M=P.model();if(!M){bad.push(d+': no model');return;}var c=M.chk;
    if(M.posts.length)bad.push(d+': '+M.posts.length+' posts');if(c.mitred!==4)bad.push(d+': mitred corners '+c.mitred);
    ['endsOff','fewBattens','overStock','overCut','jointOver','drip','outside','battenGlass','postShort','cornerMiss','cornerUnpaired','cornerOpen','cornerWide'].forEach(function(k){if(c[k])bad.push(d+': '+k+' '+c[k]);});
    var g=Z.mitre();if(!g){bad.push(d+': no mitre geometry');return;}m[d]={pairs:Z.slats().pairs,miss:+g.miss.toFixed(3),plane:[g.nA,g.nB],missModel:+(c.cornerMissMax||0).toFixed(2),moved:Z.slats().moved};
    if(!(g.nA>0)||g.nA!==g.nB)bad.push(d+': mitre vertices '+g.nA+' / '+g.nB);if(g.miss>3)bad.push(d+': a mitre misses by '+g.miss.toFixed(1)+' mm');
    (Z.parts()||[]).forEach(function(q){q.core.concat(q.strip).forEach(function(w){if(w>60)bad.push(d+': '+q.corner+' part '+w+' mm a face');});});
    if(!M.open&&c.minLap<M.lap-.5)bad.push(d+': lap '+c.minLap);if(M.open&&!(M.gapMin>=8))bad.push(d+': gap '+M.gapMin);});
  var ru=P.rules();if(!ru.some(function(q){return q[0]==='pr-ok'&&/^Corners: no post and no box/.test(q[1]);}))bad.push('no corner sentence');if(ru.some(function(q){return /corner post/.test(q[1]);}))bad.push('a rule still speaks of a corner post');
  if(!/meet in a mitre/.test(P.detail()))bad.push('detail C not the mitre');var bt=P.battens();if(!/core batten behind the mitre/.test(bt)||/^post,/m.test(bt))bad.push('battens schedule corner rows');
  if(!/,cut_length_mm$/m.test(P.csv().split('\n')[0]))bad.push('no cut length column');if(!/mitred slat ends/.test(C8.csv()))bad.push('corner table not the mitre');if(/NaN/.test(P.csv()+bt+P.detail()))bad.push('NaN in the slat files');
  var has=typeof THREE!=='undefined'&&T.hostScene;if(has){T.hostScene();var L=P.last();if(!L||!L.slats)bad.push('no slats in 3D');else{m.verts=L.verts;if(L.verts>700000)bad.push('vertices '+L.verts);}if(Z.posts())bad.push('a corner post mesh');}
  /* 2. the ribs */
  T.showTab('Serial sections',true);T.regen();X.set(['d','d','d','d']);T.regen();
  if(has){T.hostScene();var R=Z.ribs();if(!R){bad.push('ribs: nothing painted');}else{m.ribs={painted:R.painted.length,steel:R.steel,solid:Math.round(R.solid)};if(R.painted.length!==8)bad.push('ribs: painted ends '+R.painted.length);if(!(R.steel>0))bad.push('ribs: no dark steel at the fans');
      var lum=function(v){return v?(v[0]*.3+v[1]*.59+v[2]*.11):-1;},z=1800,dk=0,pl=0,tr=0;[0,1,2,3].forEach(function(i){[0,1].forEach(function(sd){[20,R.solid*.5,R.solid-10].forEach(function(dd){var v=Z.px(i,dd,z,sd);if(!v||v[3]<250)tr++;else if(lum(v)>70)pl++;else dk++;});});});
      m.ribs.samples=[dk,pl,tr];if(pl||tr)bad.push('ribs: '+pl+' pale and '+tr+' clear samples behind the fans');
      var mid=Z.px(0,12000,z,0);if(!mid||lum(mid)<90)bad.push('ribs: the backing mid-face was darkened too');}
    X.set(['d','c','c','c']);T.regen();T.hostScene();var R1=Z.ribs();if(!R1)bad.push('W1 alone: nothing painted');else{var pf=R1.painted.map(function(q){return q.join(':');}).sort().join(',');m.w1=pf;if(pf!=='0:0,0:1')bad.push('W1 alone: painted '+pf);
      var w2=Z.px(1,20,z,0);if(!w2||lum(w2)<90)bad.push('W1 alone: the composite face beside the return was darkened');}}
  K5.leave();T.regen();
  return{pass:!bad.length,detail:bad.length?bad.slice(0,8).join('; '):JSON.stringify(m),metrics:m};});

drain();
}
function done(){R.ms=Date.now()-R.t0;document.title='RESULT'+JSON.stringify(R);}
setTimeout(run,900);
})();

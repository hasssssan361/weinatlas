let DATA = {};     // { Land: { bearing, dist, borderKey, regions:{ Gebiet:{lat,lon,producers,lagen?} } } }
let SHAPES = {};   // { Land: { Gebiet: [ [[lat,lon],...], ... ] } }
const esc = s => String(s==null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtPrice(p){
  if(p==null || p==='') return '–';
  const n = Number(p);
  if(!isFinite(n)) return esc(p);
  return '€ ' + (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.',','));
}
/* ================= HELPERS ================= */
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs){ const e=document.createElementNS(NS,tag); for(const k in attrs) e.setAttribute(k,attrs[k]); return e; }
function wineCountProducers(producers){ return producers.reduce((s,p)=>s+p.wines.length,0); }
function wineCountRegion(regionObj){
  let n = wineCountProducers(regionObj.producers);
  if(regionObj.lagen) n += Object.values(regionObj.lagen).reduce((s,l)=>s+wineCountProducers(l.producers),0);
  return n;
}
function producerCountRegion(regionObj){
  let n = regionObj.producers.length;
  if(regionObj.lagen) n += Object.values(regionObj.lagen).reduce((s,l)=>s+l.producers.length,0);
  return n;
}
function wineCountCountry(country){ return Object.values(DATA[country].regions).reduce((s,r)=>s+wineCountRegion(r),0); }

function project(lat, lon, bounds, w, h, pad){
  const latMid = (bounds.latMin+bounds.latMax)/2;
  const cosLat = Math.max(0.35, Math.cos(latMid*Math.PI/180));
  const spanX = Math.max((bounds.lonMax-bounds.lonMin)*cosLat, 0.6);
  const spanY = Math.max((bounds.latMax-bounds.latMin), 0.6);
  const availW = w - pad*2, availH = h - pad*2;
  const k = Math.min(availW/spanX, availH/spanY);
  const offX = pad + (availW - spanX*k)/2;
  const offY = pad + (availH - spanY*k)/2;
  const x = offX + (lon-bounds.lonMin)*cosLat*k;
  const y = offY + (bounds.latMax-lat)*k;
  return [x,y];
}

/* Farbskala für Anbaugebiete: sandfarben (wenig) -> tiefes Weinrot (viel) */
function lerpColor(hexA, hexB, t){
  const a = [parseInt(hexA.slice(1,3),16), parseInt(hexA.slice(3,5),16), parseInt(hexA.slice(5,7),16)];
  const b = [parseInt(hexB.slice(1,3),16), parseInt(hexB.slice(3,5),16), parseInt(hexB.slice(5,7),16)];
  const c = a.map((v,i)=> Math.round(v + (b[i]-v)*t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function regionColor(t){ return lerpColor('#e8c98a', '#8a1f34', Math.max(0,Math.min(1,t))); }

/* Voronoi-Tessellation für Lagen-Flächen: aneinandergrenzende Flächen wie auf
   klassischen illustrierten Weinkarten (z.B. Bordeaux-Atlanten) — errechnet aus den
   echten Lagen-Koordinaten, ohne dass amtliche Flächen-Geometrie nötig wäre. */
function rectPoly(minX,minY,maxX,maxY){ return [[minX,minY],[maxX,minY],[maxX,maxY],[minX,maxY]]; }
function clipHalfPlane(poly, a, b, c){
  if(poly.length===0) return poly;
  const out = [];
  for(let i=0;i<poly.length;i++){
    const cur = poly[i];
    const prev = poly[(i-1+poly.length)%poly.length];
    const curD = a*cur[0]+b*cur[1]-c, prevD = a*prev[0]+b*prev[1]-c;
    const curIn = curD <= 0, prevIn = prevD <= 0;
    if(curIn){
      if(!prevIn){ const t=prevD/(prevD-curD); out.push([prev[0]+t*(cur[0]-prev[0]), prev[1]+t*(cur[1]-prev[1])]); }
      out.push(cur);
    } else if(prevIn){
      const t=prevD/(prevD-curD); out.push([prev[0]+t*(cur[0]-prev[0]), prev[1]+t*(cur[1]-prev[1])]);
    }
  }
  return out;
}
function voronoiCell(site, sites, minX,minY,maxX,maxY){
  let poly = rectPoly(minX,minY,maxX,maxY);
  sites.forEach(other=>{
    if(other===site) return;
    const a = 2*(other.x-site.x), b = 2*(other.y-site.y);
    const c = other.x*other.x+other.y*other.y - site.x*site.x-site.y*site.y;
    poly = clipHalfPlane(poly, a, b, c);
  });
  return poly;
}
function polyToPath(poly){
  if(poly.length===0) return '';
  return poly.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+' Z';
}

/* Catmull-Rom -> kubische Bezier: rundet Polygon-/Linienzüge zu einer weichen, organischen
   Kurve statt eckiger Geradensegmente (für Gebietsflächen und Flusslinien). Punkte in x,y. */
function smoothPath(pts, closed){
  const n = pts.length;
  if(n<3) return polyToPath(pts).replace(/ Z$/, closed?' Z':'');
  const at = i=> closed ? pts[(i+n)%n] : pts[Math.max(0,Math.min(n-1,i))];
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
  const steps = closed ? n : n-1;
  for(let i=0;i<steps;i++){
    const p0=at(i-1), p1=at(i), p2=at(i+1), p3=at(i+2);
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `;
  }
  return d + (closed ? 'Z' : '');
}

/* Erzeugt aus einer Mittellinie (spine, [lat,lon]-Punkte) ein "Flussband"-Polygon fester Breite —
   für von Hand angenäherte Anbaugebiets-Flächen, die einem Talverlauf folgen. Rückgabe in lat/lon. */
function ribbonPolygon(spine, widthDeg){
  const n = spine.length;
  const left = [], right = [];
  for(let i=0;i<n;i++){
    const [lat,lon] = spine[i];
    const prev = spine[Math.max(0,i-1)], next = spine[Math.min(n-1,i+1)];
    const cosLat = Math.cos(lat*Math.PI/180);
    let dx = (next[1]-prev[1])*cosLat, dy = next[0]-prev[0];
    const len = Math.hypot(dx,dy) || 1; dx/=len; dy/=len;
    const px = -dy, py = dx, half = widthDeg/2;
    left.push([lat+py*half, lon+(px*half)/cosLat]);
    right.push([lat-py*half, lon-(px*half)/cosLat]);
  }
  return left.concat(right.reverse());
}

/* ================= WORLD MAP ================= */
const svg = document.getElementById('map');
const worldLayer = el('g',{id:'worldLayer'});
const countryLayer = el('g',{id:'countryLayer', style:'opacity:0'});
svg.appendChild(worldLayer);
svg.appendChild(countryLayer);

const CX=500, CY=340;
function polar(bearingDeg, r){ const rad=(bearingDeg-90)*Math.PI/180; return [CX+r*Math.cos(rad), CY+r*Math.sin(rad)]; }

let RESTAURANT = { name:'', city:'' };
const nodeEls = {};

function buildWorld(){
  worldLayer.innerHTML = '';
  Object.keys(nodeEls).forEach(k=> delete nodeEls[k]);

  [110,190,270,340].forEach(r=> worldLayer.appendChild(el('circle',{cx:CX,cy:CY,r:r,fill:'none',stroke:'rgba(201,163,93,0.06)','stroke-width':1})));

  const hub = el('g',{});
  hub.appendChild(el('circle',{cx:CX,cy:CY,r:9,fill:'#b23a4e',stroke:'#e6c17f','stroke-width':1.5}));
  hub.appendChild(el('circle',{cx:CX,cy:CY,r:16,fill:'none',stroke:'#c9a35d','stroke-width':1,opacity:.5}));
  worldLayer.appendChild(hub);
  const hubT=el('text',{x:CX,y:CY-24,'text-anchor':'middle',class:'hub-label'}); hubT.textContent=RESTAURANT.city||''; worldLayer.appendChild(hubT);
  const hubS=el('text',{x:CX,y:CY+30,'text-anchor':'middle',class:'hub-sub'}); hubS.textContent=(RESTAURANT.name||'').toUpperCase(); worldLayer.appendChild(hubS);

  Object.keys(DATA).forEach(country=>{
    const {bearing, dist} = DATA[country];
    const [x,y] = polar(bearing, dist);
    const count = wineCountCountry(country);
    const r = 7 + Math.min(count,60)/60*7;

    const line = el('path',{d:`M${CX},${CY} Q${(CX+x)/2+(y-CY)*0.08},${(CY+y)/2-(x-CX)*0.08} ${x},${y}`, class:'path-line'});
    worldLayer.appendChild(line);

    const g = el('g',{class:'node','data-country':country});
    g.appendChild(el('circle',{cx:x,cy:y,r:r+14,class:'halo'}));
    g.appendChild(el('circle',{cx:x,cy:y,r:r,class:'pin'}));
    const cnt=el('text',{x:x,y:y-r-24,'text-anchor':'middle',class:'count'}); cnt.textContent=count+" Positionen"; g.appendChild(cnt);
    const label=el('text',{x:x,y:y-r-10,'text-anchor':'middle',class:'label'}); label.textContent=country; g.appendChild(label);
    worldLayer.appendChild(g);

    nodeEls[country]={g,line,x,y};
    g.addEventListener('click', ()=> zoomToCountry(country));
  });
}
/* ================= ZOOM TRANSITION ================= */
function tween(duration, onFrame, onDone){
  const start = performance.now();
  function ease(t){ return 1-Math.pow(1-t,3); }
  function step(now){
    let t = Math.min(1,(now-start)/duration);
    onFrame(ease(t));
    if(t<1) requestAnimationFrame(step); else if(onDone) onDone();
  }
  requestAnimationFrame(step);
}

const backBtn = document.getElementById('backBtn');
const hintText = document.getElementById('hintText');
let currentCountry = null;

function zoomToCountry(country){
  currentCountry = country;
  const {x,y} = nodeEls[country];
  buildCountryLayer(country);
  resetPanZoom();
  hintText.textContent = "▸ Anbaugebiet anklicken für die Weinliste · Mausrad = Zoom";
  backBtn.classList.add('show');
  zoomCtrls.classList.add('show');
  stage.classList.add('zoomable');

  tween(600, t=>{
    const scale = 1 + t*7;
    worldLayer.setAttribute('transform', `translate(${x},${y}) scale(${scale}) translate(${-x},${-y})`);
    worldLayer.style.opacity = String(1-t);
  }, ()=>{});

  tween(600, t=>{
    countryLayer.style.opacity = String(t);
    const s = 1.1 - t*0.1;
    countryLayer.setAttribute('transform', `translate(500,340) scale(${s}) translate(-500,-340)`);
  });
}

function zoomToWorld(){
  if(!currentCountry) return;
  const {x,y} = nodeEls[currentCountry];
  hintText.textContent = "▸ Land anklicken zum Heranzoomen";
  backBtn.classList.remove('show');
  zoomCtrls.classList.remove('show');
  stage.classList.remove('zoomable');
  hideTooltip();

  tween(500, t=>{
    countryLayer.style.opacity = String(1-t);
  });
  tween(500, t=>{
    const scale = 8 - t*7;
    worldLayer.setAttribute('transform', `translate(${x},${y}) scale(${scale}) translate(${-x},${-y})`);
    worldLayer.style.opacity = String(t);
  }, ()=>{
    worldLayer.removeAttribute('transform');
    worldLayer.style.opacity = 1;
    countryLayer.innerHTML = '';
  });
  if(nodeEls[currentCountry]){
    nodeEls[currentCountry].g.classList.remove('active');
    nodeEls[currentCountry].line.classList.remove('active');
  }
  currentCountry = null;
  closePanel();
}
backBtn.addEventListener('click', zoomToWorld);

/* ================= TOOLTIP (Hover) ================= */
const stage = document.getElementById('stage');
const tooltip = document.getElementById('tooltip');
const ttName = document.getElementById('ttName');
const ttInfo = document.getElementById('ttInfo');
function showTooltip(evt, name, info){
  ttName.textContent = name;
  ttInfo.textContent = info;
  const stageRect = stage.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  tooltip.style.left = (evt.clientX - stageRect.left) + 'px';
  tooltip.style.top = (evt.clientY - stageRect.top) + 'px';
  tooltip.classList.add('show');
}
function moveTooltip(evt){
  const stageRect = stage.getBoundingClientRect();
  tooltip.style.left = (evt.clientX - stageRect.left) + 'px';
  tooltip.style.top = (evt.clientY - stageRect.top) + 'px';
}
function hideTooltip(){ tooltip.classList.remove('show'); }

/* ================= COUNTRY (ZOOMED) MAP — ECHTE GRENZEN ================= */
let zoomG = null; // Gruppe, auf der der Pan/Zoom der Länderansicht angewendet wird
let lageZoneEls = {}; // { Region: { Lage: <g>-Element } } — für Sichtbarkeit per Panel-Klick

function buildCountryLayer(country){
  countryLayer.innerHTML = '';
  zoomG = el('g',{id:'zoomG'});
  countryLayer.appendChild(zoomG);

  const data = DATA[country];
  const regionNames = Object.keys(data.regions);
  const borderPolys = BORDERS[data.borderKey || BORDER_NAME[country]] || [];

  // Bounding box aus den ECHTEN Grenzpunkten (nicht nur den Anbaugebieten)
  let latMin=90, latMax=-90, lonMin=180, lonMax=-180;
  borderPolys.forEach(poly=> poly[0].forEach(([lon,lat])=>{
    if(lat<latMin) latMin=lat; if(lat>latMax) latMax=lat;
    if(lon<lonMin) lonMin=lon; if(lon>lonMax) lonMax=lon;
  }));
  const bounds={latMin,latMax,lonMin,lonMax};

  const W=1000,H=680,PAD=90;
  const proj = (lat,lon)=> project(lat,lon,bounds,W,H,PAD);

  // Landmasse aus echten Grenzpolygonen zeichnen
  borderPolys.forEach(poly=>{
    const ring = poly[0];
    let d = '';
    ring.forEach(([lon,lat],i)=>{
      const [x,y] = proj(lat,lon);
      d += (i===0?'M':'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    d += 'Z';
    zoomG.appendChild(el('path',{d, class:'landmass'}));
  });

  const title = el('text',{x:56,y:60,class:'country-title'}); title.textContent = country;
  zoomG.appendChild(title);
  const note = el('text',{x:56,y:82,class:'country-note'});
  note.textContent = regionNames.length + " Anbaugebiete · echte Landesgrenze";
  zoomG.appendChild(note);

  // nearest-neighbour Radius für Marker-Größe
  const projRegion = regionNames.map(n=> proj(data.regions[n].lat, data.regions[n].lon));
  const radii = projRegion.map((p,i)=>{
    let minD = Infinity;
    projRegion.forEach((q,j)=>{ if(i!==j){ const d=Math.hypot(p[0]-q[0],p[1]-q[1]); if(d<minD) minD=d; } });
    if(!isFinite(minD)) minD = 60;
    return Math.max(6, Math.min(11, minD/2*0.35));
  });

  // Farbskala relativ zum Gebiet mit den meisten Positionen im Land
  const counts = regionNames.map(n=> wineCountRegion(data.regions[n]));
  const maxCount = Math.max(1, ...counts);

  lageZoneEls = {};

  regionNames.forEach((name,i)=>{
    const [x,y] = projRegion[i];
    const r = radii[i];
    const regionObj = data.regions[name];
    const hasLagen = !!regionObj.lagen;

    // Lagen: aneinandergrenzende Voronoi-Flächen (wie auf klassischen Weinkarten), Position aus
    // den echten Ortskoordinaten. Umriss erscheint, sobald das Gebietspanel offen ist ("context"),
    // Farbfüllung erst, wenn im Panel (oder direkt auf der Fläche) der jeweilige Wein angeklickt wird ("show").
    if(hasLagen){
      lageZoneEls[name] = {};
      const lageNames = Object.keys(regionObj.lagen);
      const sites = lageNames.map(lname=>{
        const lage = regionObj.lagen[lname];
        const [sx,sy] = proj(lage.lat, lage.lon);
        return { lname, x:sx, y:sy, lage };
      });
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      sites.forEach(s=>{ if(s.x<minX)minX=s.x; if(s.x>maxX)maxX=s.x; if(s.y<minY)minY=s.y; if(s.y>maxY)maxY=s.y; });
      const padX = Math.max(50, (maxX-minX)*0.6), padY = Math.max(50, (maxY-minY)*0.6);
      minX-=padX; maxX+=padX; minY-=padY; maxY+=padY;

      sites.forEach(site=>{
        const { lname, lage } = site;
        const cell = voronoiCell(site, sites, minX,minY,maxX,maxY);
        const lcount = wineCountProducers(lage.producers);
        const lcolor = regionColor(lcount/maxCount);
        const cx = cell.reduce((s,p)=>s+p[0],0)/cell.length, cy = cell.reduce((s,p)=>s+p[1],0)/cell.length;

        const g = el('g',{class:'zone lage','data-region':lname});
        g.appendChild(el('path',{d:polyToPath(cell), class:'cell', fill:lcolor}));
        const lbl = el('text',{x:cx,y:cy,'text-anchor':'middle',class:'lage-label'}); lbl.textContent=lname;
        g.appendChild(lbl);
        zoomG.appendChild(g);
        lageZoneEls[name][lname] = g;

        g.addEventListener('mouseenter', (e)=> showTooltip(e, lname, lcount+" Weine · "+lage.producers.length+" Erzeuger · "+name));
        g.addEventListener('mousemove', moveTooltip);
        g.addEventListener('mouseleave', hideTooltip);
        g.addEventListener('click', (e)=>{ e.stopPropagation(); toggleLageFill(name, lname); });
      });
    }

    // Gebiets-Marker: entweder Fläche (von Hand angenähert, aktuell nur Deutschland) oder Punkt
    const count = hasLagen ? wineCountRegion(regionObj) : wineCountProducers(regionObj.producers);
    const color = regionColor(count/maxCount);
    const producerCount = hasLagen ? producerCountRegion(regionObj) : regionObj.producers.length;
    const shapeDef = SHAPES[country] && SHAPES[country][name];

    const g = el('g',{class: shapeDef ? 'zone region-area' : 'zone', 'data-region':name});
    if(shapeDef){
      // ein Gebiet kann aus mehreren getrennten Teilflächen bestehen (z.B. Baden mit Bodensee-Exklave)
      const parts = shapeDef;
      const d = parts.map(latlonPoly=>{
        const projPoly = latlonPoly.map(([lat,lon])=> proj(lat,lon));
        return smoothPath(projPoly,true);
      }).join(' ');
      g.appendChild(el('path',{d, class:'area', fill:color}));
    } else {
      g.appendChild(el('circle',{cx:x,cy:y,r:r*1.9,class:'glow',fill:color}));
      g.appendChild(el('circle',{cx:x,cy:y,r:r,class:'ring',fill:color}));
      g.appendChild(el('circle',{cx:x,cy:y,r:2,class:'dot'}));
    }
    zoomG.appendChild(g);

    g.addEventListener('mouseenter', (e)=> showTooltip(e, name, count+" Weine · "+producerCount+" Erzeuger"));
    g.addEventListener('mousemove', moveTooltip);
    g.addEventListener('mouseleave', hideTooltip);
    g.addEventListener('click', (e)=>{ e.stopPropagation(); openRegionPanel(country, name, regionObj, g); });
  });
}

/* ================= PAN / ZOOM (Länderansicht) ================= */
const zoomCtrls = document.getElementById('zoomCtrls');
let panX=0, panY=0, zoomScale=1;
const ZOOM_MIN=1, ZOOM_MAX=6;

function applyPanZoom(){
  if(!zoomG) return;
  zoomG.setAttribute('transform', `translate(${panX},${panY}) scale(${zoomScale})`);
}
function resetPanZoom(){
  panX=0; panY=0; zoomScale=1;
  applyPanZoom();
}
function svgUnitFactor(){
  const r = svg.getBoundingClientRect();
  return 1000 / r.width; // viewBox-Breite / gerenderte Breite
}
function zoomAt(clientX, clientY, factorDelta){
  if(!currentCountry) return;
  const r = svg.getBoundingClientRect();
  const u = svgUnitFactor();
  const mx = (clientX - r.left) * u;
  const my = (clientY - r.top) * u;
  const localX = (mx - panX) / zoomScale;
  const localY = (my - panY) / zoomScale;
  const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomScale * factorDelta));
  panX = mx - localX * newScale;
  panY = my - localY * newScale;
  zoomScale = newScale;
  if(zoomScale <= ZOOM_MIN){ panX=0; panY=0; zoomScale=1; }
  applyPanZoom();
}
svg.addEventListener('wheel', (e)=>{
  if(!currentCountry) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.18 : 1/1.18;
  zoomAt(e.clientX, e.clientY, delta);
}, {passive:false});

let dragging=false, dragStartX=0, dragStartY=0, panStartX=0, panStartY=0;
svg.addEventListener('mousedown', (e)=>{
  if(!currentCountry || zoomScale<=1) return;
  dragging=true; dragStartX=e.clientX; dragStartY=e.clientY; panStartX=panX; panStartY=panY;
  svg.classList.add('grabbing');
});
window.addEventListener('mousemove', (e)=>{
  if(!dragging) return;
  const u = svgUnitFactor();
  panX = panStartX + (e.clientX - dragStartX) * u;
  panY = panStartY + (e.clientY - dragStartY) * u;
  applyPanZoom();
});
window.addEventListener('mouseup', ()=>{ dragging=false; svg.classList.remove('grabbing'); });

document.getElementById('zoomIn').addEventListener('click', ()=>{
  const r = svg.getBoundingClientRect();
  zoomAt(r.left + r.width/2, r.top + r.height/2, 1.4);
});
document.getElementById('zoomOut').addEventListener('click', ()=>{
  const r = svg.getBoundingClientRect();
  zoomAt(r.left + r.width/2, r.top + r.height/2, 1/1.4);
});
document.getElementById('zoomReset').addEventListener('click', resetPanZoom);

/* ================= PANEL ================= */
const panel = document.getElementById('panel');
const backdrop = document.getElementById('backdrop');
const panelContent = document.getElementById('panelContent');
let activeZoneEl = null;

function renderProducers(producers, region, lname){
  let html = '';
  producers.forEach(p=>{
    html += `<div class="producer"><div class="producer-name">${esc(p.name)}</div>`;
    p.wines.forEach(([label,price])=>{
      const cls = lname ? 'wine-row lage-wine' : 'wine-row';
      const attrs = lname ? ` data-region="${esc(region)}" data-lage="${esc(lname)}"` : '';
      html += `<div class="${cls}"${attrs}><span class="wine-label">${esc(label)}</span><span class="wine-dots"></span><span class="wine-price">${fmtPrice(price)}</span></div>`;
    });
    html += `</div>`;
  });
  return html;
}

function openRegionPanel(country, name, regionObj, zoneEl){
  if(activeZoneEl) activeZoneEl.classList.remove('open');
  activeZoneEl = zoneEl; if(zoneEl) zoneEl.classList.add('open');

  const hasLagen = !!regionObj.lagen;
  const totalWines = hasLagen ? wineCountRegion(regionObj) : wineCountProducers(regionObj.producers);
  const totalProducers = hasLagen ? producerCountRegion(regionObj) : regionObj.producers.length;

  let html = `<div class="panel-eyebrow">${esc(country)}</div>
    <h2>${esc(name)}</h2>
    <div class="panel-meta">${totalProducers} Erzeuger · ${totalWines} Positionen</div>
    <div class="region-block">` + renderProducers(regionObj.producers);

  if(hasLagen){
    html += `<div class="lage-hint">▸ Auf einen Wein klicken, um seine Lage auf der Karte zu zeigen</div>`;
    Object.keys(regionObj.lagen).forEach(lname=>{
      html += `<div class="lage-title">${esc(lname)}</div>` + renderProducers(regionObj.lagen[lname].producers, name, lname);
    });
  }

  html += `</div>`;
  panelContent.innerHTML = html;
  panel.classList.add('show');
  backdrop.classList.add('show');

  // Umriss aller Lagen dieses Gebiets als Kontext einblenden (Füllfarbe folgt erst per Klick)
  if(hasLagen) Object.values(lageZoneEls[name]).forEach(g=> g.classList.add('context'));
}

function toggleLageFill(region, lname){
  const g = lageZoneEls[region] && lageZoneEls[region][lname];
  if(!g) return;
  const showing = g.classList.contains('show');
  g.classList.toggle('show', !showing);
  panelContent.querySelectorAll(`.wine-row.lage-wine[data-region="${CSS.escape(region)}"][data-lage="${CSS.escape(lname)}"]`)
    .forEach(row=> row.classList.toggle('active', !showing));
}

panelContent.addEventListener('click', (e)=>{
  const row = e.target.closest('.wine-row.lage-wine');
  if(!row) return;
  toggleLageFill(row.getAttribute('data-region'), row.getAttribute('data-lage'));
});

function closePanel(){
  panel.classList.remove('show');
  backdrop.classList.remove('show');
  if(activeZoneEl){ activeZoneEl.classList.remove('open'); activeZoneEl=null; }
  Object.values(lageZoneEls).forEach(byLage=> Object.values(byLage).forEach(g=> g.classList.remove('show','context')));
}
document.getElementById('panelClose').addEventListener('click', closePanel);
backdrop.addEventListener('click', closePanel);
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closePanel(); } });


/* ================= ÖFFENTLICHE SCHNITTSTELLE ================= */
const Atlas = {
  load(data, shapes, restaurant){
    resetToWorldInstant();
    DATA = data || {}; SHAPES = shapes || {};
    RESTAURANT = restaurant || { name:'', city:'' };
    buildWorld();
  },
  reset: resetToWorldInstant
};

function resetToWorldInstant(){
  closePanel(); hideTooltip();
  currentCountry = null;
  countryLayer.innerHTML = ''; countryLayer.style.opacity = '0'; countryLayer.removeAttribute('transform');
  worldLayer.removeAttribute('transform'); worldLayer.style.opacity = '1';
  backBtn.classList.remove('show'); zoomCtrls.classList.remove('show'); stage.classList.remove('zoomable');
  hintText.textContent = '▸ Land anklicken zum Heranzoomen';
}

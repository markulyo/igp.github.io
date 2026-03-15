/* ═══════════════════════════════════════════════════════════════
 *  DRAW MODE
 * ═══════════════════════════════════════════════════════════════ */
let drawMode  = false;
let drawPts   = [];
let drawMks   = [];
let drawPolys = [];
let polyCnt   = 1;
let tempSrc   = false;

function toggleDraw() {
  if (window._viewerRestricted) { toast('Drawing is not available for Viewer role', 'warn'); return; }
  drawMode = !drawMode;
  const bar  = document.getElementById('drawIndicator');
  const btn  = document.getElementById('drawBtn');
  const tbtn = document.getElementById('drawTbtn');

  if (drawMode) {
    bar.style.display = 'block';
    btn.textContent   = '✕ Cancel Draw';
    btn.classList.add('active');
    tbtn.classList.add('active');
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click',       onDrawClick);
    map.on('dblclick',    onDrawDblClick);
    map.on('contextmenu', onDrawRightClick);
  } else {
    cancelDraw();
  }
}

function cancelDraw() {
  drawMode = false;
  document.getElementById('drawIndicator').style.display = 'none';
  document.getElementById('drawBtn').textContent = '✏ Draw Polygon';
  document.getElementById('drawBtn').classList.remove('active');
  document.getElementById('drawTbtn').classList.remove('active');
  map.getCanvas().style.cursor = '';
  map.off('click',       onDrawClick);
  map.off('dblclick',    onDrawDblClick);
  map.off('contextmenu', onDrawRightClick);
  drawMks.forEach(m => m.remove()); drawMks = []; drawPts = [];
  ['tp-fill','tp-stroke','tp-line'].forEach(lid => { if (map.getLayer(lid)) map.removeLayer(lid); });
  if (map.getSource('tp-src')) map.removeSource('tp-src');
  tempSrc = false;
}

function onDrawClick(e) {
  drawPts.push([e.lngLat.lng, e.lngLat.lat]);
  const el = document.createElement('div');
  el.style.cssText = 'width:9px;height:9px;background:#0ea5e9;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(14,165,233,0.8)';
  drawMks.push(new mapboxgl.Marker({ element: el }).setLngLat([e.lngLat.lng, e.lngLat.lat]).addTo(map));
  updateTempDraw();
}

function onDrawDblClick(e) {
  e.preventDefault();
  if (drawPts.length < 3) { toast('Need at least 3 points', 'warn'); return; }
  finishPoly();
}

function onDrawRightClick(e) {
  e.preventDefault();
  if (!drawMode) return;
  if (drawPts.length < 3) { toast('Need at least 3 points to finish', 'warn'); return; }
  finishPoly();
}

function updateTempDraw() {
  if (drawPts.length < 2) return;
  const isPoly = drawPts.length >= 3;
  const geom   = isPoly
    ? { type:'Polygon',    coordinates: [[...drawPts, drawPts[0]]] }
    : { type:'LineString', coordinates: drawPts };
  const data = { type:'Feature', geometry:geom, properties:{} };

  if (!tempSrc) {
    map.addSource('tp-src', { type:'geojson', data });
    if (isPoly) {
      map.addLayer({ id:'tp-fill',   type:'fill', source:'tp-src', paint:{ 'fill-color':'#0ea5e9','fill-opacity':0.12 } });
      map.addLayer({ id:'tp-stroke', type:'line', source:'tp-src', paint:{ 'line-color':'#0ea5e9','line-width':2 } });
    } else {
      map.addLayer({ id:'tp-line', type:'line', source:'tp-src', paint:{ 'line-color':'#0ea5e9','line-width':2,'line-dasharray':[3,2] } });
    }
    tempSrc = true;
  } else {
    map.getSource('tp-src').setData(data);
    if (isPoly && !map.getLayer('tp-fill')) {
      if (map.getLayer('tp-line')) map.removeLayer('tp-line');
      map.addLayer({ id:'tp-fill',   type:'fill', source:'tp-src', paint:{ 'fill-color':'#0ea5e9','fill-opacity':0.12 } });
      map.addLayer({ id:'tp-stroke', type:'line', source:'tp-src', paint:{ 'line-color':'#0ea5e9','line-width':2 } });
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  AREA CALCULATION (Spherical Excess — WGS84)
 * ═══════════════════════════════════════════════════════════════ */
function ringAreaHa(coords) {
  // Shoelace on sphere (Girard's theorem approximation)
  const R = 6378137; // Earth radius metres
  const n = coords.length;
  if (n < 4) return 0;
  let area = 0;
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = [coords[i][0]   * Math.PI / 180, coords[i][1]   * Math.PI / 180];
    const [x2, y2] = [coords[i+1][0] * Math.PI / 180, coords[i+1][1] * Math.PI / 180];
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
  }
  const m2 = Math.abs(area * R * R / 2);
  return m2 / 10000; // hectares
}

function geomAreaHa(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') {
    return ringAreaHa(geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((s, poly) => s + ringAreaHa(poly[0]), 0);
  }
  return 0;
}

function fmtHa(ha) {
  if (ha >= 1000) return ha.toLocaleString('en-PH', {maximumFractionDigits:1}) + ' ha';
  if (ha >= 1)    return ha.toFixed(2) + ' ha';
  return (ha * 10000).toFixed(0) + ' m²';
}

function finishPoly() {
  const closed = [...drawPts, drawPts[0]];
  const name   = 'Polygon ' + polyCnt++;
  const ha     = geomAreaHa({ type:'Polygon', coordinates:[closed] });
  const feat   = { type:'Feature', geometry:{ type:'Polygon', coordinates:[closed] }, properties:{ name, area_ha: ha } };
  const sid    = 'poly-' + Date.now();

  map.addSource(sid, { type:'geojson', data: feat });
  map.addLayer({ id:sid+'-fill',   type:'fill', source:sid, paint:{ 'fill-color':'#22c55e','fill-opacity':0.18 } });
  map.addLayer({ id:sid+'-stroke', type:'line', source:sid, paint:{ 'line-color':'#22c55e','line-width':2.5 } });

  feat._sid = sid;
  drawPolys.push(feat);
  updatePolyPanel();
  cancelDraw();
  toast('"' + name + '" saved!', 'ok');
}

function deletePoly(i) {
  const p = drawPolys[i];
  if (p._sid) {
    [p._sid+'-fill', p._sid+'-stroke'].forEach(lid => { if (map.getLayer(lid)) map.removeLayer(lid); });
    if (map.getSource(p._sid)) map.removeSource(p._sid);
  }
  drawPolys.splice(i, 1);
  updatePolyPanel();
  toast('Polygon deleted', 'info');
}

function updatePolyPanel() {
  const sec = document.getElementById('polySection');
  const lst = document.getElementById('polyList');
  sec.style.display = drawPolys.length ? 'block' : 'none';
  lst.innerHTML = drawPolys.map((p,i) => {
    const ha = p.properties.area_ha || 0;
    return `<div class="poly-chip" style="align-items:flex-start">
      <span style="margin-top:2px">⬡</span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <span style="font-weight:500;color:var(--text)">${p.properties.name}</span>
        <span style="font-size:10px;color:#22c55e;font-weight:700">${fmtHa(ha)}</span>
      </div>
      <button class="chip-del" onclick="deletePoly(${i})">✕</button>
    </div>`;
  }).join('');
}

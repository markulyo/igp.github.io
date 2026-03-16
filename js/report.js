/* ═══════════════════════════════════════════════════════════════
 *  MAP REPORT
 * ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
 *  GEOMETRY INTERSECTION ENGINE
 * ═══════════════════════════════════════════════════════════════ */

/* Ray-casting point-in-polygon */
function ptInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function ptInPolygon(px, py, geom) {
  if (geom.type === 'Polygon') {
    if (!ptInRing(px, py, geom.coordinates[0])) return false;
    for (let h = 1; h < geom.coordinates.length; h++)
      if (ptInRing(px, py, geom.coordinates[h])) return false;
    return true;
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => {
      if (!ptInRing(px, py, poly[0])) return false;
      for (let h = 1; h < poly.length; h++) if (ptInRing(px, py, poly[h])) return false;
      return true;
    });
  }
  return false;
}

/* Segment intersection helpers for polygon-polygon overlap */
function segsIntersect(a1, a2, b1, b2) {
  const d1x = a2[0]-a1[0], d1y = a2[1]-a1[1];
  const d2x = b2[0]-b1[0], d2y = b2[1]-b1[1];
  const cross = d1x*d2y - d1y*d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((b1[0]-a1[0])*d2y - (b1[1]-a1[1])*d2x) / cross;
  const u = ((b1[0]-a1[0])*d1y - (b1[1]-a1[1])*d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function ringsIntersect(rA, rB) {
  for (let i = 0; i < rA.length - 1; i++)
    for (let j = 0; j < rB.length - 1; j++)
      if (segsIntersect(rA[i], rA[i+1], rB[j], rB[j+1])) return true;
  return false;
}

/* ── Spherical area of a ring in m² (Girard's theorem approximation) ────── */
/* This matches ringAreaHa but returns m² for use in overlap ratio calcs.    */
function ringArea(ring) {
  const R = 6378137; // Earth radius in metres
  const n = ring.length;
  if (n < 4) return 0;
  let area = 0;
  for (let i = 0; i < n - 1; i++) {
    const x1 = ring[i][0]   * Math.PI / 180;
    const y1 = ring[i][1]   * Math.PI / 180;
    const x2 = ring[i+1][0] * Math.PI / 180;
    const y2 = ring[i+1][1] * Math.PI / 180;
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
  }
  return Math.abs(area * R * R / 2);
}

/* ── Sutherland-Hodgman polygon clipping (one ring vs one ring) ─────────── */
function clipRingByHalfplane(ring, ex, ey, fx, fy) {
  if (!ring.length) return [];
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const da = (fx - ex) * (ay - ey) - (fy - ey) * (ax - ex);
    const db = (fx - ex) * (by - ey) - (fy - ey) * (bx - ex);
    if (da >= 0) out.push([ax, ay]);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([ax + t * (bx - ax), ay + t * (by - ay)]);
    }
  }
  return out;
}

function sutherlandHodgman(subjectRing, clipRing) {
  let output = [...subjectRing];
  for (let i = 0; i < clipRing.length; i++) {
    if (!output.length) return [];
    const [ex, ey] = clipRing[i];
    const [fx, fy] = clipRing[(i + 1) % clipRing.length];
    output = clipRingByHalfplane(output, ex, ey, fx, fy);
  }
  return output;
}

/* ── Intersection area of two simple rings ──────────────────────────────── */
// Sutherland-Hodgman requires consistent (CCW) winding order.
// We normalize both rings to CCW before clipping.
function ringSignedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += (x2 - x1) * (y2 + y1);
  }
  return s; // positive = CW in screen coords, negative = CCW
}
function ensureCCW(ring) {
  // CCW in geographic coords = negative signed area (latitude increases upward)
  return ringSignedArea(ring) > 0 ? [...ring].reverse() : ring;
}
function ringIntersectionArea(rA, rB) {
  if (!rA || !rB || rA.length < 3 || rB.length < 3) return 0;
  // Quick bbox reject
  const axs = rA.map(p => p[0]), ays = rA.map(p => p[1]);
  const bxs = rB.map(p => p[0]), bys = rB.map(p => p[1]);
  if (Math.min(...axs) > Math.max(...bxs) || Math.max(...axs) < Math.min(...bxs)) return 0;
  if (Math.min(...ays) > Math.max(...bys) || Math.max(...ays) < Math.min(...bys)) return 0;

  // Containment checks (exact)
  const sA = [0, Math.floor(rA.length / 3), Math.floor(rA.length * 2 / 3)];
  const sB = [0, Math.floor(rB.length / 3), Math.floor(rB.length * 2 / 3)];
  if (sA.every(i => ptInRing(rA[i][0], rA[i][1], rB))) return ringArea(rA);
  if (sB.every(i => ptInRing(rB[i][0], rB[i][1], rA))) return ringArea(rB);

  // Normalize winding to CCW then clip
  const nA = ensureCCW(rA), nB = ensureCCW(rB);
  const clipped = sutherlandHodgman(nA, nB);
  if (clipped.length >= 3) {
    const a = ringArea(clipped);
    if (a > 0) return a;
  }
  // Try reverse subject (handles some degenerate cases)
  const clipped2 = sutherlandHodgman(nB, nA);
  if (clipped2.length >= 3) {
    const a2 = ringArea(clipped2);
    if (a2 > 0) return a2;
  }
  return 0;
  // NOTE: We intentionally do NOT fall back to vertex-count heuristics —
  // those produce equal phantom areas across different features and were
  // the root cause of the "all values show same percentage" bug.
}
/* ── Total intersection area: site geometry vs layer geometry ───────────── */
function intersectionArea(siteGeom, layerGeom) {
  const siteRings = [];
  if (siteGeom.type === 'Polygon') siteRings.push(siteGeom.coordinates[0]);
  else if (siteGeom.type === 'MultiPolygon') siteGeom.coordinates.forEach(p => siteRings.push(p[0]));
  else return 0; // Points don't have area

  const layerRings = [];
  if (layerGeom.type === 'Polygon') layerRings.push(layerGeom.coordinates[0]);
  else if (layerGeom.type === 'MultiPolygon') layerGeom.coordinates.forEach(p => layerRings.push(p[0]));
  else return 0;

  let total = 0;
  for (const sR of siteRings)
    for (const lR of layerRings)
      total += ringIntersectionArea(sR, lR);
  return total;
}

/* ── Total area of site geometry ────────────────────────────────────────── */
function siteGeomArea(siteFeatures) {
  let total = 0;
  for (const sf of siteFeatures) {
    if (!sf.geometry) continue;
    const g = sf.geometry;
    if (g.type === 'Polygon') total += ringArea(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => { total += ringArea(p[0]); });
  }
  return total;
}

/* True geometry-vs-geometry intersection test */
function geomIntersects(siteGeom, layerGeom) {
  // Collect site rings
  const siteRings = [];
  if (siteGeom.type === 'Polygon') siteRings.push(siteGeom.coordinates[0]);
  else if (siteGeom.type === 'MultiPolygon') siteGeom.coordinates.forEach(p => siteRings.push(p[0]));
  else if (siteGeom.type === 'Point') {
    const [px, py] = siteGeom.coordinates;
    return ptInPolygon(px, py, layerGeom);
  }

  // For each site ring, test against each layer polygon
  const layerPolys = layerGeom.type === 'Polygon'
    ? [layerGeom.coordinates]
    : layerGeom.type === 'MultiPolygon'
    ? layerGeom.coordinates
    : null;
  if (!layerPolys) return false;

  for (const sRing of siteRings) {
    for (const lPoly of layerPolys) {
      const lRing = lPoly[0];
      // 1. Any site vertex inside layer polygon
      if (sRing.some(([x,y]) => ptInRing(x, y, lRing))) return true;
      // 2. Any layer vertex inside site polygon
      if (lRing.some(([x,y]) => ptInRing(x, y, sRing))) return true;
      // 3. Edge crossing
      if (ringsIntersect(sRing, lRing)) return true;
    }
  }
  return false;
}

/* ── Main overlap query: uses querySourceFeatures for real geometries ─────── */
function getOverlapAttributes(layerId, siteFeatures) {
  if (!siteFeatures || !siteFeatures.length) return null;
  const st = STATE[layerId];
  if (!st) return null;
  const srcId       = 'src-' + layerId;
  const sourceLayer = st.sourceLayer || '';

  let layerFeatures = [];
  try { layerFeatures = map.querySourceFeatures(srcId, { sourceLayer }); }
  catch(e) { return null; }
  if (!layerFeatures.length) return null;

  // Deduplicate — but MERGE rings from the same feature ID across tiles
  // (a single large polygon can appear clipped across many tiles; merging
  //  the rings gives us the full geometry for accurate area intersection)
  const fidMap  = new Map(); // fid → { lf, extraRings[] }
  const noFidFs = [];
  for (const lf of layerFeatures) {
    if (!lf.geometry) continue;
    const fid = lf.id != null ? lf.id
      : (lf.properties && (lf.properties.fid || lf.properties.id || lf.properties.OBJECTID));
    if (fid != null) {
      if (!fidMap.has(fid)) {
        fidMap.set(fid, { lf, extraRings: [] });
      } else {
        // Collect extra rings from this tile-clipped copy
        const g = lf.geometry;
        if (g.type === 'Polygon') {
          fidMap.get(fid).extraRings.push(g.coordinates[0]);
        } else if (g.type === 'MultiPolygon') {
          g.coordinates.forEach(p => fidMap.get(fid).extraRings.push(p[0]));
        }
      }
    } else {
      noFidFs.push(lf);
    }
  }

  // Build deduped list with merged geometry
  const deduped = [];
  for (const { lf, extraRings } of fidMap.values()) {
    if (extraRings.length === 0) {
      deduped.push(lf);
    } else {
      // Build a synthetic MultiPolygon merging all tile-clipped rings
      const g = lf.geometry;
      const baseRings = g.type === 'Polygon'
        ? [g.coordinates[0]]
        : g.coordinates.map(p => p[0]);
      const allRings = [...baseRings, ...extraRings];
      const merged = {
        type: 'Feature',
        id: lf.id,
        properties: lf.properties,
        geometry: {
          type: 'MultiPolygon',
          coordinates: allRings.map(r => [r])
        }
      };
      deduped.push(merged);
    }
  }
  for (const lf of noFidFs) deduped.push(lf);

  const cs         = LAYER_COLOR_STATE[layerId] || {};
  const colorField = cs.field || null;
  const SKIP       = /^(id|fid|gid|objectid|shape_area|shape_len|shape_leng|globalid|created_|last_edit|st_area|st_length)/i;

  let matchCount = 0;
  const hitLayerRings = [];

  // ── Build per-feature list with attribute keys ────────────────────────────
  const featureList = []; // { keys, rings[] }

  for (const lf of deduped) {
    const lGeom = lf.geometry;
    if (!siteFeatures.some(sf => sf.geometry && geomIntersects(sf.geometry, lGeom))) continue;
    matchCount++;

    const fRings = [];
    if (lGeom.type === 'Polygon') fRings.push(lGeom.coordinates[0]);
    else if (lGeom.type === 'MultiPolygon') lGeom.coordinates.forEach(p => fRings.push(p[0]));
    fRings.forEach(r => hitLayerRings.push(r));

    const props = lf.properties || {};
    const fields = [];
    if (colorField && props[colorField] != null) fields.push(colorField);
    for (const [k, v] of Object.entries(props)) {
      if (SKIP.test(k) || k === colorField) continue;
      if (v == null || String(v).trim() === '') continue;
      if (/^\d{7,}$/.test(String(v).trim())) continue;
      fields.push(k);
    }
    const featureKeys = [];
    for (const field of fields) {
      const raw = props[field];
      if (raw == null) continue;
      const val = String(raw).trim();
      if (!val) continue;
      featureKeys.push(field + '__SEP__' + val);
    }
    if (featureKeys.length) featureList.push({ keys: featureKeys, rings: fRings });
  }

  if (!matchCount) return null;

  // ── Site rings & total area ───────────────────────────────────────────────
  const siteRings = [];
  for (const sf of siteFeatures) {
    if (!sf.geometry) continue;
    if (sf.geometry.type === 'Polygon') siteRings.push(sf.geometry.coordinates[0]);
    else if (sf.geometry.type === 'MultiPolygon') sf.geometry.coordinates.forEach(p => siteRings.push(p[0]));
  }
  let siteTotalArea = 0;
  for (const r of siteRings) siteTotalArea += ringArea(r);

  // ── Grid-sampling intersection ────────────────────────────────────────────
  // Sample the site bounding box on a grid. For each sample inside the site,
  // find which layer value(s) it falls in. Count samples per value.
  // This completely sidesteps tile-fragment overlap / winding-order issues.

  // Compute site bbox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sRing of siteRings) {
    for (const [x, y] of sRing) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }

  // Choose grid resolution: ~50×50 = 2500 samples for speed, enough for ~2% precision
  const GRID = 60;
  const dx = (maxX - minX) / GRID;
  const dy = (maxY - minY) / GRID;

  // Collect all unique keys
  const allKeySet = new Set();
  for (const feat of featureList) feat.keys.forEach(k => allKeySet.add(k));

  const keySamples   = {}; // key → count of samples inside that key's rings
  for (const k of allKeySet) keySamples[k] = 0;
  let siteSamples    = 0; // total samples inside site polygon

  for (let i = 0; i <= GRID; i++) {
    const px = minX + (i + 0.5) * dx;
    for (let j = 0; j <= GRID; j++) {
      const py = minY + (j + 0.5) * dy;

      // Is this sample inside the site polygon?
      const inSite = siteRings.some(r => ptInRing(px, py, r));
      if (!inSite) continue;
      siteSamples++;

      // Which layer features contain this point?
      // Use the FIRST matching feature per field (priority: colorField first via featureList order)
      // to avoid double-counting a point that falls on a tile-seam overlap.
      const fieldHit = {}; // field → key already counted for this sample
      for (const feat of featureList) {
        const inFeat = feat.rings.some(r => ptInRing(px, py, r));
        if (!inFeat) continue;
        for (const k of feat.keys) {
          const field = k.split('__SEP__')[0];
          if (!fieldHit[field]) {
            fieldHit[field] = k;
            keySamples[k]++;
          }
          // If a different feature with same field already hit, skip (prevents double-count)
        }
      }
    }
  }

  // ── Convert sample counts to areas ───────────────────────────────────────
  // siteSamples maps to siteTotalArea; scale each key proportionally.
  const keyCovered = {};
  for (const k of allKeySet) {
    keyCovered[k] = siteSamples > 0
      ? (keySamples[k] / siteSamples) * siteTotalArea
      : 0;
  }

  // coveredArea: samples covered by ANY layer feature
  let coveredSamples = 0;
  // Re-scan: count samples inside site that are covered by at least one feature
  // We can derive this from keySamples grouped by field (use best field)
  const fieldSamples = {};
  for (const k of allKeySet) {
    const field = k.split('__SEP__')[0];
    fieldSamples[field] = (fieldSamples[field] || 0) + keySamples[k];
  }
  const bestFieldSamples = Math.max(0, ...Object.values(fieldSamples));
  const coveredArea = siteSamples > 0
    ? (Math.min(bestFieldSamples, siteSamples) / siteSamples) * siteTotalArea
    : 0;

  // ── Build fieldValuePcts, fieldValueM2, allFields, allValues from keyCovered ──
  const keyMeta = {};
  for (const k of allKeySet) {
    const sep = k.indexOf('__SEP__');
    keyMeta[k] = { field: k.slice(0, sep), value: k.slice(sep + 7) };
  }

  const fieldValuePcts = {};
  const fieldValueM2   = {};
  for (const [key, meta] of Object.entries(keyMeta)) {
    const { field, value } = meta;
    const m2  = keyCovered[key] || 0;
    const pct = siteTotalArea > 0 ? Math.min(100, (m2 / siteTotalArea) * 100) : 0;
    if (!fieldValuePcts[field]) fieldValuePcts[field] = {};
    if (!fieldValueM2[field])   fieldValueM2[field]   = {};
    fieldValuePcts[field][value] = (fieldValuePcts[field][value] || 0) + pct;
    fieldValueM2[field][value]   = (fieldValueM2[field][value]   || 0) + m2;
  }

  const allFields = Object.keys(fieldValuePcts);
  const allValues = [...new Set(Object.values(keyMeta).map(m => m.value))];

  const scoringField = colorField && fieldValuePcts[colorField] ? colorField
    : allFields[0];
  const valuePcts = scoringField ? { ...fieldValuePcts[scoringField] } : {};

  const overlapPct = siteTotalArea > 0
    ? Math.min(100, (coveredArea / siteTotalArea) * 100)
    : (matchCount > 0 ? 100 : 0);

  return { field: scoringField, fields: allFields, values: allValues,
           valuePcts, fieldValuePcts, fieldValueM2, count: matchCount,
           overlapPct, coveredArea, siteTotalArea };
}

/* ── Attribute detail: full table of ALL fields & values with overlap % ───── */
function buildAttrDetail(attrResult, layerMeta) {
  if (!attrResult) return '';
  const { fields, fieldValuePcts, fieldValueM2, count, coveredArea, siteTotalArea } = attrResult;
  const fvp  = fieldValuePcts || {};
  const fvm2 = fieldValueM2   || {};
  const coveredHa = coveredArea ? (coveredArea / 10000).toFixed(2) : null;
  const siteHa    = siteTotalArea ? (siteTotalArea / 10000).toFixed(2) : null;
  const areaLine  = (coveredHa && siteHa)
    ? (' \u00b7 ' + coveredHa + '\u00a0ha overlapping / ' + siteHa + '\u00a0ha site')
    : '';
  if (!fields || !fields.length)
    return '<div style="margin-top:6px;font-size:10px;color:var(--muted)">' + count + ' feature(s) intersected \u2014 no readable attributes' + areaLine + '</div>';

  const cs = LAYER_COLOR_STATE[layerMeta._id] || {};
  const blocks = (fields || []).map(function(field) {
    const vmap     = fvp[field] || {};
    const colorMap = cs.valueMap && cs.valueMap[field] ? cs.valueMap[field] : {};
    const entries  = Object.entries(vmap).sort(function(a, b) { return b[1] - a[1]; });
    if (!entries.length) return '';
    const rows = entries.map(function(pair) {
      const val  = pair[0];
      const pct  = pair[1];
      const col  = colorMap[val] || '#64748b';
      const barW = Math.min(100, pct).toFixed(1);
      // Use actual intersection area from fieldValueM2; fall back to back-calculation only if missing
      const actualM2 = (fvm2[field] && fvm2[field][val] != null)
        ? fvm2[field][val]
        : (siteTotalArea ? (pct / 100) * siteTotalArea : 0);
      const aHa  = (actualM2 / 10000).toFixed(2);
      return '<tr>'
        + '<td style="padding:3px 6px;border:1px solid var(--border);vertical-align:middle">'
        + '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + col + ';border:1px solid rgba(0,0,0,0.25);vertical-align:middle"></span></td>'
        + '<td style="padding:3px 8px;border:1px solid var(--border);font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + val + '">' + val + '</td>'
        + '<td style="padding:3px 8px;border:1px solid var(--border);font-size:10px;white-space:nowrap;text-align:right;font-weight:700;color:var(--accent2)">' + pct.toFixed(1) + '%</td>'
        + '<td style="padding:3px 8px;border:1px solid var(--border);font-size:10px;color:var(--muted);white-space:nowrap;text-align:right">' + aHa + ' ha</td>'
        + '<td style="padding:3px 8px;border:1px solid var(--border);min-width:70px">'
        + '<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">'
        + '<div style="width:' + barW + '%;height:100%;background:' + col + ';border-radius:3px"></div>'
        + '</div></td>'
        + '</tr>';
    }).join('');
    return '<div style="margin-top:7px">'
      + '<div style="font-size:9px;color:var(--accent2);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">\uD83D\uDCCB ' + field + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:10px">'
      + '<thead><tr style="background:rgba(255,255,255,0.04)">'
      + '<th style="padding:3px 6px;border:1px solid var(--border);font-size:9px;color:var(--muted)"></th>'
      + '<th style="padding:3px 8px;border:1px solid var(--border);text-align:left;font-size:9px;color:var(--muted)">Value</th>'
      + '<th style="padding:3px 8px;border:1px solid var(--border);text-align:right;font-size:9px;color:var(--muted)">% of Site</th>'
      + '<th style="padding:3px 8px;border:1px solid var(--border);text-align:right;font-size:9px;color:var(--muted)">Area</th>'
      + '<th style="padding:3px 8px;border:1px solid var(--border);font-size:9px;color:var(--muted)">Coverage</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>';
  }).filter(Boolean).join('');

  return '<div style="margin-top:6px">'
    + '<span style="font-size:10px;color:var(--muted)">' + count + ' feature(s) intersected' + areaLine + '</span>'
    + blocks
    + '</div>';
}


/* ── Build full color-coded legend table for all active layers (for PDF export) */
function buildPrintLegend(active) {
  if (!active.length) return '';

  const dimInfo = {
    A: { label: 'DIM A — Technical Suitability',  color: '#22c55e' },
    B: { label: 'DIM B — Environmental Safety',   color: '#f59e0b' },
    C: { label: 'DIM C — Governance & Land Use',  color: '#0ea5e9' },
  };

  let html = '';
  ['A','B','C'].forEach(dim => {
    const dimLayers = active.filter(id => LAYER_META[id].dim === dim);
    if (!dimLayers.length) return;

    const info = dimInfo[dim];
    html += `<div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.6px;color:${info.color};text-transform:uppercase;margin-bottom:6px;padding-bottom:3px;border-bottom:2px solid ${info.color}30">${info.label}</div>`;

    dimLayers.forEach(id => {
      const cs = LAYER_COLOR_STATE[id];
      const meta = LAYER_META[id];
      if (!cs || !cs.field || !cs.valueMap[cs.field]) {
        // No color coding — just show the layer name
        html += `<div style="font-size:11px;padding:4px 0;color:var(--muted)">● ${meta.name} — no attribute classification active</div>`;
        return;
      }

      const field = cs.field;
      const colorMap = cs.valueMap[field];
      const entries = Object.entries(colorMap);
      if (!entries.length) return;

      html += `<div style="margin-bottom:8px">
        <div style="font-size:11px;font-weight:600;margin-bottom:4px">
          ${meta.name}
          <span style="font-size:9px;font-weight:400;color:var(--muted);margin-left:6px">field: ${field}</span>
        </div>
        <table class="print-legend-table" style="border-collapse:collapse;width:100%;font-size:10px;margin-bottom:2px">
          <thead>
            <tr>
              <th style="background:#f0f0f0;border:1px solid #ddd;padding:4px 8px;text-align:left;width:28px"></th>
              <th style="background:#f0f0f0;border:1px solid #ddd;padding:4px 8px;text-align:left">Category / Value</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(([val, col]) => `
            <tr>
              <td style="border:1px solid #ddd;padding:4px 8px;text-align:center">
                <span class="print-legend-swatch" style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${col};-webkit-print-color-adjust:exact;print-color-adjust:exact;border:1px solid rgba(0,0,0,0.15)"></span>
              </td>
              <td style="border:1px solid #ddd;padding:4px 8px">${val}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    });

    html += `</div>`;
  });

  return html ? `<div class="rpt-section">
    <div class="rpt-section-title">🎨 Layer Attribute Legend</div>
    ${html}
  </div>` : '';
}

function getMarkerPixel(lng, lat) {
  // Returns a tiny 4px bbox around the marker's screen pixel for queryRenderedFeatures
  const pt = map.project([lng, lat]);
  const r = 4;
  const canvas = map.getCanvas();
  return [
    Math.max(0, pt.x - r), Math.max(0, pt.y - r),
    Math.min(canvas.width, pt.x + r), Math.min(canvas.height, pt.y + r)
  ];
}

function getMarkerOverlap(layerId, lng, lat) {
  // Query a small bbox around the exact marker pixel
  const fillLyr = 'lyr-' + layerId + '-fill';
  const lineLyr = 'lyr-' + layerId;
  const lyrToQuery = map.getLayer(fillLyr) ? fillLyr : map.getLayer(lineLyr) ? lineLyr : null;
  if (!lyrToQuery) return null;

  const bbox = getMarkerPixel(lng, lat);
  const features = map.queryRenderedFeatures([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { layers: [lyrToQuery] });
  if (!features || !features.length) return null;

  const cs = LAYER_COLOR_STATE[layerId];
  const colorField = cs && cs.field ? cs.field : null;

  if (colorField) {
    const vals = [...new Set(features.map(f => f.properties[colorField]).filter(v => v != null).map(v => String(v)))];
    return { field: colorField, values: vals, count: features.length };
  }
  // Fallback: first feature's readable props
  const firstProps = features[0].properties || {};
  const keyEntries = Object.entries(firstProps).filter(([k]) => !/^(id|fid|gid|objectid|shape_)/i.test(k)).slice(0, 4).map(([k, v]) => k + ': ' + v);
  return { field: null, values: keyEntries, count: features.length };
}

function buildMarkerOverlapSection(active) {
  if (!placedMarkers.length || !active.length) return '';

  const rows = placedMarkers.map(m => {
    const layerResults = active.map(id => {
      const res = getMarkerOverlap(id, m.lng, m.lat);
      if (!res || !res.values.length) return null;
      const cs = LAYER_COLOR_STATE[id];
      const colorMap = cs && res.field && cs.valueMap[res.field] ? cs.valueMap[res.field] : {};
      const chips = res.values.slice(0, 8).map(v => {
        const col = colorMap[v] || '#64748b';
        return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:1px 6px;margin:2px 2px 0 0;font-size:10px">
          <span style="width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0;display:inline-block"></span>${v}
        </span>`;
      }).join('');
      const fieldLabel = res.field
        ? `<span style="font-size:10px;color:var(--accent2);font-weight:600">${res.field}</span>`
        : `<span style="font-size:10px;color:var(--muted)">attributes</span>`;
      return `<div style="margin-bottom:7px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border)">
        <div style="font-size:10px;color:var(--muted);margin-bottom:3px">
          <span style="color:var(--text2);font-weight:600">${LAYER_META[id].name}</span>
          &nbsp;·&nbsp;Field: ${fieldLabel}
        </div>
        <div>${chips}</div>
      </div>`;
    }).filter(Boolean).join('');

    if (!layerResults) return `<div style="margin-bottom:10px;padding:8px 10px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span>📍</span>
        <strong style="font-size:12px">${m.name}</strong>
        <span style="font-size:10px;color:#8b5cf6">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted)">No layer features detected at this location — ensure the map is zoomed to this marker.</div>
    </div>`;

    return `<div style="margin-bottom:12px;padding:8px 10px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);border-radius:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span>📍</span>
        <strong style="font-size:12px">${m.name}</strong>
        <span style="font-size:10px;color:#8b5cf6">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span>
      </div>
      ${layerResults}
    </div>`;
  }).join('');

  return `<div class="rpt-section">
    <div class="rpt-section-title">📍 Marker Layer Overlap Detail</div>
    ${rows}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
 *  SCORECARD — IGP Project Site Evaluation & De-Confliction
 * ═══════════════════════════════════════════════════════════════ */

// Scoring rubric: score → label + color
function scoreMeta(score) {
  if (score >= 100) return { label: 'Highly Suitable',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.35)' };
  if (score >= 50)  return { label: 'Moderately Suitable',color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' };
  return               { label: 'Low Suitability',        color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.35)' };
}

function finalScoreMeta(score) {
  if (score > 70)  return { label: 'Highly Suitable',     color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  border: '#22c55e' };
  if (score >= 40) return { label: 'Moderately Suitable', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: '#f59e0b' };
  return                  { label: 'Not Suitable',        color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  border: '#ef4444' };
}

// Map layer IDs to scorecard criteria with weights
const SCORECARD_CRITERIA = {
  A: { // Technical Suitability — dim weight 0.295116
    dimWeight: 0.295116,
    label: 'Technical Suitability',
    color: 'var(--dim-a)',
    items: [
      { id: 'groundwater', label: 'Groundwater Map',        weight: 0.204286 },
      { id: 'climate',     label: 'Climate Type',           weight: 0.159491 },
      { id: 'landcover',   label: 'Land Cover',             weight: 0.101294 },
      { id: 'soil',        label: 'Soil Factors',           weight: 0.256696 },
      { id: 'pia',         label: 'Potential Irrigable Area',weight: 0.278233 },
    ]
  },
  B: { // Environmental Safety — dim weight 0.291456
    dimWeight: 0.291456,
    label: 'Environmental Safety',
    color: 'var(--dim-b)',
    items: [
      { id: 'protected',   label: 'Protected Areas (NIPAS)',  weight: 0.386487 },
      { id: 'flood',       label: 'Flood Susceptibility',     weight: 0.277699 },
      { id: 'landslide',   label: 'Landslide Susceptibility', weight: 0.183206 },
      { id: 'fault',       label: 'Fault Line',               weight: 0.152608 },
    ]
  },
  C: { // Governance & De-confliction — dim weight 0.413428
    dimWeight: 0.413428,
    label: 'Governance & De-confliction',
    color: 'var(--dim-c)',
    items: [
      { id: 'irrigation',  label: 'Existing Irrigation Systems', weight: 0.314747 },
      { id: 'cadt',        label: 'CADT',                        weight: 0.297610 },
      { id: 'npaaad',      label: 'NPAAAD',                      weight: 0.216952 },
      { id: 'safdz',       label: 'SAFDZ',                       weight: 0.170691 },
    ]
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  SCORING GUIDE — IGP Scoring Guide (all 13 layers)
//  Primary: attribute VALUE keywords → score per the rubric
//  When multiple values overlap the site (e.g. 60% Shallow+Deep, 40% Deep Well),
//  compute a WEIGHTED AVERAGE score using each value's overlap % of site area.
//  If no attribute value is recognizable, fall back to total overlap %.
// ═══════════════════════════════════════════════════════════════════════════

// Map each layer's attribute values to rubric scores
const ATTR_SCORE_MAP = {
  groundwater: [
    { score:100, keys:['shallow and deep', 'shallow & deep', 'shallow well'] },
    { score: 50, keys:['deep well', 'deep-well', 'deepwell'] },
    { score: 10, keys:['difficult', 'saltwater', 'salt water', 'intrusion'] },
  ],
  climate: [
    { score:100, keys:['type i', 'type 1', 'type-i', 'type-1', '1'] },
    { score: 50, keys:['type ii', 'type iii', 'type iv', 'type 2', 'type 3', '3', 'type 4', 'type-ii', 'type-iii', 'type-iv'] },
    { score: 10, keys:['type iv', 'type 4', 'type-iv'] }, // Type IV alone = 10
  ],
  landcover: [
    { score:100, keys:['annual crop', 'annual crops', 'ricefield', 'rice field', 'rice', 'corn', 'vegetable'] },
    { score: 50, keys:['grassland', 'open/barren', 'open barren', 'barren', 'brush', 'shrub', 'perennial crop', 'perennial'] },
    { score: 10, keys:['open forest', 'fishpond', 'built-up', 'built up', 'builtup', 'closed forest', 'mangrove', 'marshland', 'swamp', 'inland water', 'water body'] },
  ],
  soil: [
    { score:100, keys:['clay loam', 'silty clay', 'clay'] },
    { score: 50, keys:['loam', 'silt loam', 'sandy loam', 'silt'] },
    { score: 10, keys:['beach sand', 'river wash', 'complex', 'gravelly', 'hydrosol', 'loamy sand', 'mountainous'] },
  ],
  pia: [
    { score:100, keys:['0', '0-3', '0 - 3', 'flat', 'level', 'slope 0', '0%', '1%', '2%', '3%'] },
    { score: 50, keys:['3-8', '3 - 8', 'gently', 'undulating', '4%', '5%', '6%', '7%', '8%'] },
    { score: 10, keys:['outside', 'beyond', 'not irrigable', 'non-irrigable'] },
  ],
  protected: [
    { score:100, keys:['outside', 'non-nipas', 'non nipas'] },
    { score: 50, keys:['buffer', 'multiple use', 'multiple-use', 'multipleuse', 'fringe'] },
    { score: 10, keys:['strict', 'national park', 'wildlife sanctuary', 'mangrove reserve', 'within nipas', 'nipas'] },
  ],
  flood: [
    { score:100, keys:['low'] },
    { score: 50, keys:['moderate', 'medium'] },
    { score: 10, keys:['high'] },
  ],
  landslide: [
    { score:100, keys:['low'] },
    { score: 50, keys:['moderate', 'medium'] },
    { score: 10, keys:['high'] },
  ],
  fault: [
    { score:100, keys:['outside', 'non-fault', 'no fault'] },
    { score: 50, keys:['buffer', 'buffer zone', 'fringe', 'near'] },
    { score: 10, keys:['within', 'active fault', 'fault zone', 'fault line', 'fault'] },
  ],
  irrigation: [
    { score:100, keys:['outside', 'unserved', 'no irrigation'] },
    { score: 50, keys:['expansion', 'fringe', 'extension', 'adjacent'] },
    { score: 10, keys:['within', 'existing', 'served', 'operational', 'nip', 'nis', 'cip', 'sp', 'pip'] },
  ],
  cadt: [
    { score:100, keys:['outside', 'non-cadt', 'no cadt'] },
    { score: 50, keys:['with clearance', 'with fpic', 'clearance', 'endorsed', 'approved'] },
    { score: 10, keys:['within', 'no fpic', 'without fpic', 'cadt', 'ancestral'] },
  ],
  npaaad: [
    { score:100, keys:['alluvial', 'agro-industrial', 'agroindustrial', 'agro industrial'] },
    { score: 50, keys:['highland', '500m', 'semi-temperate', 'semitemperate'] },
    { score: 10, keys:['irrigated','served', 'fragile', 'incompatible', 'forest', 'watershed', 'built-up', 'quarry', 'water body', 'fishery'] },
  ],
  safdz: [
    { score:100, keys:['strategic crop', 'crop subdevelopment', 'crop zone', 'crop development'] },
    { score: 50, keys:['livestock', 'integrated crop', 'agro-forestry', 'agroforestry', 'remaining npaaad'] },
    { score: 10, keys:['fishery', 'watershed', 'forestry', 'integrated fishery'] },
  ],
};

function scoreForValue(layerId, valStr) {
  const rules = ATTR_SCORE_MAP[layerId];
  if (!rules) return null;
  const v = valStr.toLowerCase().trim();
  // Special: climate Type IV is 10, but Type III & IV are both 50 in the rubric
  // Process in order: check score=10 first for climate to handle Type IV correctly
  if (layerId === 'climate') {
    if (/type[\s\-]?iv|type[\s\-]?4/i.test(v)) return 10;
    if (/type[\s\-]?i(?!i|v)|type[\s\-]?1/i.test(v)) return 100;
    if (/type[\s\-]?ii|type[\s\-]?iii|type[\s\-]?2|type[\s\-]?3/i.test(v)) return 50;
    return null;
  }
  for (const rule of rules) {
    if (rule.keys.some(k => v.includes(k))) return rule.score;
  }
  return null;
}

function deriveSuitabilityScore(layerId, hasOverlap, attrResult) {
  const pct       = attrResult?.overlapPct ?? 0;
  const valuePcts = attrResult?.valuePcts       || {};
  const values    = attrResult?.values          || [];

  if (!hasOverlap || pct < 0.1) {
    if (['fault','flood','landslide','protected','cadt'].includes(layerId)) return 100;
    if (['irrigation','npaaad','safdz'].includes(layerId)) return 100;
    return 10;
  }

  // Weighted average by area %
  let wSum = 0, wTot = 0;
  for (const [val, w] of Object.entries(valuePcts)) {
    if (w <= 0) continue;
    const s = scoreForValue(layerId, val);
    if (s === null) continue;
    wSum += s * w; wTot += w;
  }
  if (wTot > 0) {
    const avg = wSum / wTot;
    if (avg >= 75) return 100;
    if (avg >= 30) return 50;
    return 10;
  }

  // Fallback: equal weight per recognized value
  let fs = 0, ft = 0;
  for (const val of values) {
    const s = scoreForValue(layerId, val);
    if (s === null) continue;
    fs += s; ft++;
  }
  if (ft > 0) {
    const avg = fs / ft;
    if (avg >= 75) return 100;
    if (avg >= 30) return 50;
    return 10;
  }

  // Heuristic fallback on overlap %
  const isHazard = ['fault','flood','landslide','protected','cadt','npaaad','safdz','irrigation'].includes(layerId);
  if (isHazard) { if (pct > 50) return 10; if (pct > 10) return 50; return 100; }
  if (pct > 60) return 100; if (pct > 10) return 50; return 10;
}

function buildScorecardSection(active, siteFeatures, overlapCache) {
  overlapCache = overlapCache || {};
  if (!siteFeatures.length || !active.length) return '';

  // Section A — Exclusionary Screening
  const sectionAChecks = [
    { id: 'irrigation', q: 'Does the proposed area overlap with an existing NIA, DA, or LGU irrigation service area?' },
    { id: 'pia',        q: 'Is the proposed site located outside the established Potential Irrigable Area boundaries?' },
    { id: 'protected',  q: 'Is the project located inside a legally protected biodiversity/conservation zone (NIPAS)?' },
    { id: 'cadt',       q: 'Is the site inside a CADT without an existing Free and Prior Informed Consent (FPIC)?' },
  ];

  let anyRestricted = false;
  const sectionAHtml = sectionAChecks.map(chk => {
    if (!active.includes(chk.id)) {
      return `<tr>
        <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">${chk.q}</td>
        <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;color:var(--muted)">—</td>
        <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;color:var(--muted)">—</td>
        <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);color:var(--muted)">Layer not active</td>
      </tr>`;
    }
    const attrResult = (overlapCache[chk.id] !== undefined) ? overlapCache[chk.id] : (siteFeatures.length ? getOverlapAttributes(chk.id, siteFeatures) : null);
    const hasOverlap = attrResult !== null;
    // For PIA: being OUTSIDE is the risk (no overlap = outside = YES risk)
    const isRestricted = chk.id === 'pia' ? !hasOverlap : hasOverlap;
    if (isRestricted) anyRestricted = true;
    return `<tr style="background:${isRestricted ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.05)'}">
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">${chk.q}</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;font-weight:700;color:${isRestricted ? '#ef4444' : 'var(--muted)'}">${isRestricted ? '✓' : ''}</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;font-weight:700;color:${!isRestricted ? '#22c55e' : 'var(--muted)'}">${!isRestricted ? '✓' : ''}</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">
        ${hasOverlap && attrResult
          ? `<span style="font-size:10px;font-weight:700;color:${isRestricted?'#ef4444':'#22c55e'}">${(attrResult.overlapPct||0).toFixed(1)}% overlap</span>`
            + buildAttrDetail(attrResult, { ...LAYER_META[chk.id], _id: chk.id })
          : '<span style="color:var(--muted);font-size:10px">No overlap detected</span>'}
      </td>
    </tr>`;
  }).join('');

  const restrictedBanner = anyRestricted
    ? `<div style="margin-bottom:10px;padding:8px 12px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:6px;font-size:11px;color:#ef4444;font-weight:600">⛔ RESTRICTED — One or more exclusionary criteria triggered. Project cannot proceed to Section B.</div>`
    : `<div style="margin-bottom:10px;padding:8px 12px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:6px;font-size:11px;color:#22c55e;font-weight:600">✅ PASSED — No exclusionary criteria triggered. Proceed to Section B.</div>`;

  // Section B — Suitability Scoring
  let grandTotal = 0;
  const dimResults = {};

  const sectionBHtml = ['A','B','C'].map(dim => {
    const cfg = SCORECARD_CRITERIA[dim];
    let dimTotal = 0;
    let scoredCount = 0;

    const rows = cfg.items.map(item => {
      if (!active.includes(item.id)) {
        return `<tr>
          <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">${item.label}</td>
          <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;color:var(--muted)">—</td>
          <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;color:var(--muted)">${(item.weight*100).toFixed(1)}%</td>
          <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;color:var(--muted)">—</td>
          <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);color:var(--muted)">Layer not active</td>
        </tr>`;
      }

      const attrResult = (overlapCache[item.id] !== undefined) ? overlapCache[item.id] : (siteFeatures.length ? getOverlapAttributes(item.id, siteFeatures) : null);
      const hasOverlap = attrResult !== null;
      const score = deriveSuitabilityScore(item.id, hasOverlap, attrResult);
      const points = score * item.weight;
      dimTotal += points;
      scoredCount++;
      const sm = scoreMeta(score);

      const pct             = attrResult ? (attrResult.overlapPct    || 0)  : 0;
      const fieldValuePcts  = attrResult ? (attrResult.fieldValuePcts || {}) : {};
      const fieldValueM2Sc  = attrResult ? (attrResult.fieldValueM2   || {}) : {};
      const siteTotalAreaSc = attrResult ? (attrResult.siteTotalArea  || 0)  : 0;
      const cs_sc           = LAYER_COLOR_STATE[item.id] || {};

      // Build full attribute breakdown table (ALL values, no threshold)
      const fieldBreakdown = Object.entries(fieldValuePcts).map(function(fEntry) {
        const field    = fEntry[0];
        const vmap     = fEntry[1];
        const colorMap = cs_sc.valueMap && cs_sc.valueMap[field] ? cs_sc.valueMap[field] : {};
        const entries  = Object.entries(vmap).sort(function(a,b){ return b[1]-a[1]; });
        if (!entries.length) return '';
        const rows = entries.map(function(pair) {
          const val   = pair[0];
          const vpct  = pair[1];
          const col   = colorMap[val] || '#64748b';
          const vs    = scoreForValue(item.id, val);
          const vc    = vs === 100 ? '#22c55e' : vs === 50 ? '#f59e0b' : vs === 10 ? '#ef4444' : col;
          const barW  = Math.min(100, vpct).toFixed(1);
          // Use actual intersection area from fieldValueM2Sc; fall back to back-calculation only if missing
          const actualM2Sc = (fieldValueM2Sc[field] && fieldValueM2Sc[field][val] != null)
            ? fieldValueM2Sc[field][val]
            : (siteTotalAreaSc ? (vpct / 100) * siteTotalAreaSc : 0);
          const areaM2 = actualM2Sc;
          const aHa   = (areaM2 / 10000).toFixed(2);
          return '<tr>'
            + '<td style="padding:2px 5px;border:1px solid var(--border);vertical-align:middle">'
            + '<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + col + ';border:1px solid rgba(0,0,0,0.25);vertical-align:middle"></span></td>'
            + '<td style="padding:2px 7px;border:1px solid var(--border);font-size:9px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + val + '">' + val + '</td>'
            + '<td style="padding:2px 7px;border:1px solid var(--border);font-size:9px;text-align:right;font-weight:700;color:' + vc + '">' + vpct.toFixed(1) + '%</td>'
            + '<td style="padding:2px 7px;border:1px solid var(--border);font-size:9px;color:var(--muted);text-align:right">' + aHa + ' ha</td>'
            + '<td style="padding:2px 7px;border:1px solid var(--border);min-width:55px">'
            + '<div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">'
            + '<div style="width:' + barW + '%;height:100%;background:' + vc + ';border-radius:3px"></div>'
            + '</div></td>'
            + '</tr>';
        }).join('');
        return '<div style="margin-top:4px">'
          + '<div style="font-size:9px;color:var(--accent2);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">' + field + '</div>'
          + '<table style="width:100%;border-collapse:collapse">'
          + '<thead><tr style="background:rgba(255,255,255,0.03)">'
          + '<th style="padding:2px 5px;border:1px solid var(--border);font-size:8px;color:var(--muted)"></th>'
          + '<th style="padding:2px 7px;border:1px solid var(--border);text-align:left;font-size:8px;color:var(--muted)">Value</th>'
          + '<th style="padding:2px 7px;border:1px solid var(--border);text-align:right;font-size:8px;color:var(--muted)">% Site</th>'
          + '<th style="padding:2px 7px;border:1px solid var(--border);text-align:right;font-size:8px;color:var(--muted)">Area</th>'
          + '<th style="padding:2px 7px;border:1px solid var(--border);font-size:8px;color:var(--muted)">Coverage</th>'
          + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
      }).filter(Boolean).join('');

      const pctBar = '<div style="margin-top:4px">'
        + '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">'
        + '<div style="flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">'
        + '<div style="width:' + Math.min(100,pct).toFixed(1) + '%;height:100%;background:' + sm.color + ';border-radius:3px"></div>'
        + '</div>'
        + '<span style="font-size:10px;font-weight:700;color:' + sm.color + ';min-width:48px">' + pct.toFixed(1) + '% site</span>'
        + '</div>'
        + (!hasOverlap && active.includes(item.id) ? '<span style="font-size:9px;color:var(--muted)">No overlap detected (0.0% of site area)</span>' : '')
        + (fieldBreakdown || '')
        + '</div>';
      return '<tr>'
        + '<td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">' + item.label + '</td>'
        + '<td style="padding:5px 8px;font-size:12px;border:1px solid var(--border);text-align:center;font-weight:700;color:' + sm.color + '">' + score + '</td>'
        + '<td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center">' + (item.weight*100).toFixed(1) + '%</td>'
        + '<td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;font-weight:600">' + points.toFixed(2) + '</td>'
        + '<td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">'
        + '<span style="display:inline-flex;align-items:center;gap:4px;background:' + sm.bg + ';border:1px solid ' + sm.border + ';border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;color:' + sm.color + '">' + sm.label + '</span>'
        + pctBar
        + '</td>'
        + '</tr>';
    }).join('');

    const dimScore = scoredCount > 0 ? dimTotal : 0;
    const dimFinal = dimScore * cfg.dimWeight;
    dimResults[dim] = { score: dimScore, weighted: dimFinal, label: cfg.label };
    grandTotal += dimFinal;

    const dm = finalScoreMeta(dimScore);

    return `<div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.6px;color:${cfg.color};text-transform:uppercase;margin-bottom:6px;padding:5px 10px;background:rgba(255,255,255,0.04);border-radius:4px;border-left:3px solid ${cfg.color}">
        DIM ${dim} — ${cfg.label}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr style="background:rgba(255,255,255,0.05)">
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:left;font-size:10px;width:30%">Criterion</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px;width:10%">Score (b)</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px;width:12%">Weight (c)</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px;width:12%">Points (b×c)</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:left;font-size:10px">Assessment</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:rgba(255,255,255,0.06);font-weight:700">
            <td style="padding:5px 8px;border:1px solid var(--border);font-size:11px">Total Score</td>
            <td style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:12px;color:${dm.color}">${dimScore.toFixed(2)}</td>
            <td style="padding:5px 8px;border:1px solid var(--border);text-align:center">${(cfg.dimWeight*100).toFixed(1)}%</td>
            <td style="padding:5px 8px;border:1px solid var(--border);text-align:center">${dimFinal.toFixed(2)}</td>
            <td style="padding:5px 8px;border:1px solid var(--border)">
              <span style="display:inline-flex;align-items:center;gap:4px;background:${dm.bg};border:1px solid ${dm.border};border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;color:${dm.color}">Result: ${dm.label}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }).join('');

  // Final summary
  // IGP rule: ANY Section A trigger → final result is always Not Suitable
  const fm = anyRestricted
    ? { label: 'Not Suitable — RESTRICTED', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', border: '#ef4444' }
    : finalScoreMeta(grandTotal);
  const summaryRows = ['A','B','C'].map(dim => {
    const d = dimResults[dim];
    const dm = finalScoreMeta(d.score);
    return `<tr>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border)">${d.label}</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;font-weight:700;color:${dm.color}">${d.score.toFixed(2)}</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center">${(SCORECARD_CRITERIA[dim].dimWeight*100).toFixed(1)}%</td>
      <td style="padding:5px 8px;font-size:11px;border:1px solid var(--border);text-align:center;font-weight:700">${d.weighted.toFixed(2)}</td>
    </tr>`;
  }).join('');

  return `<div class="rpt-section">
    <div class="rpt-section-title">📋 IGP Project Site Evaluation & De-Confliction Scorecard</div>

    <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;padding:4px 0;border-bottom:1px solid var(--border)">
      SECTION A — Preliminary Exclusionary Screening
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:8px">
      Verify the proposed project against IGP constraint layers. If ANY answer is "YES", the project is automatically flagged as <strong style="color:#ef4444">RESTRICTED</strong>.
    </div>
    ${restrictedBanner}
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px">
      <thead>
        <tr style="background:rgba(255,255,255,0.05)">
          <th style="padding:5px 8px;border:1px solid var(--border);text-align:left;font-size:10px;width:55%">Screening Criterion</th>
          <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px;width:8%">YES</th>
          <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px;width:8%">NO</th>
          <th style="padding:5px 8px;border:1px solid var(--border);text-align:left;font-size:10px">Detected Values</th>
        </tr>
      </thead>
      <tbody>${sectionAHtml}</tbody>
    </table>

    <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px;padding:4px 0;border-bottom:1px solid var(--border)">
      SECTION B — Suitability Scoring Evaluation
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:10px">
      Scores: <strong style="color:#22c55e">100</strong> = Highly Suitable &nbsp;·&nbsp;
      <strong style="color:#f59e0b">50</strong> = Moderately Suitable &nbsp;·&nbsp;
      <strong style="color:#ef4444">10</strong> = Low Suitability / High Constraint
    </div>
    ${sectionBHtml}

    <div style="margin-top:8px;padding:12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:8px">Summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead>
          <tr style="background:rgba(255,255,255,0.05)">
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:left;font-size:10px">Global Criteria</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px">Score</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px">Weight</th>
            <th style="padding:5px 8px;border:1px solid var(--border);text-align:center;font-size:10px">Total Points</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${fm.bg};border:2px solid ${fm.border};border-radius:8px">
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${fm.color}">FINAL IGP PROJECT SCORE</div>
        <div style="display:flex;align-items:center;gap:12px">
          ${anyRestricted
            ? `<span style="font-size:13px;color:rgba(239,68,68,0.45);text-decoration:line-through;font-weight:700">${grandTotal.toFixed(2)}</span>`
            : `<div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:${fm.color}">${grandTotal.toFixed(2)}</div>`}
          <div style="font-size:11px;font-weight:700;color:${fm.color};background:${fm.bg};border:1px solid ${fm.border};border-radius:6px;padding:4px 10px">${fm.label}</div>
        </div>
      </div>
      ${anyRestricted
        ? `<div style="margin-top:6px;padding:6px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:6px;font-size:10px;color:#ef4444;font-weight:600">
            ⛔ Section A exclusionary criteria triggered — final result is <strong>Not Suitable</strong> regardless of Section B score.
           </div>`
        : ""}
      <div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:right">
        Scale: &lt;40 = Not Suitable &nbsp;·&nbsp; 40–70 = Moderately Suitable &nbsp;·&nbsp; &gt;70 = Highly Suitable
      </div>
    </div>
  </div>`;
}

function openReport() {
  if (window._viewerRestricted) { toast('Report generation is not available for Viewer role', 'warn'); return; }
  const body = document.getElementById('reportBody');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted)">⏳ Loading tile data for overlap analysis…</div>';
  document.getElementById('reportModal').classList.add('show');

  // ── Collect all polygon site features ─────────────────────────────────────
  const polyFeatures = [
    ...uploadedKMLs.flatMap(k => k.features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))),
    ...drawPolys.filter(p => p.geometry && (p.geometry.type === 'Polygon' || p.geometry.type === 'MultiPolygon'))
  ];

  // ── Compute bounding box of all site polygons ──────────────────────────────
  function getSiteBbox(features) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]]
                  : f.geometry.coordinates.map(p => p[0]);
      for (const ring of rings) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    return (minLng === Infinity) ? null : [[minLng, minLat], [maxLng, maxLat]];
  }

  function _runReport() {
    const now     = new Date();
    const active  = LAYER_IDS.filter(id => STATE[id].visible);
    const dimA    = active.filter(id => LAYER_META[id].dim === 'A');
    const dimB    = active.filter(id => LAYER_META[id].dim === 'B');
    const dimC    = active.filter(id => LAYER_META[id].dim === 'C');
    const hasData = uploadedKMLs.length > 0 || drawPolys.length > 0 || placedMarkers.length > 0;
    const siteFeatures = [
      ...uploadedKMLs.flatMap(k => k.features),
      ...drawPolys,
      ...placedMarkers.map(m => ({ type:'Feature', geometry:{ type:'Point', coordinates:[m.lng,m.lat] }, properties:{ name:m.name } }))
    ];
    const overlapCache = {};
    if (hasData && siteFeatures.length)
      for (const id of active) overlapCache[id] = getOverlapAttributes(id, siteFeatures);

    const CHECKS = [
      { id:'groundwater', dim:'A', cls:'val-ok',   icon:'💧', title:'Groundwater Map',            body:'Groundwater data intersects the site area.' },
      { id:'climate',     dim:'A', cls:'val-ok',   icon:'🌤', title:'Climate Type',               body:'Climate classification intersects the site area.' },
      { id:'soil',        dim:'A', cls:'val-ok',   icon:'🌍', title:'Soil Suitability',           body:'Soil classification intersects the site area.' },
      { id:'landcover',   dim:'A', cls:'val-ok',   icon:'🗺', title:'Land Cover',                 body:'Land cover classification intersects the site area.' },
      { id:'pia',         dim:'A', cls:'val-ok',   icon:'📌', title:'Potential Irrigable Area',    body:'Site falls within a Potential Irrigable Area.' },
      { id:'fault',       dim:'B', cls:'val-err',  icon:'🔴', title:'Active Fault Line',           body:'Site proximate to a mapped active fault. MGB clearance required.' },
      { id:'flood',       dim:'B', cls:'val-warn', icon:'⚠',  title:'Flood Susceptibility Zone',  body:'Site intersects flood-susceptible zones. DRRMP compliance required.' },
      { id:'landslide',   dim:'B', cls:'val-warn', icon:'⚠',  title:'Landslide Susceptibility',   body:'Site overlaps landslide-prone areas. MGB assessment needed.' },
      { id:'protected',   dim:'B', cls:'val-err',  icon:'🔴', title:'Protected Area (NIPAS)',      body:'Site overlaps a NIPAS-protected area. Development restricted under NIPAS Act.' },
      { id:'irrigation',  dim:'C', cls:'val-ok',   icon:'🏗', title:'Existing Irrigation Systems', body:'Existing irrigation system data intersects the site area.' },
      { id:'cadt',        dim:'C', cls:'val-warn', icon:'⚠',  title:'CADT Ancestral Domain',      body:'Site intersects CADT area. FPIC under IPRA (RA 8371) required.' },
      { id:'npaaad',      dim:'C', cls:'val-warn', icon:'⚠',  title:'NPAAAD Overlap',             body:'Site falls within NPAAAD zones. DAR clearance may be required.' },
      { id:'safdz',       dim:'C', cls:'val-warn', icon:'⚠',  title:'SAFDZ Overlap',             body:'Site falls within SAFDZ. Coordinate with DA.' },
    ];
    let valHtml = '';
    if (!hasData) {
      valHtml = '<div class="val-item" style="background:rgba(255,255,255,0.03);border:1px solid var(--border)"><span style="font-size:15px">ℹ</span><div><strong>No site data loaded</strong><br>Upload a KML or draw a polygon.</div></div>';
    } else if (!active.length) {
      valHtml = '<div class="val-item val-warn"><span style="font-size:15px">⚠</span><div><strong>No layers active</strong></div></div>';
    } else {
      const dimBuckets = { A:[], B:[], C:[] };
      for (const c of CHECKS) {
        if (!active.includes(c.id)) continue;
        const ar = overlapCache[c.id];
        // ar===null means no intersection found (or no tile data loaded for this layer).
        // Show 0% overlap for active layers with no intersection.
        const overlapPct = ar ? (ar.overlapPct || 0) : 0;
        const noTileData = ar === null; // querySourceFeatures returned nothing
        const hasIntersect = ar !== null;
        dimBuckets[c.dim].push(
          '<div class="val-item ' + (hasIntersect ? c.cls : '') + '" style="' + (!hasIntersect ? 'background:rgba(255,255,255,0.02);border:1px solid var(--border)' : '') + '">' +
          '<span style="font-size:15px">' + (hasIntersect ? c.icon : '○') + '</span>' +
          '<div style="flex:1"><strong>' + c.title + '</strong>' +
          ' <span style="font-size:10px;font-weight:700;color:' + (overlapPct > 0 ? 'var(--accent2)' : 'var(--muted)') + '">' + overlapPct.toFixed(1) + '% overlap</span>' +
          (noTileData ? '<span style="font-size:9px;color:var(--muted);margin-left:6px">(no tile data loaded — zoom to polygon first)</span>' : '') +
          '<br><span style="font-size:11px">' + (hasIntersect ? c.body : 'No overlap detected with site polygon.') + '</span>' +
          (hasIntersect ? buildAttrDetail(ar, { ...LAYER_META[c.id], _id: c.id }) : '') + '</div></div>'
        );
      }
      const DL = {
        A:{ label:'DIM A — TECHNICAL SUITABILITY', color:'var(--dim-a)', icon:'🌱' },
        B:{ label:'DIM B — ENVIRONMENTAL SAFETY',  color:'var(--dim-b)', icon:'⚠' },
        C:{ label:'DIM C — GOVERNANCE & LAND USE', color:'var(--dim-c)', icon:'🏛' },
      };
      ['A','B','C'].forEach(function(d) {
        if (!dimBuckets[d].length) return;
        valHtml += '<div style="margin-bottom:4px;padding:5px 10px;border-radius:6px 6px 0 0;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-bottom:none"><span style="font-size:10px;font-weight:700;letter-spacing:0.7px;color:' + DL[d].color + ';text-transform:uppercase">' + DL[d].icon + ' ' + DL[d].label + '</span></div><div style="margin-bottom:14px;border:1px solid var(--border);border-radius:0 0 6px 6px;overflow:hidden">' + dimBuckets[d].join('') + '</div>';
      });
      if (!valHtml) valHtml = '<div class="val-item val-ok"><span style="font-size:15px">✅</span><div><strong>No critical conflicts detected</strong></div></div>';
    }
    body.innerHTML = _buildReportBody(active, dimA, dimB, dimC, siteFeatures, now, hasData, valHtml, overlapCache);
  }

  // ── Fit map to polygon bbox at z14 so full-res tiles are in cache, then run ──
  const bbox = getSiteBbox(polyFeatures);
  if (bbox && polyFeatures.length > 0) {
    map.fitBounds(bbox, { padding: 40, minZoom: 10, maxZoom: 14, animate: false });
  }
  // Always run via setTimeout — avoids any idle-event deadlock
  setTimeout(_runReport, 800);
}

function _buildReportBody(active, dimA, dimB, dimC, siteFeatures, now, hasData, valHtml, overlapCache) {
  overlapCache = overlapCache || {};
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--accent)">IGP Assessment Report</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Generated: ${now.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})} · ${now.toLocaleTimeString()}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--muted);line-height:1.8">
        <div style="color:var(--text2);font-weight:600">National Irrigation Administration</div>
        <div>Integrated Geospatial Platform</div>
        <div style="color:var(--accent2)">Philippines Coverage</div>
      </div>
    </div>

    <div class="report-stat-row">
      <div class="report-stat-card"><div class="report-stat-num" style="color:var(--accent)">${active.length}</div><div class="report-stat-lbl">Active Layers</div></div>
      <div class="report-stat-card"><div class="report-stat-num" style="color:var(--accent2)">${uploadedKMLs.length}</div><div class="report-stat-lbl">KML Files</div></div>
      <div class="report-stat-card"><div class="report-stat-num" style="color:var(--purple,#8b5cf6)">${drawPolys.length}</div><div class="report-stat-lbl">Drawn Polygons</div></div>
      <div class="report-stat-card"><div class="report-stat-num" style="color:#8b5cf6">${placedMarkers.length}</div><div class="report-stat-lbl">Markers</div></div>
      <div class="report-stat-card"><div class="report-stat-num" style="color:#22c55e;font-size:${(() => { const ha = [...uploadedKMLs.flatMap(k=>k.features), ...drawPolys].reduce((s,f)=>s+(f.properties&&f.properties.area_ha||0),0); return ha>=1000?'14px':'18px'; })()}">${(() => { const ha = [...uploadedKMLs.flatMap(k=>k.features), ...drawPolys].reduce((s,f)=>s+(f.properties&&f.properties.area_ha||0),0); return fmtHa(ha); })()}</div><div class="report-stat-lbl">Total Site Area</div></div>

    </div>

    <div class="rpt-section">
      <div class="rpt-section-title">📊 Active Reference Layers</div>
      ${!active.length ? '<div style="color:var(--muted);font-size:12px">No layers currently active.</div>' : ''}
      ${dimA.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-a);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM A — TECHNICAL SUITABILITY</div>${dimA.map(id=>`<span class="report-tag rpt-a">● ${LAYER_META[id].name}</span>`).join('')}</div>`:''}
      ${dimB.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-b);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM B — ENVIRONMENTAL SAFETY</div>${dimB.map(id=>`<span class="report-tag rpt-b">● ${LAYER_META[id].name}</span>`).join('')}</div>`:''}
      ${dimC.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-c);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM C — GOVERNANCE</div>${dimC.map(id=>`<span class="report-tag rpt-c">● ${LAYER_META[id].name}</span>`).join('')}</div>`:''}
    </div>


    <div class="rpt-section">
      <div class="rpt-section-title">📂 Site Data</div>
      ${uploadedKMLs.map(k=>`<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">📄 <span>${k.name}</span><span style="color:var(--muted)">(${k.features.length} feature${k.features.length!==1?'s':''})</span>${k.area_ha>0?`<span style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#22c55e;font-weight:700">${fmtHa(k.area_ha)}</span>`:''}</div>`).join('')}
      ${drawPolys.map(p=>`<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">⬡ <span>${p.properties.name}</span>${p.properties.area_ha?`<span style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#22c55e;font-weight:700">${fmtHa(p.properties.area_ha)}</span>`:''}</div>`).join('')}
      ${placedMarkers.map((m,i)=>`<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">📍 <span>${m.name}</span><span style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#8b5cf6;font-weight:700">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span></div>`).join('')}
      ${!hasData && !placedMarkers.length?'<div style="color:var(--muted);font-size:12px">No site data loaded.</div>':''}
    </div>

    <div class="rpt-section">
      <div class="rpt-section-title">🔍 Overlap & Conflict Validation</div>
      ${valHtml}
    </div>

    ${buildScorecardSection(active, siteFeatures, overlapCache)}

    ${buildMarkerOverlapSection(active)}


    <div style="font-size:11px;color:var(--muted);line-height:1.7;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:13px">
      <strong style="color:var(--text2)">Disclaimer:</strong> This report is based on data loaded via the Mapbox Vector Tiles API using tilesets configured in LAYER_CONFIG. Validation results are indicative only. Field verification and coordination with NAMRIA, NIA, MGB, DENR, NCIP, and DAR are required. This output does not constitute a formal environmental or engineering assessment.
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
 *  TOAST
 * ═══════════════════════════════════════════════════════════════ */
function toast(msg, type) {
  type = type || 'info';
  const icons = { ok:'✅', warn:'⚠', err:'❌', info:'ℹ' };
  const div = document.createElement('div');
  div.className = 'toast ' + type;
  div.innerHTML = '<span>' + (icons[type]||'ℹ') + '</span><span>' + msg + '</span>';
  document.getElementById('toastContainer').appendChild(div);
  setTimeout(() => div.remove(), 4500);
}

/* ═══════════════════════════════════════════════════════════════
 *  KEYBOARD SHORTCUTS
 * ═══════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (drawMode) cancelDraw();
    document.getElementById('reportModal').classList.remove('show');
  }
});

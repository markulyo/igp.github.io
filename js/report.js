/**
 * IGP - Report Generation and Geometry Intersection
 * Integrated Geospatial Platform | National Irrigation Administration
 */

/* ═══════════════════════════════════════════════════════════════
 *  GEOMETRY INTERSECTION ENGINE
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Ray-casting point-in-polygon
 * @param {number} px - X coordinate
 * @param {number} py - Y coordinate
 * @param {array} ring - Ring coordinates
 * @returns {boolean} Whether point is inside
 */
function ptInRing(px, py, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

/**
 * Point in polygon
 * @param {number} px - X coordinate
 * @param {number} py - Y coordinate
 * @param {object} geom - GeoJSON geometry
 * @returns {boolean} Whether point is inside
 */
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

/**
 * Segment intersection helpers for polygon-polygon overlap
 * @param {array} a1 - First point of segment A
 * @param {array} a2 - Second point of segment A
 * @param {array} b1 - First point of segment B
 * @param {array} b2 - Second point of segment B
 * @returns {boolean} Whether segments intersect
 */
function segsIntersect(a1, a2, b1, b2) {
    const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / cross;
    const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / cross;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Check if rings intersect
 * @param {array} rA - Ring A
 * @param {array} rB - Ring B
 * @returns {boolean} Whether rings intersect
 */
function ringsIntersect(rA, rB) {
    for (let i = 0; i < rA.length - 1; i++)
        for (let j = 0; j < rB.length - 1; j++)
            if (segsIntersect(rA[i], rA[i + 1], rB[j], rB[j + 1])) return true;
    return false;
}

/**
 * True geometry-vs-geometry intersection test
 * @param {object} siteGeom - Site geometry
 * @param {object} layerGeom - Layer geometry
 * @returns {boolean} Whether geometries intersect
 */
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
            // Any site vertex inside layer polygon
            if (sRing.some(([x, y]) => ptInRing(x, y, lRing))) return true;
            // Any layer vertex inside site polygon
            if (lRing.some(([x, y]) => ptInRing(x, y, sRing))) return true;
            // Edge crossing
            if (ringsIntersect(sRing, lRing)) return true;
        }
    }
    return false;
}

/**
 * Main overlap query: uses querySourceFeatures for real geometries
 * @param {string} layerId - Layer ID
 * @param {array} siteFeatures - Site features
 * @returns {object} Overlap attributes
 */
function getOverlapAttributes(layerId, siteFeatures) {
    if (!siteFeatures.length) return null;
    const srcId = 'src-' + layerId;
    if (!map.getSource(srcId)) return null;

    const sourceLayer = (STATE[layerId] && STATE[layerId].sourceLayer) || (LAYER_CONFIG[layerId] && LAYER_CONFIG[layerId].sourceLayer);
    if (!sourceLayer) return null;

    // Pull all rendered features from the source (real geometries)
    const layerFeatures = map.querySourceFeatures(srcId, { sourceLayer });
    if (!layerFeatures || !layerFeatures.length) return null;

    const cs = LAYER_COLOR_STATE[layerId];
    const colorField = cs && cs.field ? cs.field : null;

    const allValues = new Set();
    let matchCount = 0;
    let detectedField = colorField;

    for (const lf of layerFeatures) {
        if (!lf.geometry) continue;
        const lGeom = lf.geometry;

        // Test against each site feature
        const hit = siteFeatures.some(sf => sf.geometry && geomIntersects(sf.geometry, lGeom));
        if (!hit) continue;

        matchCount++;
        if (colorField) {
            const v = lf.properties[colorField];
            if (v != null) allValues.add(String(v));
        } else {
            const entries = Object.entries(lf.properties || {})
                .filter(([k]) => !/^(id|fid|gid|objectid|shape_)/i.test(k))
                .slice(0, 4);
            entries.forEach(([k, v]) => { allValues.add(k + ': ' + v); detectedField = null; });
        }
    }

    if (!matchCount) return null;
    return { field: detectedField, values: [...allValues], count: matchCount };
}

/**
 * Build attribute detail HTML for one layer's overlap
 * @param {object} attrResult - Attribute result
 * @param {object} layerMeta - Layer metadata
 * @returns {string} HTML string
 */
function buildAttrDetail(attrResult, layerMeta) {
    if (!attrResult) return '';
    const { field, values, count } = attrResult;
    if (!values || values.length === 0) return `<div style="font-size:10px;color:var(--muted);margin-top:3px">${count} feature(s) intersected — no readable attributes</div>`;

    const cs = LAYER_COLOR_STATE[layerMeta._id];
    const colorMap = cs && field && cs.valueMap[field] ? cs.valueMap[field] : {};

    const chips = values.slice(0, 10).map(v => {
        const col = colorMap[v] || '#64748b';
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:2px 7px;margin:2px 2px 0 0;font-size:10px">
      <span style="width:8px;height:8px;border-radius:2px;background:${col};flex-shrink:0;display:inline-block"></span>${v}
    </span>`;
    }).join('');

    const fieldLabel = field
        ? `<span style="font-size:10px;color:var(--muted)">Field: <strong style="color:var(--accent2)">${field}</strong> &nbsp;·&nbsp; ${count} feature(s)</span>`
        : `<span style="font-size:10px;color:var(--muted)">${count} feature(s)</span>`;

    return `<div style="margin-top:5px">${fieldLabel}<div style="margin-top:3px">${chips}</div></div>`;
}

/**
 * Get marker pixel bbox
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {array} Bounding box
 */
function getMarkerPixel(lng, lat) {
    const pt = map.project([lng, lat]);
    const r = 4;
    const canvas = map.getCanvas();
    return [
        Math.max(0, pt.x - r), Math.max(0, pt.y - r),
        Math.min(canvas.width, pt.x + r), Math.min(canvas.height, pt.y + r)
    ];
}

/**
 * Get marker overlap
 * @param {string} layerId - Layer ID
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {object} Marker overlap result
 */
function getMarkerOverlap(layerId, lng, lat) {
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

/**
 * Build marker overlap section HTML
 * @param {array} active - Active layer IDs
 * @returns {string} HTML string
 */
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

/**
 * Open report modal
 */
function openReport() {
    if (window._viewerRestricted) { toast('Report generation is not available for Viewer role', 'warn'); return; }
    const now = new Date();
    const active = LAYER_IDS.filter(id => STATE[id].visible);
    const dimA = active.filter(id => LAYER_META[id].dim === 'A');
    const dimB = active.filter(id => LAYER_META[id].dim === 'B');
    const dimC = active.filter(id => LAYER_META[id].dim === 'C');
    const hasData = uploadedKMLs.length > 0 || drawPolys.length > 0 || placedMarkers.length > 0;

    // Collect all site features (KML + drawn polygons + markers as point features)
    const siteFeatures = [
        ...uploadedKMLs.flatMap(k => k.features),
        ...drawPolys,
        ...placedMarkers.map(m => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng, m.lat] }, properties: { name: m.name } }))
    ];

    // Validation logic with attribute detail
    let valHtml = '';
    if (!hasData) {
        valHtml = `<div class="val-item" style="background:rgba(255,255,255,0.03);border:1px solid var(--border)">
      <span style="font-size:15px">ℹ</span>
      <div><strong>No site data loaded</strong><br>Upload a KML or draw a polygon to validate against active layers.</div>
    </div>`;
    } else {
        const checks = [
            { id: 'fault', cls: 'val-err', icon: '🔴', title: 'Active Fault Line', body: 'Site may be proximate to a mapped active fault.' },
            { id: 'flood', cls: 'val-warn', icon: '⚠', title: 'Flood Susceptibility Zone', body: 'Site intersects flood-susceptible zones. ' },
            { id: 'landslide', cls: 'val-warn', icon: '⚠', title: 'Landslide Susceptibility', body: 'Site may overlap landslide-prone areas. ' },
            { id: 'protected', cls: 'val-err', icon: '🔴', title: 'Protected Area (NIPAS)', body: 'Site overlaps a NIPAS-protected area. ' },
            { id: 'cadt', cls: 'val-warn', icon: '⚠', title: 'CADT Ancestral Domain', body: 'Site intersects CADT area.' },
            { id: 'npaaad', cls: 'val-warn', icon: '⚠', title: 'NPAAAD Overlap', body: 'Site falls within NPAAAD zones. ' },
            { id: 'safdz', cls: 'val-warn', icon: '⚠', title: 'SAFDZ Overlap', body: 'Site falls within a Strategic Agriculture and Fishery Development Zone.' },
            { id: 'groundwater', cls: 'val-ok', icon: '💧', title: 'Groundwater Map', body: 'Groundwater data is active for the site area.' },
            { id: 'climate', cls: 'val-ok', icon: '🌤', title: 'Climate Type', body: 'Climate classification data is active for the site area.' },
            { id: 'soil', cls: 'val-ok', icon: '🌍', title: 'Soil Suitability', body: 'Soil classification data is active for the site area.' },
            { id: 'landcover', cls: 'val-ok', icon: '🗺', title: 'Land Cover', body: 'Land cover classification is active for the site area.' },
            { id: 'irrigation', cls: 'val-ok', icon: '🏗', title: 'Existing Irrigation', body: 'Existing irrigation system data is active for the site area.' },
            { id: 'pia', cls: 'val-ok', icon: '📌', title: 'Potential Irrigable Area', body: 'Site falls within a Potential Irrigable Area. ' },
        ];
        checks.forEach(c => {
            if (!active.includes(c.id)) return;

            // True geometry intersection test via querySourceFeatures
            let combinedAttr = null;
            if (siteFeatures.length > 0) {
                combinedAttr = getOverlapAttributes(c.id, siteFeatures);
            }

            // Build the meta object with _id for color lookup
            const metaWithId = { ...LAYER_META[c.id], _id: c.id };
            const attrDetail = buildAttrDetail(combinedAttr, metaWithId);
            const hasOverlap = combinedAttr !== null;

            // Only show red/amber alerts if there's an actual detected overlap (or no bboxes on screen)
            // Skip this layer entirely if no actual geometric intersection found
            if (!hasOverlap) return;

            valHtml += `<div class="val-item ${c.cls}">
        <span style="font-size:15px">${c.icon}</span>
        <div style="flex:1">
          <strong>${c.title}</strong><br>
          <span style="font-size:11px">${c.body}</span>
          ${attrDetail}
        </div>
      </div>`;
        });

        if (!valHtml) {
            valHtml = `<div class="val-item val-ok"><span style="font-size:15px">✅</span><div><strong>No critical conflicts detected</strong><br>No conflicts found from active layers. Activate more layers for comprehensive validation.</div></div>`;
        }
    }

    // Calculate total area
    const totalHa = [...uploadedKMLs.flatMap(k => k.features), ...drawPolys].reduce((s, f) => s + (f.properties && f.properties.area_ha || 0), 0);

    document.getElementById('reportBody').innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--accent)">IGP Assessment Report</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Generated: ${now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })} · ${now.toLocaleTimeString()}</div>
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
      <div class="report-stat-card"><div class="report-stat-num" style="color:#22c55e;font-size:${totalHa >= 1000 ? '14px' : '18px'}">${fmtHa(totalHa)}</div><div class="report-stat-lbl">Total Site Area</div></div>
    </div>

    <div class="rpt-section">
      <div class="rpt-section-title">📊 Active Reference Layers</div>
      ${!active.length ? '<div style="color:var(--muted);font-size:12px">No layers currently active.</div>' : ''}
      ${dimA.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-a);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM A — TECHNICAL SUITABILITY</div>${dimA.map(id => `<span class="report-tag rpt-a">● ${LAYER_META[id].name}</span>`).join('')}</div>` : ''}
      ${dimB.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-b);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM B — ENVIRONMENTAL SAFETY</div>${dimB.map(id => `<span class="report-tag rpt-b">● ${LAYER_META[id].name}</span>`).join('')}</div>` : ''}
      ${dimC.length ? `<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--dim-c);font-weight:700;letter-spacing:0.5px;margin-bottom:4px">DIM C — GOVERNANCE</div>${dimC.map(id => `<span class="report-tag rpt-c">● ${LAYER_META[id].name}</span>`).join('')}</div>` : ''}
    </div>

    <div class="rpt-section">
      <div class="rpt-section-title">📂 Site Data</div>
      ${uploadedKMLs.map(k => `<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">📄 <span>${k.name}</span><span style="color:var(--muted)">(${k.features.length} feature${k.features.length !== 1 ? 's' : ''})</span>${k.area_ha > 0 ? `<span style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#22c55e;font-weight:700">${fmtHa(k.area_ha)}</span>` : ''}</div>`).join('')}
      ${drawPolys.map(p => `<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">⬡ <span>${p.properties.name}</span>${p.properties.area_ha ? `<span style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#22c55e;font-weight:700">${fmtHa(p.properties.area_ha)}</span>` : ''}</div>`).join('')}
      ${placedMarkers.map((m, i) => `<div style="font-size:12px;margin-bottom:4px;display:flex;align-items:center;gap:8px">📍 <span>${m.name}</span><span style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);border-radius:4px;padding:1px 7px;font-size:10px;color:#8b5cf6;font-weight:700">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span></div>`).join('')}
      ${!hasData && !placedMarkers.length ? '<div style="color:var(--muted);font-size:12px">No site data loaded.</div>' : ''}
    </div>

    <div class="rpt-section">
      <div class="rpt-section-title">🔍 Overlap & Conflict Validation</div>
      ${valHtml}
    </div>

    ${buildMarkerOverlapSection(active)}


    <div style="font-size:11px;color:var(--muted);line-height:1.7;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:13px">
      <strong style="color:var(--text2)">Disclaimer:</strong> This report is based on data loaded via the Mapbox Vector Tiles API using tilesets configured in LAYER_CONFIG. Validation results are indicative only. Field verification and coordination with NAMRIA, NIA, MGB, DENR, NCIP, and DAR are required. This output does not constitute a formal environmental or engineering assessment.
    </div>`;

    document.getElementById('reportModal').classList.add('show');
}

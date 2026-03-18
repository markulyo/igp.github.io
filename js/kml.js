/**
 * IGP - KML Import/Export and Markers
 * Integrated Geospatial Platform | National Irrigation Administration
 */

// Uploaded KMLs
let uploadedKMLs = [];

// Placed markers
let placedMarkers = []; // { name, lng, lat, mapMarker }
let markerCnt = 1;

/* ═══════════════════════════════════════════════════════════════
 *  KML UPLOAD
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Handle drag over event
 * @param {object} e - Drag event
 */
function doDragOver(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.add('dragover');
}

/**
 * Handle drag leave event
 */
function doDragLeave() {
    document.getElementById('dropZone').classList.remove('dragover');
}

/**
 * Handle drop event
 * @param {object} e - Drop event
 */
function doDrop(e) {
    e.preventDefault();
    doDragLeave();
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.kml'));
    if (!files.length) { toast('Only .kml files accepted', 'warn'); return; }
    files.forEach(processKML);
}

/**
 * Handle KML file upload from input
 * @param {object} e - Change event
 */
function handleKMLUpload(e) {
    if (window._viewerRestricted) return;
    Array.from(e.target.files).forEach(processKML);
    e.target.value = '';
}

/**
 * Process uploaded KML file
 * @param {File} file - KML file
 */
function processKML(file) {
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const gj = parseKML(ev.target.result);
            // Compute area for each polygon feature
            gj.features.forEach(f => {
                if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                    f.properties = f.properties || {};
                    f.properties.area_ha = geomAreaHa(f.geometry);
                }
            });
            const totalHa = gj.features.reduce((s, f) => s + (f.properties && f.properties.area_ha || 0), 0);
            const entry = { name: file.name, features: gj.features, mapIds: [], area_ha: totalHa };
            uploadedKMLs.push(entry);

            gj.features.forEach((feat, fi) => {
                const sid = 'kml-' + Date.now() + '-' + fi;
                map.addSource(sid, { type: 'geojson', data: feat });
                const gt = feat.geometry.type;
                if (gt.includes('Polygon')) {
                    map.addLayer({ id: sid + '-fill', type: 'fill', source: sid, paint: { 'fill-color': '#f472b6', 'fill-opacity': 0.22 } });
                    map.addLayer({ id: sid + '-stroke', type: 'line', source: sid, paint: { 'line-color': '#f472b6', 'line-width': 2 } });
                } else if (gt.includes('Line')) {
                    map.addLayer({ id: sid + '-line', type: 'line', source: sid, paint: { 'line-color': '#f472b6', 'line-width': 2.5 } });
                }
                entry.mapIds.push(sid);
            });

            // Fit map to uploaded KML
            const coords = gj.features.flatMap(f => {
                const g = f.geometry;
                if (g.type === 'Point') return [g.coordinates];
                if (g.type.includes('Line')) return g.coordinates;
                if (g.type === 'Polygon') return g.coordinates[0];
                return [];
            }).filter(c => !isNaN(c[0]));
            if (coords.length) {
                const b = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
                map.fitBounds(b, { padding: 60, maxZoom: 14 });
            }

            updateKMLPanel();
            toast('"' + file.name + '" loaded (' + gj.features.length + ' features)', 'ok');
        } catch (err) {
            toast('Failed to parse "' + file.name + '"', 'err');
        }
    };
    reader.readAsText(file);
}

/**
 * Parse KML to GeoJSON
 * @param {string} text - KML text
 * @returns {object} GeoJSON FeatureCollection
 */
function parseKML(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const features = [];
    doc.querySelectorAll('Placemark').forEach(pm => {
        const name = pm.querySelector('name')?.textContent?.trim() || 'Feature';
        pm.querySelectorAll('Polygon').forEach(poly => {
            const coords = parseKMLCoords(poly.querySelector('outerBoundaryIs coordinates')?.textContent || poly.querySelector('coordinates')?.textContent || '');
            if (coords.length > 2) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { name } });
        });
        pm.querySelectorAll('LineString').forEach(ls => {
            const coords = parseKMLCoords(ls.querySelector('coordinates')?.textContent || '');
            if (coords.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { name } });
        });
        pm.querySelectorAll('Point').forEach(pt => {
            const coords = parseKMLCoords(pt.querySelector('coordinates')?.textContent || '');
            if (coords.length) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: coords[0] }, properties: { name } });
        });
    });
    if (!features.length) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121, 14], [121.5, 14], [121.5, 14.5], [121, 14.5], [121, 14]]] }, properties: { name: 'Imported Area' } });
    return { type: 'FeatureCollection', features };
}

/**
 * Parse KML coordinates string
 * @param {string} text - Coordinates text
 * @returns {array} Array of [lng, lat] coordinates
 */
function parseKMLCoords(text) {
    return text.trim().split(/\s+/).map(c => { const p = c.split(','); return [parseFloat(p[0]), parseFloat(p[1])]; }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
}

/**
 * Remove uploaded KML
 * @param {number} i - Index of KML to remove
 */
function removeKML(i) {
    const k = uploadedKMLs[i];
    k.mapIds.forEach(sid => {
        [sid + '-fill', sid + '-stroke', sid + '-line'].forEach(lid => { if (map.getLayer(lid)) map.removeLayer(lid); });
        if (map.getSource(sid)) map.removeSource(sid);
    });
    uploadedKMLs.splice(i, 1);
    updateKMLPanel();
    toast('KML removed', 'info');
}

/**
 * Update KML panel UI
 */
function updateKMLPanel() {
    const sec = document.getElementById('kmlSection');
    const lst = document.getElementById('kmlList');
    sec.style.display = uploadedKMLs.length ? 'block' : 'none';
    lst.innerHTML = uploadedKMLs.map((k, i) => {
        const areaLabel = k.area_ha > 0 ? `<span style="font-size:10px;color:#22c55e;font-weight:700">${fmtHa(k.area_ha)}</span>` : '';
        return `<div class="kml-chip" style="align-items:flex-start">
      <span style="margin-top:2px">📄</span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" title="${k.name}">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--text)">${k.name}</span>
        ${k.area_ha > 0 ? `<span style="font-size:10px;color:#22c55e;font-weight:700">${fmtHa(k.area_ha)}</span>` : ''}
      </div>
      <button class="chip-del" onclick="removeKML(${i})">✕</button>
    </div>`;
    }).join('');
}

/* ═══════════════════════════════════════════════════════════════
 *  DOWNLOAD KML
 * ═══════════════════════════════════════════════════════════════ */
function downloadKML() {
  const polys = [
    ...drawPolys,
    ...uploadedKMLs.flatMap(k => k.features.filter(f => f.geometry.type === 'Polygon'))
  ];
  if (!polys.length) { toast('No polygons to export', 'warn'); return; }
  const pms = polys.map(p => {
    const coords = p.geometry.coordinates[0].map(c => c[0]+','+c[1]+',0').join(' ');
    return `  <Placemark><name>${p.properties?.name||'Feature'}</name>\n    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>\n  </Placemark>`;
  });
  const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n  <name>IGP Export — ${new Date().toLocaleDateString()}</name>\n${pms.join('\n')}\n</Document>\n</kml>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([kml], { type:'application/vnd.google-earth.kml+xml' }));
  a.download = 'IGP_NIA_' + Date.now() + '.kml';
  a.click();
  toast('KML exported (' + polys.length + ' polygon' + (polys.length !== 1 ? 's' : '') + ')', 'ok');
}

/* ═══════════════════════════════════════════════════════════════
 *  COORDINATE SEARCH & MARKERS
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Add coordinate marker
 */
function addCoordMarker() {
    if (window._viewerRestricted) { toast('Adding markers is not available for Viewer role', 'warn'); return; }
    const lngVal = document.getElementById('coordLngInput').value.trim();
    const latVal = document.getElementById('coordLatInput').value.trim();
    const lng = parseFloat(lngVal);
    const lat = parseFloat(latVal);

    if (isNaN(lng) || isNaN(lat)) {
        toast('Enter valid longitude and latitude', 'warn'); return;
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        toast('Coordinates out of valid range', 'warn'); return;
    }

    const name = 'Marker ' + markerCnt++;

    // Custom purple pin element
    const el = document.createElement('div');
    el.style.cssText = [
        'width:22px', 'height:22px', 'border-radius:50% 50% 50% 0',
        'background:#8b5cf6', 'border:3px solid #fff',
        'transform:rotate(-45deg)',
        'box-shadow:0 2px 8px rgba(139,92,246,0.6)',
        'cursor:pointer'
    ].join(';');

    const mapMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup({ offset: 25, closeButton: true })
            .setHTML(`<div style="font-family:inherit;font-size:12px;min-width:160px">
        <div style="font-weight:700;margin-bottom:4px">📍 ${name}</div>
        <div style="color:#6b7280;font-size:11px">Lng: ${lng.toFixed(6)}</div>
        <div style="color:#6b7280;font-size:11px">Lat: ${lat.toFixed(6)}</div>
      </div>`))
        .addTo(map);

    placedMarkers.push({ name, lng, lat, mapMarker });
    updateMarkerPanel();
    updateMarkerReport();

    // Fly to marker
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12), duration: 900 });

    // Clear inputs
    document.getElementById('coordLngInput').value = '';
    document.getElementById('coordLatInput').value = '';

    toast('"' + name + '" placed at ' + lat.toFixed(5) + ', ' + lng.toFixed(5), 'ok');
}

/**
 * Delete marker by index
 * @param {number} i - Index of marker to delete
 */
function deleteMarker(i) {
    const m = placedMarkers[i];
    if (m.mapMarker) m.mapMarker.remove();
    placedMarkers.splice(i, 1);
    updateMarkerPanel();
    updateMarkerReport();
    toast('Marker removed', 'info');
}

/**
 * Fly to marker
 * @param {number} i - Index of marker
 */
function flyToMarker(i) {
    const m = placedMarkers[i];
    map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 });
    m.mapMarker.togglePopup();
}

/**
 * Update marker panel UI
 */
function updateMarkerPanel() {
    const sec = document.getElementById('markerSection');
    const lst = document.getElementById('markerList');
    sec.style.display = placedMarkers.length ? 'block' : 'none';
    lst.innerHTML = placedMarkers.map((m, i) =>
        `<div class="marker-chip">
      <span style="cursor:pointer" onclick="flyToMarker(${i})">📍</span>
      <div class="chip-name" style="display:flex;flex-direction:column;gap:1px;cursor:pointer" onclick="flyToMarker(${i})">
        <span>${m.name}</span>
        <span style="font-size:10px;color:#8b5cf6;font-weight:600">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span>
      </div>
      <button class="chip-del" onclick="deleteMarker(${i})">✕</button>
    </div>`
    ).join('');
}

/**
 * Export markers to KML
 */
function exportMarkersKML() {
    if (!placedMarkers.length) { toast('No markers to export', 'warn'); return; }
    const pms = placedMarkers.map(m =>
        `  <Placemark>
    <name>${m.name}</name>
    <Point><coordinates>${m.lng},${m.lat},0</coordinates></Point>
  </Placemark>`
    ).join('\n');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>IGP Markers — ${new Date().toLocaleDateString()}</name>
${pms}
</Document>
</kml>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
    a.download = 'IGP_Markers_' + Date.now() + '.kml';
    a.click();
    toast('Markers exported (' + placedMarkers.length + ')', 'ok');
}

/**
 * Update marker report (called after marker add/delete)
 */
function updateMarkerReport() {
    // no-op here; report is regenerated fresh each time openReport() is called
}

// Initialize Enter key listeners for coordinate inputs
document.addEventListener('DOMContentLoaded', () => {
    ['coordLngInput', 'coordLatInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') addCoordMarker(); });
    });
});

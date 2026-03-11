/**
 * IGP - Layer Management
 * Integrated Geospatial Platform | National Irrigation Administration
 */

/**
 * Toggle layer visibility
 * @param {string} id - Layer ID
 */
function toggleLayer(id) {
    if (!mapReady) {
        toast('Map is still loading, please wait…', 'warn');
        document.getElementById('chk-' + id).checked = false;
        return;
    }
    const s = STATE[id];

    if (s.visible) {
        // Turn OFF
        removeMapLayer(id);
        s.visible = false;
        s.loaded = false;
        setStatus(id, 'configured', '✓ Configured — toggle to load');
        toast(LAYER_META[id].name + ' hidden', 'info');
    } else {
        // Turn ON
        if (!s.tilesetId) {
            document.getElementById('chk-' + id).checked = false;
            toast('Set tilesetId for "' + LAYER_META[id].name + '" in LAYER_CONFIG', 'warn');
            return;
        }
        s.visible = true;
        s.loaded = false;
        setStatus(id, 'loading', '⟳ Loading from Mapbox…');
        addMapLayer(id);
        toast('Loading ' + LAYER_META[id].name + '…', 'info');
    }

    syncItemUI(id);
    updateStatus();
    updateLegend();
    updateDimCounts();
}

/**
 * Add layer via Mapbox Vector Tiles API
 * @param {string} id - Layer ID
 */
function addMapLayer(id) {
    const s = STATE[id];
    const cfg = LAYER_CONFIG[id];
    const srcId = 'src-' + id;

    // Clean up any stale layers/sources first
    removeMapLayer(id, false);

    // Use already-known sourceLayer if available — go straight to render
    const knownSrcLayer = (s.sourceLayer || '').trim();
    if (knownSrcLayer) {
        renderLayer(id, srcId, cfg, s, knownSrcLayer);
        return;
    }

    const metaUrl = `https://api.mapbox.com/v4/${s.tilesetId}.json?access_token=${mapboxgl.accessToken}`;

    fetch(metaUrl)
        .then(res => {
            if (!res.ok) throw new Error(`TileJSON fetch failed (${res.status})`);
            return res.json();
        })
        .then(meta => {
            // Discover the real source-layer name from TileJSON
            const vectorLayers = meta.vector_layers || [];
            let srcLayer;
            if (vectorLayers.length > 0) {
                srcLayer = vectorLayers[0].id;
                console.log('[IGP] ' + id + ': discovered source-layer = "' + srcLayer + '"');
                console.log('[IGP] ' + id + ': all layers in tileset:', vectorLayers.map(l => l.id));
            } else {
                const dotIdx = s.tilesetId.indexOf('.');
                srcLayer = dotIdx !== -1 ? s.tilesetId.slice(dotIdx + 1) : id;
            }
            // Cache it so next toggle skips the fetch
            STATE[id].sourceLayer = srcLayer;
            renderLayer(id, srcId, cfg, s, srcLayer, meta.bounds);
        })
        .catch(err => {
            STATE[id].visible = false;
            STATE[id].error = err.message;
            document.getElementById('chk-' + id).checked = false;
            setStatus(id, 'error', '✗ ' + err.message);
            toast(LAYER_META[id].name + ' failed: ' + err.message, 'err');
            syncItemUI(id);
        });
}

/**
 * Render layer - shared rendering used by both paths
 * @param {string} id - Layer ID
 * @param {string} srcId - Source ID
 * @param {object} cfg - Layer config
 * @param {object} s - State
 * @param {string} srcLayer - Source layer name
 * @param {array} bounds - Bounds array
 */
function renderLayer(id, srcId, cfg, s, srcLayer, bounds) {
    removeMapLayer(id, false);

    map.addSource(srcId, {
        type: 'vector',
        url: 'mapbox://' + s.tilesetId,
    });

    try {
        if (cfg.type === 'line') {
            map.addLayer({
                id: 'lyr-' + id,
                type: 'line',
                source: srcId,
                'source-layer': srcLayer,
                paint: {
                    'line-color': cfg.color,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 12, 3.5],
                    'line-opacity': s.opacity,
                },
            });
        } else {
            map.addLayer({
                id: 'lyr-' + id + '-fill',
                type: 'fill',
                source: srcId,
                'source-layer': srcLayer,
                paint: {
                    'fill-color': cfg.color,
                    'fill-opacity': ['interpolate', ['linear'], ['zoom'],
                        4, s.opacity * 0.45,
                        12, s.opacity * 0.85,
                    ],
                },
            });
            map.addLayer({
                id: 'lyr-' + id + '-stroke',
                type: 'line',
                source: srcId,
                'source-layer': srcLayer,
                paint: {
                    'line-color': cfg.color,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 12, 2],
                    'line-opacity': Math.min(s.opacity + 0.25, 1),
                },
            });

            map.on('click', 'lyr-' + id + '-fill', e => {
                if (!e.features.length) return;
                const props = e.features[0].properties;
                const rows = Object.entries(props).slice(0, 12)
                    .map(([k, v]) => `<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="color:var(--muted)">${k}:</span> <strong>${v}</strong></div>`)
                    || '<em style="color:var(--muted)">No attributes</em>';
                new mapboxgl.Popup({ maxWidth: '270px', closeButton: true })
                    .setLngLat(e.lngLat)
                    .setHTML(`<div style="font-size:11px">
            <div style="font-weight:700;color:${cfg.color};margin-bottom:6px">${LAYER_META[id].icon} ${LAYER_META[id].name}</div>
            ${rows}
          </div>`)
                    .addTo(map);
            });
            map.on('mouseenter', 'lyr-' + id + '-fill', () => { if (!drawMode) map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'lyr-' + id + '-fill', () => { if (!drawMode) map.getCanvas().style.cursor = ''; });
        }

        STATE[id].loaded = true;
        STATE[id].error = null;
        setStatus(id, 'configured', '✓ Loaded — "' + srcLayer + '"');
        toast(LAYER_META[id].name + ' loaded!', 'ok');

        // If this layer already has a color state (e.g. after basemap switch), re-apply immediately
        const _cs = LAYER_COLOR_STATE[id];
        if (_cs && _cs.field && _cs.valueMap[_cs.field] && Object.keys(_cs.valueMap[_cs.field]).length > 0) {
            applyColorCoding(id, _cs.field);
        }

        // Fly to layer bounds if inside Philippines
        if (bounds && Array.isArray(bounds) && bounds.length === 4) {
            const [w, sb, e2, n] = bounds;
            if (e2 > 116 && w < 128 && n > 4 && sb < 22) {
                map.fitBounds([[w, sb], [e2, n]], { padding: 60, maxZoom: 12, duration: 800 });
            }
        }

    } catch (err) {
        STATE[id].visible = false;
        STATE[id].error = err.message;
        document.getElementById('chk-' + id).checked = false;
        setStatus(id, 'error', '✗ ' + err.message);
        toast(LAYER_META[id].name + ' error: ' + err.message, 'err');
        syncItemUI(id);
    }
}

/**
 * Remove map layer
 * @param {string} id - Layer ID
 * @param {boolean} resetVisible - Whether to reset visible state
 */
function removeMapLayer(id, resetVisible = true) {
    ['lyr-' + id, 'lyr-' + id + '-fill', 'lyr-' + id + '-stroke'].forEach(lid => {
        if (map.getLayer(lid)) map.removeLayer(lid);
    });
    if (map.getSource('src-' + id)) map.removeSource('src-' + id);
    if (resetVisible) {
        STATE[id].visible = false;
        delete LAYER_COLOR_STATE[id]; // clear so it re-detects on next load
    }
}

/**
 * Clear all layers
 */
function clearAllLayers() {
    LAYER_IDS.forEach(id => {
        removeMapLayer(id);
        document.getElementById('chk-' + id).checked = false;
        document.getElementById('item-' + id).classList.remove('active');
        setStatus(id, STATE[id].tilesetId ? 'configured' : 'not-set',
            STATE[id].tilesetId ? '✓ Configured — toggle to load' : 'No API configured');
    });
    updateStatus();
    updateLegend();
    updateDimCounts();
    toast('All layers cleared', 'info');
}

/**
 * Set layer opacity
 * @param {string} id - Layer ID
 * @param {number} val - Opacity value (0-1)
 */
function setLayerOpacity(id, val) {
    STATE[id].opacity = val;
    const cfg = LAYER_CONFIG[id];
    if (map.getLayer('lyr-' + id + '-fill')) map.setPaintProperty('lyr-' + id + '-fill', 'fill-opacity', val * 0.75);
    if (map.getLayer('lyr-' + id + '-stroke')) map.setPaintProperty('lyr-' + id + '-stroke', 'line-opacity', Math.min(val + 0.2, 1));
    if (map.getLayer('lyr-' + id)) map.setPaintProperty('lyr-' + id, 'line-opacity', val);
}

/* ═══════════════════════════════════════════════════════════════
 *  ATTRIBUTE-BASED COLOR CODING
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Build color map from values set
 * @param {Set} valuesSet - Set of values
 * @returns {object} Color map
 */
function buildColorMap(valuesSet) {
    const sorted = [...valuesSet].sort();
    const out = {};
    sorted.forEach((v, i) => { out[v] = ATTR_PALETTE[i % ATTR_PALETTE.length]; });
    return out;
}

/**
 * Apply color coding to layer
 * @param {string} id - Layer ID
 * @param {string} field - Field name
 */
function applyColorCoding(id, field) {
    const cs = LAYER_COLOR_STATE[id];
    if (!cs) return;
    cs.field = field;

    const colorMap = cs.valueMap[field];
    if (!colorMap || Object.keys(colorMap).length === 0) {
        updateLegend();
        return;
    }

    const matchExpr = ['match', ['get', field]];
    Object.entries(colorMap).forEach(([v, c]) => matchExpr.push(v, c));
    matchExpr.push(LAYER_CONFIG[id].color);

    const opacity = STATE[id].opacity;

    // polygon fill layer
    if (map.getLayer('lyr-' + id + '-fill')) {
        map.setPaintProperty('lyr-' + id + '-fill', 'fill-color', matchExpr);
        map.setPaintProperty('lyr-' + id + '-fill', 'fill-opacity',
            ['interpolate', ['linear'], ['zoom'], 4, opacity * 0.55, 12, opacity * 0.85]);
    }
    // polygon stroke / line layer
    if (map.getLayer('lyr-' + id + '-stroke')) {
        map.setPaintProperty('lyr-' + id + '-stroke', 'line-color', matchExpr);
    }
    // pure line layer (e.g. fault)
    if (map.getLayer('lyr-' + id)) {
        map.setPaintProperty('lyr-' + id, 'line-color', matchExpr);
    }

    updateLegend();
}

/**
 * Main entry: called after a layer is rendered
 * Fetches TileJSON for field names, then samples rendered features for values.
 * @param {string} id - Layer ID
 */
function colorCodeLayer(id) {
    const s = STATE[id];
    if (!s || !s.visible || !s.tilesetId) return;

    const cs = LAYER_COLOR_STATE[id];

    // If we already have fields, just sample rendered features
    if (cs && cs.fields && cs.fields.length > 0) {
        _sampleRendered(id);
        return;
    }

    // First time: fetch TileJSON to get field names
    fetch(`https://api.mapbox.com/v4/${s.tilesetId}.json?access_token=${mapboxgl.accessToken}`)
        .then(r => r.ok ? r.json() : null)
        .then(meta => {
            if (!meta) return;

            const srcLayerName = s.sourceLayer || (STATE[id].sourceLayer) || '';
            const vl = (meta.vector_layers || []).find(l => l.id === srcLayerName)
                || (meta.vector_layers || [])[0];

            if (!vl || !vl.fields) return;

            // Filter to categorical (non-numeric, non-id) fields only
            const fields = Object.keys(vl.fields).filter(f => {
                if (SKIP_FIELD_RE.test(f)) return false;
                if (vl.fields[f] === 'Number') return false;
                return true;
            });

            if (fields.length === 0) return;

            // Initialise color state
            const valueSets = {};
            fields.forEach(f => { valueSets[f] = new Set(); });

            LAYER_COLOR_STATE[id] = {
                field: fields[0],
                fields,
                fieldTypes: vl.fields,
                valueSets,
                valueMap: {},
            };

            updateLegend(); // show dropdown immediately

            // Now sample whatever features are already on screen
            _sampleRendered(id);
        })
        .catch(() => {
            // TileJSON failed — fall back to sampling only
            _sampleRendered(id);
        });
}

/**
 * Sample rendered features
 * @param {string} id - Layer ID
 */
function _sampleRendered(id) {
    const cs = LAYER_COLOR_STATE[id];
    if (!cs) return;

    // Query both fill and line layer types
    const layerIds = ['lyr-' + id + '-fill', 'lyr-' + id]
        .filter(lid => map.getLayer(lid));
    if (layerIds.length === 0) return;

    const features = map.queryRenderedFeatures({ layers: layerIds });
    if (!features || features.length === 0) return;

    let changed = false;
    features.forEach(feat => {
        const props = feat.properties || {};
        cs.fields.forEach(f => {
            const v = props[f];
            if (v !== null && v !== undefined) {
                const str = String(v).trim();
                if (str && str.length < 80 && !cs.valueSets[f].has(str)) {
                    cs.valueSets[f].add(str);
                    changed = true;
                }
            }
        });
    });

    if (!changed) return;

    // Rebuild color maps — additive only: preserve existing value→color assignments
    cs.fields.forEach(f => {
        if (cs.valueSets[f].size === 0) return;
        const existing = cs.valueMap[f] || {};
        // Only assign colors to values not already in the map
        const newVals = [...cs.valueSets[f]].filter(v => !(v in existing));
        if (newVals.length === 0) return; // nothing new, keep existing colors
        // Count how many colors already used to continue the palette index
        const usedCount = Object.keys(existing).length;
        newVals.sort().forEach((v, i) => {
            existing[v] = ATTR_PALETTE[(usedCount + i) % ATTR_PALETTE.length];
        });
        cs.valueMap[f] = existing;
    });

    // Auto-pick best field (most distinct categorical values, 2–20)
    // Skip re-picking during a style switch — keep the existing field selection
    if (!_styleSwitch) {
        let bestField = cs.field;
        let bestScore = 0;
        cs.fields.forEach(f => {
            const n = cs.valueSets[f].size;
            if (n >= 2 && n <= 20 && n > bestScore) { bestField = f; bestScore = n; }
        });
        if (!cs._userPicked) cs.field = bestField;
    }

    applyColorCoding(id, cs.field);
}

/**
 * Update legend panel
 */
function updateLegend() {
    const active = LAYER_IDS.filter(id => STATE[id].visible);
    const panel = document.getElementById('legendPanel');
    panel.style.display = active.length ? 'block' : 'none';

    document.getElementById('legendItems').innerHTML = active.map(id => {
        const cs = LAYER_COLOR_STATE[id];
        const cfg = LAYER_CONFIG[id];
        const meta = LAYER_META[id];

        if (!cs || !cs.field) {
            // TileJSON not yet fetched — show plain color swatch
            return `<div class="legend-layer-block">
        <div class="legend-layer-title">
          <span style="background:${cfg.color};width:10px;height:10px;border-radius:2px;display:inline-block;flex-shrink:0"></span>
          ${meta.name}
        </div>
        <div style="font-size:9px;color:var(--muted);font-style:italic">Pan map to load values…</div>
      </div>`;
        }

        // Has field names but no values yet — show dropdown with "loading" hint
        const hasValues = cs.valueMap[cs.field] && Object.keys(cs.valueMap[cs.field]).length > 0;
        if (!hasValues) {
            const fieldOptions = cs.fields.map(f =>
                `<option value="${f}" ${f === cs.field ? 'selected' : ''}>${f}</option>`
            ).join('');
            return `<div class="legend-layer-block">
        <div class="legend-layer-title">
          <span style="font-size:13px">${meta.icon}</span>
          <span>${meta.name}</span>
        </div>
        <div style="margin-bottom:4px;display:flex;align-items:center;gap:5px">
          <span style="font-size:9px;color:var(--muted)">Color by:</span>
          <select class="legend-field-select" onchange="LAYER_COLOR_STATE['${id}'] && (LAYER_COLOR_STATE['${id}']._userPicked=true); applyColorCoding('${id}', this.value)">
            ${fieldOptions}
          </select>
        </div>
        <div style="font-size:9px;color:var(--muted);font-style:italic">Pan/zoom to load values…</div>
      </div>`;
        }

        const colorMap = cs.valueMap[cs.field] || {};
        const fieldOptions = cs.fields.map(f =>
            `<option value="${f}" ${f === cs.field ? 'selected' : ''}>${f}</option>`
        ).join('');

        const valueRows = Object.entries(colorMap).map(([v, c]) =>
            `<div class="legend-value-row">
        <div class="legend-value-swatch" style="background:${c}"></div>
        <span class="legend-value-label" title="${v}">${v}</span>
      </div>`
        ).join('');

        return `<div class="legend-layer-block">
      <div class="legend-layer-title">
        <span style="font-size:13px">${meta.icon}</span>
        <span>${meta.name}</span>
      </div>
      <div style="margin-bottom:4px;display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--muted)">Color by:</span>
        <select class="legend-field-select" onchange="LAYER_COLOR_STATE['${id}'] && (LAYER_COLOR_STATE['${id}']._userPicked=true); applyColorCoding('${id}', this.value)">
          ${fieldOptions}
        </select>
      </div>
      ${valueRows}
    </div>`;
    }).join('<div style="border-top:1px solid var(--border);margin:6px 0"></div>');
}

/**
 * Update dimension counts
 */
function updateDimCounts() {
    ['A', 'B', 'C'].forEach(dim => {
        const ids = LAYER_IDS.filter(id => LAYER_META[id].dim === dim);
        const on = ids.filter(id => STATE[id].visible).length;
        document.getElementById('cnt-' + dim.toLowerCase()).textContent = on + '/' + ids.length;
    });
}

/**
 * Toggle dimension section
 * @param {string} secId - Section ID
 * @param {string} grpId - Group ID
 */
function toggleDim(secId, grpId) {
    document.getElementById(secId).classList.toggle('collapsed');
    document.getElementById(grpId).classList.toggle('closed');
}

// Re-sample all visible layers whenever the map goes idle (after pan/zoom/load)
// This is called from map.js after the map is ready
function initLayerIdleHandler() {
    if (!map) return;
    map.on('idle', () => {
        LAYER_IDS.forEach(id => {
            if (STATE[id].visible) colorCodeLayer(id);
        });
    });
}

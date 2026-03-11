/**
 * IGP - Map Initialization and Controls
 * Integrated Geospatial Platform | National Irrigation Administration
 */

// Mapbox Access Token
const MAPBOX_TOKEN = 'pk.eyJ1IjoibWFya3VseW8iLCJhIjoiY21obGN3bzAyMWFlZDJrb3F6dDh4b29yaCJ9.DonMQxYB1xfSOvhnr-6X8A';

// Map configuration
const DEFAULT_STYLE = 'mapbox://styles/mapbox/dark-v11';
const DEFAULT_CENTER = [121.17, 12.97];
const DEFAULT_ZOOM = 8.5;

// Layer Configuration
const LAYER_CONFIG = {
  groundwater: { tilesetId: 'markulyo.ngk2cwiyb64v', sourceLayer: '', color: '#22c55e', type: 'fill', opacity: 0.35 },
  climate:     { tilesetId: 'markulyo.alz776u0n7wj', sourceLayer: '', color: '#4ade80', type: 'fill', opacity: 0.30 },
  soil:        { tilesetId: 'markulyo.4zd49fenzhh9', sourceLayer: '', color: '#a3e635', type: 'fill', opacity: 0.30 },
  landcover:   { tilesetId: 'markulyo.nx576otfd3t1', sourceLayer: '', color: '#86efac', type: 'fill', opacity: 0.28 },
  flood:       { tilesetId: 'markulyo.myo4y9vqllsn', sourceLayer: '', color: '#3b82f6', type: 'fill', opacity: 0.38 },
  landslide:   { tilesetId: 'markulyo.qoks79jilmtw', sourceLayer: '', color: '#f59e0b', type: 'fill', opacity: 0.38 },
  fault:       { tilesetId: 'markulyo.jyyhsdtft5la', sourceLayer: '', color: '#ef4444', type: 'line', opacity: 0.90 },
  irrigation:  { tilesetId: 'markulyo.ew6mnsexf02b', sourceLayer: '', color: '#0ea5e9', type: 'fill', opacity: 0.30 },
  protected:   { tilesetId: 'markulyo.zlf58veg2rph', sourceLayer: '', color: '#8b5cf6', type: 'fill', opacity: 0.32 },
  cadt:        { tilesetId: 'markulyo.0aqwhuj52uxs', sourceLayer: '', color: '#ec4899', type: 'fill', opacity: 0.28 },
  npaaad:      { tilesetId: 'markulyo.peccxh486wx4', sourceLayer: '', color: '#14b8a6', type: 'fill', opacity: 0.28 },
  safdz:       { tilesetId: 'markulyo.r0dt6a21bg8y', sourceLayer: '', color: '#06b6d4', type: 'fill', opacity: 0.28 },
  pia:         { tilesetId: 'markulyo.w64iowtoj3dg', sourceLayer: '', color: '#6366f1', type: 'fill', opacity: 0.28 },
};

const LAYER_META = {
  groundwater: { name:'Groundwater Map', sub:'Water Source', dim:'A', icon:'💧' },
  climate:     { name:'Climate Type', sub:'Water Availability', dim:'A', icon:'🌤' },
  soil:        { name:'Soil Suitability', sub:'Agro-potential', dim:'A', icon:'🌍' },
  landcover:   { name:'Land Cover 2015', sub:'Current Land Status', dim:'A', icon:'🗺' },
  pia:         { name:'PIA', sub:'Potential Irrigable Area', dim:'A', icon:'📌' },
  flood:       { name:'Flood Susceptibility', sub:'Rain-Induced Hazard', dim:'B', icon:'🌊' },
  landslide:   { name:'Landslide Susceptibility', sub:'Rain-Induced Hazard', dim:'B', icon:'⛰' },
  fault:       { name:'Fault Line', sub:'Seismic Hazard', dim:'B', icon:'⚡' },
  protected:   { name:'Protected Areas', sub:'Environmental Law', dim:'B', icon:'🌿' },
  irrigation:  { name:'Existing Irrigation', sub:'NIA / DA / DAR Projects', dim:'C', icon:'🏗' },
  cadt:        { name:'CADT', sub:"Indigenous Peoples' Rights", dim:'C', icon:'📜' },
  npaaad:      { name:'NPAAAD', sub:'Agricultural Land Protection', dim:'C', icon:'🌾' },
  safdz:       { name:'SAFDZ', sub:'Strategic Agri & Fishery Dev. Zone', dim:'C', icon:'🗂' },
};

const STATE = {};
const LAYER_IDS = Object.keys(LAYER_CONFIG);
const LAYER_COLOR_STATE = {};
const ATTR_PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#2c3e50','#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b','#673ab7','#ffc107','#009688','#c0392b','#2980b9','#27ae60','#d35400'];
const SKIP_FIELD_RE = /^(id|fid|gid|objectid|shape_|area|perimeter|length|lat|lon|lng|x_|y_|geom|wkt|created|updated|uuid|globalid)/i;

// Initialize STATE from LAYER_CONFIG
Object.keys(LAYER_CONFIG).forEach(id => {
  STATE[id] = {
    tilesetId: LAYER_CONFIG[id].tilesetId,
    sourceLayer: LAYER_CONFIG[id].sourceLayer,
    visible: false,
    loaded: false,
    error: null,
    opacity: LAYER_CONFIG[id].opacity,
  };
});

// Map instance
let map = null;
let mapReady = false;
let basemapSat = false;

/**
 * Initialize the Mapbox map
 */
function initMap() {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    map = new mapboxgl.Map({
        container: 'map',
        style: DEFAULT_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
    });

    // Mouse move - update coordinates display
    map.on('mousemove', e => {
        document.getElementById('coordEl').textContent =
            `Lng ${e.lngLat.lng.toFixed(5)} · Lat ${e.lngLat.lat.toFixed(5)}`;
    });

    // Map loaded
    map.on('load', () => {
        mapReady = true;

        // Enable toggle buttons for any layers that already have a tilesetId set
        LAYER_IDS.forEach(id => {
            if (STATE[id].tilesetId) {
                document.getElementById('chk-' + id).disabled = false;
                setStatus(id, 'configured', '✓ Configured — toggle to load');
            }
        });

        // Initialize layer idle handler for color coding
        initLayerIdleHandler();

        toast('Map loaded! Toggle layers from the sidebar.', 'ok');
    });

    // Map error handler
    map.on('error', e => {
        const status = e?.error?.status;
        const msg = e?.error?.message || '';
        if (status === 401) {
            toast('Mapbox token invalid (401). Update MAPBOX_TOKEN in the script.', 'err');
        } else if (status === 403) {
            toast('Access denied (403) — check tileset permissions or token scope.', 'warn');
        } else if (status === 404) {
            // A tileset was not found — find which layer and report it
            const url = e?.error?.url || '';
            const badId = LAYER_IDS.find(id => url.includes(STATE[id].tilesetId));
            if (badId) {
                setStatus(badId, 'error', '✗ Tileset not found (404) — check tilesetId');
                toast(LAYER_META[badId].name + ': tileset not found. Check the tilesetId in LAYER_CONFIG.', 'err');
            }
        } else if (msg && !msg.includes('abort')) {
            // Surface unexpected errors to help debugging
            console.warn('[IGP map error]', e);
        }
    });
}

/**
 * Fly to default Philippines view
 */
function flyPH() {
    if (map) {
        map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 1200 });
    }
}

/**
 * Restore user layers after basemap change
 */
function restoreUserLayers() {
    // Re-add drawn polygons
    if (typeof drawPolys !== 'undefined') {
        drawPolys.forEach(feat => {
            const sid = feat._sid;
            if (!sid) return;
            if (!map.getSource(sid)) {
                map.addSource(sid, { type: 'geojson', data: feat });
            }
            if (!map.getLayer(sid + '-fill')) {
                map.addLayer({ id: sid + '-fill', type: 'fill', source: sid, paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.18 } });
                map.addLayer({ id: sid + '-stroke', type: 'line', source: sid, paint: { 'line-color': '#22c55e', 'line-width': 2.5 } });
            }
        });
    }

    // Re-add uploaded KML features
    if (typeof uploadedKMLs !== 'undefined') {
        uploadedKMLs.forEach(entry => {
            entry.features.forEach((feat, fi) => {
                const sid = entry.mapIds[fi];
                if (!sid) return;
                if (!map.getSource(sid)) {
                    map.addSource(sid, { type: 'geojson', data: feat });
                }
                const gt = feat.geometry.type;
                if (gt.includes('Polygon')) {
                    if (!map.getLayer(sid + '-fill')) map.addLayer({ id: sid + '-fill', type: 'fill', source: sid, paint: { 'fill-color': '#f472b6', 'fill-opacity': 0.22 } });
                    if (!map.getLayer(sid + '-stroke')) map.addLayer({ id: sid + '-stroke', type: 'line', source: sid, paint: { 'line-color': '#f472b6', 'line-width': 2 } });
                } else if (gt.includes('Line')) {
                    if (!map.getLayer(sid + '-line')) map.addLayer({ id: sid + '-line', type: 'line', source: sid, paint: { 'line-color': '#f472b6', 'line-width': 2.5 } });
                }
            });
        });
    }

    // Re-add markers
    if (typeof placedMarkers !== 'undefined') {
        placedMarkers.forEach(m => {
            if (m.mapMarker) {
                m.mapMarker.remove();
                m.mapMarker.addTo(map);
            }
        });
    }

    // Re-add in-progress draw temp layer if active
    if (typeof drawActive !== 'undefined' && typeof drawPts !== 'undefined' && drawActive && drawPts.length >= 2) {
        updateTempDraw();
    }
}

let _styleSwitch = false; // flag: style switch in progress

/**
 * Toggle between default and satellite basemap
 */
function toggleBasemap() {
    if (!mapReady || !map) return;
    basemapSat = !basemapSat;
    _styleSwitch = true;
    // Change the satellite style URL here if needed
    map.setStyle(basemapSat
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : DEFAULT_STYLE);
    map.once('style.load', () => {
        // Re-add all IGP reference layers — renderLayer will re-apply color coding automatically
        LAYER_IDS.forEach(id => { if (STATE[id].visible) addMapLayer(id); });
        // Re-add user-drawn polygons, KML uploads and markers
        restoreUserLayers();
        _styleSwitch = false;
    });
    document.getElementById('satBtn').classList.toggle('active', basemapSat);
}

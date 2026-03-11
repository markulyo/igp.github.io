/**
 * IGP - UI Helpers
 * Integrated Geospatial Platform | National Irrigation Administration
 */

/* ═══════════════════════════════════════════════════════════════
 *  TOAST NOTIFICATIONS
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Show toast notification
 * @param {string} msg - Message
 * @param {string} type - Type (ok, warn, err, info)
 */
function toast(msg, type) {
    type = type || 'info';
    const icons = { ok: '✅', warn: '⚠', err: '❌', info: 'ℹ' };
    const div = document.createElement('div');
    div.className = 'toast ' + type;
    div.innerHTML = '<span>' + (icons[type] || 'ℹ') + '</span><span>' + msg + '</span>';
    document.getElementById('toastContainer').appendChild(div);
    setTimeout(() => div.remove(), 4500);
}

/* ═══════════════════════════════════════════════════════════════
 *  UI HELPERS
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Set layer status
 * @param {string} id - Layer ID
 * @param {string} cls - CSS class
 * @param {string} msg - Status message
 */
function setStatus(id, cls, msg) {
    const el = document.getElementById('st-' + id);
    if (el) { el.className = 'layer-api-status ' + cls; el.textContent = msg; }
}

/**
 * Sync UI state with layer state
 * @param {string} id - Layer ID
 */
function syncItemUI(id) {
    const s = STATE[id];
    const chk = document.getElementById('chk-' + id);
    const itm = document.getElementById('item-' + id);
    if (chk) chk.checked = s.visible;
    if (itm) itm.classList.toggle('active', s.visible);
}

/**
 * Update overall status display
 */
function updateStatus() {
    const n = LAYER_IDS.filter(id => STATE[id].visible).length;
    document.getElementById('activeCountEl').textContent = n + ' layer' + (n !== 1 ? 's' : '') + ' active';
}

/* ═══════════════════════════════════════════════════════════════
 *  KEYBOARD SHORTCUTS
 * ═══════════════════════════════════════════════════════════════ */

// Escape key handler
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (drawMode) cancelDraw();
        document.getElementById('reportModal').classList.remove('show');
    }
});

/* ═══════════════════════════════════════════════════════════════
 *  STARTUP — enable toggles for pre-configured layers
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Initialize layer toggles
 */
function initLayerToggles() {
    // If tilesetId was already set above in LAYER_CONFIG, enable the toggle right away
    // (map.on('load') will also run this, but this handles the case before map is ready)
    LAYER_IDS.forEach(id => {
        if (STATE[id].tilesetId) {
            const chk = document.getElementById('chk-' + id);
            if (chk) chk.disabled = false;
            setStatus(id, 'configured', '✓ Configured — toggle to load');
        }
    });
}

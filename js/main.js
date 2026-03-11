/**
 * IGP - Main Entry Point
 * Integrated Geospatial Platform | National Irrigation Administration
 */

/* ═══════════════════════════════════════════════════════════════
 *  INITIALIZATION
 * ═══════════════════════════════════════════════════════════════ */

/**
 * Initialize the application
 */
function initApp() {
    // STATE is already initialized in config.js
    // Initialize the map
    initMap();

    // Initialize layer toggles
    initLayerToggles();

    console.log('IGP initialized');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

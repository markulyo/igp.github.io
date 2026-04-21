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

function openContactUs() {
  const message = 'For support and inquiries, please contact us at:\n\n' +
                  'Email: r4b.operations@nia.gov.ph\n' +
                  'Phone: (043) 288-7267\n\n' +
                  'Or visit our website for more information.';
  
  if (confirm(message + '\n\nWould you like to open your email client?')) {
    window.location.href = 'mailto:r4b.operations@nia.gov.ph?subject=IGP Map Support Request';
  }
}

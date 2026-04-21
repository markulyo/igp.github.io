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
                  'Email: support@example.com\n' +
                  'Phone: +1 (555) 123-4567\n\n' +
                  'Or visit our website for more information.';
  
  if (confirm(message + '\n\nWould you like to open your email client?')) {
    window.location.href = 'mailto:support@example.com?subject=IGP Map Support Request';
  }
}

// Cache busting script for Safari and other browsers
// Force reload if this is an old cached version

(function() {
    'use strict';
    
    // Check if this is a fresh load or cached
    if (performance.navigation.type === 1) {
        // This is a reload, check if we need to force refresh
        const lastVersion = localStorage.getItem('list_version');
        const currentVersion = 'v2.1.2025';
        
        if (lastVersion !== currentVersion) {
            localStorage.setItem('list_version', currentVersion);
            // Force a hard reload
            window.location.reload(true);
        }
    } else {
        // First load, set version
        localStorage.setItem('list_version', 'v2.1.2025');
    }
    
    // Add timestamp to prevent aggressive caching
    const timestamp = new Date().getTime();
    console.log('The List loaded at:', new Date().toISOString());
})();

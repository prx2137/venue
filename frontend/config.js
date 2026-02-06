/**
 * Frontend Configuration
 * Auto-detects backend URL based on environment
 */

const CONFIG = {
    // Auto-detect: localhost uses local backend, production uses same origin
    API_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000'
        : window.location.origin  // Same domain in production
};

console.log('🔌 API URL:', CONFIG.API_URL);

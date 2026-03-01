/**
 * Admin Dashboard Configuration
 * Manages API endpoint URLs for different environments
 */

const AdminConfig = {
    // Automatically detect environment
    getApiBaseUrl() {
        // Check if running locally
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3000';
        }

        // Production - deployed Vercel URL
        // Update this with your actual Vercel deployment URL
        return 'https://core-exterior-crm.vercel.app';
    },

    // API endpoints
    endpoints: {
        leads: '/api/leads',
        leadById: (id) => `/api/leads/${id}`
    },

    // Polling interval for live updates (in milliseconds)
    refreshInterval: 30000, // 30 seconds

    // Request timeout
    requestTimeout: 10000, // 10 seconds

    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000 // 1 second
};

// Make available globally
window.AdminConfig = AdminConfig;

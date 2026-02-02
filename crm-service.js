/**
 * Core Exteriors CRM Service
 * API client for cloud backend (Vercel Postgres)
 * Handles authentication, lead fetching, and status updates
 */

const ADMIN_PASSWORD_HASH = 'core2026'; // Simple password for now

class CRMService {
    constructor() {
        this.apiBaseUrl = null;
        this.leads = [];
        this.lastFetchTime = null;
        this._initConfig();
    }

    _initConfig() {
        // Wait for AdminConfig to be available
        if (window.AdminConfig) {
            this.apiBaseUrl = window.AdminConfig.getApiBaseUrl();
        } else {
            console.warn('AdminConfig not loaded, using default localhost');
            this.apiBaseUrl = 'http://localhost:3000';
        }
    }

    /**
     * Make API request with retry logic
     */
    async _apiRequest(endpoint, options = {}) {
        const config = window.AdminConfig || { maxRetries: 3, retryDelay: 1000, requestTimeout: 10000 };
        const url = `${this.apiBaseUrl}${endpoint}`;

        for (let attempt = 0; attempt < config.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json();
            } catch (error) {
                console.error(`API request attempt ${attempt + 1} failed:`, error);

                if (attempt === config.maxRetries - 1) {
                    throw error;
                }

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, config.retryDelay));
            }
        }
    }

    /**
     * Fetch all leads from cloud database
     */
    async fetchLeads() {
        try {
            console.log('Fetching leads from cloud database...');
            const leads = await this._apiRequest('/api/leads');
            this.leads = leads;
            this.lastFetchTime = new Date();
            console.log(`Fetched ${leads.length} leads from cloud`);
            return leads;
        } catch (error) {
            console.error('Failed to fetch leads:', error);
            throw new Error(`Unable to connect to CRM backend: ${error.message}`);
        }
    }

    /**
     * Get cached leads (for offline fallback)
     */
    getLeads() {
        return this.leads;
    }

    /**
     * Update lead status in cloud database
     */
    async updateLeadStatus(id, newStatus) {
        try {
            console.log(`Updating lead ${id} status to ${newStatus}...`);
            const updatedLead = await this._apiRequest(`/api/leads/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: newStatus })
            });

            // Update local cache
            const index = this.leads.findIndex(l => l.id === id);
            if (index !== -1) {
                this.leads[index] = updatedLead;
            }

            console.log('Lead status updated successfully');
            return updatedLead;
        } catch (error) {
            console.error('Failed to update lead status:', error);
            throw error;
        }
    }

    /**
     * Simple password check for admin login
     */
    login(password) {
        if (password === ADMIN_PASSWORD_HASH) {
            sessionStorage.setItem('core_admin_auth', 'true');
            return true;
        }
        return false;
    }

    isLoggedIn() {
        return sessionStorage.getItem('core_admin_auth') === 'true';
    }

    logout() {
        sessionStorage.removeItem('core_admin_auth');
        window.location.href = 'admin-login.html';
    }

    /**
     * Check if backend is reachable
     */
    async healthCheck() {
        try {
            await this._apiRequest('/api/leads');
            return true;
        } catch (error) {
            return false;
        }
    }
}

const crmService = new CRMService();
window.crmService = crmService; // Export to window for access from other scripts

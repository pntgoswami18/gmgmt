// In-memory settings cache to reduce database queries during validation
const { pool } = require('../config/sqlite');

class SettingsCache {
  constructor() {
    this.cache = {
      gracePeriodDays: null,
      crossSessionEnabled: null,
      lastUpdate: null
    };
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.intervalId = null;
  }

  /**
   * Initialize cache and start auto-refresh
   */
  async initialize() {
    console.log('🚀 Initializing settings cache...');
    await this.refresh();
    this.startAutoRefresh();
    console.log('✅ Settings cache initialized');
  }

  /**
   * Refresh cache from database
   */
  async refresh() {
    try {
      const settings = await pool.query(`
        SELECT key, value 
        FROM settings 
        WHERE key IN ('payment_grace_period_days', 'cross_session_checkin_restriction')
      `);

      const settingsMap = {};
      settings.rows.forEach(row => {
        settingsMap[row.key] = row.value;
      });

      this.cache = {
        gracePeriodDays: parseInt(settingsMap.payment_grace_period_days || '3', 10),
        crossSessionEnabled: settingsMap.cross_session_checkin_restriction === 'true',
        lastUpdate: Date.now()
      };

      console.log('🔄 Settings cache refreshed:', {
        gracePeriodDays: this.cache.gracePeriodDays,
        crossSessionEnabled: this.cache.crossSessionEnabled,
        lastUpdate: new Date(this.cache.lastUpdate).toISOString()
      });

      return this.cache;
    } catch (error) {
      console.error('❌ Error refreshing settings cache:', error);
      // Return cached values if refresh fails
      return this.cache;
    }
  }

  /**
   * Start automatic cache refresh
   */
  startAutoRefresh() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(async () => {
      console.log('⏰ Auto-refreshing settings cache...');
      await this.refresh();
    }, this.updateInterval);

    console.log(`✅ Auto-refresh started (every ${this.updateInterval / 1000 / 60} minutes)`);
  }

  /**
   * Stop automatic cache refresh
   */
  stopAutoRefresh() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏹️  Auto-refresh stopped');
    }
  }

  /**
   * Get grace period days (cached)
   */
  getGracePeriodDays() {
    return this.cache.gracePeriodDays || 3; // Default 3 days
  }

  /**
   * Get cross-session enabled status (cached)
   */
  getCrossSessionEnabled() {
    return this.cache.crossSessionEnabled !== null 
      ? this.cache.crossSessionEnabled 
      : true; // Default true
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      ...this.cache,
      cacheAge: this.cache.lastUpdate ? Date.now() - this.cache.lastUpdate : null,
      autoRefreshEnabled: !!this.intervalId
    };
  }

  /**
   * Manually invalidate cache (force refresh)
   */
  async invalidate() {
    console.log('🔄 Manually invalidating settings cache...');
    return await this.refresh();
  }
}

// Create singleton instance
const settingsCache = new SettingsCache();

module.exports = settingsCache;


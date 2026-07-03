const { pool } = require('../config/sqlite');
const logger = require('../utils/logger').child({ service: 'settingsCache' });

class SettingsCache {
  constructor() {
    this._map = new Map();
    this._lastUpdate = null;
    this._refreshInterval = 5 * 60 * 1000; // 5 minutes
    this._intervalId = null;
  }

  async initialize() {
    await this.refresh();
    this._intervalId = setInterval(() => this.refresh(), this._refreshInterval);
  }

  async refresh() {
    try {
      const result = await pool.query('SELECT key, value FROM settings');
      this._map = new Map(result.rows.map((r) => [r.key, r.value]));
      this._lastUpdate = Date.now();
    } catch (err) {
      logger.error({ err }, 'settingsCache refresh failed');
    }
    return this;
  }

  async invalidate() {
    return this.refresh();
  }

  stopAutoRefresh() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  // Generic accessor — returns raw string value or defaultValue
  get(key, defaultValue = null) {
    return this._map.has(key) ? this._map.get(key) : defaultValue;
  }

  // Returns boolean: 'true' / true → true, anything else → false
  getBoolean(key, defaultValue = false) {
    if (!this._map.has(key)) return defaultValue;
    const v = this._map.get(key);
    return v === 'true' || v === true;
  }

  // Returns integer, or defaultValue if missing / non-finite
  getInt(key, defaultValue = 0) {
    const parsed = parseInt(this._map.get(key), 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  // Backward-compat wrappers used by biometricController
  getGracePeriodDays() {
    return this.getInt('payment_grace_period_days', 3);
  }

  getCrossSessionEnabled() {
    return this.getBoolean('cross_session_checkin_restriction', true);
  }

  getStats() {
    return {
      size: this._map.size,
      lastUpdate: this._lastUpdate ? new Date(this._lastUpdate).toISOString() : null,
      autoRefreshEnabled: !!this._intervalId,
    };
  }
}

const settingsCache = new SettingsCache();
module.exports = settingsCache;

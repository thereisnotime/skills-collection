'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Default allowed providers when no config exists.
 * Empty array means all providers allowed (no restriction).
 */
var DEFAULT_ALLOWED_PROVIDERS = [];

/**
 * Known provider regions for enforcement.
 */
var PROVIDER_REGIONS = {
  'anthropic': ['us', 'eu'],
  'openai': ['us', 'eu', 'asia'],
  'google': ['us', 'eu', 'asia'],
  'ollama': ['local'],
};

/**
 * Data Residency Controller.
 *
 * Enforces allowed LLM providers and regions based on configuration.
 * Supports air-gapped mode with local-only providers (Ollama).
 *
 * Configuration is loaded from .loki/residency.json:
 * {
 *   "allowed_providers": ["anthropic", "ollama"],
 *   "allowed_regions": ["us", "eu"],
 *   "air_gapped": false
 * }
 */
class ResidencyController {
  /**
   * @param {object} [opts]
   * @param {string} [opts.projectDir] - Project root
   * @param {object} [opts.config] - Direct config override (for testing)
   */
  constructor(opts) {
    opts = opts || {};
    var projectDir = opts.projectDir || process.cwd();
    this._configPath = path.join(projectDir, '.loki', 'residency.json');
    this._config = opts.config || this._loadConfig();
  }

  /**
   * Check if a provider is allowed by the residency policy.
   *
   * @param {string} provider - Provider name (e.g., 'anthropic', 'openai', 'ollama')
   * @param {string} [region] - Region identifier (e.g., 'us', 'eu')
   * @returns {{ allowed: boolean, reason: string|null }}
   */
  checkProvider(provider, region) {
    if (!provider) {
      return { allowed: false, reason: 'Provider name is required' };
    }

    var p = String(provider).toLowerCase();

    // Air-gapped mode: only local providers
    if (this._config.air_gapped) {
      var isLocal = p === 'ollama' || p === 'local';
      return isLocal
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'Air-gapped mode: only local providers (ollama) allowed' };
    }

    // Check allowed providers list
    var allowedProviders = this._config.allowed_providers || [];
    if (allowedProviders.length > 0 && allowedProviders.indexOf(p) === -1) {
      return { allowed: false, reason: 'Provider "' + p + '" not in allowed list: ' + allowedProviders.join(', ') };
    }

    // Check region restrictions
    var allowedRegions = this._config.allowed_regions || [];
    if (allowedRegions.length > 0 && region) {
      var r = String(region).toLowerCase();
      if (allowedRegions.indexOf(r) === -1) {
        return { allowed: false, reason: 'Region "' + r + '" not in allowed list: ' + allowedRegions.join(', ') };
      }
    }

    return { allowed: true, reason: null };
  }

  /**
   * Get the current residency configuration.
   */
  getConfig() {
    return { allowed_providers: (this._config.allowed_providers || []).slice(), allowed_regions: (this._config.allowed_regions || []).slice(), air_gapped: this._config.air_gapped };
  }

  /**
   * Check if air-gapped mode is enabled.
   */
  isAirGapped() {
    return this._config.air_gapped === true;
  }

  /**
   * List allowed providers.
   */
  getAllowedProviders() {
    return (this._config.allowed_providers || []).slice();
  }

  /**
   * List allowed regions.
   */
  getAllowedRegions() {
    return (this._config.allowed_regions || []).slice();
  }

  /**
   * Reload configuration from disk.
   */
  reload() {
    this._config = this._loadConfig();
  }

  // -- Private --

  _loadConfig() {
    try {
      if (fs.existsSync(this._configPath)) {
        var raw = fs.readFileSync(this._configPath, 'utf8');
        var config = JSON.parse(raw);
        return {
          allowed_providers: Array.isArray(config.allowed_providers) ? config.allowed_providers.map(function(p) { return String(p).toLowerCase(); }) : [],
          allowed_regions: Array.isArray(config.allowed_regions) ? config.allowed_regions : [],
          air_gapped: config.air_gapped === true,
        };
      }
    } catch (_) { /* fall through to defaults */ }

    return {
      allowed_providers: DEFAULT_ALLOWED_PROVIDERS,
      allowed_regions: [],
      air_gapped: false,
    };
  }
}

module.exports = {
  ResidencyController: ResidencyController,
  PROVIDER_REGIONS: PROVIDER_REGIONS,
  DEFAULT_ALLOWED_PROVIDERS: DEFAULT_ALLOWED_PROVIDERS,
};

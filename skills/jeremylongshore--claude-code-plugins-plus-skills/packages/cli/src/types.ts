/**
 * Shared types for the ccpi CLI.
 *
 * Types used by more than one command module live here to avoid duplication.
 */

/**
 * Plugin metadata as returned by the marketplace catalog JSON.
 * Both install and upgrade commands consume this shape from the remote catalog.
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  category?: string;
}

/**
 * A locally-installed plugin record (from installed_plugins.json).
 */
export interface InstalledPlugin {
  version: string;
  scope?: string;
  installedAt?: string;
}

/**
 * A pending upgrade record derived by comparing installed vs catalog versions.
 */
export interface PluginUpdate {
  name: string;
  currentVersion: string;
  latestVersion: string;
  description?: string;
}

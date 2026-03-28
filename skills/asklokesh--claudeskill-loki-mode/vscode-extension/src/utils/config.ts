import * as vscode from 'vscode';
import { DEFAULT_API_PORT, DEFAULT_API_HOST, DEFAULT_POLLING_INTERVAL_MS } from './constants';

export type Provider = 'claude' | 'codex' | 'gemini';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LokiConfig {
    provider: Provider;
    apiPort: number;
    apiHost: string;
    autoConnect: boolean;
    showStatusBar: boolean;
    logLevel: LogLevel;
    pollingInterval: number;
    prdPath: string;
}

/**
 * Configuration wrapper for Loki Mode settings.
 * Provides type-safe access to vscode.workspace.getConfiguration('loki')
 */
export class Config {
    private static readonly SECTION = 'loki';

    /**
     * Get the full configuration object
     */
    static getAll(): LokiConfig {
        const config = vscode.workspace.getConfiguration(this.SECTION);
        return {
            provider: config.get<Provider>('provider', 'claude'),
            apiPort: config.get<number>('apiPort', DEFAULT_API_PORT),
            apiHost: config.get<string>('apiHost', DEFAULT_API_HOST),
            autoConnect: config.get<boolean>('autoConnect', true),
            showStatusBar: config.get<boolean>('showStatusBar', true),
            logLevel: config.get<LogLevel>('logLevel', 'info'),
            pollingInterval: config.get<number>('pollingInterval', DEFAULT_POLLING_INTERVAL_MS),
            prdPath: config.get<string>('prdPath', ''),
        };
    }

    /**
     * Get the AI provider setting
     */
    static get provider(): Provider {
        return vscode.workspace.getConfiguration(this.SECTION).get<Provider>('provider', 'claude');
    }

    /**
     * Get the API port setting
     */
    static get apiPort(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('apiPort', DEFAULT_API_PORT);
    }

    /**
     * Get the API host setting
     */
    static get apiHost(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('apiHost', DEFAULT_API_HOST);
    }

    /**
     * Get the full API base URL
     */
    static get apiBaseUrl(): string {
        return `http://${this.apiHost}:${this.apiPort}`;
    }

    /**
     * Get the auto-connect setting
     */
    static get autoConnect(): boolean {
        return vscode.workspace.getConfiguration(this.SECTION).get<boolean>('autoConnect', true);
    }

    /**
     * Get the show status bar setting
     */
    static get showStatusBar(): boolean {
        return vscode.workspace.getConfiguration(this.SECTION).get<boolean>('showStatusBar', true);
    }

    /**
     * Get the log level setting
     */
    static get logLevel(): LogLevel {
        return vscode.workspace.getConfiguration(this.SECTION).get<LogLevel>('logLevel', 'info');
    }

    /**
     * Get the polling interval setting (in milliseconds)
     */
    static get pollingInterval(): number {
        return vscode.workspace.getConfiguration(this.SECTION).get<number>('pollingInterval', DEFAULT_POLLING_INTERVAL_MS);
    }

    /**
     * Get the default PRD path setting
     */
    static get prdPath(): string {
        return vscode.workspace.getConfiguration(this.SECTION).get<string>('prdPath', '');
    }

    /**
     * Update a configuration value
     * @param key The configuration key
     * @param value The new value
     * @param target The configuration target (default: Workspace)
     */
    static async update<K extends keyof LokiConfig>(
        key: K,
        value: LokiConfig[K],
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.SECTION);
        await config.update(key, value, target);
    }

    /**
     * Register a listener for configuration changes
     * @param callback Function to call when configuration changes
     * @returns Disposable to unregister the listener
     */
    static onDidChange(callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(this.SECTION)) {
                callback(e);
            }
        });
    }

    /**
     * Check if a specific configuration key changed
     * @param event The configuration change event
     * @param key The key to check
     */
    static didChange(event: vscode.ConfigurationChangeEvent, key: keyof LokiConfig): boolean {
        return event.affectsConfiguration(`${this.SECTION}.${key}`);
    }
}

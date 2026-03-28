import * as vscode from 'vscode';
import { Config, LogLevel } from './config';

/**
 * Log level priorities for comparison
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * Logger wrapper around VS Code OutputChannel.
 * Provides leveled logging with timestamps and configurable log levels.
 */
export class Logger {
    private static instance: Logger | null = null;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Loki Mode');
        this.logLevel = Config.logLevel;

        // Listen for configuration changes
        Config.onDidChange((e) => {
            if (Config.didChange(e, 'logLevel')) {
                this.logLevel = Config.logLevel;
                this.info(`Log level changed to: ${this.logLevel}`);
            }
        });
    }

    /**
     * Get the singleton Logger instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Dispose the logger and release resources
     */
    static dispose(): void {
        if (Logger.instance) {
            Logger.instance.outputChannel.dispose();
            Logger.instance = null;
        }
    }

    /**
     * Check if a message at the given level should be logged
     */
    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.logLevel];
    }

    /**
     * Format a log message with timestamp and level
     */
    private formatMessage(level: LogLevel, message: string): string {
        const timestamp = new Date().toISOString();
        const levelStr = level.toUpperCase().padEnd(5);
        return `[${timestamp}] [${levelStr}] ${message}`;
    }

    /**
     * Log a message at the specified level
     */
    private log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (!this.shouldLog(level)) {
            return;
        }

        let formattedMessage = message;
        if (args.length > 0) {
            formattedMessage = `${message} ${args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ')}`;
        }

        this.outputChannel.appendLine(this.formatMessage(level, formattedMessage));
    }

    /**
     * Log a debug message
     */
    debug(message: string, ...args: unknown[]): void {
        this.log('debug', message, ...args);
    }

    /**
     * Log an info message
     */
    info(message: string, ...args: unknown[]): void {
        this.log('info', message, ...args);
    }

    /**
     * Log a warning message
     */
    warn(message: string, ...args: unknown[]): void {
        this.log('warn', message, ...args);
    }

    /**
     * Log an error message
     */
    error(message: string, ...args: unknown[]): void {
        this.log('error', message, ...args);
    }

    /**
     * Log an error with stack trace
     */
    errorWithStack(message: string, error: Error): void {
        this.error(`${message}: ${error.message}`);
        if (error.stack) {
            this.error(`Stack trace:\n${error.stack}`);
        }
    }

    /**
     * Show the output channel in the VS Code panel
     */
    show(preserveFocus: boolean = true): void {
        this.outputChannel.show(preserveFocus);
    }

    /**
     * Hide the output channel
     */
    hide(): void {
        this.outputChannel.hide();
    }

    /**
     * Clear all log messages
     */
    clear(): void {
        this.outputChannel.clear();
    }

    /**
     * Get the underlying OutputChannel for disposal
     */
    getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }
}

// Export convenience functions for direct logging
export const logger = {
    debug: (message: string, ...args: unknown[]) => Logger.getInstance().debug(message, ...args),
    info: (message: string, ...args: unknown[]) => Logger.getInstance().info(message, ...args),
    warn: (message: string, ...args: unknown[]) => Logger.getInstance().warn(message, ...args),
    error: (message: string, ...args: unknown[]) => Logger.getInstance().error(message, ...args),
    errorWithStack: (message: string, error: Error) => Logger.getInstance().errorWithStack(message, error),
    show: (preserveFocus?: boolean) => Logger.getInstance().show(preserveFocus),
    hide: () => Logger.getInstance().hide(),
    clear: () => Logger.getInstance().clear(),
};

/**
 * Loki CLI Detector
 * Functions to detect and validate the Loki CLI installation
 */

import { exec, execFile } from 'child_process';
import { access, constants } from 'fs/promises';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { DEFAULT_API_PORT } from '../utils/constants';
import { parseHealthResponse } from '../api/validators';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Common installation locations for the loki CLI
 */
const COMMON_LOCATIONS = [
    // npm global installations
    '/usr/local/bin/loki',
    '/usr/bin/loki',
    // Homebrew
    '/opt/homebrew/bin/loki',
    '/usr/local/opt/loki-mode/bin/loki',
    // User-local installations
    path.join(os.homedir(), '.local/bin/loki'),
    path.join(os.homedir(), '.npm-global/bin/loki'),
    path.join(os.homedir(), 'bin/loki'),
    // Windows locations
    path.join(os.homedir(), 'AppData/Roaming/npm/loki.cmd'),
    'C:/Program Files/nodejs/loki.cmd',
];

/**
 * Version info returned by getLokiVersion
 */
export interface VersionInfo {
    version: string;
    fullOutput: string;
}

/**
 * Detection result with path and version
 */
export interface DetectionResult {
    found: boolean;
    path: string | null;
    version: string | null;
    source: 'path' | 'common' | 'not_found';
}

/**
 * Check if a file exists and is executable
 */
async function isExecutable(filePath: string): Promise<boolean> {
    try {
        await access(filePath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Try to find loki using the which/where command
 */
async function findInPath(): Promise<string | null> {
    const command = process.platform === 'win32' ? 'where' : 'which';

    try {
        const { stdout } = await execAsync(`${command} loki`, {
            timeout: 5000,
            env: { ...process.env },
        });

        const lokiPath = stdout.trim().split('\n')[0];
        if (lokiPath && await isExecutable(lokiPath)) {
            return lokiPath;
        }
    } catch {
        // Command not found or error
    }

    return null;
}

/**
 * Try to find loki in common installation locations
 */
async function findInCommonLocations(): Promise<string | null> {
    for (const location of COMMON_LOCATIONS) {
        if (await isExecutable(location)) {
            return location;
        }
    }
    return null;
}

/**
 * Detect the loki CLI installation
 * @returns Path to loki CLI or null if not found
 */
export async function detectLokiCli(): Promise<string | null> {
    // First, try PATH
    const pathResult = await findInPath();
    if (pathResult) {
        return pathResult;
    }

    // Then, try common locations
    const commonResult = await findInCommonLocations();
    if (commonResult) {
        return commonResult;
    }

    return null;
}

/**
 * Detect the loki CLI with detailed result
 * @returns Detection result with path, version, and source
 */
export async function detectLokiCliDetailed(): Promise<DetectionResult> {
    // First, try PATH
    const pathResult = await findInPath();
    if (pathResult) {
        const version = await getLokiVersion(pathResult);
        return {
            found: true,
            path: pathResult,
            version,
            source: 'path',
        };
    }

    // Then, try common locations
    const commonResult = await findInCommonLocations();
    if (commonResult) {
        const version = await getLokiVersion(commonResult);
        return {
            found: true,
            path: commonResult,
            version,
            source: 'common',
        };
    }

    return {
        found: false,
        path: null,
        version: null,
        source: 'not_found',
    };
}

/**
 * Get the version of the loki CLI
 * @param cliPath - Path to the loki executable
 * @returns Version string or null if unable to determine
 */
export async function getLokiVersion(cliPath: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(cliPath, ['--version'], {
            timeout: 5000,
        });

        // Parse version from output
        // Expected formats: "loki-mode v5.4.0", "5.4.0", "v5.4.0"
        const output = stdout.trim();
        const versionMatch = output.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);

        if (versionMatch) {
            return versionMatch[1];
        }

        // Return raw output if no version pattern found
        return output || null;
    } catch {
        return null;
    }
}

/**
 * Get detailed version info
 * @param cliPath - Path to the loki executable
 * @returns Version info with parsed version and full output
 */
export async function getLokiVersionInfo(cliPath: string): Promise<VersionInfo | null> {
    try {
        const { stdout } = await execFileAsync(cliPath, ['--version'], {
            timeout: 5000,
        });

        const output = stdout.trim();
        const versionMatch = output.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);

        return {
            version: versionMatch ? versionMatch[1] : output,
            fullOutput: output,
        };
    } catch {
        return null;
    }
}

/**
 * Check if a TCP port is in use (server is running)
 * @param port - Port number to check
 * @param host - Host to check (default: localhost)
 * @returns true if port is in use, false otherwise
 */
export async function isServerRunning(port: number, host: string = 'localhost'): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        const cleanup = () => {
            socket.removeAllListeners();
            socket.destroy();
        };

        socket.setTimeout(2000);

        socket.on('connect', () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(true);
            }
        });

        socket.on('timeout', () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(false);
            }
        });

        socket.on('error', () => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(false);
            }
        });

        socket.connect(port, host);
    });
}

/**
 * Check if the Loki server is running on the default port
 * @param port - Port to check (default: DEFAULT_API_PORT)
 * @returns true if server is running
 */
export async function isLokiServerRunning(port: number = DEFAULT_API_PORT): Promise<boolean> {
    // First check if port is in use
    const portInUse = await isServerRunning(port);
    if (!portInUse) {
        return false;
    }

    // Then verify it's actually a Loki server by hitting health endpoint
    try {
        const response = await fetch(`http://localhost:${port}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
            const rawData = await response.json();
            const data = parseHealthResponse(rawData);
            return data.status === 'ok';
        }
    } catch {
        // Not a Loki server or server not responding to HTTP
    }

    return false;
}

/**
 * Wait for the server to become available
 * @param port - Port to check
 * @param timeout - Maximum time to wait in ms (default: 30000)
 * @param interval - Check interval in ms (default: 500)
 * @returns true if server became available, false if timeout
 */
export async function waitForServer(
    port: number = DEFAULT_API_PORT,
    timeout: number = 30000,
    interval: number = 500
): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        if (await isLokiServerRunning(port)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }

    return false;
}

/**
 * Validate the CLI is working correctly
 * @param cliPath - Path to the loki executable
 * @returns true if CLI is functional
 */
export async function validateCli(cliPath: string): Promise<boolean> {
    try {
        // Try to run --help to verify CLI is functional
        const { stdout, stderr } = await execFileAsync(cliPath, ['--help'], {
            timeout: 5000,
        });

        // Check for expected help output keywords
        const output = (stdout + stderr).toLowerCase();
        return output.includes('loki') || output.includes('usage') || output.includes('help');
    } catch {
        return false;
    }
}

/**
 * Get available loki subcommands
 * @param cliPath - Path to the loki executable
 * @returns Array of available subcommands
 */
export async function getAvailableCommands(cliPath: string): Promise<string[]> {
    try {
        const { stdout } = await execFileAsync(cliPath, ['--help'], {
            timeout: 5000,
        });

        // Parse commands from help output
        // Look for patterns like "  command    description" or "command:"
        const commands: string[] = [];
        const lines = stdout.split('\n');

        for (const line of lines) {
            // Match command patterns in help output
            const match = line.match(/^\s{2,4}(\w+(?:-\w+)*)\s{2,}/);
            if (match && match[1]) {
                commands.push(match[1]);
            }
        }

        return commands;
    } catch {
        return [];
    }
}

export default {
    detectLokiCli,
    detectLokiCliDetailed,
    getLokiVersion,
    getLokiVersionInfo,
    isServerRunning,
    isLokiServerRunning,
    waitForServer,
    validateCli,
    getAvailableCommands,
};

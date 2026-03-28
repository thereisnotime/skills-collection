/**
 * Loki CLI Executor
 * Class to execute Loki CLI commands and manage the server process
 */

import { spawn, ChildProcess, SpawnOptions, execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { detectLokiCli, waitForServer, isLokiServerRunning } from './detector';
import { DEFAULT_API_PORT } from '../utils/constants';

const execFileAsync = promisify(execFile);

/**
 * Command execution result
 */
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    success: boolean;
}

/**
 * Server process state
 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Executor configuration options
 */
export interface ExecutorConfig {
    cliPath?: string;
    serverPort?: number;
    startupTimeout?: number;
    commandTimeout?: number;
    env?: Record<string, string>;
    cwd?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ExecutorConfig, 'env' | 'cwd'>> = {
    cliPath: '',
    serverPort: DEFAULT_API_PORT,
    startupTimeout: 30000,
    commandTimeout: 60000,
};

/**
 * Events emitted by CliExecutor
 */
export interface CliExecutorEvents {
    'server:starting': () => void;
    'server:started': (port: number) => void;
    'server:stopping': () => void;
    'server:stopped': (code: number | null) => void;
    'server:error': (error: Error) => void;
    'server:output': (data: string) => void;
    'server:stderr': (data: string) => void;
}

/**
 * CliExecutor - Execute Loki CLI commands and manage the server
 */
export class CliExecutor extends EventEmitter {
    private config: Required<Omit<ExecutorConfig, 'env' | 'cwd'>> & Pick<ExecutorConfig, 'env' | 'cwd'>;
    private serverProcess: ChildProcess | null = null;
    private _serverState: ServerState = 'stopped';
    private _cliPath: string | null = null;
    private outputBuffer: string = '';
    private stderrBuffer: string = '';

    /**
     * Create a new CLI executor
     * @param config - Configuration options
     */
    constructor(config?: ExecutorConfig) {
        super();
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }

    /**
     * Get current server state
     */
    get serverState(): ServerState {
        return this._serverState;
    }

    /**
     * Get CLI path (cached after first detection)
     */
    get cliPath(): string | null {
        return this._cliPath;
    }

    /**
     * Get collected server output
     */
    get serverOutput(): string {
        return this.outputBuffer;
    }

    /**
     * Get collected server stderr
     */
    get serverStderr(): string {
        return this.stderrBuffer;
    }

    /**
     * Set server state and emit event
     */
    private setServerState(state: ServerState): void {
        this._serverState = state;
    }

    /**
     * Ensure CLI path is available
     */
    private async ensureCliPath(): Promise<string> {
        if (this._cliPath) {
            return this._cliPath;
        }

        if (this.config.cliPath) {
            this._cliPath = this.config.cliPath;
            return this._cliPath;
        }

        const detectedPath = await detectLokiCli();
        if (!detectedPath) {
            throw new Error(
                'Loki CLI not found. Please install it via npm (npm install -g loki-mode), ' +
                'Homebrew (brew install loki-mode), or specify the path in settings.'
            );
        }

        this._cliPath = detectedPath;
        return this._cliPath;
    }

    /**
     * Build spawn options
     */
    private buildSpawnOptions(timeout?: number): SpawnOptions {
        return {
            cwd: this.config.cwd,
            env: {
                ...process.env,
                ...this.config.env,
                FORCE_COLOR: '0', // Disable color codes for parsing
            },
            timeout: timeout || this.config.commandTimeout,
            shell: process.platform === 'win32',
            windowsHide: true,
        };
    }

    /**
     * Start the Loki server
     * @returns Promise that resolves when server is ready
     */
    async startServer(): Promise<void> {
        // Check if already running
        if (this._serverState === 'running') {
            return;
        }

        // Check if server is already running (from another process)
        if (await isLokiServerRunning(this.config.serverPort)) {
            this.setServerState('running');
            this.emit('server:started', this.config.serverPort);
            return;
        }

        if (this._serverState === 'starting') {
            throw new Error('Server is already starting');
        }

        const cliPath = await this.ensureCliPath();

        this.setServerState('starting');
        this.emit('server:starting');
        this.outputBuffer = '';
        this.stderrBuffer = '';

        return new Promise((resolve, reject) => {
            const args = ['serve', '--port', String(this.config.serverPort)];

            this.serverProcess = spawn(cliPath, args, {
                ...this.buildSpawnOptions(),
                detached: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            // Handle stdout
            this.serverProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                this.outputBuffer += output;
                this.emit('server:output', output);
            });

            // Handle stderr
            this.serverProcess.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                this.stderrBuffer += output;
                this.emit('server:stderr', output);
            });

            // Handle process exit
            this.serverProcess.on('exit', (code, _signal) => {
                this.serverProcess = null;
                this.setServerState('stopped');
                this.emit('server:stopped', code);

                // If we're still waiting for startup, reject
                if (this._serverState === 'starting') {
                    reject(new Error(`Server exited during startup with code ${code}`));
                }
            });

            // Handle process error
            this.serverProcess.on('error', (error) => {
                this.serverProcess = null;
                this.setServerState('error');
                this.emit('server:error', error);
                reject(error);
            });

            // Wait for server to be ready
            waitForServer(this.config.serverPort, this.config.startupTimeout)
                .then((ready) => {
                    if (ready) {
                        this.setServerState('running');
                        this.emit('server:started', this.config.serverPort);
                        resolve();
                    } else {
                        this.setServerState('error');
                        const error = new Error('Server failed to start within timeout');
                        this.emit('server:error', error);
                        // Try to kill the process
                        this.serverProcess?.kill();
                        reject(error);
                    }
                })
                .catch(reject);
        });
    }

    /**
     * Stop the Loki server
     * @param force - Force kill if graceful shutdown fails
     */
    async stopServer(force: boolean = false): Promise<void> {
        if (this._serverState === 'stopped') {
            return;
        }

        if (!this.serverProcess) {
            // Server might be running from another process
            // Just update our state
            this.setServerState('stopped');
            return;
        }

        this.setServerState('stopping');
        this.emit('server:stopping');

        return new Promise((resolve) => {
            if (!this.serverProcess) {
                this.setServerState('stopped');
                resolve();
                return;
            }

            const killTimeout = setTimeout(() => {
                if (this.serverProcess) {
                    this.serverProcess.kill('SIGKILL');
                }
            }, force ? 0 : 5000);

            this.serverProcess.once('exit', (code) => {
                clearTimeout(killTimeout);
                this.serverProcess = null;
                this.setServerState('stopped');
                this.emit('server:stopped', code);
                resolve();
            });

            // Send graceful shutdown signal
            this.serverProcess.kill(force ? 'SIGKILL' : 'SIGTERM');
        });
    }

    /**
     * Execute a CLI command
     * @param command - Subcommand to execute
     * @param args - Arguments for the command
     * @param timeout - Command timeout in ms
     * @returns Execution result
     */
    async executeCommand(
        command: string,
        args: string[] = [],
        timeout?: number
    ): Promise<ExecutionResult> {
        const cliPath = await this.ensureCliPath();
        const fullArgs = [command, ...args];

        try {
            const { stdout, stderr } = await execFileAsync(
                cliPath,
                fullArgs,
                {
                    cwd: this.config.cwd,
                    env: {
                        ...process.env,
                        ...this.config.env,
                        FORCE_COLOR: '0',
                    },
                    timeout: timeout || this.config.commandTimeout,
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                }
            );

            return {
                stdout,
                stderr,
                code: 0,
                signal: null,
                success: true,
            };
        } catch (error: unknown) {
            const execError = error as { stdout?: string; stderr?: string; code?: number; signal?: NodeJS.Signals };
            return {
                stdout: execError.stdout || '',
                stderr: execError.stderr || (error as Error).message,
                code: execError.code ?? 1,
                signal: execError.signal || null,
                success: false,
            };
        }
    }

    /**
     * Execute a command and stream output
     * @param command - Subcommand to execute
     * @param args - Arguments for the command
     * @param onOutput - Callback for stdout data
     * @param onError - Callback for stderr data
     * @returns Promise that resolves with exit code
     */
    async executeCommandStreaming(
        command: string,
        args: string[] = [],
        onOutput?: (data: string) => void,
        onError?: (data: string) => void
    ): Promise<number> {
        const cliPath = await this.ensureCliPath();
        const fullArgs = [command, ...args];

        return new Promise((resolve, reject) => {
            const proc = spawn(cliPath, fullArgs, {
                ...this.buildSpawnOptions(),
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            proc.stdout?.on('data', (data: Buffer) => {
                onOutput?.(data.toString());
            });

            proc.stderr?.on('data', (data: Buffer) => {
                onError?.(data.toString());
            });

            proc.on('exit', (code, _signal) => {
                resolve(code ?? 0);
            });

            proc.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Get CLI help text
     * @param command - Optional subcommand to get help for
     */
    async getHelp(command?: string): Promise<string> {
        const args = command ? [command, '--help'] : ['--help'];
        const result = await this.executeCommand(args[0], args.slice(1));
        return result.stdout || result.stderr;
    }

    /**
     * Get CLI version
     */
    async getVersion(): Promise<string> {
        const result = await this.executeCommand('--version', []);
        const output = result.stdout || result.stderr;
        const match = output.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
        return match ? match[1] : output.trim();
    }

    /**
     * Check if server is currently managed by this executor
     */
    isServerManaged(): boolean {
        return this.serverProcess !== null;
    }

    /**
     * Send input to the server process stdin
     * @param input - Input string to send
     */
    async sendInput(input: string): Promise<void> {
        if (!this.serverProcess || !this.serverProcess.stdin) {
            throw new Error('Server process is not running or stdin is not available');
        }

        return new Promise((resolve, reject) => {
            this.serverProcess!.stdin!.write(input + '\n', (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Clean up resources
     */
    async dispose(): Promise<void> {
        await this.stopServer(true);
        this.removeAllListeners();
    }
}

/**
 * Create a new CLI executor
 * @param config - Configuration options
 */
export function createExecutor(config?: ExecutorConfig): CliExecutor {
    return new CliExecutor(config);
}

/**
 * Default export
 */
export default CliExecutor;

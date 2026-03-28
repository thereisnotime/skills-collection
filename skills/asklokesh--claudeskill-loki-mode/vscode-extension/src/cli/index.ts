/**
 * CLI Module Exports
 * Re-exports all CLI detector and executor functionality
 */

// Detector
export {
    detectLokiCli,
    detectLokiCliDetailed,
    getLokiVersion,
    getLokiVersionInfo,
    isServerRunning,
    isLokiServerRunning,
    waitForServer,
    validateCli,
    getAvailableCommands,
} from './detector';
export type { VersionInfo, DetectionResult } from './detector';

// Executor
export { CliExecutor, createExecutor } from './executor';
export type { ExecutionResult, ServerState, ExecutorConfig, CliExecutorEvents } from './executor';
export { default as Executor } from './executor';

import * as vscode from 'vscode';

/**
 * Status states for the Loki Mode status bar
 */
export type StatusState = 'idle' | 'running' | 'paused' | 'error';

/**
 * Configuration for status bar display
 */
interface StatusConfig {
    text: string;
    tooltip: string;
    icon: string;
    color?: string;
    backgroundColor?: string;
}

/**
 * Manages the Loki Mode status bar item
 * Shows current session state and provides quick actions
 */
export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private state: StatusState = 'idle';
    private currentPhase: string = '';
    private completedTasks: number = 0;
    private totalTasks: number = 0;
    private provider: string = 'claude';

    constructor() {
        // Create status bar item on the left side with high priority
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );

        // Set command to open quick pick menu
        this.statusBarItem.command = 'loki.showQuickPick';

        // Initialize with idle state
        this.updateDisplay();
        this.statusBarItem.show();
    }

    /**
     * Set the current state of the status bar
     */
    setState(state: StatusState): void {
        this.state = state;
        this.updateDisplay();
    }

    /**
     * Update the current phase
     */
    setPhase(phase: string): void {
        this.currentPhase = phase;
        this.updateDisplay();
    }

    /**
     * Update task counts
     */
    setTaskCounts(completed: number, total: number): void {
        this.completedTasks = completed;
        this.totalTasks = total;
        this.updateDisplay();
    }

    /**
     * Set the current provider
     */
    setProvider(provider: string): void {
        this.provider = provider;
        this.updateDisplay();
    }

    /**
     * Update all status information at once
     */
    updateStatus(options: {
        state?: StatusState;
        phase?: string;
        completedTasks?: number;
        totalTasks?: number;
        provider?: string;
    }): void {
        if (options.state !== undefined) {
            this.state = options.state;
        }
        if (options.phase !== undefined) {
            this.currentPhase = options.phase;
        }
        if (options.completedTasks !== undefined) {
            this.completedTasks = options.completedTasks;
        }
        if (options.totalTasks !== undefined) {
            this.totalTasks = options.totalTasks;
        }
        if (options.provider !== undefined) {
            this.provider = options.provider;
        }
        this.updateDisplay();
    }

    /**
     * Get the current state
     */
    getState(): StatusState {
        return this.state;
    }

    /**
     * Show the status bar item
     */
    show(): void {
        this.statusBarItem.show();
    }

    /**
     * Hide the status bar item
     */
    hide(): void {
        this.statusBarItem.hide();
    }

    /**
     * Dispose of the status bar item
     */
    dispose(): void {
        this.statusBarItem.dispose();
    }

    private updateDisplay(): void {
        const config = this.getStatusConfig();

        this.statusBarItem.text = config.text;
        this.statusBarItem.tooltip = this.buildTooltip(config.tooltip);

        if (config.color) {
            this.statusBarItem.color = new vscode.ThemeColor(config.color);
        } else {
            this.statusBarItem.color = undefined;
        }

        if (config.backgroundColor) {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(config.backgroundColor);
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    private getStatusConfig(): StatusConfig {
        switch (this.state) {
            case 'running':
                return {
                    text: this.buildRunningText(),
                    tooltip: 'Loki Mode is running',
                    icon: '$(sync~spin)',
                    color: 'statusBarItem.warningForeground',
                    backgroundColor: 'statusBarItem.warningBackground'
                };

            case 'paused':
                return {
                    text: '$(debug-pause) Loki: Paused',
                    tooltip: 'Loki Mode is paused',
                    icon: '$(debug-pause)',
                    color: 'statusBarItem.warningForeground'
                };

            case 'error':
                return {
                    text: '$(error) Loki: Error',
                    tooltip: 'Loki Mode encountered an error',
                    icon: '$(error)',
                    color: 'statusBarItem.errorForeground',
                    backgroundColor: 'statusBarItem.errorBackground'
                };

            case 'idle':
            default:
                return {
                    text: '$(rocket) Loki Mode',
                    tooltip: 'Click to start Loki Mode',
                    icon: '$(rocket)'
                };
        }
    }

    private buildRunningText(): string {
        const parts: string[] = ['$(sync~spin) Loki'];

        // Add phase if available
        if (this.currentPhase) {
            parts.push(`: ${this.shortenPhase(this.currentPhase)}`);
        }

        // Add task count if available
        if (this.totalTasks > 0) {
            parts.push(` (${this.completedTasks}/${this.totalTasks})`);
        }

        return parts.join('');
    }

    private shortenPhase(phase: string): string {
        // Shorten long phase names for status bar
        const maxLength = 15;
        if (phase.length > maxLength) {
            return phase.substring(0, maxLength - 3) + '...';
        }
        return phase;
    }

    private buildTooltip(_baseTooltip: string): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;

        md.appendMarkdown(`**Loki Mode**\n\n`);
        md.appendMarkdown(`Status: ${this.getStatusText()}\n\n`);

        if (this.state !== 'idle') {
            md.appendMarkdown(`Provider: ${this.formatProvider()}\n\n`);

            if (this.currentPhase) {
                md.appendMarkdown(`Phase: ${this.currentPhase}\n\n`);
            }

            if (this.totalTasks > 0) {
                const progress = Math.round((this.completedTasks / this.totalTasks) * 100);
                md.appendMarkdown(`Progress: ${this.completedTasks}/${this.totalTasks} tasks (${progress}%)\n\n`);
            }
        }

        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(`Click for actions menu`);

        return md;
    }

    private getStatusText(): string {
        switch (this.state) {
            case 'running':
                return 'Running';
            case 'paused':
                return 'Paused';
            case 'error':
                return 'Error';
            case 'idle':
            default:
                return 'Idle';
        }
    }

    private formatProvider(): string {
        switch (this.provider) {
            case 'claude':
                return 'Claude Code';
            case 'codex':
                return 'OpenAI Codex';
            case 'gemini':
                return 'Google Gemini';
            default:
                return this.provider;
        }
    }
}

/**
 * Show the quick pick menu for Loki Mode actions
 */
export async function showQuickPickMenu(statusManager: StatusBarManager): Promise<string | undefined> {
    const state = statusManager.getState();
    const items: vscode.QuickPickItem[] = [];

    if (state === 'idle') {
        items.push({
            label: '$(rocket) Start Session',
            description: 'Start a new Loki Mode session',
            detail: 'Select a PRD file to begin autonomous development'
        });
    }

    if (state === 'running') {
        items.push({
            label: '$(debug-pause) Pause Session',
            description: 'Pause the current session',
            detail: 'Temporarily halt execution'
        });
    }

    if (state === 'paused') {
        items.push({
            label: '$(debug-continue) Resume Session',
            description: 'Resume the paused session',
            detail: 'Continue from where you left off'
        });
    }

    if (state !== 'idle') {
        items.push({
            label: '$(debug-stop) Stop Session',
            description: 'Stop the current session',
            detail: 'End the session completely'
        });

        items.push({
            label: '$(edit) Inject Input',
            description: 'Send human input to the session',
            detail: 'Provide guidance or corrections'
        });
    }

    items.push({
        label: '$(refresh) Refresh Status',
        description: 'Refresh task and session status',
        detail: 'Sync with the latest state'
    });

    items.push({
        label: '$(info) Show Status',
        description: 'Show detailed status notification',
        detail: 'View current session information'
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an action',
        title: 'Loki Mode Actions'
    });

    if (!selected) {
        return undefined;
    }

    // Return the command to execute based on selection
    if (selected.label.includes('Start')) {
        return 'loki.start';
    } else if (selected.label.includes('Pause')) {
        return 'loki.pause';
    } else if (selected.label.includes('Resume')) {
        return 'loki.resume';
    } else if (selected.label.includes('Stop')) {
        return 'loki.stop';
    } else if (selected.label.includes('Inject')) {
        return 'loki.injectInput';
    } else if (selected.label.includes('Refresh')) {
        return 'loki.refreshTasks';
    } else if (selected.label.includes('Status')) {
        return 'loki.status';
    }

    return undefined;
}

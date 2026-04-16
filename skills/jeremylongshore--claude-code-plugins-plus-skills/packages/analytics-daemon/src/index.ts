#!/usr/bin/env node

import { homedir } from 'os';
import { join } from 'path';
import { ConversationWatcher } from './watcher.js';
import { AnalyticsServer } from './server.js';
import { AnalyticsAPI } from './api.js';
import { AttributionEngine } from './attribution.js';
import type { AnalyticsEvent } from './types.js';
import type { AttributionEvent } from './attribution.js';

/**
 * Claude Code Analytics Daemon
 *
 * Monitors ~/.claude/conversations/ for plugin usage, skill triggers, and LLM calls.
 * Broadcasts real-time events via WebSocket for dashboard consumption.
 * Provides HTTP API for querying session data.
 */

const DEFAULT_WS_PORT = 3456;
const DEFAULT_API_PORT = 3333;
const DEFAULT_HOST = 'localhost';

/**
 * Safely extract a string value from an unknown metadata field.
 * Returns undefined if the value is absent or not a string.
 */
function stringMeta(
  meta: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const val = meta?.[key];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Main daemon class
 */
class AnalyticsDaemon {
  private watcher: ConversationWatcher;
  private server: AnalyticsServer;
  private api: AnalyticsAPI;
  private attribution: AttributionEngine;
  private conversationsPath: string;

  constructor() {
    this.conversationsPath = join(homedir(), '.claude', 'conversations');

    this.watcher = new ConversationWatcher({
      conversationsPath: this.conversationsPath,
      debounceMs: 500,
      ignoreInitial: true,
    });

    this.server = new AnalyticsServer({
      port: parseInt(process.env.CCP_ANALYTICS_PORT ?? String(DEFAULT_WS_PORT)),
      host: process.env.CCP_ANALYTICS_HOST ?? DEFAULT_HOST,
    });

    this.attribution = new AttributionEngine();

    this.api = new AnalyticsAPI(this.watcher, this.server, this.attribution, {
      port: parseInt(process.env.CCP_API_PORT ?? String(DEFAULT_API_PORT)),
      host: process.env.CCP_API_HOST ?? DEFAULT_HOST,
    });

    this.watcher.on('event', (event: AnalyticsEvent) => {
      this.handleEvent(event);
    });

    this.watcher.on('error', (error: Error) => {
      console.error('Watcher error:', error);
    });

    this.attribution.onAttribution((event: AttributionEvent) => {
      this.handleAttributionEvent(event);
    });
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Claude Code Analytics Daemon');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log();

    try {
      await this.attribution.initialize();
      console.log('✓ Attribution engine initialized');

      await this.api.start();
      console.log();

      await this.server.start();
      console.log();

      this.watcher.start();
      console.log();

      console.log('✓ Daemon started successfully');
      console.log(`  Watching: ${this.conversationsPath}`);
      console.log(`  WebSocket: ws://${this.server.getStatus().host}:${this.server.getStatus().port}`);
      console.log();
      console.log('Press Ctrl+C to stop');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (error) {
      console.error('Failed to start daemon:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the daemon
   */
  async stop(): Promise<void> {
    console.log('\nStopping daemon...');
    await this.watcher.stop();
    await this.server.stop();
    await this.api.stop();
    console.log('Daemon stopped');
  }

  /**
   * Handle analytics event
   */
  private handleEvent(event: AnalyticsEvent): void {
    console.log(`[${new Date(event.timestamp).toISOString()}] ${event.type}`);
    this.server.broadcast(event);

    switch (event.type) {
      case 'plugin.activation':
        console.log(`  Plugin: ${event.pluginName}`);
        break;
      case 'skill.trigger':
        console.log(`  Skill: ${event.skillName} (${event.pluginName})`);
        break;
      case 'llm.call':
        console.log(`  Model: ${event.model}, Tokens: ${event.totalTokens}`);
        break;
      case 'cost.update':
        console.log(`  Cost: ${event.totalCost} ${event.currency}`);
        break;
      case 'rate_limit.warning':
        console.log(`  Service: ${event.service}, Usage: ${event.current}/${event.limit}`);
        break;
      case 'mcp.tool_call':
        console.log(`  MCP Tool: ${event.toolName}${event.mcpServer ? ` (${event.mcpServer})` : ''}`);
        break;
    }

    if (event.type === 'conversation.updated' || event.type === 'conversation.created') {
      const conversation = this.watcher.getConversation(event.conversationId);
      if (conversation) {
        this.attribution.analyzeConversation(conversation).catch((error) => {
          console.error('Error analyzing conversation for attribution:', error);
        });
      }
    }
  }

  /**
   * Handle attribution event
   */
  private handleAttributionEvent(event: AttributionEvent): void {
    let analyticsEvent: AnalyticsEvent;

    switch (event.type) {
      case 'plugin':
        analyticsEvent = {
          type: 'plugin.activation',
          timestamp: event.timestamp,
          conversationId: event.conversationId,
          pluginName: event.name,
          marketplace: stringMeta(event.metadata, 'marketplace'),
        };
        break;

      case 'skill':
        analyticsEvent = {
          type: 'skill.trigger',
          timestamp: event.timestamp,
          conversationId: event.conversationId,
          skillName: event.name,
          pluginName: stringMeta(event.metadata, 'pluginName') ?? 'unknown',
        };
        break;

      case 'mcp':
        analyticsEvent = {
          type: 'mcp.tool_call',
          timestamp: event.timestamp,
          conversationId: event.conversationId,
          toolName: event.name,
          mcpServer: stringMeta(event.metadata, 'mcpServer'),
        };
        break;
    }

    this.server.broadcast(analyticsEvent);
  }

  /**
   * Get daemon status
   */
  getStatus(): {
    watcher: {
      conversationsPath: string;
      conversationCount: number;
    };
    server: {
      running: boolean;
      clients: number;
      host: string;
      port: number;
    };
    attribution: {
      pluginCount: number;
      skillCount: number;
      mcpToolCount: number;
      lastUpdated: number;
    };
  } {
    const stats = this.attribution.getStats();
    return {
      watcher: {
        conversationsPath: this.conversationsPath,
        conversationCount: this.watcher.getConversations().length,
      },
      server: this.server.getStatus(),
      attribution: {
        pluginCount: stats.plugins.size,
        skillCount: stats.skills.size,
        mcpToolCount: stats.mcpTools.size,
        lastUpdated: stats.lastUpdated,
      },
    };
  }

  /**
   * Get attribution engine (for API access)
   */
  getAttributionEngine(): AttributionEngine {
    return this.attribution;
  }
}

/**
 * CLI entry point
 */
async function main() {
  const daemon = new AnalyticsDaemon();

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });

  await daemon.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { AnalyticsDaemon };

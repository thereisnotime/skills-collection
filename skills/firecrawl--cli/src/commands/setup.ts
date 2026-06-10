/**
 * Setup command implementation
 * Installs firecrawl skill files and MCP server into AI coding agents
 */

import { execSync } from 'child_process';
import readline from 'readline';
import { getApiKey } from '../utils/config';
import {
  buildSkillsInstallArgs,
  cleanNpmEnv,
  SKILL_REPOS,
  WORKFLOW_SKILL_REPOS,
} from './skills-install';
import { hasNpx, installSkillsNative } from './skills-native';
import {
  configureWebDefaults,
  WEB_AGENTS,
  type WebAgent,
} from '../utils/web-defaults';

export type SetupSubcommand = 'skills' | 'workflows' | 'mcp' | 'defaults';

export interface SetupOptions {
  global?: boolean;
  agent?: string;
  undo?: boolean;
  /** Skip the interactive harness picker and apply to all agents. */
  yes?: boolean;
}

/**
 * Main setup command handler
 */
export async function handleSetupCommand(
  subcommand: SetupSubcommand,
  options: SetupOptions = {}
): Promise<void> {
  switch (subcommand) {
    case 'skills':
      await installSkills(options, SKILL_REPOS);
      break;
    case 'workflows':
      await installSkills(options, WORKFLOW_SKILL_REPOS);
      break;
    case 'mcp':
      await installMcp(options);
      break;
    case 'defaults':
      await handleMakeDefaultCommand(options);
      break;
    default:
      console.error(`Unknown setup subcommand: ${subcommand}`);
      console.log('\nAvailable subcommands:');
      console.log(
        '  skills     Install core/build Firecrawl skills into AI coding agents'
      );
      console.log(
        '  workflows  Install Firecrawl workflow skills into AI coding agents'
      );
      console.log(
        '  mcp        Install firecrawl MCP server into editors (Cursor, Claude Code, VS Code, etc.)'
      );
      console.log(
        '  defaults   Make Firecrawl the default web provider (use --undo to restore native web tools)'
      );
      process.exit(1);
  }
}

/** Map a user-supplied --agent value to a known web agent. */
function resolveWebAgent(agent: string): WebAgent | null {
  const normalized = agent.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude code') {
    return 'Claude Code';
  }
  if (normalized === 'codex') return 'Codex';
  return null;
}

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Interactively ask which harnesses to apply the change to, one by one.
 * Returns the selected agents, or null if the user aborted.
 */
async function pickWebAgents(undo: boolean): Promise<WebAgent[] | null> {
  const verb = undo
    ? 'Re-enable native web tools for'
    : 'Disable native web tools for';
  console.log(
    undo
      ? 'Choose which harnesses to restore native web tools for:'
      : 'Choose which harnesses to route through Firecrawl:'
  );
  console.log('');

  const selected: WebAgent[] = [];
  for (const agent of WEB_AGENTS) {
    const answer = (
      await promptInput(`  ${verb} ${agent}? [Y/n] `)
    ).toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      selected.push(agent);
    }
  }
  console.log('');
  return selected;
}

export async function handleMakeDefaultCommand(
  options: SetupOptions = {}
): Promise<void> {
  const undo = Boolean(options.undo);
  let agents: readonly WebAgent[] | undefined;

  if (options.agent) {
    const resolved = resolveWebAgent(options.agent);
    if (!resolved) {
      console.error(
        `Unknown agent "${options.agent}" for setup defaults. Use "claude" or "codex".`
      );
      process.exit(1);
    }
    agents = [resolved];
  } else if (!options.yes && process.stdin.isTTY) {
    const picked = await pickWebAgents(undo);
    if (!picked || picked.length === 0) {
      console.log('No harnesses selected. Nothing changed.');
      return;
    }
    agents = picked;
  }

  const results = await configureWebDefaults({ undo, agents });

  for (const result of results) {
    const prefix = result.skipped ? '!' : result.changed ? '✓' : '•';
    console.log(`${prefix} ${result.message}`);
    console.log(`  ${result.path}`);
  }

  console.log('');
  if (undo) {
    console.log('Native web tools restored where supported.');
  } else {
    console.log(
      'Firecrawl is now the default web provider for supported AI agents.'
    );
  }
}

async function installSkills(
  options: SetupOptions,
  repos: readonly string[]
): Promise<void> {
  for (const repo of repos) {
    if (hasNpx()) {
      const args = buildSkillsInstallArgs({
        repo,
        agent: options.agent,
        global: true,
        includeNpxYes: true,
      });

      const cmd = args.join(' ');
      console.log(`Running: ${cmd}\n`);

      try {
        execSync(cmd, { stdio: 'inherit', env: cleanNpmEnv() });
        continue;
      } catch {
        process.exit(1);
      }
    }

    // Fallback: native install (no npx/Node required)
    try {
      await installSkillsNative(repo);
    } catch (error) {
      console.error(
        `Failed to install skills from ${repo}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  }
}

async function installMcp(options: SetupOptions): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(
      'No API key found. Please run `firecrawl login` first, or set FIRECRAWL_API_KEY.'
    );
    process.exit(1);
  }

  const args = [
    'npx',
    'add-mcp',
    `"npx -y firecrawl-mcp"`,
    '--name',
    'firecrawl',
  ];

  if (options.global) {
    args.push('--global');
  }

  if (options.agent) {
    args.push('--agent', options.agent);
  }

  const cmd = args.join(' ');
  console.log(`Running: ${cmd}\n`);

  try {
    execSync(cmd, {
      stdio: 'inherit',
      env: { ...cleanNpmEnv(), FIRECRAWL_API_KEY: apiKey },
    });
  } catch {
    process.exit(1);
  }
}

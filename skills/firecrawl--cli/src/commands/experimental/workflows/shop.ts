/**
 * Workflow: Shop
 *
 * Researches a product across the web (reviews, Reddit, Wirecutter, etc.),
 * finds the best option, then uses a saved Amazon browser profile to
 * add it to cart. Demonstrates persistent browser profiles in action.
 */

import { Command } from 'commander';
import { type Backend, BACKENDS, launchAgent } from '../backends';
import { validateRequired } from '../shared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Inputs {
  query: string;
  budget: string;
  sites: string;
  context: string;
}

// ─── Input gathering ────────────────────────────────────────────────────────

async function gatherInputs(prefill?: { query?: string }): Promise<Inputs> {
  // If query is prefilled, skip interactive prompts entirely
  if (prefill?.query) {
    return { query: prefill.query, budget: '', sites: '', context: '' };
  }

  const { input } = await import('@inquirer/prompts');

  const query = await input({
    message: 'What are you looking to buy?',
    validate: validateRequired('Product'),
  });

  const budget = await input({
    message: 'Budget? (leave blank for no limit)',
    default: '',
  });

  const sites = await input({
    message:
      'Preferred site(s)? (e.g. amazon, bestbuy, newegg -- leave blank for any)',
    default: '',
  });

  const context = await input({
    message:
      'Any other preferences? (brand, features, delivery location, etc.)',
    default: '',
  });

  return { query, budget, sites, context };
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a personal shopping assistant powered by Firecrawl. You shop for products using a real cloud browser -- browsing sites, comparing options, and adding items to cart visually.

## STEP 1: Launch Browser and Open Live View

Before anything else, launch a browser session and open the live view so the user can watch you shop:

\`\`\`bash
firecrawl browser launch-session --json
\`\`\`

Extract the \`liveViewUrl\` from the JSON output and open it for the user:

\`\`\`bash
open "<liveViewUrl>"          # macOS
xdg-open "<liveViewUrl>"     # Linux
\`\`\`

If the \`open\` command fails, print the URL clearly so the user can copy-paste it. Make sure the user sees the live view URL before you start shopping.

## STEP 2: Shop Using the Browser

Use \`firecrawl browser\` commands to browse, search, compare, and shop. Do everything in the browser -- this is a visual shopping experience.

\`\`\`bash
firecrawl browser "open <url>"           # Navigate to a site
firecrawl browser "snapshot"             # See what's on screen
firecrawl browser "click @<ref>"         # Click an element
firecrawl browser "type @<ref> <text>"   # Type into search/fields
firecrawl browser "scroll down"          # Scroll to see more
firecrawl browser "scrape"               # Get page content as markdown
\`\`\`

### How to shop:
1. Go to the user's preferred site (or Amazon by default)
2. Search for the product
3. Browse results, click into listings, compare specs and prices
4. Pick the best option based on reviews, price, and the user's requirements
5. Add to cart
6. Go to cart and snapshot to confirm

If you need to research reviews or comparisons outside the shopping site, you can use \`firecrawl search\` or \`firecrawl scrape\`, but **always come back to the browser for the actual shopping**.

Do everything sequentially -- do NOT spawn parallel subagents. Work through each step yourself, one at a time.

## Output

Print a summary to the terminal:

### What I Found
- Products compared, your pick, and why

### Cart
- Items added (name, price, seller)
- Total estimated cost
- Cart confirmation

Be specific with product names, model numbers, and prices. Start immediately.`;
}

// ─── Command registration ───────────────────────────────────────────────────

export function register(parentCmd: Command, backend: Backend): void {
  const config = BACKENDS[backend];

  parentCmd
    .command('shop')
    .description(
      'Research products across the web, then buy using your saved Amazon session'
    )
    .argument('[query...]', 'What to shop for')
    .option('-y, --yes', 'Auto-approve all tool permissions')
    .action(async (queryParts: string[], options) => {
      const prefillQuery =
        queryParts.length > 0 ? queryParts.join(' ') : undefined;
      const inputs = await gatherInputs(
        prefillQuery ? { query: prefillQuery } : undefined
      );

      const parts = [inputs.query];
      if (inputs.budget) parts.push(`Budget: ${inputs.budget}`);
      if (inputs.sites) parts.push(`Shop on: ${inputs.sites}`);
      if (inputs.context) parts.push(inputs.context);
      const userMessage = parts.join('. ') + '.';

      const skipPermissions = true;
      console.log(`\nLaunching ${config.displayName}...\n`);

      launchAgent(backend, buildSystemPrompt(), userMessage, skipPermissions);
    });
}

/**
 * esbuild configuration for Loki Dashboard UI
 *
 * Generates two bundles:
 * - ESM: For modern browsers and React/static dashboard imports
 * - IIFE: For VS Code webview (CSP-compatible, exposes LokiDashboard global)
 *
 * Usage:
 *   npm run build         # Build both bundles
 *   npm run build:esm     # Build ESM only
 *   npm run build:iife    # Build IIFE only
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Common build options
const commonOptions = {
  entryPoints: [path.join(__dirname, 'index.js')],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info',
};

/**
 * Build ESM bundle for modern browsers
 * Used by: React dashboard, static HTML dashboard, modern module imports
 */
async function buildESM() {
  await esbuild.build({
    ...commonOptions,
    format: 'esm',
    outfile: path.join(distDir, 'loki-dashboard.esm.js'),
    splitting: false,
    banner: {
      js: '/* Loki Dashboard UI - ESM Bundle */\n',
    },
  });
  console.log('[ESM] Built: dist/loki-dashboard.esm.js');
}

/**
 * Build IIFE bundle for VS Code webview
 * Exposes global LokiDashboard with init() and all exports
 * CSP-compatible: no eval, no dynamic code execution
 */
async function buildIIFE() {
  await esbuild.build({
    ...commonOptions,
    format: 'iife',
    globalName: 'LokiDashboard',
    outfile: path.join(distDir, 'loki-dashboard.iife.js'),
    banner: {
      js: '/* Loki Dashboard UI - IIFE Bundle (VS Code Webview) */\n',
    },
    footer: {
      js: `
// Expose init at top level for convenience
if (typeof window !== 'undefined') {
  window.LokiDashboard = LokiDashboard;
}
`,
    },
  });
  console.log('[IIFE] Built: dist/loki-dashboard.iife.js');
}

/**
 * Build all bundles
 */
async function buildAll() {
  const startTime = Date.now();

  try {
    await Promise.all([buildESM(), buildIIFE()]);

    const elapsed = Date.now() - startTime;
    console.log(`\nBuild complete in ${elapsed}ms`);
    console.log('Output files:');
    console.log('  - dist/loki-dashboard.esm.js (+ .map)');
    console.log('  - dist/loki-dashboard.iife.js (+ .map)');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// CLI handling
const args = process.argv.slice(2);

if (args.includes('--esm')) {
  buildESM().catch(() => process.exit(1));
} else if (args.includes('--iife')) {
  buildIIFE().catch(() => process.exit(1));
} else if (args.includes('--watch')) {
  // Watch mode for development
  Promise.all([
    esbuild.context({
      ...commonOptions,
      format: 'esm',
      outfile: path.join(distDir, 'loki-dashboard.esm.js'),
      splitting: false,
      banner: {
        js: '/* Loki Dashboard UI - ESM Bundle */\n',
      },
    }),
    esbuild.context({
      ...commonOptions,
      format: 'iife',
      globalName: 'LokiDashboard',
      outfile: path.join(distDir, 'loki-dashboard.iife.js'),
      banner: {
        js: '/* Loki Dashboard UI - IIFE Bundle (VS Code Webview) */\n',
      },
      footer: {
        js: `
// Expose init at top level for convenience
if (typeof window !== 'undefined') {
  window.LokiDashboard = LokiDashboard;
}
`,
      },
    }),
  ]).then(async (contexts) => {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
  });
} else {
  buildAll();
}

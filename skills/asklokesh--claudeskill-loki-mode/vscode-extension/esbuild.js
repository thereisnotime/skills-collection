const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Copy dashboard-ui bundle to media directory for webview use
 */
function copyDashboardBundle() {
    const dashboardDir = path.join(__dirname, '../dashboard-ui/dist');
    const mediaDir = path.join(__dirname, 'media');

    // Ensure media directory exists
    fs.mkdirSync(mediaDir, { recursive: true });

    const filesToCopy = [
        { src: 'loki-dashboard.iife.js', dest: 'loki-dashboard.js' },
        { src: 'loki-dashboard.iife.js.map', dest: 'loki-dashboard.js.map' }
    ];

    for (const file of filesToCopy) {
        const srcPath = path.join(dashboardDir, file.src);
        const destPath = path.join(mediaDir, file.dest);

        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`[dashboard] Copied ${file.src} -> media/${file.dest}`);
        } else {
            console.warn(`[dashboard] Warning: ${srcPath} not found. Run 'npm run build' in dashboard-ui first.`);
        }
    }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`> ${location.file}:${location.line}:${location.column}: error: ${text}`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'info',
        plugins: [
            esbuildProblemMatcherPlugin,
        ],
    });

    if (watch) {
        // Copy dashboard bundle before watching
        copyDashboardBundle();
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        // Copy dashboard bundle after build
        copyDashboardBundle();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

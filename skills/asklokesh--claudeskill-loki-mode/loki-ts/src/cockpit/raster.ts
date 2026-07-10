// SVG -> PNG rasterize. Two-tier, zero-friction:
//
//   1. Native @resvg/resvg-js if it happens to be installed (fastest).
//   2. Otherwise the bundled @resvg/resvg-wasm (platform-independent, shipped
//      with loki-mode) -- so `loki cockpit` renders the inline image out of the
//      box on EVERY platform with no native build step and nothing to install.
//   3. Only if BOTH fail do we return unavailable and the caller falls back to
//      the text/browser dashboard. The render never claims an image it did not
//      produce.
//
// initWasm can only run once per process, so the initialized module is cached.

export interface RasterResult {
  png: Uint8Array | null;
  available: boolean;
  reason?: string;
}

type ResvgCtor = new (svg: string, opts?: unknown) => { render(): { asPng(): Uint8Array } };

let nativeResvg: { Resvg?: ResvgCtor } | null | undefined; // undefined = not looked up
let wasmResvg: { Resvg?: ResvgCtor } | null | undefined; // undefined = not looked up

function loadNative(): { Resvg?: ResvgCtor } | null {
  if (nativeResvg !== undefined) return nativeResvg;
  try {
    const req = (globalThis as { require?: NodeRequire }).require ?? require;
    req.resolve("@resvg/resvg-js");
    nativeResvg = req("@resvg/resvg-js") as { Resvg?: ResvgCtor };
  } catch {
    nativeResvg = null;
  }
  return nativeResvg;
}

// Initialize the bundled wasm rasterizer once. Returns the module with a ready
// Resvg constructor, or null if the wasm cannot be loaded/initialized.
async function loadWasm(): Promise<{ Resvg?: ResvgCtor } | null> {
  if (wasmResvg !== undefined) return wasmResvg;
  try {
    const mod = (await import("@resvg/resvg-wasm")) as {
      Resvg?: ResvgCtor;
      initWasm: (m: Uint8Array | ArrayBuffer | WebAssembly.Module) => Promise<void>;
    };
    const req = (globalThis as { require?: NodeRequire }).require ?? require;
    const { readFileSync, existsSync } = (await import("node:fs")) as typeof import("node:fs");
    const { resolve: pathResolve, dirname } = (await import("node:path")) as typeof import("node:path");
    const { fileURLToPath } = (await import("node:url")) as typeof import("node:url");
    // Resolve the .wasm binary. Prefer the vendored copy in loki-ts/data/ (it
    // ALWAYS ships in the npm/Docker/brew tarball, so the inline image works out
    // of the box); fall back to the copy inside the resvg-wasm package.
    let wasmBytes: Buffer | null = null;
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      // dist/cockpit.js and src/cockpit/*.ts both sit two levels under loki-ts/.
      for (const rel of ["../data/resvg.wasm", "../../data/resvg.wasm"]) {
        const p = pathResolve(here, rel);
        if (existsSync(p)) { wasmBytes = readFileSync(p); break; }
      }
    } catch {
      // fall through to package-resolved path
    }
    if (!wasmBytes) {
      const wasmPath = req.resolve("@resvg/resvg-wasm/index_bg.wasm");
      wasmBytes = readFileSync(wasmPath);
    }
    await mod.initWasm(wasmBytes);
    wasmResvg = { Resvg: mod.Resvg };
  } catch {
    wasmResvg = null;
  }
  return wasmResvg;
}

// True if EITHER path can rasterize. Async because wasm init is async; the
// doctor probe awaits it so its report matches real behavior.
export async function rasterAvailable(): Promise<boolean> {
  if (loadNative()?.Resvg) return true;
  return (await loadWasm())?.Resvg != null;
}

// The wasm rasterizer runs in a sandbox with NO access to installed system
// fonts, so without a loaded font every <text> renders blank. Load a real font
// buffer from a common OS location (first that exists) and set it as the default
// family; the SVG's Fraunces/Inter/JetBrains-Mono families gracefully fall back
// to it. Cached so we read the file once. Native resvg-js reads system fonts
// itself and does not need this.
let cachedFont: Uint8Array | null | undefined;
async function loadFontBuffer(): Promise<Uint8Array | null> {
  if (cachedFont !== undefined) return cachedFont;
  try {
    const { readFileSync, existsSync } = (await import("node:fs")) as typeof import("node:fs");
    const candidates = [
      // macOS
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/System/Library/Fonts/Helvetica.ttc",
      "/Library/Fonts/Arial.ttf",
      // Linux (common)
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/TTF/DejaVuSans.ttf",
      // Windows
      "C:\\Windows\\Fonts\\arial.ttf",
      "C:\\Windows\\Fonts\\segoeui.ttf",
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        cachedFont = new Uint8Array(readFileSync(p));
        return cachedFont;
      }
    }
    cachedFont = null;
  } catch {
    cachedFont = null;
  }
  return cachedFont;
}

export async function rasterize(svg: string, width = 900): Promise<RasterResult> {
  // Prefer native (no async init, reads system fonts itself, fastest) when present.
  const native = loadNative();
  if (native?.Resvg) {
    try {
      const resvg = new native.Resvg(svg, { fitTo: { mode: "width", value: width } });
      return { png: Uint8Array.from(resvg.render().asPng()), available: true };
    } catch {
      // fall through to wasm
    }
  }
  const wasm = await loadWasm();
  if (wasm?.Resvg) {
    try {
      const font = await loadFontBuffer();
      const opts: Record<string, unknown> = { fitTo: { mode: "width", value: width } };
      if (font) {
        // A real font buffer guarantees text renders even in the fontless wasm
        // sandbox; loadSystemFonts:false keeps it fast and deterministic.
        opts["font"] = { fontBuffers: [font], defaultFontFamily: "Arial", loadSystemFonts: false };
      } else {
        // No bundled/system font found: let resvg try system fonts (best-effort).
        opts["font"] = { loadSystemFonts: true };
      }
      const resvg = new wasm.Resvg(svg, opts);
      return { png: Uint8Array.from(resvg.render().asPng()), available: true };
    } catch (e) {
      return { png: null, available: false, reason: `raster failed: ${(e as Error).message}` };
    }
  }
  return { png: null, available: false, reason: "rasterizer unavailable (no resvg native or wasm)" };
}

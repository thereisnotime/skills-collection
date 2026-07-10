// Orchestrates state -> SVG -> PNG -> terminal image for `loki cockpit`.
//
// Given a CockpitState and the chosen/detected protocol, produce either the
// terminal inline-image escape sequence, or an honest "fallback" signal telling
// the caller to use the text/browser dashboard. It NEVER claims an image was
// rendered when rasterization or the terminal protocol was unavailable.

import { buildSvg, type CockpitState } from "./svg.ts";
import { rasterize } from "./raster.ts";
import { encodeForProtocol } from "./encode.ts";
import { detectProtocol, type CockpitProtocol, type CapabilityEnv } from "./capability.ts";

export interface RenderOutcome {
  kind: "image" | "fallback";
  protocol: CockpitProtocol;
  data?: string; // terminal escape sequence, present when kind === "image"
  reason?: string; // why we fell back, present when kind === "fallback"
  svg: string; // always produced; useful for debugging / saving
}

export interface RenderOpts {
  protocol?: CockpitProtocol | "auto";
  env?: CapabilityEnv;
  forceText?: boolean; // --no-image
  cols?: number; // terminal width in columns; scales the image to fill the pane
}

export async function render(state: CockpitState, opts: RenderOpts = {}): Promise<RenderOutcome> {
  const svg = buildSvg(state);

  if (opts.forceText) {
    return { kind: "fallback", protocol: "none", reason: "--no-image (text/browser fallback)", svg };
  }

  let protocol: CockpitProtocol;
  if (opts.protocol && opts.protocol !== "auto") {
    protocol = opts.protocol;
  } else {
    protocol = detectProtocol(opts.env);
  }

  if (protocol === "none") {
    return { kind: "fallback", protocol, reason: "no inline-image terminal detected", svg };
  }

  const raster = await rasterize(svg);
  if (!raster.available || !raster.png) {
    return {
      kind: "fallback",
      protocol,
      reason: raster.reason || "rasterization unavailable",
      svg,
    };
  }

  const data = encodeForProtocol(protocol, raster.png, opts.cols);
  return { kind: "image", protocol, data, svg };
}

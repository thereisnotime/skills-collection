// Terminal graphics capability detection for `loki cockpit`.
//
// Returns which inline-image protocol the current terminal supports, from
// environment signals only (no probing, no escape round-trips). "none" means
// the caller must fall back to the text/browser dashboard.
//
// Detection order (LOKI_COCKPIT_PROTOCOL override always wins):
//   iterm2 : TERM_PROGRAM in {iTerm.app, WezTerm, ghostty} (all speak the
//            iTerm2 inline-image protocol)
//   kitty  : KITTY_WINDOW_ID set, or TERM=xterm-kitty
//   none   : anything else (TERM=dumb, unset, plain xterm, ...)

export type CockpitProtocol = "iterm2" | "kitty" | "none";

export interface CapabilityEnv {
  TERM_PROGRAM?: string;
  KITTY_WINDOW_ID?: string;
  TERM?: string;
  LOKI_COCKPIT_PROTOCOL?: string;
}

const ITERM2_PROGRAMS = new Set(["iterm.app", "wezterm", "ghostty"]);

export function detectProtocol(env: CapabilityEnv = process.env as CapabilityEnv): CockpitProtocol {
  const override = (env.LOKI_COCKPIT_PROTOCOL || "").trim().toLowerCase();
  if (override === "iterm2" || override === "kitty" || override === "none") {
    return override;
  }
  // "auto" or empty falls through to sniffing.

  const kittyWin = (env.KITTY_WINDOW_ID || "").trim();
  const term = (env.TERM || "").trim().toLowerCase();
  if (kittyWin.length > 0 || term === "xterm-kitty") {
    return "kitty";
  }

  const program = (env.TERM_PROGRAM || "").trim().toLowerCase();
  if (ITERM2_PROGRAMS.has(program)) {
    return "iterm2";
  }

  return "none";
}

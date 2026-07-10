// Pure terminal inline-image encoders. No external binaries: given raw PNG
// bytes, produce the exact escape sequence a supporting terminal renders.
//
// iTerm2 inline image:  OSC 1337 ; File=inline=1;size=N;width=auto;height=auto : <base64> BEL
// Kitty graphics:       APC _G a=T,f=100,... ; <base64chunk> ST   (chunked when large)
//
// References:
//   iTerm2  https://iterm2.com/documentation-images.html
//   Kitty   https://sw.kovidgoyal.net/kitty/graphics-protocol/

const ESC = "\x1b";
const BEL = "\x07";
const OSC = `${ESC}]`;
const APC = `${ESC}_`;
const ST = `${ESC}\\`; // String Terminator

export function toBase64(png: Uint8Array): string {
  // Buffer is available in both Bun and Node; avoids btoa's binary-string dance.
  return Buffer.from(png).toString("base64");
}

// iTerm2 inline image. size is the byte length of the raw (pre-base64) image,
// which iTerm2 uses for its transfer progress display. When `cols` is given the
// image is scaled to that many terminal columns (height auto-derived from the
// aspect ratio) so the cockpit fills the terminal width instead of rendering at
// a tiny native pixel size in the corner. Default width=auto (native) preserved
// for callers that do not pass a width.
export function encodeIterm2(png: Uint8Array, cols?: number): string {
  const b64 = toBase64(png);
  const w = cols && cols > 0 ? `${cols}` : "auto";
  const args = `inline=1;size=${png.length};width=${w};height=auto;preserveAspectRatio=1`;
  return `${OSC}1337;File=${args}:${b64}${BEL}`;
}

// Kitty graphics protocol. f=100 => PNG payload. Data is base64 and MUST be
// chunked at <=4096 base64 bytes per APC; m=1 on all but the last chunk, m=0
// closes the transfer. a=T transmits-and-displays.
export function encodeKitty(png: Uint8Array, chunkSize = 4096, cols?: number): string {
  const b64 = toBase64(png);
  if (b64.length === 0) {
    // Degenerate: still emit a valid (empty) transmit-and-display command.
    return `${APC}Ga=T,f=100,m=0;${ST}`;
  }

  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
  }

  // c=<cols> scales the image across that many terminal columns (rows auto).
  const colsKey = cols && cols > 0 ? `,c=${cols}` : "";
  let out = "";
  for (let idx = 0; idx < chunks.length; idx++) {
    const last = idx === chunks.length - 1;
    const more = last ? 0 : 1;
    // Control keys only go on the first chunk (per protocol); continuation
    // chunks carry just m=<0|1>.
    const control = idx === 0 ? `a=T,f=100${colsKey},m=${more}` : `m=${more}`;
    out += `${APC}G${control};${chunks[idx]}${ST}`;
  }
  return out;
}

export function encodeForProtocol(
  protocol: "iterm2" | "kitty",
  png: Uint8Array,
  cols?: number,
): string {
  return protocol === "kitty" ? encodeKitty(png, 4096, cols) : encodeIterm2(png, cols);
}

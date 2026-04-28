# Forensics — Decrypting C2 Framework Traffic from PCAP/Memory

A high-recurrence HTB Forensics pattern: PCAP (often with a paired memory dump or dropper binary) of a known C2 framework. The flag is hidden inside encrypted command/response traffic. The win condition is recovering the session key from secondary artifacts and replaying the framework's crypto.

## Step 1 — Fingerprint the framework

Look for unique URI / header / response signatures:

| Framework | URI / Header / Body signature                                   | Key location                             |
|-----------|-----------------------------------------------------------------|------------------------------------------|
| Covenant Grunt | `/en-us/{index,test,docs}.html`, JSON `GruntEncryptedMessage` body, strings `GruntStager`, `CovenantCertHash`, `MessageTransform` | 32-byte session key in the implant process memory dump |
| SharPyShell | POST to `*.aspx`, base64'd AES-256-CBC body, `If-Match: <id>` header pattern | sha256-hex of password (32 bytes), hardcoded in the dropper's `.cs` source |
| Empire 4.x | `/news.php`, `/login/process.php`, `Cookie: session=`           | Staging key in stager (PowerShell or Python source) |
| Sliver | gRPC + DNS C2, mTLS handshake | Implant binary; reverse the per-session ECDH derivation |
| Tiny SHell (tsh / `creaktive/tsh`) | TCP, no HTTP framing; first 40 bytes are `IV1‖IV2` (per-direction IV); each frame ends `HMAC-SHA1(ct‖u32 counter)` | Hardcoded `secret` string in the dropper ELF (e.g. `S3cr3tP@ss`) |
| **NimPlant** | HTTP `/api/v2/{login,ping,query}`, port 4444; AES-CTR with per-implant 16-byte key derived from `xor_string`; strings `BeaconData*` in implant binary | Recover by brute-forcing the `xor_string` integer key (small space, ~10^4) against any decrypted JSON marker. The session AES key is then visible in the implant's `~/.config/np/<id>` file or in the per-implant constants in the binary. |

Tools: `tshark -Y http -T fields -e http.host -e http.user_agent -e http.request.uri`, then `--export-objects http,out/` to pull bodies. For non-HTTP, `tshark -Y "tcp.port==X" -T fields -e data.data` and reassemble with scapy.

## Step 2 — Recover the session key

Three escalation paths, in order:

1. **Hardcoded key in dropper.** Most common. `strings -n 8 dropper.exe | grep -i 'pass\|key\|secret'` then check the source-style comments and resource sections.
2. **Memory carving.** Dump the implant process. Carve the key by:
   - Type-aware scan: search for `byte[N]` heap arrays — in .NET dumps look for an 8-byte little-endian length prefix followed by N bytes (e.g. `20 00 00 00 00 00 00 00` for a 32-byte buffer). Yields ~10⁴ candidates.
   - **HMAC oracle**: take one captured ciphertext+HMAC pair from the PCAP. For each candidate key, compute the framework's HMAC; the unique match is the real key. ~10⁴ candidates × ms-per-hmac ≈ minutes.
3. **Crib-drag XOR**: when traffic is XORed with a small repeating key (e.g. shellcode body XOR'd with 8-byte key), drag a known prefix (`cmd.exe /c `, MZ header, `cmd.exe`, `WinExec`) across the ciphertext until printable bytes appear. The aligned XOR'd offset gives the key.

## Step 3 — Decrypt and walk the operator session

Replay the framework's crypto using its public source:
- Covenant Grunt → `Covenant/Models/Grunts/Grunt.cs::Encrypt` (AES-256-CBC + HMAC-SHA-256, IV per message, key = session key).
- SharPyShell → `core/ChannelAES.py::encrypt` (AES-256-CBC, key = `bytes.fromhex(sha256_hex)`, IV = key[:16], PKCS7).
- tsh PEL → `pel.c::pel_recv_msg` (key = `SHA1(secret‖IV)[:16]`, AES-128-CBC, LCT = IV[:16], HMAC-SHA1 every frame, counter increments).

Decrypted output is usually a tty session: `whoami`, file ops, mimikatz, screenshots, keylogger captures. **The flag often appears as a typed password, an exfil filename, or a created-file-content** — not necessarily in the first decrypted message.

## Step 4 — Decoys

C2-themed challenges almost always include 1–2 fake `HTB{...}` strings to mislead anyone who only `strings` the pcap. Always validate by submitting the candidate that's the operator's *clear intent* (e.g. the password they typed into a phishing form), not the first match.

## Past solves
- HTB **Acknowledge the corn** (id=293, Hard) — Covenant Grunt; recovered AES key by HMAC-oracle scan over .NET heap byte[32] arrays in the powershell minidump; decrypted 26 messages → keylogger captured the flag as a typed admin-portal password.
- HTB **Masks Off** (id=295, Hard) — Tiny SHell (tsh) with hardcoded `S3cr3tP@ss`; decrypted PEL stream → `zip -PnL98udHrzk5vhrLWns3hIDi b12gb.zip cert9.db key4.db logins.json`; recovered the password from the operator command, opened the carved zip, ran `firefox_decrypt.py` on the Firefox profile to extract the flag from saved credentials.
- HTB **Window's Infinity Edge** (id=141, Hard) — SharPyShell with sha256-hex password hardcoded in the dropper; decrypted all 32 round-trips; flag appeared inside an `inject_shellcode_as` payload that XOR'd a 121-byte tail with an 8-byte key. Crib-dragged `cmd.exe /c ` to recover XOR key `xGk89_Ew`, decoded the `WinExec("cmd.exe /c echo HTB{...} > flag.txt")` shellcode. Two decoy flags in the same pcap.
- HTB **The Art of Capture** (id=766, Hard, *partial*) — NimPlant C2; xor_key=2288 brute-forced from `xor_string`; AES-CTR session keys recovered (`ZjLtHquGbCxfsnoS`, `kVUboRSaneIPXWg1`); full operator timeline decrypted; uploaded `rev.exe` with RC4-loader (key `xobvrE_x11mb`) decoded to a Cobalt-Strike stager. **Lesson: HTB sometimes splits the flag across artifacts — closing half was in the CS stager tail (`St4y_4l3Rt_4ND_r3Ly_0n_y0ur$3Lf}`); opening half was in an unreachable stage-2 download URL.** Always check whether the artifact bundle is "complete" before exhausting submissions.

## Anti-pattern: do NOT
- Submit the first `HTB{...}` you `strings` out of the pcap — almost always a decoy.
- Brute-force the C2 password with rockyou — passwords for HTB scenarios are not in wordlists; recover from artifacts.
- Skip the dropper. Even when a memory dump is present, the dropper has the cleanest source-of-truth for the crypto choice.

## API host & submission gotchas (recorded for runner code)
- `https://www.hackthebox.com/api/v4/...` works for many GET endpoints but POST `/challenge/own` and `/challenge/start|stop` may 404. The path-correct host for in-app challenge ops is `https://labs.hackthebox.com/api/v4/...`. **Always try `labs.` first for state-changing requests.**
- Submission `difficulty` is constrained — observed accepted values: 40, 50, 60, 70, 80. Value 75 was *rejected as invalid* on at least one Insane challenge. Use multiples of 10 to be safe.
- Always send `Accept: application/json` and `User-Agent: HTBClient/1.0` headers.
- Token must be parsed precisely from env-reader output; `awk -F=` truncates JWTs that contain `=`. Use `grep '^HTB_TOKEN=eyJ' | sed 's/^HTB_TOKEN=//'` instead.

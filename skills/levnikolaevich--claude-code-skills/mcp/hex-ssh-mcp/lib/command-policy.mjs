const BLOCKED_PATTERNS = [
    { regex: /rm\s+(-[rf]+\s+)*[/~]/, reason: "rm -rf on root/home" },
    { regex: /mkfs/, reason: "filesystem format" },
    { regex: /dd\s+if=\/dev\/zero/, reason: "direct disk write" },
    { regex: /:\(\)\{.*\}/, reason: "fork bomb" },
    { regex: />\s*\/dev\/sd/, reason: "direct device write" },
    { regex: /chmod\s+777/, reason: "removes all access restrictions" },
];

export function validateCommand(command) {
    const mode = process.env.REMOTE_SSH_MODE || "disabled";
    if (mode === "disabled") {
        return 'REMOTE_SSH_DISABLED: remote-ssh is disabled by default. Set REMOTE_SSH_MODE=safe (blocked patterns) or REMOTE_SSH_MODE=open (unrestricted).';
    }
    if (mode === "open") return null;

    // safe mode: block dangerous patterns
    for (const { regex, reason } of BLOCKED_PATTERNS) {
        if (regex.test(command)) {
            return `BLOCKED_COMMAND: ${reason}. Set REMOTE_SSH_MODE=open to bypass.`;
        }
    }
    return null;
}

export function shellQuote(s) {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function assertSafeArg(name, value) {
    if (/[\0\n\r]/.test(value)) {
        throw new Error(`UNSAFE_ARG: ${name} contains null bytes or newlines`);
    }
}

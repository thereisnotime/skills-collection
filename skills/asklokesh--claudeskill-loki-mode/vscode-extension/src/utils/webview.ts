/**
 * Shared webview utilities
 */

/**
 * Generate a nonce string for Content Security Policy
 * Used to allow inline scripts in webviews while maintaining security
 * @returns A random 32-character alphanumeric string
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

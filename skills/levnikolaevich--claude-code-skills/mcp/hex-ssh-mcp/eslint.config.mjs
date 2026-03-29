export default [
    { ignores: ["dist/", "benchmark/"] },
    {
        files: ["**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                process: "readonly",
                console: "readonly",
                URL: "readonly",
                Buffer: "readonly",
                Map: "readonly",
                Set: "readonly",
                Math: "readonly",
                JSON: "readonly",
                Date: "readonly",
                RegExp: "readonly",
                Promise: "readonly",
                parseInt: "readonly",
                String: "readonly",
                Array: "readonly",
                Error: "readonly",
                Object: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
            }
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-undef": "error",
            "no-constant-condition": "warn",
            "no-debugger": "error",
            "eqeqeq": ["error", "always", { null: "ignore" }],
            "no-var": "error",
            "prefer-const": "warn"
        }
    }
];

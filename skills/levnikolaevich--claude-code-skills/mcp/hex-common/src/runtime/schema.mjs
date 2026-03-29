import { z } from "zod";

// LLM clients may send booleans as strings ("true"/"false").
// z.coerce.boolean() is unsafe: Boolean("false") === true.
export const flexBool = () => z.preprocess(
    v => typeof v === "string" ? v === "true" : v,
    z.boolean().optional()
).optional();

// LLM clients may send numbers as strings ("5" instead of 5).
// z.coerce.number() generates {"type":"number"} and strict MCP clients reject strings.
export const flexNum = () => z.preprocess(
    v => typeof v === "string" ? Number(v) : v,
    z.number().optional()
).optional();

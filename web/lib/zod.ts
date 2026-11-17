import { z } from "zod";

// Zod probes for eval with `Function("")` before it compiles fast object parsers.
// The /tools pages' CSP has no 'unsafe-eval' (#385), so in the browser that probe is
// a CSP violation on every page that parses with Zod. jitless skips the probe and
// the compiled parsers. Import z from here, not from "zod", so the setting is
// applied before any schema parses.
z.config({ jitless: true });

export { z };

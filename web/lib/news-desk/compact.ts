// Tool results go back to the model on every later turn of a question, so their
// size is paid for again each time. See spec §7.2 step 3.
export const MAX_RESULT_CHARS = 24_000;

const SKIP = new Set(["viz", "msg", "statusCode"]);

type Flat = Record<string, string | number | boolean | null>;

function isFlat(v: unknown): v is Flat {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => x === null || typeof x !== "object")
  );
}

function entry(o: Flat): string {
  const keys = Object.keys(o).filter((k) => !SKIP.has(k));
  const code = keys.find((k) => k.endsWith("_code"));
  const label = keys.find((k) => k.endsWith("_name")) ?? keys.find((k) => k === "name" || k === "description");
  // Parent codes (a CPI item's class, group and division) are dropped: they
  // more than double CPI's size and the labels already say what an item is.
  if (code && label) return `${o[code]}=${o[label]}`;
  return keys.length === 1 ? String(o[keys[0]]) : keys.map((k) => `${k}=${o[k]}`).join(" ");
}

type Param = { name: string; required?: boolean; description?: string; schema?: { enum?: string[] } };

function param(p: Param): string {
  const allowed = p.schema?.enum ? ` one of ${p.schema.enum.join("/")}` : "";
  const note = p.description ? `: ${p.description.trim()}` : "";
  return `- ${p.name}${p.required ? " (required)" : ""}${allowed}${note}`;
}

function walk(v: unknown, key: string, out: string[]): void {
  if (key === "api_params" && Array.isArray(v)) {
    out.push("get_data filters:", ...(v as Param[]).map(param));
    return;
  }
  if (Array.isArray(v) && v.length > 0 && v.every(isFlat)) {
    out.push(`${key}: ${v.map(entry).join("; ")}`);
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (!SKIP.has(k)) walk(x, Array.isArray(v) ? key : k, out);
    }
    return;
  }
  out.push(`${key}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

/** Rewrites a get_metadata result as one line per filter list,
 * `name: code=label; code=label`, keeping every value. MoSPI nests the lists
 * differently per dataset (CPI under data[0], PLFS under filter_values.data),
 * so the whole object is walked. */
export function compactMetadata(json: unknown): string {
  const out: string[] = [];
  walk(json, "", out);
  return out.join("\n");
}

export function capResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[Truncated at ${MAX_RESULT_CHARS} characters. Ask for a narrower level or fewer rows.]`;
}

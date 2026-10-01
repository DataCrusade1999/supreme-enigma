// Writes the one-glance table for the whole run. Step summaries are per
// job, so the only place a single overview can come from is a job that
// depends on every other one - that is the `summary` job in deploy.yml,
// which runs only when the cross-OS e2e legs did and hands us
// `toJSON(needs)`.
import { ICONS, emit } from "./summary-lib.mjs";

const LABELS = {
  test: "Tests (lint, unit, Lambda, e2e, security)",
  "e2e-cross-os": "E2E (Windows, macOS)",
};

let needs;
try {
  needs = JSON.parse(process.env.NEEDS ?? "");
  if (!needs || typeof needs !== "object") throw new Error("not an object");
} catch (err) {
  console.error(`NEEDS is not the toJSON(needs) object: ${err.message}`);
  process.exit(1);
}

const eventName = process.env.EVENT_NAME ?? "";
const baseRef = process.env.BASE_REF ?? "";
const crossOs = eventName === "pull_request" && baseRef === "main";
const where = eventName === "pull_request" ? `${eventName} into ${baseRef}` : eventName;

const lines = ["## CI summary", "", "| Job | Result |", "|---|---|"];
// Known jobs first, in a fixed order, then anything else by id so a job
// added to `needs:` without a label here still shows up.
const ids = [...Object.keys(LABELS).filter((id) => id in needs), ...Object.keys(needs).filter((id) => !(id in LABELS))];
for (const id of ids) {
  const result = needs[id]?.result ?? "unknown";
  lines.push(`| ${LABELS[id] ?? id} | ${ICONS[result] ?? ""} ${result} |`);
}
lines.push(
  "",
  `Cross-OS e2e: ${crossOs ? "yes" : "no"} (${where}). Runs on PRs into main only.`,
);

emit(lines);

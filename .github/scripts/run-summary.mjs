// Writes the one-glance table for the whole run. Step summaries are per
// job, so the only place a single overview can come from is a job that
// depends on every other one - that is the `summary` job in deploy.yml,
// which runs `if: always()` and hands us `toJSON(needs)`.
import { appendFileSync } from "node:fs";

const LABELS = {
  unit: "Lint + unit tests",
  lambda: "Lambda tests",
  e2e: "E2E (Playwright)",
  security: "Security scan",
};

const ICONS = {
  success: "✅",
  failure: "❌",
  skipped: "⏭️",
  cancelled: "🚫",
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
const crossOs =
  eventName === "workflow_dispatch" ||
  (eventName === "pull_request" && (baseRef === "stage" || baseRef === "main"));
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
  `Cross-OS e2e: ${crossOs ? "yes" : "no"} (${where}). Runs on promotion PRs and workflow_dispatch.`,
);

const output = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
} else {
  console.log(output);
}

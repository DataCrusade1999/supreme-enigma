// Renders Terraform plans for the `terraform` workflow: the PR comment, the job
// summary, and the destroy count the apply job's guard reads. Input is
// `terraform show -json` (counts and addresses only — its values are never printed,
// since that JSON holds sensitive values in plain text) plus the redacted
// `terraform show -no-color` text.
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fence } from "./summary-lib.mjs";

export const MARKER = "<!-- terraform-plan -->";
// GitHub rejects comment bodies over 65,536 characters; leave room for the frame.
export const MAX_COMMENT = 65000;

export function summarize(plan) {
  const s = { add: 0, change: 0, destroy: 0, replace: [], deletes: [] };
  for (const { address, change } of plan.resource_changes ?? []) {
    const a = change.actions;
    const del = a.includes("delete");
    const create = a.includes("create");
    if (del && create) s.replace.push(address);
    if (create) s.add++;
    if (a.includes("update")) s.change++;
    if (del) {
      s.destroy++;
      s.deletes.push(address);
    }
  }
  return s;
}

function section({ name, plan, text }) {
  const s = summarize(plan);
  if (s.add + s.change + s.destroy === 0) return `### \`${name}\` — No changes\n`;
  const lines = [`### \`${name}\` — ${s.add} to add, ${s.change} to change, ${s.destroy} to destroy`];
  if (s.deletes.length) lines.push("", `⚠ destroys or replaces: ${s.deletes.map((d) => `\`${d}\``).join(", ")}`);
  const f = fence(text);
  lines.push("", "<details><summary>Plan</summary>", "", `${f}\n${text}\n${f}`, "", "</details>");
  return lines.join("\n") + "\n";
}

export function renderComment(stacks, title) {
  const head = `${MARKER}\n## ${title}\n\n`;
  let md = head + stacks.map(section).join("\n");
  if (md.length > MAX_COMMENT) {
    const note = "\n\n_…truncated — the full plan is in the job summary._\n";
    md = md.slice(0, MAX_COMMENT - note.length - 10) + "\n```\n" + note;
  }
  return md;
}

function main([cmd, ...args]) {
  if (cmd === "deletes") {
    const s = summarize(JSON.parse(readFileSync(args[0], "utf8")));
    for (const d of s.deletes) console.error(d);
    console.log(s.deletes.length);
    return;
  }
  if (cmd === "comment") {
    const [dir, title] = args;
    const stacks = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const base = f.slice(0, -5);
        return {
          name: base.replace("-", "/"),
          plan: JSON.parse(readFileSync(join(dir, f), "utf8")),
          text: readFileSync(join(dir, `${base}.txt`), "utf8"),
        };
      });
    const md = renderComment(stacks, title);
    process.stdout.write(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    return;
  }
  console.error("usage: tf-summary.mjs deletes <plan.json> | comment <dir> <title>");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

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
  const s = { add: 0, change: 0, destroy: 0, forget: 0, replace: [], deletes: [] };
  for (const { address, change } of plan.resource_changes ?? []) {
    const a = change.actions;
    const del = a.includes("delete");
    const create = a.includes("create");
    if (del && create) s.replace.push(address);
    if (create) s.add++;
    if (a.includes("update")) s.change++;
    if (del) s.destroy++;
    // A `removed` block drops the resource from state without destroying it. That
    // still loses it from Terraform's control, so the destroy guard counts it.
    if (a.includes("forget")) s.forget++;
    if (del || a.includes("forget")) s.deletes.push(address);
  }
  return s;
}

function section({ name, plan, text }) {
  const s = summarize(plan);
  if (s.add + s.change + s.destroy + s.forget === 0) return `### \`${name}\` — No changes\n`;
  let counts = `${s.add} to add, ${s.change} to change, ${s.destroy} to destroy`;
  if (s.forget) counts += `, ${s.forget} to forget`;
  const lines = [`### \`${name}\` — ${counts}`];
  if (s.deletes.length) lines.push("", `⚠ destroys or replaces: ${s.deletes.map((d) => `\`${d}\``).join(", ")}`);
  const f = fence(text);
  lines.push("", "<details><summary>Plan</summary>", "", `${f}\n${text}\n${f}`, "", "</details>");
  return lines.join("\n") + "\n";
}

// Truncates inside a stack's plan text, never across the markup, so the fence and
// </details> that section() writes always close and the note renders as text.
export function renderComment(stacks, title) {
  const note = "\n_…truncated — the full plan is in the job summary._\n";
  let md = `${MARKER}\n## ${title}\n\n`;
  for (const [i, stack] of stacks.entries()) {
    const sep = i ? "\n" : "";
    const full = sep + section(stack);
    if (md.length + full.length <= MAX_COMMENT) {
      md += full;
      continue;
    }
    // A shorter text can need a longer fence than the empty one; 16 covers that.
    const room = MAX_COMMENT - md.length - (sep + section({ ...stack, text: "" })).length - note.length - 16;
    if (room > 0) md += sep + section({ ...stack, text: stack.text.slice(0, room) });
    return md + note;
  }
  return md;
}

// The workflow names each stack's files with every `/` turned into `-`.
export function stackName(base) {
  return base.replaceAll("-", "/");
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
          name: stackName(base),
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

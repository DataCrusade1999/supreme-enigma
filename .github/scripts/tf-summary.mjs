// Renders Terraform plans for the `terraform` workflow: the PR comment, the job
// summary, and the destroy count the apply job's guard reads. Input is
// `terraform show -json` (counts and addresses only — its values are never printed,
// since that JSON holds sensitive values in plain text) plus the redacted
// `terraform show -no-color` text.
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join, sep } from "node:path";
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

// Every stack's heading and ⚠ line are reserved first, so a long plan can only
// shorten plan text, never push a later stack out. Text is cut inside a section,
// so the fence and </details> that section() writes always close.
export function renderComment(stacks, title) {
  const note = "\n_…truncated — the full plan is in the job summary._\n";
  const head = `${MARKER}\n## ${title}\n\n`;
  const sep = (i) => (i ? "\n" : "");
  const bare = (stack) => section({ ...stack, text: "" }).length;
  // A cut text can need a longer fence than the empty one; 16 per stack covers that.
  let room = MAX_COMMENT - head.length - note.length - stacks.reduce((n, s, i) => n + sep(i).length + bare(s) + 16, 0);
  let truncated = false;
  const parts = stacks.map((stack, i) => {
    let text = stack.text;
    if (text.length > room) {
      text = text.slice(0, Math.max(room, 0));
      truncated = true;
    }
    const md = section({ ...stack, text });
    room -= md.length - bare(stack);
    return sep(i) + md;
  });
  return head + parts.join("") + (truncated ? note : "");
}

// The workflow writes each stack's plan to <dir>/<stack>/plan.{json,txt}, so the
// directory path is the stack name with no encoding to undo.
export function readStacks(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => f.split(sep).join("/"))
    .filter((f) => f.endsWith("/plan.json"))
    .map((f) => f.slice(0, -"/plan.json".length))
    .sort()
    .map((name) => {
      return {
        name,
        plan: JSON.parse(readFileSync(join(dir, name, "plan.json"), "utf8")),
        text: readFileSync(join(dir, name, "plan.txt"), "utf8"),
      };
    });
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
    const md = renderComment(readStacks(dir), title);
    process.stdout.write(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    return;
  }
  console.error("usage: tf-summary.mjs deletes <plan.json> | comment <dir> <title>");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

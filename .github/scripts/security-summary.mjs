// Renders Trivy's `--format json` output into the job summary, and writes the
// same markdown to trivy-summary.md so the uploaded artifact and the summary
// cannot disagree.
//
// JSON rather than the table format the first version parsed: counting
// findings meant matching `^(?:Total|Failures): (\d+) \(`, which is a
// presentation detail inside Trivy - the word differs per scanner and current
// versions print no count line at all for a clean target. The JSON also
// carries PrimaryURL and CauseMetadata.StartLine, which the table drops.
//
// The Security tab (SARIF upload) needs Advanced Security, which this private
// repo does not have, so the summary is still where findings live.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fence, blobLink, emit } from "./summary-lib.mjs";

const HEADING = "## Security scan (Trivy)";
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };
const SEVERITY_ICON = { CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "⚪" };

const [, , filePath, outcome] = process.argv;
if (!filePath || !outcome) {
  console.error("Usage: node security-summary.mjs <trivy-results.json> <success|failure>");
  process.exit(1);
}

function severity(s) {
  const key = String(s ?? "UNKNOWN").toUpperCase();
  return { key, icon: SEVERITY_ICON[key] ?? "", rank: SEVERITY_RANK[key] ?? 9 };
}

// Markdown tables have no escape for a cell separator, so a pipe anywhere in
// a Trivy message would silently shift every column after it.
function cellText(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function collect(report) {
  const vulns = [];
  const misconfs = [];
  const secrets = [];
  for (const result of report.Results ?? []) {
    const target = result.Target ?? "";
    for (const v of result.Vulnerabilities ?? []) {
      vulns.push({ target, ...v, sev: severity(v.Severity) });
    }
    for (const m of result.Misconfigurations ?? []) {
      // Only failures are in the JSON unless --include-non-failures is set,
      // but a PASS row must never be reported as a finding if it ever is.
      if (String(m.Status ?? "FAIL").toUpperCase() === "PASS") continue;
      misconfs.push({ target, ...m, sev: severity(m.Severity) });
    }
    for (const s of result.Secrets ?? []) {
      secrets.push({ target, ...s, sev: severity(s.Severity) });
    }
  }
  const order = (a, b) => a.sev.rank - b.sev.rank || a.target.localeCompare(b.target);
  vulns.sort(order);
  misconfs.sort(order);
  secrets.sort(order);
  return { vulns, misconfs, secrets, count: vulns.length + misconfs.length + secrets.length };
}

function link(url, text) {
  return url ? `[${cellText(text)}](${url})` : cellText(text);
}

function findingTables({ vulns, misconfs, secrets }) {
  const lines = [];
  if (vulns.length) {
    lines.push(
      "### Vulnerabilities",
      "",
      "| Severity | Package | Installed | Fixed in | Advisory | Target |",
      "|---|---|---|---|---|---|",
    );
    for (const v of vulns) {
      lines.push(
        `| ${v.sev.icon} ${v.sev.key} | \`${cellText(v.PkgName)}\` | ${cellText(v.InstalledVersion)} | ` +
          `${cellText(v.FixedVersion) || "—"} | ${link(v.PrimaryURL, v.VulnerabilityID)} | \`${cellText(v.target)}\` |`,
      );
    }
    lines.push("");
  }
  if (misconfs.length) {
    lines.push("### Misconfiguration", "", "| Severity | Check | Where | Message |", "|---|---|---|---|");
    for (const m of misconfs) {
      const line = m.CauseMetadata?.StartLine;
      lines.push(
        `| ${m.sev.icon} ${m.sev.key} | ${link(m.PrimaryURL, m.ID || m.AVDID)} | ${blobLink(m.target, line)} | ` +
          `${cellText(m.Message || m.Title)} |`,
      );
    }
    lines.push("");
  }
  if (secrets.length) {
    // Deliberately no `Match` column. Trivy redacts the secret itself, but the
    // surrounding line is still credential context, and this markdown ends up
    // quoted into PR comments and chat. File and line locate it well enough.
    lines.push("### Secrets", "", "| Severity | Rule | Where |", "|---|---|---|");
    for (const s of secrets) {
      lines.push(
        `| ${s.sev.icon} ${s.sev.key} | ${cellText(s.Title || s.RuleID)} | ${blobLink(s.target, s.StartLine)} |`,
      );
    }
    lines.push("");
  }
  return lines;
}

let report = null;
let parseError = "";
if (!existsSync(filePath)) {
  parseError = `No scanner output found at \`${filePath}\`.`;
} else {
  try {
    report = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof report !== "object" || report === null || Array.isArray(report)) {
      parseError = `\`${filePath}\` is not a Trivy JSON report.`;
      report = null;
    }
  } catch (err) {
    parseError = `\`${filePath}\` is not valid JSON: ${err.message}`;
  }
}

// Three states, in this order. Findings are decided from the report, never
// from the step outcome: in report-only mode (`exit-code: "0"`) the outcome is
// `success` no matter what was found, and once gating is on a DB-download
// failure is `failure` with no report at all.
const lines = [HEADING, ""];
const found = report ? collect(report) : null;

if (found && found.count > 0) {
  lines.push(
    `**${found.count} finding${found.count === 1 ? "" : "s"}** at HIGH or CRITICAL with a fix available.`,
    "",
    ...findingTables(found),
  );
} else if (found && outcome === "success") {
  lines.push("✅ No HIGH or CRITICAL findings with a fix available.");
  if (report.ArtifactName) {
    // Not a list of clean targets: Trivy omits findings-free targets from the
    // JSON entirely, so any such list would be a lie by omission.
    lines.push("", `Scanned \`${report.ArtifactName}\` (${report.ArtifactType ?? "filesystem"}).`);
  }
} else {
  lines.push(
    `⚠️ The scanner did not complete (outcome: ${outcome}) - no findings were evaluated. Rerun the job; if it repeats, read the log.`,
  );
  if (parseError) {
    lines.push("", parseError);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim().slice(0, 2000);
      if (raw) {
        const f = fence(raw);
        lines.push("", f, raw, f);
      }
    }
  }
}

const output = emit(lines);
// The artifact and the step summary are the same bytes by construction. The
// write is best-effort: the "no scanner output" path is reached with a path
// whose directory may not exist, and losing the artifact copy must not cost
// us the summary that says what went wrong.
try {
  writeFileSync(join(dirname(filePath), "trivy-summary.md"), output);
} catch (err) {
  console.error(`Could not write trivy-summary.md next to ${filePath}: ${err.message}`);
}

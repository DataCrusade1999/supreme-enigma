import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const script = fileURLToPath(new URL("./security-summary.mjs", import.meta.url));

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: "",
      GITHUB_SERVER_URL: "",
      GITHUB_REPOSITORY: "",
      HEAD_SHA: "",
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function tmpReport(value) {
  const file = join(mkdtempSync(join(tmpdir(), "sec-")), "trivy-results.json");
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

const VULN = {
  ArtifactName: ".",
  ArtifactType: "filesystem",
  Results: [
    {
      Target: "web/package-lock.json",
      Class: "lang-pkgs",
      Type: "npm",
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2026-0002",
          PkgName: "undici",
          InstalledVersion: "6.0.0",
          FixedVersion: "6.0.1",
          Severity: "HIGH",
          Title: "undici does a bad thing",
          PrimaryURL: "https://avd.aquasec.com/nvd/cve-2026-0002",
        },
        {
          VulnerabilityID: "CVE-2026-0001",
          PkgName: "next",
          InstalledVersion: "16.0.1",
          FixedVersion: "16.0.3",
          Severity: "CRITICAL",
          Title: "next does a worse thing",
          PrimaryURL: "https://avd.aquasec.com/nvd/cve-2026-0001",
        },
      ],
    },
  ],
};

const MISCONF = {
  ArtifactName: ".",
  ArtifactType: "filesystem",
  Results: [
    {
      Target: "infra/main/shared.tf",
      Class: "config",
      Type: "terraform",
      MisconfSummary: { Successes: 38, Failures: 1 },
      Misconfigurations: [
        {
          Type: "Terraform Security Check",
          ID: "AVD-AWS-0089",
          AVDID: "AVD-AWS-0089",
          Title: "S3 Bucket Logging",
          Message: "Bucket does not have logging enabled",
          Severity: "HIGH",
          Status: "FAIL",
          PrimaryURL: "https://avd.aquasec.com/misconfig/avd-aws-0089",
          CauseMetadata: { Provider: "AWS", Service: "s3", StartLine: 12, EndLine: 14 },
        },
      ],
    },
  ],
};

const SECRET_MATCH = "AWS_SECRET_ACCESS_KEY=****************************************";
const SECRET = {
  ArtifactName: ".",
  ArtifactType: "filesystem",
  Results: [
    {
      Target: "web/lib/leak.ts",
      Class: "secret",
      Secrets: [
        {
          RuleID: "aws-secret-access-key",
          Category: "AWS",
          Severity: "CRITICAL",
          Title: "AWS Secret Access Key",
          StartLine: 3,
          EndLine: 3,
          Match: SECRET_MATCH,
        },
      ],
    },
  ],
};

test("vulnerabilities render as a table, CRITICAL before HIGH", () => {
  const { status, stdout } = run([tmpReport(VULN), "failure"]);
  assert.equal(status, 0);
  assert.match(stdout, /^## Security scan \(Trivy\)\n/);
  assert.match(stdout, /\*\*2 findings\*\* at HIGH or CRITICAL with a fix available\./);
  assert.match(stdout, /### Vulnerabilities/);
  assert.match(stdout, /\| 🔴 CRITICAL \| `next` \| 16\.0\.1 \| 16\.0\.3 \| \[CVE-2026-0001\]\(https:\/\/avd\.aquasec\.com\/nvd\/cve-2026-0001\) \| `web\/package-lock\.json` \|/);
  assert.ok(stdout.indexOf("CVE-2026-0001") < stdout.indexOf("CVE-2026-0002"), "CRITICAL must sort above HIGH");
});

test("misconfiguration renders with a line-anchored location", () => {
  const { stdout } = run([tmpReport(MISCONF), "failure"], {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    HEAD_SHA: "abc123",
  });
  assert.match(stdout, /### Misconfiguration/);
  assert.match(stdout, /\[AVD-AWS-0089\]\(https:\/\/avd\.aquasec\.com\/misconfig\/avd-aws-0089\)/);
  assert.match(stdout, /\[`infra\/main\/shared\.tf:12`\]\(https:\/\/github\.com\/o\/r\/blob\/abc123\/infra\/main\/shared\.tf#L12\)/);
  assert.match(stdout, /Bucket does not have logging enabled/);
});

test("a PASS misconfiguration is not counted as a finding", () => {
  const passed = structuredClone(MISCONF);
  passed.Results[0].Misconfigurations[0].Status = "PASS";
  const { stdout } = run([tmpReport(passed), "success"]);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.doesNotMatch(stdout, /### Misconfiguration/);
});

test("secrets render location only — the Match value never reaches the summary", () => {
  const { stdout } = run([tmpReport(SECRET), "failure"]);
  assert.match(stdout, /### Secrets/);
  assert.match(stdout, /AWS Secret Access Key/);
  assert.match(stdout, /`web\/lib\/leak\.ts:3`/);
  assert.doesNotMatch(stdout, /AWS_SECRET_ACCESS_KEY=/);
  assert.ok(!stdout.includes(SECRET_MATCH), "Trivy's Match field must never be printed");
  assert.doesNotMatch(stdout, /\| Match \|/);
});

test("the Match value never reaches the artifact markdown either", () => {
  const file = tmpReport(SECRET);
  run([file, "failure"]);
  const md = readFileSync(join(dirname(file), "trivy-summary.md"), "utf8");
  assert.ok(!md.includes(SECRET_MATCH), "Trivy's Match field must never be written to the artifact");
  assert.match(md, /### Secrets/);
});

test("a mixed report renders all three sections and one total", () => {
  const mixed = { ArtifactName: ".", ArtifactType: "filesystem", Results: [...VULN.Results, ...MISCONF.Results, ...SECRET.Results] };
  const { stdout } = run([tmpReport(mixed), "failure"]);
  assert.match(stdout, /\*\*4 findings\*\*/);
  assert.match(stdout, /### Vulnerabilities/);
  assert.match(stdout, /### Misconfiguration/);
  assert.match(stdout, /### Secrets/);
});

test("findings are read from the report even when the outcome is success (report-only mode)", () => {
  const { status, stdout } = run([tmpReport(VULN), "success"]);
  assert.equal(status, 0);
  assert.match(stdout, /\*\*2 findings\*\*/);
  assert.doesNotMatch(stdout, /did not complete/);
});

// The shape a real clean run produces: every target present with its counts,
// no findings arrays at all. Taken from an actual CI report (Trivy 0.70.0).
const CLEAN = {
  SchemaVersion: 2,
  Trivy: { Version: "0.70.0" },
  ArtifactName: ".",
  ArtifactType: "repository",
  Metadata: { Commit: "2ecd7b0a918622a5d16a66836f7833b2ae8015da" },
  Results: [
    { Target: "web/package-lock.json", Class: "lang-pkgs", Type: "npm", Packages: Array.from({ length: 366 }, (_, i) => ({ Name: `pkg-${i}` })) },
    { Target: "infra/main", Class: "config", Type: "terraform", MisconfSummary: { Successes: 28, Failures: 0 } },
    { Target: "infra/main/shared.tf", Class: "config", Type: "terraform" },
    { Target: "lambda/Dockerfile", Class: "config", Type: "dockerfile", MisconfSummary: { Successes: 19, Failures: 0 } },
  ],
};

test("clean: a real clean report reports what was scanned, not just that nothing was found", () => {
  const { status, stdout } = run([tmpReport(CLEAN), "success"]);
  assert.equal(status, 0);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.match(stdout, /### Coverage/);
  assert.match(stdout, /\| `web\/package-lock\.json` \| npm \| 366 packages \| ✅ 0 \|/);
  assert.match(stdout, /\| `infra\/main` \| terraform \| 28 checks \| ✅ 0 \|/);
  assert.match(stdout, /\| `lambda\/Dockerfile` \| dockerfile \| 19 checks \| ✅ 0 \|/);
  assert.match(stdout, /Trivy 0\.70\.0 · 4 targets · commit `2ecd7b0`/);
});

test("clean: a target with no count of its own renders an em dash and is explained", () => {
  const { stdout } = run([tmpReport(CLEAN), "success"]);
  assert.match(stdout, /\| `infra\/main\/shared\.tf` \| terraform \| — \| ✅ 0 \|/);
  assert.match(stdout, /carry no count of their own/);
});

test("clean: singular package and check counts", () => {
  const one = {
    Trivy: { Version: "0.70.0" },
    Results: [
      { Target: "a/package-lock.json", Type: "npm", Packages: [{ Name: "only" }] },
      { Target: "b", Type: "terraform", MisconfSummary: { Successes: 1, Failures: 0 } },
    ],
  };
  const { stdout } = run([tmpReport(one), "success"]);
  assert.match(stdout, /1 package \|/);
  assert.match(stdout, /1 check \|/);
  assert.match(stdout, /Trivy 0\.70\.0 · 2 targets/);
});

test("clean: Results absent entirely warns that nothing was examined", () => {
  const { stdout } = run([tmpReport({ SchemaVersion: 2, ArtifactName: "." }), "success"]);
  assert.match(stdout, /No HIGH or CRITICAL findings with a fix available\./);
  assert.match(stdout, /⚠️ The report lists no scanned targets, so nothing was examined\./);
  assert.doesNotMatch(stdout, /### Coverage/);
});

test("clean: an empty Results array warns the same way", () => {
  const { stdout } = run([tmpReport({ ArtifactName: ".", Results: [] }), "success"]);
  assert.match(stdout, /nothing was examined/);
});

test("the coverage table is rendered alongside findings, not instead of them", () => {
  const withFindings = { ...CLEAN, Results: [...CLEAN.Results, ...MISCONF.Results] };
  const { stdout } = run([tmpReport(withFindings), "failure"]);
  assert.match(stdout, /### Misconfiguration/);
  assert.match(stdout, /### Coverage/);
  assert.match(stdout, /\| `infra\/main\/shared\.tf` \| terraform \| 39 checks \| ❌ 1 \|/);
  // Findings come first; coverage is context underneath.
  assert.ok(stdout.indexOf("### Misconfiguration") < stdout.indexOf("### Coverage"));
});

test("a single finding is singular", () => {
  const { stdout } = run([tmpReport(MISCONF), "failure"]);
  assert.match(stdout, /\*\*1 finding\*\* at HIGH or CRITICAL/);
});

test("unparseable output with outcome failure is a scan error, not zero findings", () => {
  const { status, stdout } = run([tmpReport("FATAL: failed to download vulnerability DB"), "failure"]);
  assert.equal(status, 0);
  assert.match(stdout, /⚠️ The scanner did not complete \(outcome: failure\)/);
  assert.doesNotMatch(stdout, /findings? at HIGH/);
  assert.match(stdout, /is not valid JSON/);
  assert.match(stdout, /failed to download vulnerability DB/);
});

test("valid JSON of the wrong shape with outcome failure is a scan error", () => {
  const { stdout } = run([tmpReport([1, 2, 3]), "failure"]);
  assert.match(stdout, /⚠️ The scanner did not complete/);
  assert.match(stdout, /is not a Trivy JSON report/);
});

test("a clean report with outcome failure still reads as a scan error", () => {
  const { stdout } = run([tmpReport({ ArtifactName: ".", Results: [] }), "failure"]);
  assert.match(stdout, /⚠️ The scanner did not complete/);
});

test("missing file is a scan error and does not crash on the artifact write", () => {
  const { status, stdout } = run(["/nope/does-not-exist/trivy-results.json", "failure"]);
  assert.equal(status, 0);
  assert.match(stdout, /⚠️ The scanner did not complete \(outcome: failure\)/);
  assert.match(stdout, /No scanner output found at/);
  assert.ok(!existsSync("/nope/does-not-exist/trivy-summary.md"));
});

test("a pipe in a Trivy message does not break the table columns", () => {
  const piped = structuredClone(MISCONF);
  piped.Results[0].Misconfigurations[0].Message = "value is `a|b` which is wrong";
  const { stdout } = run([tmpReport(piped), "failure"]);
  assert.match(stdout, /a\\\|b/);
});

test("usage error without both arguments", () => {
  assert.equal(run(["only-one.json"]).status, 1);
});

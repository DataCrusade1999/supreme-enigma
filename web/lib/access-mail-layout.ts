export type EmailRow = { tool: string; detail: string; button?: { label: string; href: string } };

export type EmailParts = {
  heading: string;
  intro?: string;
  rows: EmailRow[];
  after?: string;
  footer: string[];
};

const INK = "#111110";
const BODY = "#2b2a27";
const MUTED = "#5f5d57";
const RULE = "rgba(17,17,16,0.18)";
const TEAL = "#146b64";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Helvetica, Arial, sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const cell = (style: string, inner: string) => `<tr><td style="${style}">${inner}</td></tr>`;

function rowHtml(r: EmailRow): string {
  const button = r.button
    ? `<td align="right" valign="middle" style="padding:18px 0 18px 20px;"><a href="${esc(r.button.href)}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font:600 14px ${SANS};padding:12px 20px;white-space:nowrap;">${esc(r.button.label)}</a></td>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${RULE};border-bottom:1px solid ${RULE};"><tr><td valign="middle" style="padding:18px 0;"><div style="font:400 26px ${SERIF};color:${INK};">${esc(r.tool)}</div><div style="font:400 14px ${SANS};color:${BODY};padding-top:4px;">${esc(r.detail)}</div></td>${button}</tr></table>`;
}

export function renderEmail(p: EmailParts): { html: string; text: string } {
  const gap = "padding-top:20px;";
  const blocks: string[] = [
    cell(
      `padding-bottom:10px;border-bottom:2px solid ${INK};`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font:italic 400 26px ${SERIF};color:${INK};">Ashutosh Pandey</td><td align="right" style="font:400 12px ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">Tools &middot; Access</td></tr></table>`,
    ),
    cell(`${gap}font:400 40px/1.1 ${SERIF};color:${INK};`, esc(p.heading)),
  ];
  if (p.intro) blocks.push(cell(`${gap}font:400 15px/1.65 ${SANS};color:${BODY};`, esc(p.intro)));
  for (const r of p.rows) blocks.push(cell(gap, rowHtml(r)));
  if (p.after) blocks.push(cell(`${gap}font:400 14px/1.6 ${SANS};color:${MUTED};`, esc(p.after)));
  blocks.push(
    cell(
      `padding-top:34px;`,
      `<div style="border-top:1px solid ${RULE};padding-top:14px;font:400 12px/1.6 ${SANS};color:${MUTED};">${p.footer.map(esc).join("<br>")}</div>`,
    ),
  );

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#eceae5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceae5;"><tr><td align="center" style="padding:0;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#eceae5;"><tr><td style="padding:36px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${blocks.join("")}</table></td></tr></table></td></tr></table></body></html>`;

  const text = [
    p.heading,
    ...(p.intro ? ["", p.intro] : []),
    ...p.rows.flatMap((r) => ["", r.tool, r.detail, ...(r.button ? [`${r.button.label}: ${r.button.href}`] : [])]),
    ...(p.after ? ["", p.after] : []),
    "",
    ...p.footer,
  ].join("\n");

  return { html, text };
}

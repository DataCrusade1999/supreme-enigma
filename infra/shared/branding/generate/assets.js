// Writes the logo and background SVGs in infra/shared/branding/ for Cognito's
// managed login. Managed login has no font setting, so the site's type is
// outlined to paths here. Colours are web/app/globals.css.
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const out = path.join(__dirname, '..');
const f = (p) => opentype.parse(fs.readFileSync(require.resolve(p)).buffer);
const plex600 = f('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff');
const plex400 = f('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff');
const serif = f('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff');

const MODES = {
  dark: { fg: '#eceae5', muted: '#9a968c', line: 'rgba(236,234,229,0.16)', accent: '#5ec8c0', peak: '#e2574c', ink25: 'rgba(236,234,229,0.25)', ink40: 'rgba(236,234,229,0.4)' },
  light: { fg: '#111110', muted: '#5f5d57', line: 'rgba(17,17,16,0.14)', accent: '#146b64', peak: '#a8362a', ink25: 'rgba(17,17,16,0.25)', ink40: 'rgba(17,17,16,0.4)' },
};

const r2 = (n) => Math.round(n * 100) / 100;
function text(font, s, x, y, size, spacingEm = 0) {
  const p = font.getPath(s, x, y, size, { letterSpacing: spacingEm });
  return p.toPathData(2);
}
function width(font, s, size, spacingEm = 0) {
  return font.getAdvanceWidth(s, size, { letterSpacing: spacingEm });
}
function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`;
}

// PAGE_HEADER_LOGO: the /login wordmark, tick + name in Plex 600, tracking-tight.
function headerLogo(c) {
  const size = 14;
  const x = 14;
  const w = Math.ceil(x + width(plex600, 'Ashutosh Pandey', size, -0.025));
  // Cognito draws the header logo 40px high, at most 160px wide, and rejects
  // anything wider than 4:1. A 156x40 box stays under both and renders at 1:1.
  if (w > 156) throw new Error('header wordmark wider than 156px');
  const top = 10;
  const body = [
    `<rect x="0" y="${top + 3}" width="4" height="14" fill="${c.accent}"/>`,
    `<path fill="${c.fg}" d="${text(plex600, 'Ashutosh Pandey', x, top + 15, size, -0.025)}"/>`,
  ].join('\n');
  return svg(156, 40, body);
}

// FORM_LOGO: "PRIVATE" eyebrow over serif "Tools". Cognito draws it 60px high,
// at most 240px wide, so this 236x60 box renders at 1:1 and the /login rule
// under the heading does not fit.
function formLogo(c) {
  const body = [
    `<path fill="${c.muted}" d="${text(plex400, 'PRIVATE', 0, 9, 11, 0.14)}"/>`,
    `<path fill="${c.fg}" d="${text(serif, 'Tools', -1, 58, 52)}"/>`,
  ].join('\n');
  return svg(236, 60, body);
}

// PAGE_BACKGROUND: the GridBackdrop hairlines, with LoopRing and its caption
// centred in columns 8-12, as on /login. The envelope is copied from
// web/content/wave-envelope.ts.
const HEAD = [18, 34, 27, 52, 41, 63, 38, 46];
const BODY = [30, 47, 71, 55, 82, 61, 44, 58, 73, 49, 36, 66, 88, 70, 52, 39, 57, 80, 62, 45, 33, 51, 68, 84, 59, 42, 30, 48, 65, 77, 54, 40, 62, 86, 69, 47, 35, 53, 44, 29];
const WAVE = [...HEAD, ...BODY, ...HEAD];
function background(c) {
  const W = 1440, H = 900, margin = 40, gap = 24;
  const col = (W - 2 * margin - 11 * gap) / 12;
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const x = r2(margin + i * (col + gap)) + 0.5;
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c.line}" stroke-width="1"/>`);
  }
  const left = margin + 7 * (col + gap);
  const span = 5 * col + 4 * gap;
  const cx = r2(left + span / 2);
  const cy = 420;
  const radius = 104, scale = 0.5;
  WAVE.forEach((h, i) => {
    const a = (-90 + i * (360 / WAVE.length)) * Math.PI / 180;
    const x1 = r2(cx + Math.cos(a) * radius), y1 = r2(cy + Math.sin(a) * radius);
    const x2 = r2(cx + Math.cos(a) * (radius + h * scale)), y2 = r2(cy + Math.sin(a) * (radius + h * scale));
    const colour = h >= 78 ? c.peak : (i < HEAD.length || i >= HEAD.length + BODY.length) ? c.accent : c.ink25;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="2"/>`);
  });
  parts.push(`<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - radius}" stroke="${c.ink40}" stroke-width="1"/>`);
  const lines = ['Small tools, built for one job each,', 'kept behind one door.'];
  lines.forEach((s, i) => {
    const w = width(plex400, s, 13);
    parts.push(`<path fill="${c.muted}" d="${text(plex400, s, r2(cx - w / 2), cy + radius + 44 + 28 + 13 + i * 21, 13)}"/>`);
  });
  return svg(W, H, parts.join('\n'));
}

for (const [mode, c] of Object.entries(MODES)) {
  fs.writeFileSync(path.join(out, `header-logo-${mode}.svg`), headerLogo(c));
  fs.writeFileSync(path.join(out, `form-logo-${mode}.svg`), formLogo(c));
  fs.writeFileSync(path.join(out, `background-${mode}.svg`), background(c));
}
console.log(fs.readdirSync(out).filter((n) => n.endsWith('.svg')).map((n) => `${n} ${fs.statSync(path.join(out, n)).size}`).join('\n'));

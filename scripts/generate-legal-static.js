#!/usr/bin/env node
/**
 * Generates crawlable static legal pages from i18n/locales/*.json.
 *
 * Why: /privacy and /terms are SPA routes — the raw HTML a fetcher sees is
 * "You need to enable JavaScript to run this app." App Store review, Google
 * Play's policy scanner, and link previews all fetch those URLs directly and
 * get nothing. These static twins render real HTML with no JavaScript.
 *
 * The SPA routes are untouched (humans keep the in-app styled version); the
 * store listings should point at /legal/privacy.html and /legal/terms.html.
 *
 * Content comes from the SAME i18n keys the React pages use, so the two can't
 * drift. Re-run after editing i18n/locales/*.json:
 *
 *   node scripts/generate-legal-static.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'legal');

const LOCALES = ['en', 'es'];
const LOCALE_LABEL = { en: 'English', es: 'Español' };

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The i18n keys follow a flat convention: sNTitle / sNIntro / sNPn / sNLn.
 * Walk N upward and emit each section in document order.
 */
function renderSections(doc) {
  const parts = [];
  for (let n = 1; n <= 40; n += 1) {
    const title = doc[`s${n}Title`];
    if (!title) continue;
    parts.push(`<h2>${esc(title)}</h2>`);

    const intro = doc[`s${n}Intro`];
    if (intro) parts.push(`<p>${esc(intro)}</p>`);

    // Paragraphs sNP1..sNP9 — but only the plain ones. Keys like s1P1Privacy
    // are inline link fragments the React page stitches together; including
    // them standalone would read as duplicated sentence fragments.
    for (let p = 1; p <= 9; p += 1) {
      const body = doc[`s${n}P${p}`];
      if (body) parts.push(`<p>${esc(body)}</p>`);
    }

    const items = [];
    for (let l = 1; l <= 12; l += 1) {
      const item = doc[`s${n}L${l}`];
      if (item) items.push(`<li>${esc(item)}</li>`);
    }
    if (items.length) parts.push(`<ul>${items.join('')}</ul>`);

    const sensitive = doc[`s${n}Sensitive`];
    if (sensitive) parts.push(`<p>${esc(sensitive)}</p>`);
  }
  return parts.join('\n');
}

function renderPage(kind, docsByLocale) {
  const primary = docsByLocale.en;
  const title = primary.title || (kind === 'privacy' ? 'Privacy Policy' : 'Terms of Use');

  const localeBlocks = LOCALES.map((locale) => {
    const doc = docsByLocale[locale];
    if (!doc) return '';
    return `
    <section lang="${locale}" id="${locale}">
      <h1>${esc(doc.title || title)}</h1>
      <p class="meta">
        ${esc(doc.effectiveDate || '')} October 21, 2025 &middot;
        ${esc(doc.lastUpdated || '')} October 21, 2025
      </p>
      <p class="meta">${esc(doc.appliesTo || '')}</p>
      <p class="intro">${esc(doc.introAlert || '')}</p>
      ${renderSections(doc)}
      <p class="meta">C1 Staffing, LLC &middot; ${esc(doc.footer || 'All rights reserved.')}</p>
    </section>`;
  }).join('\n<hr />\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · C1 Staffing</title>
<meta name="description" content="${esc(title)} for C1 Staffing, LLC and the C1 Staffing worker mobile app." />
<link rel="canonical" href="https://hrxone.com/legal/${kind}.html" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6; margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.25rem 4rem;
    color: #16181a; background: #fafaf8;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #f1efe9; background: #151513; }
    a { color: #ffc700; }
  }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .5rem; }
  h2 { font-size: 1.05rem; margin: 1.9rem 0 .45rem; }
  p, li { font-size: .97rem; }
  ul { padding-left: 1.15rem; }
  .meta { color: #6b6b6b; font-size: .86rem; }
  @media (prefers-color-scheme: dark) { .meta { color: #a5a29a; } }
  .intro { margin: 1rem 0 1.5rem; }
  hr { border: 0; border-top: 1px solid #e6e6e3; margin: 3rem 0; }
  nav { margin-bottom: 1.5rem; font-size: .9rem; }
  nav a { margin-right: 1rem; }
</style>
</head>
<body>
<nav>
  ${LOCALES.map((l) => `<a href="#${l}">${LOCALE_LABEL[l]}</a>`).join('')}
  <a href="/legal/privacy.html">Privacy Policy</a>
  <a href="/legal/terms.html">Terms of Use</a>
</nav>
${localeBlocks}
</body>
</html>
`;
}

function main() {
  const byLocale = {};
  for (const locale of LOCALES) {
    const raw = fs.readFileSync(path.join(ROOT, 'i18n', 'locales', `${locale}.json`), 'utf8');
    byLocale[locale] = JSON.parse(raw).legal || {};
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const kind of ['privacy', 'terms']) {
    const docs = {};
    for (const locale of LOCALES) docs[locale] = byLocale[locale][kind] || {};
    if (!docs.en || !Object.keys(docs.en).length) {
      throw new Error(`No i18n content found for legal.${kind}`);
    }
    const html = renderPage(kind, docs);
    const outPath = path.join(OUT_DIR, `${kind}.html`);
    fs.writeFileSync(outPath, html);
    console.log(`wrote ${path.relative(ROOT, outPath)} (${html.length} bytes)`);
  }
}

main();

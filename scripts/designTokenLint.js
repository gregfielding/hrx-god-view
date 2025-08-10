// Flags literal colors and spacing in JSX/TSX; prints a style report.
const fs = require('fs');
const path = require('path');

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx|jsx)$/.test(e.name)) acc.push(p);
  }
}

function scan(file) {
  const t = fs.readFileSync(file, 'utf8');
  const hits = [];
  const colorRe = /#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(/g;
  const spaceRe = /\b(\d+px|\d+rem|\d+em)\b/g;
  let m; while ((m = colorRe.exec(t))) hits.push({ kind: 'color', val: m[0], idx: m.index });
  while ((m = spaceRe.exec(t))) hits.push({ kind: 'spacing', val: m[0], idx: m.index });
  return hits;
}

function main() {
  const files = [];
  if (fs.existsSync('src')) walk('src', files);
  const report = [];
  for (const f of files) {
    const hits = scan(f);
    if (hits.length) report.push({ file: f, hits });
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/design_tokens_report.json', JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
  console.log(`Design tokens report written: reports/design_tokens_report.json (${report.length} files flagged)`);
}

main();



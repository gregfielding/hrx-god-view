const fs = require('fs');
const path = require('path');

function walk(dir, acc) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) acc.push(p);
  }
}

function analyze(text) {
  const usages = [];
  const patterns = [
    /collection\(([^\)]+)\)/g,
    /doc\(([^\)]+)\)/g,
    /where\(([^\)]+)\)/g,
    /orderBy\(([^\)]+)\)/g,
    /limit\(([^\)]+)\)/g
  ];
  for (const re of patterns) {
    let m; while ((m = re.exec(text))) usages.push({ kind: re.source.split('\\(')[0], snippet: m[0] });
  }
  return usages;
}

function main() {
  const files = [];
  for (const r of ['src', 'functions/src']) if (fs.existsSync(r)) walk(r, files);
  const out = [];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const u = analyze(t);
    if (u.length) out.push({ file: f, usages: u });
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/firestore_usages.json', JSON.stringify({ generatedAt: new Date().toISOString(), out }, null, 2));
  console.log(`Found Firestore usage in ${out.length} files. Report: reports/firestore_usages.json`);
}

main();



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

function analyzeFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const anyCount = (text.match(/\bany\b/g) || []).length;
  const tsIgnoreCount = (text.match(/@ts-ignore/g) || []).length;
  const todoCount = (text.match(/TODO|FIXME/g) || []).length;
  return { file, anyCount, tsIgnoreCount, todoCount };
}

function main() {
  const roots = ['src', 'functions/src'];
  const files = [];
  for (const r of roots) if (fs.existsSync(r)) walk(r, files);

  const results = files.map(analyzeFile).filter(r => r.anyCount || r.tsIgnoreCount || r.todoCount);
  results.sort((a, b) => (b.anyCount + b.tsIgnoreCount) - (a.anyCount + a.tsIgnoreCount));

  console.log('Type-safety scan (any, @ts-ignore, TODO/FIXME):');
  for (const r of results) {
    console.log(`${r.file}: any=${r.anyCount}, ts-ignore=${r.tsIgnoreCount}, notes=${r.todoCount}`);
  }
  console.log(`\nFiles scanned: ${files.length}. Problem files: ${results.length}.`);
  const out = { generatedAt: new Date().toISOString(), totals: { files: files.length, problemFiles: results.length }, results };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/type_safety_report.json', JSON.stringify(out, null, 2));
}

main();



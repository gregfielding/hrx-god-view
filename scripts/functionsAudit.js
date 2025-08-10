const fs = require('fs');
const path = require('path');

function walk(dir, acc) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name)) acc.push(p);
  }
}

function main() {
  const root = 'functions/src';
  const files = [];
  if (!fs.existsSync(root)) return console.log('no functions/src');
  walk(root, files);
  const report = [];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const usesGen2 = /from 'firebase-functions\/v2\//.test(t);
    const regions = (t.match(/region\s*:\s*\[/g) || []).length;
    const minInstances = (t.match(/minInstances\s*:\s*\d+/g) || []).length;
    const timeout = (t.match(/timeoutSeconds\s*:\s*\d+/g) || []).length;
    const concurrency = (t.match(/concurrency\s*:\s*\d+/g) || []).length;
    report.push({ file: f, usesGen2, regions, minInstances, timeout, concurrency });
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/functions_audit.json', JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
  console.log('Functions audit written to reports/functions_audit.json');
}

main();



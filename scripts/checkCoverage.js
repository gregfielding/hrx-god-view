const fs = require('fs');

try {
  const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
  const lines = summary.total.lines.pct;
  const branches = summary.total.branches.pct;
  const functions = summary.total.functions.pct;
  const statements = summary.total.statements.pct;
  const min = 20; // starter gate; raise gradually
  const ok = lines >= min && branches >= min && functions >= min && statements >= min;
  console.log(`Coverage: lines=${lines} branches=${branches} functions=${functions} statements=${statements}`);
  if (!ok) {
    console.error(`Coverage below ${min}% gate`);
    process.exit(1);
  }
} catch (e) {
  console.error('Coverage summary not found or invalid');
  process.exit(1);
}



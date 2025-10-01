// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FieldRegistry } = require('../src/fields/registry');

(function main() {
  const issues: string[] = [];

  // Ensure all registry fields intended for Both have basic properties
  const both = Object.values(FieldRegistry as any).filter((f: any) => (f.usedBy || []).includes('Both'));
  for (const f of both as any[]) {
    if (!f.type) issues.push(`Field ${f.id} missing type`);
    if (!f.label) issues.push(`Field ${f.id} missing label`);
  }

  // Advisory: warn if any select has empty/undefined options
  for (const f of Object.values(FieldRegistry as any) as any[]) {
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      issues.push(`Select field ${f.id} has no options defined`);
    }
  }

  // Advisory: warn if select fields exist that might not be wired via registry in JobOrder form.
  const expectedJOSelects = ['experienceLevel', 'priority'];
  for (const id of expectedJOSelects) {
    const def = (FieldRegistry as any)[id];
    if (!def) continue;
    if (def.type === 'select' && (!def.options || def.options.length === 0)) {
      issues.push(`JobOrder select ${id} lacks registry options`);
    }
  }

  if (issues.length) {
    const blocking = process.env.PARITY_BLOCKING === 'true';
    const msg = (blocking ? '❌ Parity check failed (blocking)\n' : '⚠️ Advisory parity issues found:\n') + issues.map((i: string) => ' - ' + i).join('\n');
    if (blocking) {
      console.error(msg);
      process.exit(1);
    } else {
      console.warn(msg);
      process.exitCode = 0;
    }
  } else {
    console.log('✅ Advisory parity check passed');
  }
})();

export {};



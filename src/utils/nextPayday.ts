/**
 * Next payday (Friday, inclusive of today) — both entities pay Fridays:
 * Select for the prior Sun-Sat week, Events for the prior Mon-Sun week.
 * See docs/claude/project_payroll_help_desk.md.
 */
export function nextPayday(now: Date = new Date()): { date: Date; isToday: boolean } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 5 = Friday
  const delta = (5 - day + 7) % 7;
  d.setDate(d.getDate() + delta);
  return { date: d, isToday: delta === 0 };
}

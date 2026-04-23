/** Adjudication / vendor decision text → MUI Chip color. */
export function decisionChipColor(text: string): 'success' | 'error' | 'warning' | 'default' {
  const s = text.toLowerCase();
  if (/clear|eligible|pass/i.test(s)) return 'success';
  if (/fail|ineligible|decline/i.test(s)) return 'error';
  if (/review|pending|hold/i.test(s)) return 'warning';
  return 'default';
}

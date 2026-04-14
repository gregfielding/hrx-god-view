/**
 * Worker security levels included in recruiter "all users" / applicants lists.
 * Firestore `in` is type-sensitive — include both string and numeric forms.
 */
export const TENANT_LISTABLE_SECURITY_LEVELS: Array<string | number> = [
  '0',
  '1',
  '2',
  '3',
  '4',
  0,
  1,
  2,
  3,
  4,
];

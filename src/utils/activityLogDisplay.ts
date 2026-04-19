/**
 * Activity log `description` is often generic ("SMS sent via system"). When present, prefer
 * metadata fields that carry the actual outbound copy (SMS/email).
 */
export function getActivityLogMessageBodyDisplay(args: {
  actionType: string;
  description: string;
  metadata?: Record<string, unknown>;
}): string {
  const m = args.metadata || {};

  const pickString = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === 'string') {
        const t = v.trim();
        if (t) return t;
      }
    }
    return null;
  };

  const at = args.actionType || '';

  if (at === 'sms_sent' || at === 'email_sent') {
    const body =
      pickString('messageBody', 'smsBody', 'contentSent', 'messagePreview', 'message') ||
      (typeof args.description === 'string' ? args.description.trim() : '');
    if (body) return body;
  }

  if (at === 'notification') {
    const n = pickString('messageBody', 'message', 'messagePreview');
    if (n) return n;
  }

  return typeof args.description === 'string' ? args.description : '';
}

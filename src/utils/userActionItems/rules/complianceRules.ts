import type { ActionItem } from '../../../types/actionItems';
import { makeActionItem } from '../actionItemFactory';
import type { ActionItemsV1Input } from '../actionItemsV1Input';

function bgStatusNeedsReview(status: string, result?: string): boolean {
  const s = status.toLowerCase();
  const r = (result || '').toLowerCase();
  if (r.includes('fail') || r.includes('adverse') || s.includes('review')) return true;
  return false;
}

function bgStatusPending(status: string): boolean {
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('closed') || s.includes('clear')) return false;
  if (s.includes('pending') || s.includes('progress') || s.includes('submitted') || s.includes('ordered')) return true;
  return true;
}

export function runComplianceRules(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];
  const out: ActionItem[] = [];

  for (const o of input.backgroundCheckOrders) {
    const st = String(o.status || '');
    const res = o.result ? String(o.result) : undefined;
    if (bgStatusNeedsReview(st, res)) {
      out.push(
        makeActionItem({
          dedupeKey: `bg:${o.id}:review`,
          type: 'background_review_required',
          category: 'compliance',
          severity: 'high',
          actor: 'recruiter',
          title: 'Background check needs review',
          shortDescription: `${o.typeLabel || 'Screening'} returned a flag — confirm the outcome on Backgrounds.`,
          scope: { kind: 'global' },
          blocking: 'hard',
          sourceType: 'user_doc',
          sourceId: o.id,
          ctaLabel: 'Backgrounds',
          ctaTarget: { kind: 'profileTab', tab: 'Backgrounds' },
          priority: 14,
        }),
      );
    } else if (bgStatusPending(st)) {
      out.push(
        makeActionItem({
          dedupeKey: `bg:${o.id}:pending`,
          type: 'background_pending',
          category: 'compliance',
          severity: 'medium',
          actor: 'system',
          title: 'Background screen pending',
          shortDescription: `${o.typeLabel || 'Screening'} has not cleared yet — track it on Backgrounds.`,
          scope: { kind: 'global' },
          blocking: 'soft',
          sourceType: 'user_doc',
          sourceId: o.id,
          ctaLabel: 'Backgrounds',
          ctaTarget: { kind: 'profileTab', tab: 'Backgrounds' },
          priority: 45,
        }),
      );
    }
  }

  const certs = Array.isArray(input.certifications) ? input.certifications : [];
  certs.forEach((c, idx) => {
    if (!c || typeof c !== 'object') return;
    const o = c as Record<string, unknown>;
    const name = String(o.name || o.label || o.title || 'Certification');
    const required = o.required === true || o.isRequired === true;
    const hasFile = Boolean(o.fileName || o.fileUrl || o.uploadedAt);
    const expired = o.expired === true || o.status === 'expired';
    if (required && (!hasFile || expired)) {
      out.push(
        makeActionItem({
          dedupeKey: `cert:${name}:${idx}`,
          type: 'cert_required_missing',
          category: 'compliance',
          severity: 'high',
          actor: 'worker',
          title: `Missing required certification — ${name}`,
          shortDescription: expired
            ? 'The saved credential looks expired — renew or replace it.'
            : 'Upload proof or complete this requirement to clear the blocker.',
          scope: { kind: 'global' },
          blocking: 'hard',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Certifications',
          ctaTarget: { kind: 'profileTab', tab: 'Certifications' },
          priority: 18,
        }),
      );
    }
  });

  return out;
}

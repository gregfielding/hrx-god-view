/**
 * Job-order-driven certification demands for assignment readiness (shared: Cloud Functions bundle + web placement allowlist).
 * Synthetic rows use inner keys `required_${slug}` → `buildAssignmentReadiness` emits `cert_required_${slug}`.
 */

import type { AssignmentReadinessCertItem } from './buildAssignmentReadiness';

export function normalizeCertRequirementToken(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same semantics as placement allowlist label match: exact normalized equality, or substring when the
 * job-order token length is ≥ 4 (see `placementQualificationChipsModel`).
 */
export function certLabelMatchesJobOrderRequirement(certLabel: string, requirementRaw: string): boolean {
  const lab = normalizeCertRequirementToken(certLabel);
  const req = normalizeCertRequirementToken(requirementRaw);
  if (!lab || !req) return false;
  if (lab === req) return true;
  if (req.length >= 4 && (lab.includes(req) || req.includes(lab))) return true;
  return false;
}

const MAX_SLUG_LEN = 48;

function hash6(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

/** Stable slug for `cert_required_*` inner segment; must stay in sync with placement allowlist. */
export function stableCertRequiredSlug(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return 'unknown';
  let slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!slug) slug = `h_${hash6(s)}`;
  if (slug.length > MAX_SLUG_LEN) {
    slug = slug.slice(0, MAX_SLUG_LEN).replace(/_+$/g, '') || `h_${hash6(s)}`;
  }
  return slug;
}

function allocateSyntheticInnerKey(raw: string, usedInnerKeys: Set<string>): string {
  const baseSlug = stableCertRequiredSlug(raw);
  for (let n = 0; n < 100; n += 1) {
    const piece = n === 0 ? baseSlug : `${baseSlug}_${n}`;
    const inner = `required_${piece}`;
    if (!usedInnerKeys.has(inner)) return inner;
  }
  const inner = `required_${baseSlug}_${hash6(raw)}`;
  return inner;
}

/**
 * Append synthetic missing certification rows for JO requirements with no matching compliance evidence row.
 * Matching: (1) explicit id → row with same Firestore doc id; (2) human strings → normalized label match
 * against existing compliance-derived rows. Id demands are processed before string demands.
 */
export function mergeJobOrderSyntheticCertificationDemands(
  jobOrder: Record<string, unknown> | null | undefined,
  certifications: AssignmentReadinessCertItem[],
): AssignmentReadinessCertItem[] {
  if (!jobOrder) return certifications;

  const explicitIds = Array.isArray(jobOrder.requiredCertificationComplianceIds)
    ? (jobOrder.requiredCertificationComplianceIds as unknown[]).map((x) => String(x || '').trim()).filter(Boolean)
    : [];

  const labelStrings = [
    ...(Array.isArray(jobOrder.requiredCertifications) ? (jobOrder.requiredCertifications as unknown[]) : []),
    ...(Array.isArray(jobOrder.requiredLicenses) ? (jobOrder.requiredLicenses as unknown[]) : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  if (explicitIds.length === 0 && labelStrings.length === 0) return certifications;

  const out: AssignmentReadinessCertItem[] = [...certifications];
  const usedInnerKeys = new Set(
    out.map((c) => String(c.key || '').trim()).filter(Boolean),
  );

  function addSynthetic(displayLabel: string) {
    const inner = allocateSyntheticInnerKey(displayLabel, usedInnerKeys);
    if (usedInnerKeys.has(inner)) return;
    usedInnerKeys.add(inner);
    out.push({
      key: inner,
      label: displayLabel,
      complete: false,
    });
  }

  const seenIds = new Set<string>();
  for (const id of explicitIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const hasRow = certifications.some((c) => c.key === id);
    if (!hasRow) addSynthetic(id);
  }

  const seenNormLabels = new Set<string>();
  for (const lab of labelStrings) {
    const hasRow = certifications.some((c) => certLabelMatchesJobOrderRequirement(c.label, lab));
    if (hasRow) continue;
    const norm = normalizeCertRequirementToken(lab);
    if (norm && seenNormLabels.has(norm)) continue;
    if (norm) seenNormLabels.add(norm);
    addSynthetic(lab);
  }

  return out;
}

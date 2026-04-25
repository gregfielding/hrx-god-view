import type { CertificationCatalogManifestV1 } from './certificationCatalogManifest';
import type { Phase1CertificationRequirement } from './certificationRequirement';
import { warnCertifications } from './certificationsLogging';
import { normalizeCertificationNameForLookup } from './normalizeCertificationNameForLookup';
import { buildCatalogResolveIndex, resolveCatalogEntryId } from './resolveCatalogEntry';

function stableLegacyRequirementId(raw: string, catalogEntryId: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `legacy:${catalogEntryId}:${slug || 'req'}`;
}

/**
 * Bridge — maps job-order style **string** requirements to engine `Phase1CertificationRequirement` rows.
 * Unmapped strings are **skipped** (no silent guessing) and collected for logging/metrics.
 */
export function buildCertificationRequirementsFromLegacyStrings(input: {
  requiredCertifications?: string[] | null | undefined;
  requiredLicenses?: string[] | null | undefined;
  manifest: CertificationCatalogManifestV1;
}): { requirements: Phase1CertificationRequirement[]; unmappedStrings: string[] } {
  const index = buildCatalogResolveIndex(input.manifest);

  const merged = [...(input.requiredCertifications ?? []), ...(input.requiredLicenses ?? [])]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const seenRaw = new Set<string>();
  const dedupedRaw: string[] = [];
  for (const s of merged) {
    if (seenRaw.has(s)) continue;
    seenRaw.add(s);
    dedupedRaw.push(s);
  }

  const unmappedStrings: string[] = [];
  const byCatalogEntryId = new Map<string, Phase1CertificationRequirement>();

  for (const raw of dedupedRaw) {
    const normalized = normalizeCertificationNameForLookup(raw);
    const catalogEntryId = resolveCatalogEntryId(normalized, index);
    if (!catalogEntryId) {
      unmappedStrings.push(raw);
      warnCertifications('unmapped_legacy_name', {
        detail: `Job requirement string could not be resolved to catalogEntryId: "${raw}"`,
      });
      continue;
    }

    if (byCatalogEntryId.has(catalogEntryId)) {
      continue;
    }

    byCatalogEntryId.set(catalogEntryId, {
      requirementId: stableLegacyRequirementId(raw, catalogEntryId),
      catalogEntryId,
      scope: 'required',
      evidencePolicy: 'upload_required',
      reviewPolicy: 'must_be_approved',
      expirationPolicy: 'must_be_valid',
      legacySourceLabel: raw,
    });
  }

  return { requirements: [...byCatalogEntryId.values()], unmappedStrings };
}

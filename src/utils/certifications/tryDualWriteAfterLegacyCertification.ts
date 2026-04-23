import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { CertificationSourcePhase1 } from '../../types/certifications/certificationEnums';
import { createOrUpdateCertificationRecord } from './createOrUpdateCertificationRecord';
import { extractEvidenceFiles, type LegacyEvidenceInput } from './extractEvidenceFiles';
import { getCatalogEntryById } from './getCatalogEntryById';
import { isCertRecordsDualWriteEnabled } from './isCertRecordsDualWriteEnabled';
import { resolveCatalogEntryOrWarn } from './resolveCatalogEntryOrWarn';
import { warnCertifications } from './certificationsLogging';

/** Lazy manifest import for bundle (same JSON as Phase 1A). */
import certificationCatalogManifest from '../../data/generated/certificationCatalogManifest.v1.json';

const manifest = certificationCatalogManifest as CertificationCatalogManifestV1;

/**
 * After legacy `users.certifications` write succeeds, optionally create/update canonical record.
 * Returns new `certificationRecordId`, or `null` when skipped (flag off, unmapped, or failure — legacy remains).
 */
export async function tryDualWriteAfterLegacyCertification(params: {
  uid: string;
  certificationName: string;
  issuerName?: string | null;
  expirationDate?: string | null;
  legacyEvidence: LegacyEvidenceInput;
  source: CertificationSourcePhase1;
  existingCertificationRecordId?: string | null;
}): Promise<string | null> {
  if (!isCertRecordsDualWriteEnabled()) return null;

  const catalogEntryId = resolveCatalogEntryOrWarn(params.certificationName, manifest, params.uid);
  if (!catalogEntryId) return null;

  const cat = getCatalogEntryById(manifest, catalogEntryId);
  if (!cat) {
    warnCertifications('unmapped_legacy_name', {
      userId: params.uid,
      detail: `Manifest missing catalogEntryId "${catalogEntryId}" after resolve.`,
    });
    return null;
  }

  const evidenceFiles = extractEvidenceFiles(params.legacyEvidence);

  try {
    const { certificationRecordId } = await createOrUpdateCertificationRecord({
      uid: params.uid,
      certificationRecordId: params.existingCertificationRecordId ?? undefined,
      catalogEntryId,
      issuerName: params.issuerName ?? null,
      expirationDate: params.expirationDate ?? null,
      evidenceFiles,
      source: params.source,
      catalogAllowsSelfAttestation: cat.allowsSelfAttestation,
    });
    return certificationRecordId;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    warnCertifications('dual_write_failed', { userId: params.uid, detail });
    return null;
  }
}

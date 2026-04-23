import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { ActionBlocking, ActionItem, ActionSeverity } from '../../types/actionItems';
import { makeActionItem } from '../userActionItems/actionItemFactory';
import type { RequirementEvaluationRow } from './evaluateCertificationsForRequirements';
import { certificationDisplayNameForCatalogId } from './certificationReadinessSurfaceLabels';

/** Surfaces where action copy may differ (e.g. assignment vs profile). */
export type CertificationActionSurfaceContext = 'apply' | 'assignment' | 'profile';

export type MapCertificationEvaluationsToActionItemsInput = {
  rows: RequirementEvaluationRow[];
  manifest: CertificationCatalogManifestV1;
  surface: CertificationActionSurfaceContext;
  /** Firestore user id — used as `sourceId` for global-scope items. */
  userId: string;
};

function displayName(
  row: RequirementEvaluationRow,
  manifest: CertificationCatalogManifestV1,
): string {
  const legacy = row.requirement.legacySourceLabel?.trim();
  if (legacy) return legacy;
  return certificationDisplayNameForCatalogId(manifest, row.requirement.catalogEntryId);
}

function actionBlockingFromResult(
  row: RequirementEvaluationRow,
): { blocking: ActionBlocking; severity: ActionSeverity } {
  const { result, requirement } = row;
  if (result.status === 'preferred_unmet') {
    return { blocking: 'informational', severity: 'low' };
  }
  if (result.status === 'expiring_soon') {
    return { blocking: 'informational', severity: 'medium' };
  }
  if (result.blocking) {
    return { severity: requirement.scope === 'required' ? 'critical' : 'high', blocking: 'hard' as ActionBlocking };
  }
  return { blocking: 'soft', severity: 'medium' };
}

/**
 * Maps batched engine evaluation rows to Action Items v1 (Phase 5).
 * Does not dedupe against legacy cert items — merge happens in {@link deriveActionItemsV1}.
 */
export function mapCertificationEvaluationsToActionItems(
  input: MapCertificationEvaluationsToActionItemsInput,
): ActionItem[] {
  const { rows, manifest, userId, surface } = input;
  const out: ActionItem[] = [];

  for (const row of rows) {
    const { requirement, result } = row;
    const name = displayName(row, manifest);
    const refBase = {
      requirementId: requirement.requirementId,
      catalogEntryId: requirement.catalogEntryId,
      certificationRecordId: result.certificationRecordId,
      engineReason: result.reason,
    };

    const { blocking, severity } = actionBlockingFromResult(row);

    const push = (p: {
      type: ActionItem['type'];
      dedupeKey: string;
      title: string;
      shortDescription: string;
      actor: ActionItem['actor'];
      ctaLabel: string;
      priority: number;
    }) => {
      out.push(
        makeActionItem({
          ...p,
          category: 'compliance',
          severity,
          scope: { kind: 'global' },
          blocking,
          sourceType: 'derived',
          sourceId: userId,
          ctaTarget: { kind: 'profileTab', tab: 'Certifications' },
          certificationRef: refBase,
        }),
      );
    };

    switch (result.status) {
      case 'approved':
      case 'waived':
        break;
      case 'missing':
        push({
          type: 'missing_certification',
          dedupeKey: `cert_engine:${requirement.requirementId}:missing`,
          title: `Upload certification — ${name}`,
          shortDescription:
            surface === 'assignment'
              ? `A valid ${name} record is required before assignment. Upload proof on Certifications.`
              : `Add proof for ${name} on the Certifications tab.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 12,
        });
        break;
      case 'attested_only':
        push({
          type: 'certification_attested_only',
          dedupeKey: `cert_engine:${requirement.requirementId}:attested_only`,
          title: `Upload proof — ${name}`,
          shortDescription:
            requirement.evidencePolicy === 'upload_required'
              ? `${name} requires a file or verification — replace self-attestation with proof.`
              : `Upload supporting evidence for ${name} on Certifications.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 14,
        });
        break;
      case 'pending_review':
        push({
          type: 'certification_pending_review',
          dedupeKey: `cert_engine:${requirement.requirementId}:pending_review`,
          title: `Review certification — ${name}`,
          shortDescription: `${name} is awaiting review. Open Certifications to approve or reject.`,
          actor: 'recruiter',
          ctaLabel: 'Certifications',
          priority: 16,
        });
        break;
      case 'rejected':
        push({
          type: 'certification_rejected',
          dedupeKey: `cert_engine:${requirement.requirementId}:rejected`,
          title: `Resubmit certification — ${name}`,
          shortDescription: `${name} was rejected — worker should upload a corrected document.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 13,
        });
        break;
      case 'expired':
        push({
          type: 'certification_expired',
          dedupeKey: `cert_engine:${requirement.requirementId}:expired`,
          title: `Upload updated certification — ${name}`,
          shortDescription: `${name} is expired. Renew and upload on Certifications.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 15,
        });
        break;
      case 'expiring_soon':
        push({
          type: 'certification_expiring_soon',
          dedupeKey: `cert_engine:${requirement.requirementId}:expiring_soon`,
          title: `Renew soon — ${name}`,
          shortDescription: `${name} expires within the renewal window — plan an update.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 40,
        });
        break;
      case 'preferred_unmet':
        push({
          type: 'certification_preferred_unmet',
          dedupeKey: `cert_engine:${requirement.requirementId}:preferred_unmet`,
          title: `Preferred certification — ${name}`,
          shortDescription: `Consider adding ${name} to strengthen the profile.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 60,
        });
        break;
      case 'invalid':
        push({
          type: 'missing_certification',
          dedupeKey: `cert_engine:${requirement.requirementId}:invalid`,
          title: `Fix certification — ${name}`,
          shortDescription: result.reason || `${name} could not be validated — update on Certifications.`,
          actor: 'worker',
          ctaLabel: 'Certifications',
          priority: 14,
        });
        break;
      default:
        break;
    }
  }

  return out;
}

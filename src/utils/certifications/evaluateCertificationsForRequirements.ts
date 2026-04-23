import type { CertificationRecordV1 } from '../../types/certifications/certificationRecord';
import type { EvaluationContext, Phase1CertificationRequirement } from '../../types/certifications/certificationRequirement';
import { chooseBestCertificationRecordForCatalogEntry } from './chooseBestCertificationRecordForCatalogEntry';
import {
  evaluateCertificationRequirement,
  type CertificationEvaluationResult,
} from './evaluateCertificationRequirement';
import { firestoreTimestampToMs } from './firestoreTimestampToMs';

export type CanonicalRecordWithId = {
  certificationRecordId: string;
  record: CertificationRecordV1;
};

export type RequirementEvaluationRow = {
  requirement: Phase1CertificationRequirement;
  result: CertificationEvaluationResult;
};

/**
 * Batch evaluation: one best canonical record per requirement `catalogEntryId`, then pure engine run.
 * **No string matching** — callers supply canonical `certification_records` rows only.
 */
export function evaluateCertificationsForRequirements(input: {
  requirements: Phase1CertificationRequirement[];
  /** Canonical rows from `getCanonicalCertificationRecordsWithIds` (or equivalent). */
  records: CanonicalRecordWithId[];
  context: EvaluationContext;
  todayISO: string;
}): RequirementEvaluationRow[] {
  const { requirements, records, context, todayISO } = input;
  const byCatalog = new Map<string, CanonicalRecordWithId[]>();
  for (const row of records) {
    const id = row.record.catalogEntryId;
    const arr = byCatalog.get(id) ?? [];
    arr.push(row);
    byCatalog.set(id, arr);
  }

  const out: RequirementEvaluationRow[] = [];

  for (const requirement of requirements) {
    const group = byCatalog.get(requirement.catalogEntryId) ?? [];
    const candidates = group.map((g) => ({
      kind: 'canonical' as const,
      certificationRecordId: g.certificationRecordId,
      record: g.record,
      updatedAtMs: firestoreTimestampToMs(g.record.updatedAt),
    }));

    const chosen =
      candidates.length > 0
        ? chooseBestCertificationRecordForCatalogEntry(candidates, todayISO).best
        : null;

    const best =
      chosen?.kind === 'canonical'
        ? group.find((x) => x.certificationRecordId === chosen.certificationRecordId) ?? null
        : null;

    const result = evaluateCertificationRequirement({
      requirement,
      record: best?.record ?? null,
      certificationRecordId: best?.certificationRecordId,
      context,
      todayISO,
    });

    out.push({ requirement, result });
  }

  return out;
}

import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import certificationCatalogManifest from '../../data/generated/certificationCatalogManifest.v1.json';
import type { CertificationCatalogManifestV1 } from '../../types/certifications/certificationCatalogManifest';
import type { CertificationRecordStatus, CertificationReviewStatus } from '../../types/certifications/certificationEnums';
import type { CertificationRecordV1 } from '../../types/certifications/certificationRecord';
import {
  chooseBestCertificationRecordForCatalogEntry,
  type ChooseCertificationCandidate,
} from './chooseBestCertificationRecordForCatalogEntry';
import { warnCertifications } from './certificationsLogging';
import { firestoreTimestampToMs } from './firestoreTimestampToMs';
import type { CanonicalCertificationRecordDoc } from './getCanonicalCertificationRecords';
import { getCanonicalCertificationRecordsWithIds } from './getCanonicalCertificationRecords';
import { getCatalogEntryById } from './getCatalogEntryById';
import { normalizeDateToISODateString } from './normalizeDateToISODateString';
import { normalizeLegacyCertificationRow } from './normalizeLegacyCertificationRow';
import { buildCatalogResolveIndex } from './resolveCatalogEntry';

export type UnifiedCertificationProvenance = 'canonical' | 'legacy_only' | 'merged';

export type UnifiedCertificationListItem = {
  unifiedId: string;
  catalogEntryId: string | null;
  displayName: string;
  issuer?: string | null;
  expirationDate?: string | null;
  evidenceFileUrls: string[];
  provenance: UnifiedCertificationProvenance;
  certificationRecordId?: string;
  recordStatus?: CertificationRecordStatus;
  reviewStatus?: CertificationReviewStatus;
  mergeWarnings?: string[];
  isUnmapped?: boolean;
};

export type GetWorkerCertificationsUnifiedResult = {
  items: UnifiedCertificationListItem[];
  canonicalCount: number;
  legacyOnlyCount: number;
  warnings: string[];
};

const manifest = certificationCatalogManifest as CertificationCatalogManifestV1;

function legacyEvidenceUrls(raw: Record<string, unknown>): string[] {
  const u = raw.fileUrl ?? raw.downloadUrl;
  if (typeof u === 'string' && u.trim()) return [u.trim()];
  return [];
}

function canonicalEvidenceUrls(record: CertificationRecordV1): string[] {
  const refs = record.evidenceFileRefs ?? [];
  return refs.map((r) => r.storageUrl).filter((x): x is string => typeof x === 'string' && x.length > 0);
}

type LegacyParsed = {
  index: number;
  raw: Record<string, unknown>;
  normalized: ReturnType<typeof normalizeLegacyCertificationRow>;
  displayName: string;
};

function mergeVisual(
  legacyRaw: Record<string, unknown>,
  canon: CertificationRecordV1 | null,
  displayName: string,
): {
  displayName: string;
  issuer: string | null;
  expiration: string | null;
  evidenceFileUrls: string[];
  mergeWarnings: string[];
} {
  const mw: string[] = [];
  const legacyIssuer = typeof legacyRaw.issuer === 'string' ? legacyRaw.issuer.trim() : null;
  const legacyExp = normalizeDateToISODateString(legacyRaw.expirationDate);

  let issuer = canon?.issuer ?? legacyIssuer ?? null;
  let expiration = canon?.expirationDate ?? legacyExp ?? null;

  const legacyUrls = legacyEvidenceUrls(legacyRaw);
  const cUrls = canon ? canonicalEvidenceUrls(canon) : [];
  const evidenceFileUrls =
    cUrls.length > 0 ? [...cUrls, ...legacyUrls.filter((u) => !cUrls.includes(u))] : legacyUrls;

  if (canon && legacyExp && canon.expirationDate && legacyExp !== canon.expirationDate) {
    mw.push('field_mismatch_expiration');
  }
  if (canon && legacyIssuer && canon.issuer && legacyIssuer !== canon.issuer) {
    mw.push('field_mismatch_issuer');
  }

  return { displayName, issuer, expiration, evidenceFileUrls, mergeWarnings: mw };
}

/**
 * Unified read: legacy `users.certifications` + `certification_records` (canonical wins on conflict).
 * No readiness/scoring side effects.
 */
export async function getWorkerCertificationsUnified(
  uid: string,
  _opts?: { tenantId?: string | null },
): Promise<GetWorkerCertificationsUnifiedResult> {
  const warnings: string[] = [];
  const resolveIndex = buildCatalogResolveIndex(manifest);
  const evalDate = normalizeDateToISODateString(new Date()) ?? '1970-01-01';

  const [userSnap, canonicalRows] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getCanonicalCertificationRecordsWithIds(uid),
  ]);

  const rawLegacy = Array.isArray(userSnap.data()?.certifications) ? userSnap.data()!.certifications : [];

  const legacyParsed: LegacyParsed[] = rawLegacy.map((raw: unknown, index: number) => {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { name: String(raw ?? '') };
    const normalized = normalizeLegacyCertificationRow({ name: obj.name, issuer: obj.issuer, expirationDate: obj.expirationDate }, manifest, resolveIndex);
    const displayName =
      typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : normalized.name || 'Certification';
    return { index, raw: obj, normalized, displayName };
  });

  const canonById = new Map<string, CanonicalCertificationRecordDoc>();
  for (const row of canonicalRows) {
    canonById.set(row.certificationRecordId, row);
  }

  const legacyConsumed = new Set<number>();
  const canonConsumed = new Set<string>();
  const items: UnifiedCertificationListItem[] = [];

  /** A — pair by `legacy.certificationRecordId` === Firestore doc id */
  for (const leg of legacyParsed) {
    const rid = typeof leg.raw.certificationRecordId === 'string' ? leg.raw.certificationRecordId.trim() : '';
    if (!rid) continue;
    const c = canonById.get(rid);
    if (!c) {
      warnCertifications('field_mismatch', {
        userId: uid,
        detail: `Legacy certificationRecordId "${rid}" has no canonical doc`,
      });
      continue;
    }
    const catId = c.record.catalogEntryId;
    const catMeta = getCatalogEntryById(manifest, catId);
    const title = catMeta?.displayName ?? leg.displayName;
    const merged = mergeVisual(leg.raw, c.record, title);
    items.push({
      unifiedId: `merged-id-${rid}`,
      catalogEntryId: catId,
      displayName: merged.displayName,
      issuer: merged.issuer,
      expirationDate: merged.expiration,
      evidenceFileUrls: merged.evidenceFileUrls,
      provenance: 'merged',
      certificationRecordId: rid,
      recordStatus: c.record.recordStatus,
      reviewStatus: c.record.review.status,
      mergeWarnings: merged.mergeWarnings.length ? merged.mergeWarnings : undefined,
    });
    canonConsumed.add(rid);
    legacyConsumed.add(leg.index);
  }

  /** Remaining */
  const remCanon = canonicalRows.filter((r) => !canonConsumed.has(r.certificationRecordId));
  const remLegacy = legacyParsed.filter((l) => !legacyConsumed.has(l.index));

  const canonByCat = new Map<string, CanonicalCertificationRecordDoc[]>();
  for (const r of remCanon) {
    const id = r.record.catalogEntryId;
    const arr = canonByCat.get(id) ?? [];
    arr.push(r);
    canonByCat.set(id, arr);
  }

  const legByCat = new Map<string, LegacyParsed[]>();
  for (const l of remLegacy) {
    const cid = l.normalized.catalogEntryId;
    if (!cid) continue;
    const arr = legByCat.get(cid) ?? [];
    arr.push(l);
    legByCat.set(cid, arr);
  }

  const allCatIds = new Set<string>([...canonByCat.keys(), ...legByCat.keys()]);

  for (const catId of allCatIds) {
    const cGroup = canonByCat.get(catId) ?? [];
    const lGroup = legByCat.get(catId) ?? [];

    if (cGroup.length > 1) {
      warnings.push(`duplicate_canon:${catId}`);
      warnCertifications('duplicate_detected', {
        userId: uid,
        detail: `Multiple canonical docs for catalogEntryId=${catId} (${cGroup.length})`,
      });
    }
    if (lGroup.length > 1) {
      warnings.push(`duplicate_legacy:${catId}`);
      warnCertifications('duplicate_detected', {
        userId: uid,
        detail: `Multiple legacy rows for catalogEntryId=${catId} (${lGroup.length})`,
      });
    }

    const canonCandidates: ChooseCertificationCandidate[] = cGroup.map((c) => ({
      kind: 'canonical',
      certificationRecordId: c.certificationRecordId,
      record: c.record,
      updatedAtMs: firestoreTimestampToMs(c.record.updatedAt),
    }));
    const bestCanonChoice = canonCandidates.length
      ? chooseBestCertificationRecordForCatalogEntry(canonCandidates, evalDate).best
      : null;
    const bestC =
      bestCanonChoice?.kind === 'canonical'
        ? cGroup.find((x) => x.certificationRecordId === bestCanonChoice.certificationRecordId) ?? null
        : null;

    const legCandidates: ChooseCertificationCandidate[] = lGroup.map((l) => ({
      kind: 'legacy',
      legacyIndex: l.index,
      certificationRecordId: typeof l.raw.certificationRecordId === 'string' ? l.raw.certificationRecordId : undefined,
      expirationDate: l.normalized.expirationDate,
    }));
    const bestLegChoice = legCandidates.length
      ? chooseBestCertificationRecordForCatalogEntry(legCandidates, evalDate).best
      : null;
    const bestL =
      bestLegChoice?.kind === 'legacy' ? lGroup.find((x) => x.index === bestLegChoice.legacyIndex) ?? null : null;

    const catMeta = getCatalogEntryById(manifest, catId);
    const title = catMeta?.displayName ?? bestL?.displayName ?? bestC?.record.catalogEntryId ?? catId;

    if (bestC && bestL) {
      const merged = mergeVisual(bestL.raw, bestC.record, title);
      const mw = [...merged.mergeWarnings];
      if (cGroup.length > 1) mw.push('duplicate_catalog_entry_ignored');
      if (lGroup.length > 1) mw.push('duplicate_legacy_rows_ignored');
      items.push({
        unifiedId: `merged-cat-${catId}`,
        catalogEntryId: catId,
        displayName: merged.displayName,
        issuer: merged.issuer,
        expirationDate: merged.expiration,
        evidenceFileUrls: merged.evidenceFileUrls,
        provenance: 'merged',
        certificationRecordId: bestC.certificationRecordId,
        recordStatus: bestC.record.recordStatus,
        reviewStatus: bestC.record.review.status,
        mergeWarnings: mw.length ? mw : undefined,
      });
      for (const l of lGroup) legacyConsumed.add(l.index);
      for (const c of cGroup) canonConsumed.add(c.certificationRecordId);
      continue;
    }

    if (bestC && !bestL) {
      const r = bestC.record;
      items.push({
        unifiedId: `canon-${bestC.certificationRecordId}`,
        catalogEntryId: catId,
        displayName: title,
        issuer: r.issuer ?? null,
        expirationDate: r.expirationDate ?? null,
        evidenceFileUrls: canonicalEvidenceUrls(r),
        provenance: 'canonical',
        certificationRecordId: bestC.certificationRecordId,
        recordStatus: r.recordStatus,
        reviewStatus: r.review.status,
        mergeWarnings: cGroup.length > 1 ? ['duplicate_catalog_entry_ignored'] : undefined,
      });
      for (const c of cGroup) canonConsumed.add(c.certificationRecordId);
      continue;
    }

    if (bestL && !bestC) {
      const merged = mergeVisual(bestL.raw, null, title);
      items.push({
        unifiedId: `legacy-mapped-${bestL.index}`,
        catalogEntryId: catId,
        displayName: merged.displayName,
        issuer: merged.issuer,
        expirationDate: merged.expiration,
        evidenceFileUrls: merged.evidenceFileUrls,
        provenance: 'merged',
        mergeWarnings: [
          ...merged.mergeWarnings,
          'canonical_record_absent',
          ...(lGroup.length > 1 ? ['duplicate_legacy_rows_ignored'] : []),
        ],
      });
      for (const l of lGroup) legacyConsumed.add(l.index);
    }
  }

  /** Unmapped legacy */
  for (const leg of legacyParsed) {
    if (legacyConsumed.has(leg.index)) continue;
    if (!leg.normalized.isUnmapped) continue;
    const merged = mergeVisual(leg.raw, null, leg.displayName);
    warnings.push(`unmapped_legacy:${leg.index}`);
    warnCertifications('unmapped_legacy_name', { userId: uid, detail: `Legacy row index ${leg.index} unmapped` });
    items.push({
      unifiedId: `legacy:${leg.index}`,
      catalogEntryId: null,
      displayName: merged.displayName,
      issuer: merged.issuer,
      expirationDate: merged.expiration,
      evidenceFileUrls: merged.evidenceFileUrls,
      provenance: 'legacy_only',
      mergeWarnings: [...merged.mergeWarnings, 'unmapped_legacy_name'],
      isUnmapped: true,
    });
    legacyConsumed.add(leg.index);
  }

  /** Orphan canon (no legacy match at all) */
  for (const row of canonicalRows) {
    if (canonConsumed.has(row.certificationRecordId)) continue;
    const catId = row.record.catalogEntryId;
    const catMeta = getCatalogEntryById(manifest, catId);
    const title = catMeta?.displayName ?? catId;
    const r = row.record;
    items.push({
      unifiedId: `canon-orphan-${row.certificationRecordId}`,
      catalogEntryId: catId,
      displayName: title,
      issuer: r.issuer ?? null,
      expirationDate: r.expirationDate ?? null,
      evidenceFileUrls: canonicalEvidenceUrls(r),
      provenance: 'canonical',
      certificationRecordId: row.certificationRecordId,
      recordStatus: r.recordStatus,
      reviewStatus: r.review.status,
    });
  }

  const canonicalCount = canonicalRows.length;
  const legacyOnlyCount = items.filter((i) => i.provenance === 'legacy_only' && i.isUnmapped).length;

  return { items, canonicalCount, legacyOnlyCount, warnings };
}

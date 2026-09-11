/**
 * Live claim readiness for the signed-in worker at one hiring entity (step 5,
 * 2026-09-11): their `entity_employments` rows, the Everee link and their user
 * doc (headshot). Rules allow each read for the worker's own docs; a missing
 * Everee link can surface as permission-denied and is treated as "no link".
 * Pass nulls to keep the hook inert.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import {
  evaluateClaimReadiness,
  isHeadshotReadyForClaim,
  isPayrollReadyForClaim,
  type ClaimReadinessKind,
} from '../utils/claimShift/claimReadiness';

export interface ClaimReadinessState {
  loading: boolean;
  kind: ClaimReadinessKind | null;
  payrollReady: boolean;
  photoReady: boolean;
}

type Row = Record<string, unknown>;

export function useClaimReadiness(
  tenantId: string | null | undefined,
  uid: string | null | undefined,
  entityId: string | null | undefined,
): ClaimReadinessState {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [link, setLink] = useState<Row | null | undefined>(undefined);
  const [userDoc, setUserDoc] = useState<Row | null | undefined>(undefined);
  const active = Boolean(tenantId && uid && entityId);

  useEffect(() => {
    setRows(null);
    setLink(undefined);
    setUserDoc(undefined);
    if (!tenantId || !uid || !entityId) return undefined;
    const unsubRows = onSnapshot(
      query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', uid)),
      (snap) => setRows(snap.docs.map((d) => d.data() as Row).filter((r) => String(r.entityId || '') === entityId)),
      () => setRows([]),
    );
    const unsubLink = onSnapshot(
      doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${uid}`),
      (snap) => setLink(snap.exists() ? (snap.data() as Row) : null),
      () => setLink(null),
    );
    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      (snap) => setUserDoc(snap.exists() ? (snap.data() as Row) : null),
      () => setUserDoc(null),
    );
    return () => {
      unsubRows();
      unsubLink();
      unsubUser();
    };
  }, [tenantId, uid, entityId]);

  return useMemo(() => {
    if (!active) return { loading: false, kind: null, payrollReady: false, photoReady: false };
    const loading = rows === null || link === undefined || userDoc === undefined;
    if (loading) return { loading: true, kind: null, payrollReady: false, photoReady: false };
    return {
      loading: false,
      kind: evaluateClaimReadiness({ entityId: entityId as string, employments: rows, link }),
      payrollReady: isPayrollReadyForClaim(rows, link),
      photoReady: isHeadshotReadyForClaim(userDoc),
    };
  }, [active, rows, link, userDoc, entityId]);
}

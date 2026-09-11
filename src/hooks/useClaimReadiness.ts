/**
 * Live claim readiness for the signed-in worker at one hiring entity (step 5,
 * 2026-09-11): their `entity_employments` rows, the Everee link and their user
 * doc (headshot). Rules allow each read for the worker's own docs; a missing
 * Everee link can surface as permission-denied and is treated as "no link".
 * A denied listener never sees the doc appear, so the link listener
 * re-subscribes every few seconds for two minutes — a fresh C1 Events hire's
 * link lands seconds after the apply. Pass nulls to keep the hook inert.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import {
  evaluateClaimReadiness,
  eventsSetupSteps,
  isHeadshotReadyForClaim,
  isPayrollReadyForClaim,
  type ClaimReadinessKind,
} from '../utils/claimShift/claimReadiness';

export interface ClaimReadinessState {
  loading: boolean;
  kind: ClaimReadinessKind | null;
  payrollReady: boolean;
  photoReady: boolean;
  /** Payroll checklist steps (`eventsSetupSteps`); finished payroll = both true. */
  directDepositReady: boolean;
  taxFormReady: boolean;
  /** The link's Everee tenant — route key of the per-employer payroll page. */
  evereeTenantId: string | null;
}

type Row = Record<string, unknown>;

const LINK_RETRY_MS = 5000;
const LINK_RETRY_MAX = 24;

const INERT: ClaimReadinessState = {
  loading: false,
  kind: null,
  payrollReady: false,
  photoReady: false,
  directDepositReady: false,
  taxFormReady: false,
  evereeTenantId: null,
};

export function useClaimReadiness(
  tenantId: string | null | undefined,
  uid: string | null | undefined,
  entityId: string | null | undefined,
): ClaimReadinessState {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [link, setLink] = useState<Row | null | undefined>(undefined);
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [userDoc, setUserDoc] = useState<Row | null | undefined>(undefined);
  const active = Boolean(tenantId && uid && entityId);

  useEffect(() => {
    setRows(null);
    setLink(undefined);
    setLinkAttempt(0);
    setUserDoc(undefined);
    if (!tenantId || !uid || !entityId) return undefined;
    const unsubRows = onSnapshot(
      query(collection(db, 'tenants', tenantId, 'entity_employments'), where('userId', '==', uid)),
      (snap) => setRows(snap.docs.map((d) => d.data() as Row).filter((r) => String(r.entityId || '') === entityId)),
      () => setRows([]),
    );
    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      (snap) => setUserDoc(snap.exists() ? (snap.data() as Row) : null),
      () => setUserDoc(null),
    );
    return () => {
      unsubRows();
      unsubUser();
    };
  }, [tenantId, uid, entityId]);

  useEffect(() => {
    if (!tenantId || !uid || !entityId) return undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const unsubLink = onSnapshot(
      doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${uid}`),
      (snap) => setLink(snap.exists() ? (snap.data() as Row) : null),
      () => {
        setLink(null);
        if (linkAttempt < LINK_RETRY_MAX) {
          retry = setTimeout(() => setLinkAttempt((n) => n + 1), LINK_RETRY_MS);
        }
      },
    );
    return () => {
      unsubLink();
      if (retry) clearTimeout(retry);
    };
  }, [tenantId, uid, entityId, linkAttempt]);

  return useMemo(() => {
    if (!active) return INERT;
    const loading = rows === null || link === undefined || userDoc === undefined;
    if (loading) return { ...INERT, loading: true };
    const payrollReady = isPayrollReadyForClaim(rows, link);
    const steps = eventsSetupSteps({ photoReady: isHeadshotReadyForClaim(userDoc), payrollReady, link });
    const tid = link?.evereeTenantId;
    return {
      loading: false,
      kind: evaluateClaimReadiness({ entityId: entityId as string, employments: rows, link }),
      payrollReady,
      photoReady: steps.photo,
      directDepositReady: steps.directDeposit,
      taxFormReady: steps.taxForm,
      evereeTenantId:
        typeof tid === 'number' ? String(tid) : typeof tid === 'string' && tid.trim() ? tid.trim() : null,
    };
  }, [active, rows, link, userDoc, entityId]);
}

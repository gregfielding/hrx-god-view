/**
 * Worker-facing Everee pay history (Earnings v1/v2, Greg 2026-08-24).
 * Shared by the Earnings index (10-row "Recent pay") and the full
 * /c1/workers/pay-history page. Rides the existing `evereeGetPayHistory`
 * callable — `canSelfOrManageEveree` already allows workers to fetch
 * their own history, so there is no new server surface.
 */
import { useEffect, useState } from 'react';
import { collection, getDocs, limit as fbLimit, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

export interface WorkerEmployerLinkage {
  /** HRX entity id, e.g. c1_select_llc — what the Everee callables need. */
  entityId: string;
  /** Everee tenant id, e.g. "3133" — what worker routes use. */
  evereeTenantId: string;
  label: string;
}

export interface PayHistoryRow {
  statementId: string;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  gross: number | null;
  net: number | null;
  status: string | null;
  employerLabel: string;
  entityId: string;
  evereeTenantId: string;
}

export const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * The worker's production Everee employers with display labels.
 * Linkage docs (`everee_workers/{entityId}__{uid}`) are worker-readable;
 * sandbox tenant 2320 / smoke docs are skipped.
 */
export function useWorkerEmployerLinkages(
  tenantId: string | undefined,
  uid: string | undefined,
): { linkages: WorkerEmployerLinkage[]; loading: boolean } {
  const [linkages, setLinkages] = useState<WorkerEmployerLinkage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !uid) {
      setLinkages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const out: WorkerEmployerLinkage[] = [];
      try {
        const snap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'everee_workers'), where('firebaseUid', '==', uid)),
        );
        for (const d of snap.docs) {
          const x = d.data() as Record<string, unknown>;
          const tid = String(x.evereeTenantId ?? '');
          if (x.smokeData === true || tid === '2320' || !tid) continue;
          const entityId = String(x.entityId ?? '') || d.id.split('__')[0];
          if (!entityId) continue;
          let label = `Payroll · ${tid}`;
          try {
            const es = await getDocs(
              query(
                collection(db, 'tenants', tenantId, 'entities'),
                where('evereeTenantId', '==', tid),
                fbLimit(1),
              ),
            );
            const name = es.docs[0]?.get('name') ?? es.docs[0]?.get('legalName');
            if (typeof name === 'string' && name.trim()) label = name.trim();
          } catch {
            /* label fallback stands */
          }
          if (!out.some((l) => l.entityId === entityId)) out.push({ entityId, evereeTenantId: tid, label });
        }
      } catch {
        /* empty list — page shows its empty state */
      }
      if (!cancelled) {
        setLinkages(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid]);

  return { linkages, loading };
}

/** Fetch + merge pay history across employers, newest first. */
export function useWorkerPayHistory(
  tenantId: string | undefined,
  linkages: WorkerEmployerLinkage[],
  maxRows: number,
): { rows: PayHistoryRow[]; loading: boolean } {
  const [rows, setRows] = useState<PayHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const key = linkages.map((l) => l.entityId).sort().join('|');

  useEffect(() => {
    if (!tenantId || linkages.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const merged: PayHistoryRow[] = [];
      await Promise.all(
        linkages.map(async (l) => {
          try {
            const fn = httpsCallable(getFunctions(), 'evereeGetPayHistory');
            const res = await fn({ tenantId, entityId: l.entityId });
            const items = (res.data as { items?: Array<Record<string, unknown>> })?.items ?? [];
            for (const it of items) {
              merged.push({
                statementId: String(it.statementId || ''),
                payDate: (it.payDate as string) ?? null,
                periodStart: (it.periodStart as string) ?? null,
                periodEnd: (it.periodEnd as string) ?? null,
                gross: typeof it.gross === 'number' ? it.gross : null,
                net: typeof it.net === 'number' ? it.net : null,
                status: (it.status as string) ?? null,
                employerLabel: l.label,
                entityId: l.entityId,
                evereeTenantId: l.evereeTenantId,
              });
            }
          } catch {
            /* pay history is a convenience — other employers still render */
          }
        }),
      );
      if (cancelled) return;
      merged.sort((a, b) => String(b.payDate ?? '').localeCompare(String(a.payDate ?? '')));
      setRows(merged.slice(0, maxRows));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, key, maxRows]);

  return { rows, loading };
}

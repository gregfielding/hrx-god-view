/**
 * Timesheets — recruiter/admin timesheet workspace.
 *
 * **Filter gating** (per TS.1 §3.1):
 *   1. Entity dropdown is required.
 *   2. Once an entity is chosen, the period picker activates.
 *   3. Once a period is chosen, the grid hydrates.
 *
 * If a recruiter lands on the page with neither selected, the grid
 * shows a friendly "pick a hiring entity and period" empty state — we
 * never show "0 workers · 0 hrs" before the filter has been narrowed.
 *
 * **Account + Job Order narrowing.** Stacked on top of the base
 * entity+period filter. Both are optional client-side narrows applied
 * post-resolve (see `TimesheetGrid.narrowJobOrderIds`). The page loads
 * the entity's JOs once on entity change and derives both the Account
 * options (unique JO.companyId → companyName) and the Job Order
 * options (filtered by Account when set) from that list.
 *
 * **Toolbar layout.** `PageHeader` with `hideHeading` and a single
 * always-visible filter row containing Hiring Entity / Account /
 * Job Order / Shift / Period / Clear filters. The top bar title is
 * set to "Timesheets" (replaces the default tenant-name title).
 *
 * Sec 5/6/7 only — gate enforced at `App.tsx` (route) and
 * `menuGenerator.ts` (sidebar). Both must agree.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { collection, getDocs, query, where } from 'firebase/firestore';

import PageHeader from '../components/PageHeader';
import PeriodPicker, {
  type PeriodPickerScope,
} from '../components/timesheets/PeriodPicker';
import TimesheetGrid from '../components/timesheets/TimesheetGrid';
import AddRetroactiveWorkerDialog, {
  type AddRetroactiveWorkerDialogShiftOption,
} from '../components/timesheets/AddRetroactiveWorkerDialog';
import { useAuth } from '../contexts/AuthContext';
import { useSetTopBarTitle } from '../contexts/TopBarTitleContext';
import { db } from '../firebase';
import type { HiringEntity } from '../types/recruiter/hiringEntity';
import type { TimesheetFilter } from '../types/recruiter/timesheet';
import {
  type PeriodRange,
  isValidPeriod,
} from '../utils/timesheets/dateRange';

// Mirrors `/shifts` toolbar styling — 36px-tall, 6px radius, white bg,
// subtle border. Importing the same sx ensures both pages read as one
// visual family.
const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

/** Lightweight shape pulled off each JO doc — enough to drive both the
 *  Account and Job Order dropdowns plus the account→JO narrowing. The
 *  startDate/endDate fields are normalized to YYYY-MM-DD so they can
 *  feed PeriodPicker's `scope.autoFillPeriod` for per_event entities.
 *  jobTitle / worksite* feed the 3-line MenuItem rendering on the JO
 *  dropdown so recruiters can disambiguate same-named JOs at a glance. */
interface JobOrderOption {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  startDate: string | null;
  endDate: string | null;
  jobTitle: string | null;
  worksiteName: string | null;
  worksiteAddress: string | null;
}

/** Lightweight shape for a shift under a JO — drives the Shift
 *  dropdown when the recruiter has narrowed to a specific JO. Holds
 *  enough display detail (date + start/end times) that the option
 *  label is self-explanatory in the dropdown menu. The optional
 *  `endDate` field captures multi-day shifts (e.g. a Fri–Sun music
 *  festival shift); single-day shifts leave it null. */
interface ShiftOption {
  id: string;
  date: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Normalize a JO/shift date field to YYYY-MM-DD. JO docs store dates
 * as either ISO strings (`"2026-05-25"`), full ISO timestamps
 * (`"2026-05-25T08:00:00.000Z"`), Firestore Timestamps (with `.toDate()`),
 * or native Date objects depending on the write path that created them.
 * This helper coerces whichever shape Firestore handed back into the
 * single canonical YYYY-MM-DD string the PeriodRange API expects.
 */
function toYyyyMmDd(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    // Full ISO timestamp — slice the date prefix.
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t.slice(0, 10);
    return null;
  }
  // Firestore Timestamp has a .toDate() method; native Dates are
  // valid as-is. Both go through getFullYear/Month/Date.
  let d: Date | null = null;
  if (value instanceof Date) d = value;
  else if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    try {
      d = (value as { toDate: () => Date }).toDate();
    } catch {
      d = null;
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------
 * Filter persistence to localStorage
 *
 * Scoped by tenantId so switching tenants gets that tenant's saved view
 * (not a leak from the previous one). Stored as plain JSON; reads
 * defend against malformed or stale shapes.
 *
 * `entity` is persisted as just its `id` (the full HiringEntity gets
 * re-hydrated from the loaded `entities` list once it arrives). All
 * other fields are primitives or a small `PeriodRange`.
 * ------------------------------------------------------------------------- */

const FILTERS_STORAGE_PREFIX = 'hrx:timesheets:filters:';

interface PersistedFilters {
  entityId: string | null;
  accountFilter: string;
  jobOrderFilter: string;
  shiftFilter: string;
  period: PeriodRange | null;
}

function readPersistedFilters(tenantId: string): PersistedFilters | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(
      `${FILTERS_STORAGE_PREFIX}${tenantId}`,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedFilters>;
    const period =
      parsed.period &&
      typeof parsed.period === 'object' &&
      isValidPeriod(parsed.period as PeriodRange)
        ? (parsed.period as PeriodRange)
        : null;
    return {
      entityId: typeof parsed.entityId === 'string' ? parsed.entityId : null,
      accountFilter:
        typeof parsed.accountFilter === 'string' ? parsed.accountFilter : 'all',
      jobOrderFilter:
        typeof parsed.jobOrderFilter === 'string' ? parsed.jobOrderFilter : 'all',
      shiftFilter:
        typeof parsed.shiftFilter === 'string' ? parsed.shiftFilter : 'all',
      period,
    };
  } catch {
    return null;
  }
}

function writePersistedFilters(
  tenantId: string,
  filters: PersistedFilters,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${FILTERS_STORAGE_PREFIX}${tenantId}`,
      JSON.stringify(filters),
    );
  } catch {
    // Quota exceeded / private-mode / disabled storage — silent no-op.
    // Persistence is a UX enhancement, not a correctness requirement.
  }
}

const Timesheets: React.FC = () => {
  const { tenantId } = useAuth();

  const [entities, setEntities] = useState<HiringEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entity, setEntity] = useState<HiringEntity | null>(null);
  const [period, setPeriod] = useState<PeriodRange | null>(null);

  // Narrowing filters — applied client-side on top of the resolver's
  // entity+period query (see TimesheetGrid.narrowJobOrderIds /
  // narrowShiftId).
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [jobOrderFilter, setJobOrderFilter] = useState<string>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');

  // JO list scoped to the selected entity. Drives the Account dropdown
  // (derived companyId/companyName tuples) and the Job Order dropdown
  // (filtered by the selected Account when set).
  const [jobOrders, setJobOrders] = useState<JobOrderOption[]>([]);
  const [joLoading, setJoLoading] = useState(false);

  // Shifts under the currently-selected JO. Empty when no JO is picked.
  // Refetched on JO change; the dropdown is disabled outside that state.
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);

  // "+ Add worker" modal — admin-only retroactive placement. Opens from
  // the header (visible once a JO is selected). The `refreshKey` bumps
  // on success so the TimesheetGrid re-resolves and picks up the new
  // per-day assignment docs.
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Replace the default tenant-name top-bar title with "Timesheets".
  const topBarTitleNode = useMemo(
    () => (
      <Typography
        component="span"
        sx={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'inherit',
          lineHeight: 1.2,
        }}
      >
        Timesheets
      </Typography>
    ),
    [],
  );
  useSetTopBarTitle(topBarTitleNode);

  /* -------------------------------------------------------------------
   * Entity list — load once per tenant. Small list (typically 1–5 per
   * tenant) so we hold it inline rather than memoizing across pages.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    setEntitiesLoading(true);
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) => {
        if (cancelled) return;
        const list: HiringEntity[] = snap.docs
          .map((d) => {
            const data = d.data() as Partial<HiringEntity> & { name?: string };
            return {
              id: d.id,
              tenantId,
              name: typeof data.name === 'string' && data.name.trim().length > 0
                ? data.name
                : d.id,
              workerType: (data.workerType ?? 'mixed') as HiringEntity['workerType'],
              evereeApprovalGroupId: data.evereeApprovalGroupId,
              evereeEmbedEventHandlerName: data.evereeEmbedEventHandlerName,
              payrollSettings: data.payrollSettings,
              payPeriodPolicy: data.payPeriodPolicy,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntities(list);
        setEntitiesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load entities', err);
        setEntities([]);
        setEntitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  /* -------------------------------------------------------------------
   * Entity-scoped JO list — refetched whenever the selected entity
   * changes. Drives the Account + Job Order dropdown options. We keep
   * the field set narrow on purpose; this is a UI lookup, not the row
   * source of truth.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId || !entity) {
      setJobOrders([]);
      return;
    }
    let cancelled = false;
    setJoLoading(true);
    const q = query(
      collection(db, 'tenants', tenantId, 'job_orders'),
      where('hiringEntityId', '==', entity.id),
    );
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const list: JobOrderOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const name =
              (typeof data.jobOrderName === 'string' && data.jobOrderName.trim()) ||
              (typeof data.jobTitle === 'string' && data.jobTitle.trim()) ||
              d.id;
            const companyId =
              (typeof data.companyId === 'string' && data.companyId.trim()) ||
              (typeof data.accountId === 'string' && data.accountId.trim()) ||
              '';
            const companyName =
              (typeof data.companyName === 'string' && data.companyName.trim()) ||
              (typeof data.accountName === 'string' && data.accountName.trim()) ||
              '(unknown account)';
            // Job title — distinct from jobOrderName. A JO labeled
            // "Suenos 2026" might have jobTitle "Janitors and Cleaners";
            // both belong in the MenuItem so the recruiter sees what
            // the workers are actually doing.
            const jobTitle =
              (typeof data.jobTitle === 'string' && data.jobTitle.trim()) || null;
            const worksiteName =
              (typeof data.worksiteName === 'string' && data.worksiteName.trim()) ||
              (typeof data.locationName === 'string' && data.locationName.trim()) ||
              null;
            // Compose a one-line address from the worksiteAddress map
            // (street, city, state, zip). Older JOs may have only some
            // of these set — emit whatever's available, comma-joined.
            const addrMap =
              (data.worksiteAddress as Record<string, unknown> | undefined) ?? {};
            const addrLine1 =
              typeof addrMap.street === 'string' ? addrMap.street.trim() : '';
            const addrCity =
              typeof addrMap.city === 'string' ? addrMap.city.trim() : '';
            const addrState =
              typeof addrMap.state === 'string' ? addrMap.state.trim() : '';
            const addrZip = typeof addrMap.zip === 'string' ? addrMap.zip.trim() : '';
            const cityStateZip = [addrCity, addrState].filter(Boolean).join(', ');
            const cityStateZipFull = addrZip ? `${cityStateZip} ${addrZip}` : cityStateZip;
            const worksiteAddress =
              [addrLine1, cityStateZipFull].filter(Boolean).join(' · ') || null;
            return {
              id: d.id,
              name,
              companyId,
              companyName,
              startDate: toYyyyMmDd(data.startDate),
              endDate: toYyyyMmDd(data.endDate),
              jobTitle,
              worksiteName,
              worksiteAddress,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setJobOrders(list);
        setJoLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load job orders', err);
        setJobOrders([]);
        setJoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, entity]);

  /* -------------------------------------------------------------------
   * Shift list — loaded on demand whenever a single JO is selected.
   * Cleared (and dropdown disabled) outside that state. Listing every
   * shift in the entity would scale poorly + dilute the dropdown UX;
   * the JO-scoped pattern matches how recruiters think about Events
   * payroll (pick the account → JO → shift → submit).
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId || jobOrderFilter === 'all') {
      setShifts([]);
      setShiftsLoading(false);
      return;
    }
    let cancelled = false;
    setShiftsLoading(true);
    getDocs(
      collection(
        db,
        'tenants',
        tenantId,
        'job_orders',
        jobOrderFilter,
        'shifts',
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        const list: ShiftOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const date =
              toYyyyMmDd(data.shiftDate) ?? toYyyyMmDd(data.date);
            // Multi-day shifts (e.g. a Fri–Sun festival single shift)
            // carry an `endDate` separate from the start `shiftDate`.
            // Single-day shifts leave it null and the period collapses
            // to a one-day range later in the scope mapper.
            const endDate = toYyyyMmDd(data.endDate);
            const startTime =
              (typeof data.startTime === 'string' && data.startTime.trim()) ||
              null;
            const endTime =
              (typeof data.endTime === 'string' && data.endTime.trim()) ||
              null;
            return { id: d.id, date, endDate, startTime, endTime };
          })
          .sort((a, b) => {
            // Sort by date asc, then start time asc — matches the
            // operational order recruiters scan for daily payroll.
            const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
            if (dateCmp !== 0) return dateCmp;
            return (a.startTime ?? '').localeCompare(b.startTime ?? '');
          });
        setShifts(list);
        setShiftsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load shifts', err);
        setShifts([]);
        setShiftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrderFilter]);

  /* -------------------------------------------------------------------
   * Derived dropdown option lists.
   *
   * Accounts: unique companyId tuples from the loaded JOs. We key by
   * companyId (not companyName) so renames don't fragment the list.
   *
   * Job Orders: filtered to the selected Account when set.
   * ------------------------------------------------------------------- */
  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const jo of jobOrders) {
      if (jo.companyId && !map.has(jo.companyId)) {
        map.set(jo.companyId, jo.companyName);
      }
    }
    return Array.from(map.entries())
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [jobOrders]);

  const jobOrderOptions = useMemo(() => {
    if (accountFilter === 'all') return jobOrders;
    return jobOrders.filter((jo) => jo.companyId === accountFilter);
  }, [jobOrders, accountFilter]);

  /* -------------------------------------------------------------------
   * Narrowing set passed to the grid.
   *
   *   - Both filters "all"           → null (no narrowing)
   *   - jobOrderFilter set           → singleton set with that id
   *   - accountFilter set            → set of all JOs under that account
   *   - both set                     → singleton (JO already constrained
   *                                    by the account-filtered dropdown)
   * ------------------------------------------------------------------- */
  const narrowJobOrderIds = useMemo<Set<string> | null>(() => {
    if (jobOrderFilter !== 'all') {
      return new Set([jobOrderFilter]);
    }
    if (accountFilter !== 'all') {
      return new Set(
        jobOrders
          .filter((jo) => jo.companyId === accountFilter)
          .map((jo) => jo.id),
      );
    }
    return null;
  }, [jobOrderFilter, accountFilter, jobOrders]);

  /* -------------------------------------------------------------------
   * Filter-change side effects.
   *
   * Entity swap → reset period, account, and JO. PeriodPicker will
   * re-seed with the new entity's default on next render.
   *
   * Account swap → if the previously-selected JO is no longer under
   * that account, clear it.
   *
   * Tenant swap → drop everything (rare in practice — tenant-switcher).
   * ------------------------------------------------------------------- */
  const handleEntityChange = useCallback((nextId: string) => {
    const next = entities.find((e) => e.id === nextId) ?? null;
    setEntity(next);
    setPeriod(null);
    setAccountFilter('all');
    setJobOrderFilter('all');
    setShiftFilter('all');
  }, [entities]);

  const handleAccountChange = useCallback((nextId: string) => {
    setAccountFilter(nextId);
    // If the current JO selection isn't under the new account, drop it.
    if (
      nextId !== 'all' &&
      jobOrderFilter !== 'all' &&
      !jobOrders.some((jo) => jo.id === jobOrderFilter && jo.companyId === nextId)
    ) {
      setJobOrderFilter('all');
      setShiftFilter('all');
    }
  }, [jobOrderFilter, jobOrders]);

  const handleJobOrderChange = useCallback((nextId: string) => {
    setJobOrderFilter(nextId);
    // Switching JO invalidates the shift selection — different JO = a
    // different shift collection. Reset to "All Shifts" so we don't
    // leave a stale shift id selected against a JO it doesn't belong to.
    setShiftFilter('all');
    // NOTE: we deliberately do NOT setPeriod(null) here.
    //   - For per_event entities, PeriodPicker's `scope` effect picks
    //     up the new JO's autoFillPeriod and overwrites `value`
    //     directly — no `null` round-trip needed.
    //   - For weekly entities, scope is ignored; clearing the period
    //     would just snap the recruiter back to "this week" and lose
    //     whatever week they had picked. That was the source of the
    //     "Week input refreshes after every JO/shift change" bug
    //     reported against the Timesheets page.
  }, []);

  const handleShiftChange = useCallback((nextId: string) => {
    setShiftFilter(nextId);
    // Same rationale as handleJobOrderChange — let PeriodPicker's
    // scope effect drive per_event auto-fill; preserve weekly
    // entity period selection across shift narrowing.
  }, []);

  /* -------------------------------------------------------------------
   * Filter persistence — restore on tenant change; write back on change.
   *
   * On tenantId change, read the saved filters for THAT tenant and
   * seed the non-entity primitives immediately (account / JO / shift /
   * period). The entity object itself is re-hydrated by a separate
   * effect once `entities[]` finishes loading.
   *
   * `restoredEntityForTenantRef` guards the entity-restore against
   * stomping a user-initiated `entity = null` selection later in the
   * session. We only auto-set entity once per tenantId arrival.
   * ------------------------------------------------------------------- */
  const restoredEntityForTenantRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setEntity(null);
      setPeriod(null);
      setAccountFilter('all');
      setJobOrderFilter('all');
      setShiftFilter('all');
      restoredEntityForTenantRef.current = null;
      return;
    }
    const persisted = readPersistedFilters(tenantId);
    setEntity(null); // re-hydrated by the entities-loaded effect below
    setPeriod(persisted?.period ?? null);
    setAccountFilter(persisted?.accountFilter ?? 'all');
    setJobOrderFilter(persisted?.jobOrderFilter ?? 'all');
    setShiftFilter(persisted?.shiftFilter ?? 'all');
    // Reset the entity-restore guard for the new tenant — once entities
    // load for THIS tenantId, we'll attempt the entity restore exactly once.
    restoredEntityForTenantRef.current = null;
  }, [tenantId]);

  // Once entities load, hydrate `entity` from the saved entityId.
  // Guarded by the ref so this only runs once per tenantId arrival —
  // if the user later clears the entity selection, we don't re-restore.
  useEffect(() => {
    if (!tenantId || entities.length === 0) return;
    if (restoredEntityForTenantRef.current === tenantId) return;
    const persisted = readPersistedFilters(tenantId);
    if (persisted?.entityId) {
      const found = entities.find((e) => e.id === persisted.entityId);
      if (found) setEntity(found);
    }
    restoredEntityForTenantRef.current = tenantId;
  }, [tenantId, entities]);

  // Write-back: persist any filter change. Skipped when tenantId is
  // unset (e.g. between tenant switches).
  useEffect(() => {
    if (!tenantId) return;
    writePersistedFilters(tenantId, {
      entityId: entity?.id ?? null,
      accountFilter,
      jobOrderFilter,
      shiftFilter,
      period,
    });
  }, [tenantId, entity, accountFilter, jobOrderFilter, shiftFilter, period]);

  /* -------------------------------------------------------------------
   * Filter assembly — the base resolver filter the grid loads against.
   * Account + JO are layered on top via `narrowJobOrderIds`.
   * ------------------------------------------------------------------- */
  const filter: TimesheetFilter | null = useMemo(() => {
    if (!entity) return null;
    if (!period || !isValidPeriod(period)) return null;
    return {
      kind: 'entity_period',
      hiringEntityId: entity.id,
      periodStart: period.start,
      periodEnd: period.end,
    };
  }, [entity, period]);

  const hasActiveFilters =
    accountFilter !== 'all' ||
    jobOrderFilter !== 'all' ||
    shiftFilter !== 'all';

  const handleClearFilters = useCallback(() => {
    setAccountFilter('all');
    setJobOrderFilter('all');
    setShiftFilter('all');
  }, []);

  /** Single shift id passed to the grid for the third narrowing axis.
   *  `null` means "no shift narrowing" — apply only the JO-set narrow. */
  const narrowShiftId = shiftFilter !== 'all' ? shiftFilter : null;

  /* -------------------------------------------------------------------
   * PeriodPicker scope — tells the picker that the period should be
   * derived from a JO or shift's date range rather than a default
   * weekly/manual cadence.
   *
   * Resolution order (most specific wins):
   *   1. Shift selected (with a known date) → `{ kind: 'shift' }`
   *   2. JO selected   (with known startDate/endDate) → `{ kind: 'jobOrder' }`
   *   3. Otherwise → null (PeriodPicker falls back to its own default)
   *
   * For per_event entities (e.g. C1 Events), this triggers the
   * `per_event_scoped` mode in PeriodPicker — the picker auto-fills
   * the period from `autoFillPeriod` and shows a "Switch to manual"
   * affordance. For weekly entities (C1 Select / Workforce), the
   * scope is currently ignored by PeriodPicker so the Week dropdown
   * remains; JO/shift narrowing still applies via narrowJobOrderIds /
   * narrowShiftId.
   * ------------------------------------------------------------------- */
  const periodScope = useMemo<PeriodPickerScope>(() => {
    if (shiftFilter !== 'all') {
      const shift = shifts.find((s) => s.id === shiftFilter);
      // Multi-day shifts (festivals etc.) span shiftDate → endDate;
      // single-day shifts collapse to {start, end: start}.
      const start = shift?.date ?? null;
      const end = shift?.endDate ?? shift?.date ?? null;
      // If the shift has no usable dates, fall back to scope=null so
      // PeriodPicker stays in its policy default rather than getting
      // stuck on "Resolving scope…". Row narrowing still applies via
      // narrowShiftId regardless.
      if (!start || !end) return null;
      return {
        kind: 'shift',
        refId: shiftFilter,
        autoFillPeriod: { start, end },
      };
    }
    if (jobOrderFilter !== 'all') {
      const jo = jobOrders.find((j) => j.id === jobOrderFilter);
      const start = jo?.startDate ?? null;
      const end = jo?.endDate ?? jo?.startDate ?? null;
      if (!start || !end) return null;
      return {
        kind: 'jobOrder',
        refId: jobOrderFilter,
        autoFillPeriod: { start, end },
      };
    }
    return null;
  }, [shiftFilter, jobOrderFilter, shifts, jobOrders]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ maxWidth: 720 }}>
          No active tenant. Switch tenants to load timesheets.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        hideHeading
        dense
        showDivider={false}
        title=""
        filters={
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 0,
              width: '100%',
              minWidth: 0,
            }}
          >
            {/* Filters are always visible per design — no Show/Hide
                toggle and no collapsed-state summary. The four filter
                Selects + Period picker + Clear filters fit comfortably
                in one wrapping row. */}
            <Box
              sx={{
                display: 'flex',
                gap: 1.25,
                alignItems: 'center',
                flexWrap: 'wrap',
                rowGap: 1,
              }}
            >
                <FormControl size="small" sx={{ minWidth: 220, height: 36 }}>
                  {/* `shrink` + `notched` keeps the label floating
                      regardless of value so the "Select an entity"
                      placeholder doesn't collide with the label. */}
                  <InputLabel shrink sx={{ fontSize: '0.875rem' }}>
                    Hiring Entity
                  </InputLabel>
                  <Select
                    value={entity?.id ?? ''}
                    onChange={(e) => handleEntityChange(String(e.target.value))}
                    label="Hiring Entity"
                    notched
                    sx={filterSelectSx}
                    displayEmpty
                    renderValue={(val) => {
                      if (!val) {
                        return (
                          <Typography
                            component="span"
                            sx={{
                              fontSize: '0.875rem',
                              color: 'text.disabled',
                            }}
                          >
                            {entitiesLoading
                              ? 'Loading…'
                              : entities.length === 0
                                ? 'No entities'
                                : 'Select an entity'}
                          </Typography>
                        );
                      }
                      return entities.find((e) => e.id === val)?.name ?? String(val);
                    }}
                  >
                    {entities.map((e) => (
                      <MenuItem key={e.id} value={e.id}>
                        {e.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 200, height: 36 }}
                  disabled={!entity || joLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Account</InputLabel>
                  <Select
                    value={accountFilter}
                    onChange={(e) => handleAccountChange(String(e.target.value))}
                    label="Account"
                    sx={filterSelectSx}
                  >
                    <MenuItem value="all">All Accounts</MenuItem>
                    {accountOptions.map((a) => (
                      <MenuItem key={a.companyId} value={a.companyId}>
                        {a.companyName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 220, height: 36 }}
                  disabled={!entity || joLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Job Order</InputLabel>
                  <Select
                    value={jobOrderFilter}
                    onChange={(e) => handleJobOrderChange(String(e.target.value))}
                    label="Job Order"
                    sx={filterSelectSx}
                    // Keep the closed-state display a single line. Without
                    // this, the Select renders the entire 3-line MenuItem
                    // body when collapsed and the field grows to ~80px tall.
                    renderValue={(val) => {
                      if (val === 'all') return 'All Job Orders';
                      const jo = jobOrderOptions.find((o) => o.id === val);
                      return jo?.name ?? String(val);
                    }}
                  >
                    <MenuItem value="all">All Job Orders</MenuItem>
                    {jobOrderOptions.map((jo) => (
                      <MenuItem key={jo.id} value={jo.id} sx={{ alignItems: 'flex-start', py: 1 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, lineHeight: 1.2 }}
                          >
                            {jo.name}
                          </Typography>
                          {jo.jobTitle && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ lineHeight: 1.2 }}
                            >
                              {jo.jobTitle}
                            </Typography>
                          )}
                          {(jo.worksiteName || jo.worksiteAddress) && (
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ lineHeight: 1.2 }}
                            >
                              {[jo.worksiteName, jo.worksiteAddress]
                                .filter(Boolean)
                                .join(' — ')}
                            </Typography>
                          )}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 200, height: 36 }}
                  disabled={jobOrderFilter === 'all' || shiftsLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Shift</InputLabel>
                  <Select
                    value={shiftFilter}
                    onChange={(e) => handleShiftChange(String(e.target.value))}
                    label="Shift"
                    sx={filterSelectSx}
                  >
                    <MenuItem value="all">All Shifts</MenuItem>
                    {shifts.map((s) => {
                      // Compose a label that's stable + scannable. We
                      // accept that some legacy shifts may not carry
                      // date or time — fall back to the doc id so the
                      // option is at least selectable.
                      const datePart = s.date ?? '';
                      const timePart =
                        s.startTime && s.endTime
                          ? `${s.startTime}–${s.endTime}`
                          : s.startTime ?? '';
                      const label =
                        datePart && timePart
                          ? `${datePart} · ${timePart}`
                          : datePart || timePart || s.id;
                      return (
                        <MenuItem key={s.id} value={s.id}>
                          {label}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>

                {/* PeriodPicker is purposely kept as-is — it owns the
                    entity-specific pay-period logic (weekly arrows /
                    per-event manual mode). Visual fit isn't pixel-
                    perfect with the Select cluster, but the business
                    logic is non-trivial and worth keeping centralized. */}
                {entity ? (
                  <PeriodPicker
                    entity={entity}
                    value={period}
                    onChange={setPeriod}
                    scope={periodScope}
                  />
                ) : (
                  <Typography
                    variant="body2"
                    color="text.disabled"
                    sx={{ pt: 0.5 }}
                  >
                    Period selector activates once a hiring entity is selected.
                  </Typography>
                )}

                <Button
                  variant="text"
                  size="small"
                  disabled={!hasActiveFilters}
                  onClick={handleClearFilters}
                  sx={{
                    textTransform: 'none',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: hasActiveFilters ? '#0057B8' : 'rgba(0, 0, 0, 0.35)',
                    minHeight: 30,
                    minWidth: 'auto',
                    px: 1,
                    '&:hover': {
                      bgcolor: hasActiveFilters
                        ? 'rgba(0, 87, 184, 0.06)'
                        : 'transparent',
                    },
                  }}
                >
                  Clear filters
                </Button>

                {/* Universal "+" — admin-only retroactive worker add.
                    Only meaningful with a JO selected (the modal needs
                    to know which shifts to offer). Mirrors the
                    `/users/all` primary-blue idiom for "add new <thing>". */}
                {jobOrderFilter !== 'all' && (
                  <Tooltip title="Add a worker to this job order (retroactive — no notifications sent)">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => setAddWorkerOpen(true)}
                        disabled={shiftsLoading || shifts.length === 0}
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: '#0057B8',
                          color: '#fff',
                          '&:hover': { bgcolor: '#004a9f' },
                          '&.Mui-disabled': {
                            bgcolor: 'rgba(0, 87, 184, 0.35)',
                            color: '#fff',
                          },
                        }}
                        aria-label="Add worker"
                      >
                        <AddIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
            </Box>
          </Box>
        }
      />

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          px: { xs: 2, md: 3 },
          pb: 2,
        }}
      >
        <TimesheetGrid
          filter={filter}
          refreshSignal={refreshKey}
          narrowJobOrderIds={narrowJobOrderIds}
          narrowShiftId={narrowShiftId}
        />
      </Box>

      {tenantId && jobOrderFilter !== 'all' && (
        <AddRetroactiveWorkerDialog
          open={addWorkerOpen}
          onClose={() => setAddWorkerOpen(false)}
          onSuccess={() => {
            // Force the TimesheetGrid to re-mount (and re-resolve) so the
            // new per-day assignment docs show up immediately. Cheap
            // because the grid's own data flow is keyed on filter + period,
            // not on a heavy parent state.
            setRefreshKey((k) => k + 1);
          }}
          tenantId={tenantId}
          jobOrderId={jobOrderFilter}
          shifts={shifts.map((s): AddRetroactiveWorkerDialogShiftOption => {
            const datePart = s.date ?? '';
            const timePart =
              s.startTime && s.endTime
                ? `${s.startTime}–${s.endTime}`
                : s.startTime ?? '';
            const label =
              datePart && timePart
                ? `${datePart} · ${timePart}`
                : datePart || timePart || s.id;
            return { id: s.id, label };
          })}
          defaultShiftId={shiftFilter === 'all' ? null : shiftFilter}
        />
      )}
    </Box>
  );
};

export default Timesheets;

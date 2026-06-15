/**
 * EditShiftForm — self-contained shift create/edit form.
 *
 * Originally lived inline inside `ShiftSetupTab`'s Add/Edit Shift dialog
 * but was extracted so it can be reused in places that don't want a
 * full-screen dialog wrapper (e.g. the ShiftPlacementsDrawer Settings
 * tab). The form owns:
 *
 *  - All form state (formData, error)
 *  - Validation
 *  - Firestore add / update writes
 *  - The "notify assigned workers?" follow-up dialog when an existing
 *    shift's schedule or instructions change
 *  - The Cancel / Add / Update buttons (renderActions=false to suppress
 *    when a parent like a Dialog wants to render its own footer)
 *
 * Side effects: on successful save it calls `onSaved(message)`. The
 * parent decides whether to close, refresh a list, etc. The form does
 * not navigate or close itself.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Check as CheckIcon,
  Clear as ClearIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { JobsBoardService } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { useEntity } from '../../hooks/useEntity';
import { getDateRange, formatDayAndDate } from '../../utils/dateSchedule';
import { formatHourlyPayRateForDisplay } from '../../utils/hourlyPayDisplay';
import {
  getFutaRateByState,
  getSutaRateByState,
  normalizeStateCode,
} from '../../utils/unemploymentRates';
import {
  buildScheduleNotifyText,
  computeShiftNotifyDiff,
  shouldPromptShiftWorkerNotify,
} from '../../utils/shiftWorkerNotifyDiff';
import { persistMissingSutaFutaForJobOrderAndAccount } from '../../utils/shifts/sutaFutaAccountHydration';
import {
  persistShiftPricingToJobOrder,
  recomputePricingTriple,
  type ShiftPricingPatch,
} from '../../utils/shifts/persistShiftPricingToJobOrder';
import {
  SHIFT_STATUS_FILTER_ENTRIES,
  type ShiftStatus,
} from '../../utils/shifts/shiftRow';

export type { ShiftStatus };

/* -------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface ShiftFormShift {
  id: string;
  tenantId: string;
  jobOrderId: string;
  shiftTitle: string;
  status?: ShiftStatus;
  defaultJobTitle?: string;
  totalStaffRequested: number;
  overstaffCount?: number;
  showStaffNeeded?: boolean;
  poNumber?: string;
  shiftDate: string;
  shiftMode?: 'single' | 'multi';
  /** 'open' = a date-range standing-crew shift with no fixed times; placed
   *  workers get ongoing assignments, hours are entered weekly. Default
   *  'standard' = a normal scheduled shift. */
  shiftType?: 'standard' | 'open';
  endDate?: string;
  weeklySchedule?: Record<
    string,
    { enabled: boolean; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
  >;
  dateSchedule?: Record<
    string,
    { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
  >;
  defaultStartTime: string;
  defaultEndTime: string;
  shiftDescription?: string;
  emailIntro?: string;
  clockInUrl?: string;
  sendNotification: boolean;
  files?: Array<{ title: string; description: string; url: string; fileName: string }>;
  createdAt?: any;
  createdBy?: string;
  updatedAt?: any;
}

interface Position {
  jobTitle: string;
  payRate: string;
  workersNeeded?: number;
  /** Pricing fields hydrated from JO `positions[]` / `gigPositions[]` / legacy top-level
   *  fields. Shown read-only beneath the picker so the recruiter can see what rates the
   *  shift will inherit before saving. */
  billRate?: string;
  markupPercent?: string;
  workersCompCode?: string;
  workersCompRate?: string;
  sutaRate?: string;
  futaRate?: string;
}

/* -------------------------------------------------------------------------
 * Constants + helpers
 * ------------------------------------------------------------------------- */

const DOWS: Array<{ dow: number; label: string; short: string }> = [
  { dow: 1, label: 'Monday', short: 'Mon' },
  { dow: 2, label: 'Tuesday', short: 'Tue' },
  { dow: 3, label: 'Wednesday', short: 'Wed' },
  { dow: 4, label: 'Thursday', short: 'Thu' },
  { dow: 5, label: 'Friday', short: 'Fri' },
  { dow: 6, label: 'Saturday', short: 'Sat' },
  { dow: 0, label: 'Sunday', short: 'Sun' },
];

function buildDefaultWeeklySchedule(
  start: string,
  end: string,
): Record<string, { enabled: boolean; startTime: string; endTime: string }> {
  const schedule: Record<string, { enabled: boolean; startTime: string; endTime: string }> = {};
  for (const { dow } of DOWS) {
    schedule[String(dow)] = { enabled: true, startTime: start, endTime: end };
  }
  return schedule;
}

const formatTime = (time: string): string => {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

/* -------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------- */

export interface EditShiftFormProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: any;
  /** Provide a Shift to edit, or null/undefined to create a new one. */
  shift?: ShiftFormShift | null;
  /** Called after a successful save with a status message. Parent
   *  decides what to do next (close a dialog, refetch a list, etc.). */
  onSaved: (message: string) => void;
  /** Called when the user clicks Cancel or otherwise dismisses. */
  onCancel: () => void;
  /** Override the submit button label. Defaults to "Update Shift" when
   *  editing and "Add Shift" when creating. */
  submitLabel?: string;
  /** Hide the action buttons (Cancel / Save). Useful when the parent
   *  renders its own footer (e.g. inside `<DialogActions>`). When true
   *  the parent must call the imperative `submit()` ref API or pass
   *  its own buttons that read the form state from elsewhere — for
   *  now we don't expose a ref API, so leave this false unless you
   *  add one. */
  hideActions?: boolean;
  /** Called after an in-form action mutates the JO doc directly (e.g.
   *  the "Apply state default" SUTA/FUTA buttons). Parent should re-fetch
   *  the JO so derived position rows pick up the new value. */
  onJobOrderUpdated?: () => void | Promise<void>;
}

const EditShiftForm: React.FC<EditShiftFormProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  shift,
  onSaved,
  onCancel,
  submitLabel,
  hideActions = false,
  onJobOrderUpdated,
}) => {
  const { user } = useAuth();
  const isGigJob = jobOrder?.jobType === 'gig';
  const editingShift = shift ?? null;

  /* --- Account label (read-only) -----------------------------------
   * Mirror the JO Detail page's Account dropdown exactly, which reads
   * from `tenants/{tid}/recruiter_accounts/{id}` and composes
   * `{name} — {parentName}` (see `JobOrderForm.tsx` line 572). The
   * persisted `accountName`/`parentAccountName` on the JO doc are
   * sourced from `crm_companies` and don't always match the recruiter-
   * account display name (e.g. CRM company name "Savannah …" vs.
   * recruiter-account name "CORT Savannah …"). So we prefer the
   * recruiter-accounts lookup when `recruiterAccountId` is present
   * and fall back to the JO denorms / `companyName` otherwise.
   * ----------------------------------------------------------------- */
  const [resolvedAccountLabel, setResolvedAccountLabel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const jo = jobOrder as
      | {
          recruiterAccountId?: string | null;
          accountName?: string;
          parentAccountName?: string | null;
          companyName?: string;
          companyId?: string | null;
        }
      | null
      | undefined;

    const fallback = (() => {
      const sub = jo?.accountName?.trim() || '';
      const parent = jo?.parentAccountName?.trim() || '';
      if (sub) return parent ? `${sub} — ${parent}` : sub;
      return jo?.companyName?.trim() || '';
    })();

    const accountId = jo?.recruiterAccountId?.trim();
    const companyId = jo?.companyId?.trim();
    if (!tenantId || (!accountId && !companyId)) {
      setResolvedAccountLabel(fallback);
      return;
    }

    setResolvedAccountLabel(fallback);

    // Resolve a recruiter_accounts doc by id (with parent name) into the
    // canonical "{name} — {parentName}" label used on the JO Detail page.
    // Note: the recruiter-accounts collection lives at `tenants/{tid}/accounts`
    // (see `src/data/firestorePaths.ts` — `p.recruiterAccount`/`p.recruiterAccounts`).
    // An earlier version of this lookup pointed at `recruiter_accounts`, which
    // doesn't exist, so step 1 silently failed and the field fell back to the
    // denormalized parent name on the JO doc (e.g. just "CORT" instead of
    // "Pennsylvania Convention Center — CORT").
    const composeLabel = async (
      accData: { name?: string; parentAccountId?: string | null },
    ): Promise<string> => {
      const name = String(accData.name ?? '').trim();
      const parentId =
        typeof accData.parentAccountId === 'string' ? accData.parentAccountId.trim() : '';
      let parentName = '';
      if (parentId) {
        const parentSnap = await getDoc(doc(db, p.recruiterAccount(tenantId, parentId)));
        if (parentSnap.exists()) {
          parentName = String(
            (parentSnap.data() as { name?: string }).name ?? '',
          ).trim();
        }
      }
      return name ? (parentName ? `${name} — ${parentName}` : name) : '';
    };

    (async () => {
      try {
        // 1) Direct lookup by `recruiterAccountId` when present.
        if (accountId) {
          const accSnap = await getDoc(doc(db, p.recruiterAccount(tenantId, accountId)));
          if (cancelled) return;
          if (accSnap.exists()) {
            const label = await composeLabel(
              accSnap.data() as { name?: string; parentAccountId?: string | null },
            );
            if (cancelled) return;
            if (label) {
              setResolvedAccountLabel(label);
              return;
            }
          }
        }
        // 2) Fallback: find the recruiter_account associated with this JO's
        //    company. Mirrors `RecruiterJobOrderDetail.tsx`'s `linkedAccount`
        //    resolver so we surface the child account (e.g. "CORT Savannah …")
        //    instead of just the denormalized parent company name ("CORT").
        if (companyId) {
          const accountsRef = collection(db, p.recruiterAccounts(tenantId));
          const snap = await getDocs(
            query(
              accountsRef,
              where('associations.companyIds', 'array-contains', companyId),
              fsLimit(1),
            ),
          );
          if (cancelled) return;
          const first = snap.docs[0];
          if (first) {
            const label = await composeLabel(
              first.data() as { name?: string; parentAccountId?: string | null },
            );
            if (cancelled) return;
            if (label) setResolvedAccountLabel(label);
          }
        }
      } catch (err) {
        console.warn('[EditShiftForm] account label lookup failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrder]);

  /* --- Available positions (derived from JO) ------------------------ */
  /**
   * Hiring entity for this JO (drives the SUTA/FUTA display gate). Same
   * entity check the JO form uses — `useEntity` resolves the entity name
   * so we can apply the C1 Workforce / C1 Select policy without
   * hardcoding entity ids.
   */
  const { entity: jobOrderEntity } = useEntity(
    tenantId ?? null,
    typeof jobOrder?.hiringEntityId === 'string' ? jobOrder.hiringEntityId : null,
  );
  const showSutaFutaForJo = useMemo(
    () => /C1 Workforce|C1 Select/i.test(jobOrderEntity?.name || ''),
    [jobOrderEntity?.name],
  );

  /**
   * Cross-doc fallback: when the JO doesn't carry a worksite state field
   * (legacy / manually-created career JOs that never ran through the
   * auto-spawn helper, e.g. JO #133 under autoLoc Hyatt), but it does
   * carry a `worksiteId / locationId`, read the linked CRM-company
   * location doc and lift `address.state` (or top-level `state`). Stays
   * empty when the JO doc itself already supplies a state code.
   *
   * Self-healing for shift pricing — without this, `worksiteStateForJo`
   * resolves to `''` and `Apply state-default SUTA/FUTA` is gated off
   * with the yellow "Add a worksite state…" notice, even though the
   * location row clearly has the state set.
   */
  const [locationDocStateFallback, setLocationDocStateFallback] = useState<string>('');
  useEffect(() => {
    if (!jobOrder) {
      if (locationDocStateFallback) setLocationDocStateFallback('');
      return;
    }
    const jo = jobOrder as Record<string, unknown>;
    const addr = (jo.worksiteAddress as Record<string, unknown> | undefined) ?? undefined;
    const directState =
      (typeof addr?.state === 'string' && addr.state.trim()) ||
      (typeof addr?.stateCode === 'string' && addr.stateCode.trim()) ||
      (typeof jo.worksiteState === 'string' && (jo.worksiteState as string).trim()) ||
      '';
    // The JO already carries a state on the doc — let the memo below pick
    // it up and clear any prior fallback we cached.
    if (directState) {
      if (locationDocStateFallback) setLocationDocStateFallback('');
      return;
    }
    const companyId = typeof jo.companyId === 'string' ? jo.companyId.trim() : '';
    const locationId =
      (typeof jo.worksiteId === 'string' && jo.worksiteId.trim()) ||
      (typeof jo.locationId === 'string' && (jo.locationId as string).trim()) ||
      '';
    if (!companyId || !locationId) return;
    let cancelled = false;
    (async () => {
      try {
        let snap = await getDoc(
          doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId),
        );
        if (!snap.exists()) {
          snap = await getDoc(doc(db, 'crm_companies', companyId, 'locations', locationId));
        }
        if (cancelled || !snap.exists()) return;
        const data = (snap.data() as Record<string, unknown> | undefined) ?? {};
        const innerAddr = (data.address as Record<string, unknown> | undefined) ?? undefined;
        const raw =
          (typeof innerAddr?.state === 'string' && innerAddr.state) ||
          (typeof innerAddr?.stateCode === 'string' && innerAddr.stateCode) ||
          (typeof data.state === 'string' && (data.state as string)) ||
          '';
        const code = normalizeStateCode(raw).trim().toUpperCase();
        if (!cancelled) setLocationDocStateFallback(code);
      } catch {
        if (!cancelled) setLocationDocStateFallback('');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally NOT depending on `locationDocStateFallback` — that's the
    // value we're computing; including it would trigger a redundant lookup
    // every time the location doc resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    jobOrder,
    tenantId,
  ]);

  /**
   * Worksite 2-letter state code derived from the JO doc. Tolerates the
   * canonical `worksiteAddress.state` shape (set by `JobOrderForm` and
   * the auto-spawn helper) plus a couple of legacy/fallback paths used
   * by older job orders, plus account/company snapshot fallbacks for
   * JOs that didn't denormalize a worksite address. Empty when no
   * field on the JO doc carries a state code.
   *
   * Final fallback (2026-05-05): the linked CRM-company location's state
   * code, resolved by the effect above. Covers manually-created career JOs
   * that point at a `worksiteId` but never got the address denormalized.
   */
  const worksiteStateForJo = useMemo<string>(() => {
    if (!jobOrder) return '';
    const jo = jobOrder as Record<string, unknown>;
    const addr = (key: string): Record<string, unknown> | undefined =>
      (jo[key] as Record<string, unknown> | undefined) ?? undefined;
    const candidates: Array<unknown> = [
      addr('worksiteAddress')?.state,
      addr('worksiteAddress')?.stateCode,
      jo.worksiteState,
      jo.locationState,
      addr('address')?.state,
      addr('address')?.stateCode,
      addr('companyAddress')?.state,
      addr('accountAddress')?.state,
      addr('locationAddress')?.state,
      jo.companyState,
      jo.accountState,
      jo.state,
      locationDocStateFallback,
    ];
    for (const c of candidates) {
      const code = normalizeStateCode(typeof c === 'string' ? c : '')
        .trim()
        .toUpperCase();
      if (code) return code;
    }
    return '';
  }, [jobOrder, locationDocStateFallback]);

  const availablePositions = useMemo<Position[]>(() => {
    if (!jobOrder) return [];

    // Coerce a stored value (number | string | null) into a stable string the form can
    // hand to read-only TextFields. Null/undefined/empty stay empty so the disabled
    // input renders as blank rather than "0" or "null".
    const toStr = (value: unknown): string => {
      if (value == null) return '';
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
      const trimmed = String(value).trim();
      return trimmed;
    };

    /**
     * Default-policy SUTA/FUTA display fallback (Greg, 2026-04-30).
     *
     * The shift form is read-only for these cells — the canonical write
     * path is the JO form. But for JOs that pre-date the JO-form
     * auto-fill (or where the cascade skipped them), the position rows
     * surface here as blanks. Since the worksite + entity are known at
     * the JO level, we can compute the state-derived rate and show it
     * when:
     *
     *   - Hiring entity uses unemployment tax (C1 Workforce / C1 Select)
     *   - Position has both pay > 0 AND bill > 0 (a "real" pricing row)
     *   - Worksite state is resolvable
     *   - The position itself has no stored SUTA/FUTA value
     *
     * Display-only: we don't write the derived value back to the JO.
     * The recruiter sees the actual rate the shift would price at, the
     * helper text below the field flags it as estimated.
     */
    const deriveDisplayRates = (
      pos: any,
    ): { sutaRate: string; futaRate: string } => {
      const stored = {
        sutaRate: toStr(pos.sutaRate ?? pos.suta),
        futaRate: toStr(pos.futaRate ?? pos.futa),
      };
      if (!showSutaFutaForJo || !worksiteStateForJo) return stored;

      const pay = parseFloat(toStr(pos.payRate));
      const bill = parseFloat(toStr(pos.billRate));
      if (!Number.isFinite(pay) || pay <= 0) return stored;
      if (!Number.isFinite(bill) || bill <= 0) return stored;

      const sutaForState = getSutaRateByState(worksiteStateForJo);
      const futaForState = getFutaRateByState(worksiteStateForJo);
      return {
        sutaRate:
          stored.sutaRate ||
          (sutaForState != null ? String(sutaForState) : ''),
        futaRate: stored.futaRate || String(futaForState),
      };
    };

    const mapPos = (pos: any): Position => {
      const { sutaRate, futaRate } = deriveDisplayRates(pos);

      // Field-name reconciliation across writers (Greg, 2026-04-30 bugfix).
      //
      // The JO form's gig-position UI (`JobOrderForm.tsx`) actually
      // persists these names:
      //   - `pos.markup`               (NOT `markupPercent`)
      //   - `pos.workersCompClassCode` (NOT `workersCompCode`)
      // Older account/cascade docs use the canonical
      // `markupPercent` / `workersCompCode`, and a few legacy rows wrote
      // `markupPercentage`. Read all of them, JO-form write key first.
      //
      // Bill rate is also fragile: when a recruiter sets markup>0 the JO
      // form's bill-rate input goes read-only and shows a *computed*
      // value (`pay × (1 + markup/100)`) without persisting it — so the
      // stored doc has `billRate: ''` despite the JO UI displaying
      // 24.84. We mirror that compute here so the shift form shows the
      // same number the JO form does.
      const payNum = parseFloat(toStr(pos.payRate));
      const rawMarkup = toStr(pos.markup ?? pos.markupPercent ?? pos.markupPercentage);
      const markupNum = parseFloat(rawMarkup);
      const rawBill = toStr(pos.billRate);
      const billNum = parseFloat(rawBill);

      let resolvedBill = rawBill;
      if (
        (!Number.isFinite(billNum) || billNum <= 0) &&
        Number.isFinite(payNum) && payNum > 0 &&
        Number.isFinite(markupNum) && markupNum > 0
      ) {
        resolvedBill = String(Number((payNum * (1 + markupNum / 100)).toFixed(2)));
      }

      let resolvedMarkup = rawMarkup;
      if (
        !resolvedMarkup &&
        Number.isFinite(payNum) && payNum > 0 &&
        Number.isFinite(billNum) && billNum > 0 &&
        billNum > payNum
      ) {
        resolvedMarkup = String(Number(((billNum / payNum - 1) * 100).toFixed(2)));
      }

      return {
        jobTitle: pos.jobTitle || '',
        payRate: toStr(pos.payRate),
        workersNeeded: pos.workersNeeded,
        billRate: resolvedBill,
        markupPercent: resolvedMarkup,
        workersCompCode: toStr(pos.workersCompClassCode ?? pos.workersCompCode),
        workersCompRate: toStr(pos.workersCompRate),
        sutaRate,
        futaRate,
      };
    };

    // Preferred: JO `positions[]` (canonical, used for both gig and career going forward).
    if (Array.isArray(jobOrder.positions) && jobOrder.positions.length > 0) {
      return jobOrder.positions
        .filter((pos: any) => pos && String(pos.jobTitle || '').trim())
        .map(mapPos);
    }

    // Legacy gig JOs persisted positions on `gigPositions[]`.
    if (jobOrder.jobType === 'gig' && Array.isArray(jobOrder.gigPositions)) {
      return jobOrder.gigPositions
        .filter((pos: any) => pos && String(pos.jobTitle || '').trim())
        .map(mapPos);
    }

    // Legacy career JOs: a single position derived from top-level fields.
    // Pass the raw keys through — `mapPos` already reconciles
    // `markup`/`markupPercent` and `workersCompClassCode`/`workersCompCode`.
    if (jobOrder.jobTitle) {
      return [
        mapPos({
          jobTitle: jobOrder.jobTitle,
          payRate: jobOrder.payRate,
          billRate: jobOrder.billRate,
          markup: jobOrder.markup,
          markupPercent: jobOrder.markupPercent ?? jobOrder.markupPercentage,
          workersCompClassCode: jobOrder.workersCompClassCode,
          workersCompCode: jobOrder.workersCompCode,
          workersCompRate: jobOrder.workersCompRate,
          sutaRate: jobOrder.sutaRate ?? jobOrder.suta,
          futaRate: jobOrder.futaRate ?? jobOrder.futa,
          workersNeeded: jobOrder.workersNeeded,
        }),
      ];
    }
    return [];
  }, [jobOrder, showSutaFutaForJo, worksiteStateForJo]);


  /* --- Form state --------------------------------------------------- */
  type FormData = {
    shiftTitle: string;
    status: ShiftStatus;
    defaultJobTitle: string;
    totalStaffRequested: number;
    overstaffCount: number;
    showStaffNeeded: boolean;
    poNumber: string;
    shiftMode: 'single' | 'multi';
    /** 'open' = standing-crew date-range shift with no fixed times. */
    shiftType: 'standard' | 'open';
    shiftDate: string;
    endDate: string;
    weeklySchedule: Record<
      string,
      { enabled: boolean; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
    >;
    dateSchedule: Record<
      string,
      { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
    >;
    defaultStartTime: string;
    defaultEndTime: string;
    shiftDescription: string;
    emailIntro: string;
    clockInUrl: string;
    sendNotification: boolean;
  };

  const buildInitial = (): FormData => {
    if (editingShift) {
      const mode: 'single' | 'multi' = editingShift.shiftMode === 'multi' ? 'multi' : 'single';
      const weeklySchedule =
        mode === 'multi'
          ? editingShift.weeklySchedule ||
            buildDefaultWeeklySchedule(
              editingShift.defaultStartTime || '',
              editingShift.defaultEndTime || '',
            )
          : buildDefaultWeeklySchedule('', '');
      const endDateVal =
        mode === 'multi' ? (isGigJob ? editingShift.endDate || editingShift.shiftDate : '') : '';
      const dateSchedule: FormData['dateSchedule'] = {};
      if (isGigJob && mode === 'multi' && editingShift.shiftDate && endDateVal) {
        if (
          editingShift.dateSchedule &&
          typeof editingShift.dateSchedule === 'object'
        ) {
          const raw = editingShift.dateSchedule;
          Object.keys(raw).forEach((iso) => {
            const e = raw[iso];
            dateSchedule[iso] = {
              startTime: e?.startTime ?? '',
              endTime: e?.endTime ?? '',
              workersNeeded: e?.workersNeeded != null ? Number(e.workersNeeded) : 1,
              overstaff: e?.overstaff != null ? Math.max(0, Number(e.overstaff)) : 0,
            };
          });
        } else {
          const range = getDateRange(editingShift.shiftDate, endDateVal);
          const defStart = editingShift.defaultStartTime || '';
          const defEnd = editingShift.defaultEndTime || '';
          range.forEach((iso) => {
            const d = new Date(iso + 'T12:00:00');
            const dow = d.getDay();
            const ws = editingShift.weeklySchedule?.[String(dow)];
            dateSchedule[iso] = {
              startTime: ws?.enabled ? ws.startTime || defStart : defStart,
              endTime: ws?.enabled ? ws.endTime || defEnd : defEnd,
              workersNeeded: 1,
              overstaff: 0,
            };
          });
        }
      }
      return {
        shiftTitle: editingShift.shiftTitle,
        status: (editingShift.status || 'open') as ShiftStatus,
        defaultJobTitle: editingShift.defaultJobTitle || '',
        totalStaffRequested: editingShift.totalStaffRequested,
        overstaffCount: Math.max(0, Number(editingShift.overstaffCount ?? 0) || 0),
        showStaffNeeded: editingShift.showStaffNeeded || false,
        poNumber: editingShift.poNumber || '',
        shiftMode: mode,
        shiftType:
          (editingShift as { shiftType?: 'standard' | 'open' }).shiftType === 'open'
            ? 'open'
            : 'standard',
        shiftDate: editingShift.shiftDate,
        endDate: endDateVal,
        weeklySchedule,
        dateSchedule,
        defaultStartTime: editingShift.defaultStartTime,
        defaultEndTime: editingShift.defaultEndTime,
        shiftDescription: editingShift.shiftDescription || '',
        emailIntro: editingShift.emailIntro || '',
        clockInUrl: editingShift.clockInUrl || '',
        sendNotification: editingShift.sendNotification,
      };
    }
    // Create mode — seed defaultJobTitle from first JO position so the
    // recruiter doesn't have to pick from a single-option list.
    const defaultJobTitle =
      availablePositions.length > 0
        ? availablePositions[0].jobTitle
        : jobOrder?.jobTitle || '';
    return {
      shiftTitle: '',
      status: 'open',
      defaultJobTitle,
      totalStaffRequested: 1,
      overstaffCount: 0,
      showStaffNeeded: jobOrder?.showWorkersNeeded === true,
      poNumber: '',
      shiftMode: 'single',
      shiftType: 'standard',
      shiftDate: '',
      endDate: '',
      weeklySchedule: buildDefaultWeeklySchedule('', ''),
      dateSchedule: {},
      defaultStartTime: '',
      defaultEndTime: '',
      shiftDescription: '',
      emailIntro: '',
      clockInUrl: '',
      sendNotification: true,
    };
  };

  const [formData, setFormData] = useState<FormData>(buildInitial);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* --- Pricing edits ----------------------------------------------------
   * Recruiter-editable mirror of the selected position's pricing fields.
   * Re-seeded whenever the position dropdown changes; on save the diff vs
   * the JO row gets propagated up via `persistShiftPricingToJobOrder` so
   * future shifts on this JO inherit the updated rates.
   *
   * State (vs JO worksite) is intentionally NOT in here — Greg confirmed
   * that the location/state of a shift is fixed at the JO level and is
   * not editable on individual shifts. That keeps SUTA/FUTA from getting
   * silently re-derived if someone "moves" a shift to a different state.
   * ------------------------------------------------------------------- */
  type ShiftPricingDraft = {
    payRate: string;
    markupPercent: string;
    billRate: string;
    workersCompCode: string;
    workersCompRate: string;
    sutaRate: string;
    futaRate: string;
  };
  const EMPTY_PRICING_DRAFT: ShiftPricingDraft = {
    payRate: '',
    markupPercent: '',
    billRate: '',
    workersCompCode: '',
    workersCompRate: '',
    sutaRate: '',
    futaRate: '',
  };
  const [pricingEdit, setPricingEdit] = useState<ShiftPricingDraft>(EMPTY_PRICING_DRAFT);
  /** Snapshot of `pricingEdit` immediately after the position dropdown change so
   *  we can detect "did the recruiter actually edit anything" at save time and
   *  skip the JO write when they didn't. */
  const [pricingBaseline, setPricingBaseline] = useState<ShiftPricingDraft>(EMPTY_PRICING_DRAFT);
  // Transient "copied" feedback for the Clock-In URL field. When set,
  // the end-adornment swaps the copy icon for a checkmark + tooltip
  // for ~1.5s. Reverts on its own; no snackbar.
  const [clockInUrlCopied, setClockInUrlCopied] = useState(false);

  // Worker-notify follow-up state (only used when editing a shift whose
  // schedule or instructions changed and at least one worker is on it).
  const [workerNotifyDialogOpen, setWorkerNotifyDialogOpen] = useState(false);
  const [workerNotifySaving, setWorkerNotifySaving] = useState(false);
  const [pendingWorkerSave, setPendingWorkerSave] = useState<{
    shiftData: any;
    plainNext: Record<string, unknown>;
    diff: ReturnType<typeof computeShiftNotifyDiff>;
    shiftId: string;
  } | null>(null);

  // Reset whenever the parent swaps in a different shift to edit.
  useEffect(() => {
    setFormData(buildInitial());
    setError('');
    setWorkerNotifyDialogOpen(false);
    setPendingWorkerSave(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingShift?.id, jobOrderId]);

  /** Position that matches the currently selected job title. Drives the read-only
   *  pricing card under the picker so recruiters can preview rates the shift inherits. */
  const selectedPosition = useMemo<Position | null>(() => {
    const title = String(formData?.defaultJobTitle ?? '').trim();
    if (!title) return null;
    return (
      availablePositions.find(
        (pos) => pos.jobTitle.trim().toLowerCase() === title.toLowerCase(),
      ) ?? null
    );
  }, [availablePositions, formData?.defaultJobTitle]);

  /** Truthy if the selected position carries any pricing data worth surfacing. */
  const hasPositionPricing = useMemo(() => {
    if (!selectedPosition) return false;
    return Boolean(
      selectedPosition.payRate ||
        selectedPosition.billRate ||
        selectedPosition.markupPercent ||
        selectedPosition.workersCompCode ||
        selectedPosition.workersCompRate ||
        selectedPosition.sutaRate ||
        selectedPosition.futaRate,
    );
  }, [selectedPosition]);

  /* --- Re-seed the editable pricing draft whenever the position changes ----
   * Keyed on every pricing field of `selectedPosition` so that a JO-level
   * cascade (e.g. "Apply state default" buttons writing SUTA/FUTA back to
   * the JO and refetching) reflows into the form without the recruiter
   * losing their unsaved edits — only fields whose JO value actually
   * changed get re-pulled. The current draft wins for any field the
   * recruiter has typed into. */
  useEffect(() => {
    const next: ShiftPricingDraft = selectedPosition
      ? {
          payRate: selectedPosition.payRate || '',
          markupPercent: selectedPosition.markupPercent || '',
          billRate: selectedPosition.billRate || '',
          workersCompCode: selectedPosition.workersCompCode || '',
          workersCompRate: selectedPosition.workersCompRate || '',
          sutaRate: selectedPosition.sutaRate || '',
          futaRate: selectedPosition.futaRate || '',
        }
      : EMPTY_PRICING_DRAFT;
    setPricingEdit(next);
    setPricingBaseline(next);
    // EMPTY_PRICING_DRAFT is a stable literal in render scope; lint tolerates
    // it via the deps below. We intentionally re-seed only on position swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPosition?.jobTitle,
    selectedPosition?.payRate,
    selectedPosition?.markupPercent,
    selectedPosition?.billRate,
    selectedPosition?.workersCompCode,
    selectedPosition?.workersCompRate,
    selectedPosition?.sutaRate,
    selectedPosition?.futaRate,
  ]);

  /** Update one pricing field with optional pay/markup/bill auto-derivation. */
  const setPricingField = (
    field: keyof ShiftPricingDraft,
    value: string,
  ): void => {
    setPricingEdit((prev) => {
      if (field === 'payRate' || field === 'markupPercent' || field === 'billRate') {
        const triple = recomputePricingTriple({
          changed: field,
          payRate: field === 'payRate' ? value : prev.payRate,
          markupPercent: field === 'markupPercent' ? value : prev.markupPercent,
          billRate: field === 'billRate' ? value : prev.billRate,
        });
        return { ...prev, ...triple };
      }
      return { ...prev, [field]: value };
    });
  };

  /**
   * Whether the displayed SUTA / FUTA values for the currently-selected
   * position were derived from worksite state (vs read directly off the
   * JO position). Drives the helper-text suffix below the read-only
   * SUTA / FUTA fields so a recruiter can tell "saved on the JO" apart
   * from "estimated for shift display".
   *
   * We recompute by re-reading the **raw** JO position by job title —
   * `selectedPosition.sutaRate` already includes the fallback, so we
   * can't infer the source from it alone.
   */
  const sutaFutaSource = useMemo<{
    suta: 'position' | 'estimated' | 'none';
    futa: 'position' | 'estimated' | 'none';
  }>(() => {
    const titleNorm = String(formData?.defaultJobTitle ?? '')
      .trim()
      .toLowerCase();
    if (!jobOrder || !titleNorm || !selectedPosition) {
      return { suta: 'none', futa: 'none' };
    }

    const pickRaw = (
      arr: unknown,
    ): Record<string, unknown> | null => {
      if (!Array.isArray(arr)) return null;
      const hit = (arr as Array<Record<string, unknown>>).find(
        (p) => String(p?.jobTitle ?? '').trim().toLowerCase() === titleNorm,
      );
      return hit ?? null;
    };
    const raw =
      pickRaw(jobOrder.positions) ||
      pickRaw(jobOrder.gigPositions) ||
      (String(jobOrder.jobTitle ?? '').trim().toLowerCase() === titleNorm
        ? (jobOrder as Record<string, unknown>)
        : null);

    const rawSuta = raw ? (raw.sutaRate ?? raw.suta) : null;
    const rawFuta = raw ? (raw.futaRate ?? raw.futa) : null;
    const hasRaw = (v: unknown): boolean =>
      v != null && String(v).trim() !== '';

    return {
      suta: hasRaw(rawSuta)
        ? 'position'
        : selectedPosition.sutaRate
          ? 'estimated'
          : 'none',
      futa: hasRaw(rawFuta)
        ? 'position'
        : selectedPosition.futaRate
          ? 'estimated'
          : 'none',
    };
  }, [jobOrder, formData?.defaultJobTitle, selectedPosition]);

  /* --- Apply state-default SUTA/FUTA -------------------------------
   * Recruiter-initiated cascade: writes the state-derived rate to the
   * JO `positions[]` row (and the matching account pricing row) so
   * every downstream consumer sees the saved value rather than the
   * estimated fallback. Bypasses the C1 hiring-entity gate because
   * the recruiter has explicitly opted in for this JO.
   */
  const [applyStateDefaultPending, setApplyStateDefaultPending] = useState<
    null | 'suta' | 'futa' | 'both'
  >(null);
  const [applyStateDefaultError, setApplyStateDefaultError] = useState<string | null>(null);

  const handleApplyStateDefaults = async (which: 'suta' | 'futa' | 'both') => {
    if (!tenantId || !jobOrderId || !jobOrder) return;
    if (!worksiteStateForJo) return;
    setApplyStateDefaultPending(which);
    setApplyStateDefaultError(null);
    try {
      const result = await persistMissingSutaFutaForJobOrderAndAccount({
        tenantId,
        jobOrderId,
        jobOrder: jobOrder as Record<string, unknown>,
        hiringEntityName: jobOrderEntity?.name ?? null,
        userId: user?.uid ?? null,
        force: true,
      });
      if (result.wroteJobOrder || result.wroteAccount) {
        await onJobOrderUpdated?.();
      }
    } catch (err) {
      setApplyStateDefaultError(
        err instanceof Error ? err.message : 'Failed to save unemployment rates.',
      );
    } finally {
      setApplyStateDefaultPending(null);
    }
  };

  const sutaStateDefault = worksiteStateForJo
    ? getSutaRateByState(worksiteStateForJo)
    : null;
  const futaStateDefault = worksiteStateForJo
    ? getFutaRateByState(worksiteStateForJo)
    : null;
  // Buttons appear whenever the displayed field is empty (no value
  // saved on the JO position or estimated for display) AND we have a
  // state-derived default to apply. The surrounding render block is
  // additionally gated on `showSutaFutaForJo` so non-EoR entities
  // (e.g. C1 Events LLC) never see SUTA/FUTA at all.
  const sutaFieldEmpty = !String(selectedPosition?.sutaRate ?? '').trim();
  const futaFieldEmpty = !String(selectedPosition?.futaRate ?? '').trim();
  const canApplySuta =
    !!worksiteStateForJo && sutaStateDefault != null && sutaFieldEmpty;
  const canApplyFuta =
    !!worksiteStateForJo && futaStateDefault != null && futaFieldEmpty;

  /* --- Save flow ---------------------------------------------------- */

  const handleWorkerNotifyChoice = async (sendNotify: boolean) => {
    const pending = pendingWorkerSave;
    if (!pending || workerNotifySaving) return;
    setWorkerNotifySaving(true);
    setWorkerNotifyDialogOpen(false);
    setPendingWorkerSave(null);
    try {
      await updateDoc(
        doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', pending.shiftId),
        pending.shiftData,
      );
      let notifyFailed = false;
      if (sendNotify) {
        try {
          const jobTitle =
            formData.defaultJobTitle?.trim() ||
            jobOrder?.jobTitle?.trim() ||
            'your role';
          const scheduleSection = pending.diff.scheduleChanged
            ? buildScheduleNotifyText(
                {
                  shiftMode: pending.plainNext.shiftMode as 'single' | 'multi' | undefined,
                  shiftDate: pending.plainNext.shiftDate as string | undefined,
                  endDate: pending.plainNext.endDate as string | undefined,
                  defaultStartTime: pending.plainNext.defaultStartTime as string | undefined,
                  defaultEndTime: pending.plainNext.defaultEndTime as string | undefined,
                  dateSchedule: pending.plainNext.dateSchedule as
                    | Record<string, { startTime: string; endTime: string }>
                    | undefined,
                  weeklySchedule: pending.plainNext.weeklySchedule as
                    | Record<string, { enabled?: boolean; startTime: string; endTime: string }>
                    | undefined,
                },
                formatTime,
              )
            : '';
          const instructionsSection = pending.diff.instructionsChanged
            ? [
                formData.shiftDescription?.trim(),
                formData.emailIntro?.trim(),
                formData.clockInUrl?.trim()
                  ? `Clock-in link: ${formData.clockInUrl.trim()}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n\n')
            : '';
          const notifyFn = httpsCallable(functions, 'notifyShiftWorkersUpdated');
          await notifyFn({
            tenantId,
            jobOrderId,
            shiftId: pending.shiftId,
            jobTitle,
            scheduleSection,
            instructionsSection,
          });
        } catch (notifyErr) {
          console.error('notifyShiftWorkersUpdated failed:', notifyErr);
          notifyFailed = true;
        }
      }
      JobsBoardService.getInstance()
        .syncJobOrderToLinkedPostings(tenantId, jobOrderId)
        .catch(() => {});
      onSaved(
        notifyFailed
          ? 'Shift saved, but worker notifications could not be sent.'
          : 'Shift updated successfully',
      );
    } catch (err) {
      console.error('Error saving shift:', err);
      setError('Failed to save shift');
    } finally {
      setWorkerNotifySaving(false);
    }
  };

  const persistNewShift = async (
    shiftData: any,
    isSchedule: boolean,
    gigJob: boolean,
    isOpen = false,
  ) => {
    const dataForAdd = { ...shiftData };
    if (isOpen) {
      // Open shift: keep endDate (already cleaned to a string or absent),
      // but it never carries per-day/weekly schedule maps.
      delete dataForAdd.weeklySchedule;
      delete dataForAdd.dateSchedule;
    } else if (!isSchedule) {
      delete dataForAdd.endDate;
      delete dataForAdd.weeklySchedule;
      delete dataForAdd.dateSchedule;
    } else if (!gigJob) {
      delete dataForAdd.endDate;
    }
    await addDoc(
      collection(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts'),
      dataForAdd,
    );
  };

  const handleSubmit = async () => {
    try {
      setError('');
      setSubmitting(true);

      if (!formData.shiftTitle.trim()) {
        setError('Shift title is required');
        return;
      }
      // Open shifts have no fixed times — skip the time-required check.
      if (
        formData.shiftType !== 'open' &&
        !isGigJob &&
        (!formData.defaultStartTime || !formData.defaultEndTime)
      ) {
        setError('Start and end times are required');
        return;
      }
      if (!isGigJob && formData.totalStaffRequested < 1) {
        setError('Total staff requested must be at least 1');
        return;
      }

      // An open shift is never a standard "schedule" — it carries no
      // per-day/weekly times, just a date range — so force isSchedule
      // false and let the open branch below stamp its own fields.
      const isSchedule =
        formData.shiftType !== 'open' &&
        formData.shiftMode === 'multi' &&
        (!isGigJob ||
          (!!formData.endDate && formData.endDate !== formData.shiftDate));

      if (!formData.shiftDate) {
        setError(formData.shiftType === 'open' || isSchedule ? 'Start date is required' : 'Shift date is required');
        return;
      }
      if (
        formData.shiftType === 'open' &&
        formData.endDate &&
        formData.endDate < formData.shiftDate
      ) {
        setError('End date must be on or after start date');
        return;
      }
      if (isGigJob && isSchedule && !formData.endDate) {
        setError('End date is required');
        return;
      }
      if (isGigJob && isSchedule && formData.endDate < formData.shiftDate) {
        setError('End date must be on or after start date');
        return;
      }

      if (isSchedule) {
        if (isGigJob) {
          const range = getDateRange(formData.shiftDate, formData.endDate);
          const dateSchedule = formData.dateSchedule || {};
          // Resolve the same effective row the save (line ~1354) and
          // the per-day editor UI (line ~2241) use: a date is "set"
          // when its dateSchedule entry has start+end OR when the
          // form's default times will fill in for it. Pre-fix, the
          // UI rendered 08:00 AM / 08:00 PM for every untouched day
          // (sourced from defaultStart/EndTime), but the validator
          // only counted dates the user had typed into — so a user
          // who flipped 1-day -> multi-day, eyeballed the inherited
          // defaults, and hit Update saw "Enter start and end times
          // for at least one date" with all five rows visibly filled.
          // (Greg, 2026-05-12, BTS Stanford "Prep Chef" Gig shift.)
          const effectiveStart = (iso: string): string => {
            const v = dateSchedule[iso]?.startTime?.trim();
            if (v) return v;
            return formData.defaultStartTime?.trim() || '';
          };
          const effectiveEnd = (iso: string): string => {
            const v = dateSchedule[iso]?.endTime?.trim();
            if (v) return v;
            return formData.defaultEndTime?.trim() || '';
          };
          const withHours = range.filter(
            (iso) => !!effectiveStart(iso) && !!effectiveEnd(iso),
          );
          if (withHours.length === 0) {
            setError('Enter start and end times for at least one date in the range');
            return;
          }
          for (const iso of withHours) {
            if (!effectiveStart(iso) || !effectiveEnd(iso)) {
              setError(`Start and end times are required for ${formatDayAndDate(iso)}`);
              return;
            }
          }
        } else {
          const schedule = formData.weeklySchedule || {};
          const enabledDays = Object.values(schedule).filter((d) => d?.enabled);
          if (enabledDays.length === 0) {
            setError('Select at least one day of the week for this multi-day shift');
            return;
          }
          for (const [k, d] of Object.entries(schedule)) {
            if (!d?.enabled) continue;
            if (!d.startTime || !d.endTime) {
              setError(
                `Start and end times are required for ${
                  DOWS.find((x) => String(x.dow) === k)?.label || 'a selected day'
                }`,
              );
              return;
            }
          }
        }
      }

      // Snapshot the chosen position's pricing onto the shift doc
      // (Greg, 2026-04-30 cascade audit). Downstream consumers
      // (`useActiveShifts`, `PlacementsTab`, `placementsApi`) historically
      // had to re-resolve rates by walking JO `positions[]` /
      // `gigPositions[]` and then matching by `defaultJobTitle` — which
      // each consumer did slightly differently and most got wrong for
      // multi-position JOs. By stamping `payRate` / `billRate` /
      // `markupPercent` / `workersComp{Code,Rate}` / `sutaRate` /
      // `futaRate` here at save time, every reader gets the right value
      // straight off the shift doc with the existing
      // `shift.X ?? jobOrder.X` fallback (placementsApi:489-490 etc.).
      //
      // Drift policy: a recruiter editing a shift refreshes the
      // snapshot; a JO position rate change post-shift-create does NOT
      // retroactively update the shift. This matches the §16.1
      // snapshot-at-activation pattern.
      const optNum = (v: string | undefined): number | undefined => {
        if (v == null || String(v).trim() === '') return undefined;
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : undefined;
      };
      const optStr = (v: string | undefined): string | undefined => {
        const s = (v ?? '').toString().trim();
        return s || undefined;
      };
      // Always write every snapshot field (use `deleteField()` in edit
      // mode for missing values). Otherwise switching the shift's
      // position from one with markup -> one without would silently
      // retain the old markup on the shift doc.
      //
      // Sourced from `pricingEdit` (the recruiter-editable mirror) rather
      // than `selectedPosition` so any unsaved edits in the pricing block
      // get baked into the snapshot and onto the parent JO row in the same
      // save action.
      const snapshotKeys = [
        'payRate',
        'billRate',
        'markupPercent',
        'workersCompCode',
        'workersCompRate',
        'sutaRate',
        'futaRate',
      ] as const;
      const positionSnapshot: Record<string, unknown> = {};
      const resolved: Partial<Record<typeof snapshotKeys[number], number | string>> = {};
      if (selectedPosition) {
        const payN = optNum(pricingEdit.payRate);
        const billN = optNum(pricingEdit.billRate);
        const markupN = optNum(pricingEdit.markupPercent);
        const wcCode = optStr(pricingEdit.workersCompCode);
        const wcRateN = optNum(pricingEdit.workersCompRate);
        const sutaN = optNum(pricingEdit.sutaRate);
        const futaN = optNum(pricingEdit.futaRate);
        if (payN !== undefined) resolved.payRate = payN;
        if (billN !== undefined) resolved.billRate = billN;
        if (markupN !== undefined) resolved.markupPercent = markupN;
        if (wcCode !== undefined) resolved.workersCompCode = wcCode;
        if (wcRateN !== undefined) resolved.workersCompRate = wcRateN;
        if (sutaN !== undefined) resolved.sutaRate = sutaN;
        if (futaN !== undefined) resolved.futaRate = futaN;
      }
      for (const k of snapshotKeys) {
        if (resolved[k] !== undefined) {
          positionSnapshot[k] = resolved[k];
        } else if (editingShift) {
          positionSnapshot[k] = deleteField();
        }
      }

      /* --- Cascade pricing edits to the parent job order --------------
       * Edit-then-propagate: any field the recruiter touched (vs the
       * baseline captured when the position was last selected) gets
       * written to the matching row in JO `positions[]` /
       * `gigPositions[]` before we write the shift, so the shift
       * snapshot and the JO stay in sync and the *next* shift on this
       * JO inherits the new rates.
       *
       * Scope per Greg: JO only — the child account's pricing.positions[]
       * is intentionally left alone (national-level changes drive sibling
       * JOs separately).
       *
       * We send `null` for fields the recruiter cleared so the JO row
       * actually loses the value (not just our snapshot).
       * ------------------------------------------------------------- */
      if (selectedPosition && formData.defaultJobTitle) {
        const draftDiffField = (
          k: keyof typeof pricingEdit,
        ): string | null | undefined => {
          if (pricingEdit[k] === pricingBaseline[k]) return undefined;
          const trimmed = pricingEdit[k].trim();
          return trimmed === '' ? null : trimmed;
        };
        const numericPatch = (raw: string | null | undefined): number | null | undefined => {
          if (raw === undefined) return undefined;
          if (raw === null) return null;
          const n = parseFloat(raw);
          return Number.isFinite(n) ? n : undefined;
        };
        const patch: ShiftPricingPatch = {
          payRate: numericPatch(draftDiffField('payRate')),
          markupPercent: numericPatch(draftDiffField('markupPercent')),
          billRate: numericPatch(draftDiffField('billRate')),
          workersCompCode: draftDiffField('workersCompCode') as string | null | undefined,
          workersCompRate: numericPatch(draftDiffField('workersCompRate')),
          sutaRate: numericPatch(draftDiffField('sutaRate')),
          futaRate: numericPatch(draftDiffField('futaRate')),
        };
        try {
          const result = await persistShiftPricingToJobOrder({
            tenantId,
            jobOrderId,
            jobOrder: jobOrder as Record<string, unknown>,
            defaultJobTitle: formData.defaultJobTitle,
            pricing: patch,
            userId: user?.uid,
          });
          if (result.wrote) {
            // Resync the baseline so a follow-up edit in the same form
            // session diff's against what's actually on the JO now, and
            // ask the parent to refetch so other tabs see it.
            setPricingBaseline(pricingEdit);
            await onJobOrderUpdated?.();
          }
        } catch (err) {
          console.error('Failed to cascade shift pricing to job order:', err);
          setError('Failed to save pricing changes to the job order. Try again.');
          setSubmitting(false);
          return;
        }
      }

      const baseShiftData: any = {
        shiftTitle: formData.shiftTitle,
        status: formData.status,
        defaultJobTitle: formData.defaultJobTitle,
        totalStaffRequested: formData.totalStaffRequested,
        overstaffCount: Math.max(0, Number(formData.overstaffCount || 0)),
        showStaffNeeded: formData.showStaffNeeded,
        poNumber: formData.poNumber,
        shiftDate: formData.shiftDate,
        defaultStartTime: formData.defaultStartTime,
        defaultEndTime: formData.defaultEndTime,
        shiftDescription: formData.shiftDescription,
        emailIntro: formData.emailIntro,
        clockInUrl: formData.clockInUrl?.trim() || '',
        sendNotification: formData.sendNotification,
        tenantId,
        jobOrderId,
        ...positionSnapshot,
        updatedAt: serverTimestamp(),
        ...(editingShift
          ? {}
          : { createdAt: serverTimestamp(), createdBy: user?.uid || 'unknown' }),
      };

      const shiftData: any = {
        ...baseShiftData,
        shiftMode: isSchedule ? 'multi' : 'single',
      };

      let mergedGigDateSchedule:
        | Record<
            string,
            { startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
          >
        | undefined;

      if (isSchedule) {
        if (isGigJob) {
          shiftData.endDate = formData.endDate;
          const range = getDateRange(formData.shiftDate, formData.endDate);
          mergedGigDateSchedule = {};
          // **Default cascade on save (2026-06-02).** When the recruiter
          // never typed into a per-day cell, fall back to the form's
          // `totalStaffRequested` / `overstaffCount` defaults — same as
          // the per-row display uses (line ~2265). Previously the save
          // hardcoded `workersNeeded: 1` / `overstaff: 0`, so a recruiter
          // who set "Default Workers = 5" saw 5 on every row in the UI
          // but the shift wrote `workersNeeded: 1` to every untouched
          // day. Reported by Greg on the David L. Lawrence Convention
          // Center JO 2026-06-02.
          const defaultWorkers = Math.max(1, Number(formData.totalStaffRequested ?? 1));
          const defaultOverstaff = Math.max(0, Number(formData.overstaffCount ?? 0));
          range.forEach((iso) => {
            const existing = formData.dateSchedule?.[iso];
            mergedGigDateSchedule![iso] = {
              startTime: existing?.startTime ?? formData.defaultStartTime,
              endTime: existing?.endTime ?? formData.defaultEndTime,
              workersNeeded:
                existing?.workersNeeded != null
                  ? Math.max(1, Number(existing.workersNeeded))
                  : defaultWorkers,
              overstaff:
                existing?.overstaff != null
                  ? Math.max(0, Number(existing.overstaff))
                  : defaultOverstaff,
            };
          });
          shiftData.dateSchedule = mergedGigDateSchedule;
          const gigTotal = range.reduce((sum, iso) => {
            const e = mergedGigDateSchedule![iso];
            return sum + (e?.workersNeeded ?? 1) + (e?.overstaff ?? 0);
          }, 0);
          shiftData.totalStaffRequested = Math.max(1, gigTotal);
          shiftData.overstaffCount = 0;
        } else {
          if (editingShift) shiftData.endDate = deleteField();
        }
        if (!isGigJob) {
          shiftData.weeklySchedule =
            formData.weeklySchedule ||
            buildDefaultWeeklySchedule(formData.defaultStartTime, formData.defaultEndTime);
        } else {
          if (editingShift) shiftData.weeklySchedule = deleteField();
        }
      } else {
        if (editingShift) {
          shiftData.endDate = deleteField();
          shiftData.weeklySchedule = deleteField();
          if (isGigJob) shiftData.dateSchedule = deleteField();
        }
      }

      // Open shift: a standing date-range assignment with no fixed daily
      // times. Stamp the markers, keep endDate (if any) as the close-out
      // boundary, and clear the scheduling fields the standard path uses.
      // Hidden from the public jobs board so workers can't apply to it.
      if (formData.shiftType === 'open') {
        shiftData.shiftType = 'open';
        shiftData.noFixedTimes = true;
        shiftData.hideFromJobsBoard = true;
        shiftData.shiftMode = 'single';
        shiftData.defaultStartTime = '';
        shiftData.defaultEndTime = '';
        if (formData.endDate) {
          shiftData.endDate = formData.endDate;
        } else if (editingShift) {
          shiftData.endDate = deleteField();
        }
        if (editingShift) {
          shiftData.weeklySchedule = deleteField();
          shiftData.dateSchedule = deleteField();
        }
      } else if (editingShift) {
        // Standard shift (possibly converted away from open) — clear markers.
        shiftData.shiftType = deleteField();
        shiftData.noFixedTimes = deleteField();
        shiftData.hideFromJobsBoard = deleteField();
      }

      const plainNext: Record<string, unknown> = {
        shiftDate: formData.shiftDate,
        shiftMode: isSchedule ? 'multi' : 'single',
        defaultStartTime: formData.defaultStartTime,
        defaultEndTime: formData.defaultEndTime,
        shiftDescription: formData.shiftDescription,
        emailIntro: formData.emailIntro,
        clockInUrl: formData.clockInUrl?.trim() || '',
      };
      if (isSchedule) {
        if (isGigJob) {
          plainNext.endDate = formData.endDate;
          plainNext.dateSchedule = mergedGigDateSchedule || {};
          plainNext.weeklySchedule = {};
        } else {
          plainNext.endDate = '';
          plainNext.weeklySchedule =
            formData.weeklySchedule ||
            buildDefaultWeeklySchedule(formData.defaultStartTime, formData.defaultEndTime);
          plainNext.dateSchedule = {};
        }
      } else {
        plainNext.endDate = '';
        plainNext.weeklySchedule = {};
        plainNext.dateSchedule = {};
      }
      if (formData.shiftType === 'open') {
        plainNext.endDate = formData.endDate || '';
        plainNext.weeklySchedule = {};
        plainNext.dateSchedule = {};
      }

      if (!editingShift) {
        await persistNewShift(shiftData, isSchedule, isGigJob, formData.shiftType === 'open');
        JobsBoardService.getInstance()
          .syncJobOrderToLinkedPostings(tenantId, jobOrderId)
          .catch(() => {});
        onSaved('Shift created successfully');
        return;
      }

      const diff = computeShiftNotifyDiff(editingShift as any, plainNext);
      if (shouldPromptShiftWorkerNotify(diff)) {
        // Pre-check assignments. Toggling single -> multi (or any
        // schedule edit) makes `scheduleChanged === true`, which used
        // to ALWAYS open the "Notify assigned workers?" dialog — even
        // for an `open` shift with zero placements. The dialog had
        // a backdrop-dismiss handler that cleared `pendingWorkerSave`,
        // so a stray click outside the dialog silently aborted the
        // save and the user's edits were lost. We now skip the prompt
        // entirely when no assignments exist for this shift; the
        // backdrop-dismiss handler is also hardened separately so the
        // remaining "real" prompts can't lose data.
        // (Bug surfaced 2026-05-12 toggling 1d -> 5d on BTS Stanford.)
        let hasAssignedWorkers = false;
        try {
          const assignmentsSnap = await getDocs(
            query(
              collection(db, 'tenants', tenantId, 'assignments'),
              where('jobOrderId', '==', jobOrderId),
              where('shiftId', '==', editingShift.id),
              fsLimit(1),
            ),
          );
          hasAssignedWorkers = !assignmentsSnap.empty;
        } catch (preErr) {
          console.warn(
            'EditShiftForm: assignments pre-check failed, defaulting to prompt',
            preErr,
          );
          // Conservative fallback: if the count query fails, fall back
          // to showing the prompt rather than silently skipping the
          // notify path. Avoids losing the chance to notify real
          // workers when Firestore returned a transient error.
          hasAssignedWorkers = true;
        }

        if (hasAssignedWorkers) {
          setPendingWorkerSave({
            shiftData,
            plainNext,
            diff,
            shiftId: editingShift.id,
          });
          setWorkerNotifyDialogOpen(true);
          return;
        }
        // Fall through and save directly when no one is assigned.
      }

      await updateDoc(
        doc(db, 'tenants', tenantId, 'job_orders', jobOrderId, 'shifts', editingShift.id),
        shiftData,
      );
      JobsBoardService.getInstance()
        .syncJobOrderToLinkedPostings(tenantId, jobOrderId)
        .catch(() => {});
      onSaved('Shift updated successfully');
    } catch (err) {
      console.error('Error saving shift:', err);
      setError('Failed to save shift');
    } finally {
      setSubmitting(false);
    }
  };

  /* --- Render ------------------------------------------------------- */

  const submitDisabled =
    submitting ||
    workerNotifySaving ||
    !formData.shiftTitle ||
    !formData.shiftDate ||
    (formData.shiftType !== 'open' &&
      !isGigJob &&
      (!formData.defaultStartTime || !formData.defaultEndTime)) ||
    (formData.shiftType !== 'open' &&
      isGigJob &&
      formData.shiftMode === 'multi' &&
      (!formData.endDate || formData.endDate < formData.shiftDate));

  const computedSubmitLabel =
    submitLabel ?? (editingShift ? 'Update Shift' : 'Add Shift');

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        {/* Sub Account (read-only). Composed by `resolvedAccountLabel`
            above so the value matches the JO Detail page's Account
            dropdown one-to-one (child account name + parent national
            account, e.g. "Pennsylvania Convention Center — CORT").
            Fallback chain (also handled there): recruiter accounts
            lookup → JO denorms → companyName. */}
        <TextField
          fullWidth
          label="Sub Account"
          value={resolvedAccountLabel}
          InputProps={{ readOnly: true }}
          variant="outlined"
        />


        {/* Shift Title (left) + Status (right) */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Shift Title"
              placeholder="(ex: Night Shift Janitor)"
              value={formData.shiftTitle}
              onChange={(e) => setFormData({ ...formData, shiftTitle: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value as ShiftStatus })
                }
              >
                {SHIFT_STATUS_FILTER_ENTRIES.map(({ value, label }) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Default Job for Shift */}
        <Autocomplete
          fullWidth
          options={availablePositions}
          getOptionLabel={(option) =>
            typeof option === 'string' ? option : option.jobTitle || ''
          }
          value={
            availablePositions.find((p) => p.jobTitle === formData.defaultJobTitle) || null
          }
          onChange={(_event, newValue) => {
            setFormData({
              ...formData,
              defaultJobTitle: newValue ? newValue.jobTitle : '',
            });
          }}
          renderOption={(props, option) => {
            const positionPayLabel = formatHourlyPayRateForDisplay(option.payRate);
            return (
              <Box component="li" {...props} key={option.jobTitle}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <Typography>{option.jobTitle}</Typography>
                  {positionPayLabel && (
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                      {positionPayLabel}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Set Default Job for Shift"
              helperText={
                availablePositions.length > 0
                  ? `Select from ${availablePositions.length} position${
                      availablePositions.length > 1 ? 's' : ''
                    } defined in Overview tab`
                  : 'No positions defined in Overview tab. Please add positions first.'
              }
            />
          )}
          disabled={availablePositions.length === 0}
        />

        {/* Position pricing — editable. Edits propagate to the parent
            job order's positions[] row on save (see
            persistShiftPricingToJobOrder) so the next shift on this JO
            inherits the new rates. Worksite state is intentionally not
            editable here — SUTA/FUTA are stored as numbers and are
            decoupled from the location after they're written. */}
        {selectedPosition && hasPositionPricing && (
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={1}
            >
              <Typography variant="subtitle2">
                Pricing for {selectedPosition.jobTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Edits save back to the job order and apply to future shifts on this position.
              </Typography>
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Pay Rate"
                  type="number"
                  value={pricingEdit.payRate}
                  onChange={(e) => setPricingField('payRate', e.target.value)}
                  InputProps={{ startAdornment: <span>$</span> }}
                  inputProps={{ min: 0, step: '0.01' }}
                  variant="outlined"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Markup (%)"
                  type="number"
                  value={pricingEdit.markupPercent}
                  onChange={(e) => setPricingField('markupPercent', e.target.value)}
                  inputProps={{ min: 0, step: '0.01' }}
                  variant="outlined"
                  helperText="Bill rate auto-recalculates from pay × (1 + markup/100)."
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Bill Rate"
                  type="number"
                  value={pricingEdit.billRate}
                  onChange={(e) => setPricingField('billRate', e.target.value)}
                  InputProps={{ startAdornment: <span>$</span> }}
                  inputProps={{ min: 0, step: '0.01' }}
                  variant="outlined"
                  helperText="Editing bill recalculates markup."
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Workers Comp Class Code"
                  value={pricingEdit.workersCompCode}
                  onChange={(e) => setPricingField('workersCompCode', e.target.value)}
                  variant="outlined"
                  helperText="From Settings > Onboarding Library > WC Class Codes"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Workers Comp Rate"
                  type="number"
                  value={pricingEdit.workersCompRate}
                  onChange={(e) => setPricingField('workersCompRate', e.target.value)}
                  inputProps={{ min: 0, step: '0.01' }}
                  variant="outlined"
                />
              </Grid>

              {/*
                SUTA/FUTA fields + apply-state-default button are
                only meaningful when the JO's hiring entity is one of
                the C1 Employer-of-Record entities (C1 Workforce /
                C1 Select). For other entities (e.g. C1 Events LLC,
                which is the customer/event-organizer model and is
                NOT an EoR), unemployment-on-pay rates don't apply —
                C1 isn't paying the workers there. Gate the entire
                SUTA/FUTA block on `showSutaFutaForJo` so it stays
                hidden for those JOs. May 2026 (was previously
                "always show so recruiter can override" — the override
                affordance was misleading for non-EoR entities).
              */}
              {showSutaFutaForJo && (
                <>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="SUTA %"
                      type="number"
                      value={pricingEdit.sutaRate}
                      onChange={(e) => setPricingField('sutaRate', e.target.value)}
                      inputProps={{ min: 0, step: '0.01' }}
                      variant="outlined"
                      helperText={
                        sutaFutaSource.suta === 'estimated' && worksiteStateForJo
                          ? `Estimated from ${worksiteStateForJo} (new-employer rate; not yet saved on the job order). Worksite state is fixed at the JO level.`
                          : 'State unemployment on pay (C1 Workforce / C1 Select). Worksite state is fixed at the JO level.'
                      }
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="FUTA %"
                      type="number"
                      value={pricingEdit.futaRate}
                      onChange={(e) => setPricingField('futaRate', e.target.value)}
                      inputProps={{ min: 0, step: '0.01' }}
                      variant="outlined"
                      helperText={
                        sutaFutaSource.futa === 'estimated' && worksiteStateForJo
                          ? `Estimated from ${worksiteStateForJo} (state-effective rate; not yet saved on the job order). Worksite state is fixed at the JO level.`
                          : 'Federal unemployment on pay. Worksite state is fixed at the JO level.'
                      }
                    />
                  </Grid>
                  {/* Apply state defaults — recruiter-initiated cascade.
                      Visible whenever a field is empty AND we know the
                      worksite state. Writes to the JO position so every
                      downstream consumer (account pricing, future shifts)
                      inherits the rates. */}
                  {(canApplySuta || canApplyFuta) && (
                    <Grid item xs={12}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        sx={{ rowGap: 1 }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          disabled={applyStateDefaultPending !== null}
                          onClick={() =>
                            handleApplyStateDefaults(
                              canApplySuta && canApplyFuta
                                ? 'both'
                                : canApplySuta
                                  ? 'suta'
                                  : 'futa',
                            )
                          }
                          sx={{ textTransform: 'none' }}
                        >
                          {applyStateDefaultPending != null
                            ? 'Saving…'
                            : canApplySuta && canApplyFuta
                              ? `Apply ${worksiteStateForJo} SUTA (${sutaStateDefault}%) & FUTA (${futaStateDefault}%) to job order`
                              : canApplySuta
                                ? `Apply ${worksiteStateForJo} SUTA default (${sutaStateDefault}%) to job order`
                                : `Apply ${worksiteStateForJo} FUTA default (${futaStateDefault}%) to job order`}
                        </Button>
                        {applyStateDefaultError && (
                          <Typography variant="caption" color="error">
                            {applyStateDefaultError}
                          </Typography>
                        )}
                      </Stack>
                    </Grid>
                  )}
                  {/* Diagnostic hint when fields are empty but we couldn't
                      resolve a worksite state — tells the recruiter what to
                      fix on the JO Overview tab so the auto-apply unlocks. */}
                  {(sutaFieldEmpty || futaFieldEmpty) && !worksiteStateForJo && (
                    <Grid item xs={12}>
                      <Typography variant="caption" color="warning.main">
                        Add a worksite state on the job order's Overview tab to
                        unlock state-default SUTA/FUTA rates.
                      </Typography>
                    </Grid>
                  )}
                </>
              )}
            </Grid>
          </Stack>
        )}

        {/* Career-only: Total/Over/Toggle row */}
        {!isGigJob && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Total Staff Requested"
                type="number"
                value={formData.totalStaffRequested}
                onChange={(e) => {
                  const next = parseInt(e.target.value) || 1;
                  const oldDefault = formData.totalStaffRequested ?? 1;
                  // Cascade to weekly-schedule days that still hold the old
                  // default (per-day overrides are preserved). Days without
                  // an explicit value pick up the new default via fallback
                  // on next render.
                  const prev = formData.weeklySchedule || {};
                  const out: typeof prev = { ...prev };
                  for (const k of Object.keys(out)) {
                    const entry = out[k];
                    if (!entry) continue;
                    if (entry.workersNeeded == null || entry.workersNeeded === oldDefault) {
                      out[k] = { ...entry };
                      delete out[k].workersNeeded;
                    }
                  }
                  setFormData({
                    ...formData,
                    totalStaffRequested: next,
                    weeklySchedule: out,
                  });
                }}
                inputProps={{ min: 1 }}
                required
                helperText="Default for each weekly day; per-day Workers below can override."
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Overstaff (extra)"
                type="number"
                value={formData.overstaffCount}
                onChange={(e) => {
                  const next = parseInt(e.target.value) || 0;
                  const oldDefault = formData.overstaffCount ?? 0;
                  const prev = formData.weeklySchedule || {};
                  const out: typeof prev = { ...prev };
                  for (const k of Object.keys(out)) {
                    const entry = out[k];
                    if (!entry) continue;
                    if (entry.overstaff == null || entry.overstaff === oldDefault) {
                      out[k] = { ...entry };
                      delete out[k].overstaff;
                    }
                  }
                  setFormData({
                    ...formData,
                    overstaffCount: next,
                    weeklySchedule: out,
                  });
                }}
                inputProps={{ min: 0 }}
                helperText={`Filled target: ${Math.max(
                  1,
                  (formData.totalStaffRequested || 1) + (formData.overstaffCount || 0),
                )} assignments`}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.showStaffNeeded}
                    onChange={(e) =>
                      setFormData({ ...formData, showStaffNeeded: e.target.checked })
                    }
                  />
                }
                label="Show Staff Needed on Jobs Board"
              />
            </Grid>
          </Grid>
        )}

        {/* PO Number */}
        <TextField
          fullWidth
          label="PO Number"
          value={formData.poNumber}
          onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
        />

        {/* Shift Type: Standard (scheduled) vs Open (no-fixed-times, standing-crew) */}
        <FormControl fullWidth>
          <FormLabel sx={{ mb: 0.75, fontSize: '0.8rem', fontWeight: 600 }}>
            Shift type
          </FormLabel>
          <ToggleButtonGroup
            exclusive
            color="primary"
            size="small"
            value={formData.shiftType || 'standard'}
            onChange={(_e, next) => {
              if (!next) return;
              setFormData((prev) => ({ ...prev, shiftType: next }));
            }}
          >
            <ToggleButton value="standard" sx={{ textTransform: 'none', px: 2 }}>
              Standard shift
            </ToggleButton>
            <ToggleButton value="open" sx={{ textTransform: 'none', px: 2 }}>
              Open shift (no set times)
            </ToggleButton>
          </ToggleButtonGroup>
        </FormControl>

        {formData.shiftType === 'open' ? (
          /* ---- Open shift: a date range with no fixed daily times ---- */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
              An <strong>Open Shift</strong> is a standing assignment over a date range with
              no fixed daily times. Place your regular crew here — they get an ongoing
              assignment and you enter their hours weekly. It won't appear on the public jobs
              board for workers to apply to.
            </Alert>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Start date"
                  type="date"
                  value={formData.shiftDate}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    let nextEnd = formData.endDate;
                    if (nextEnd && nextStart && nextEnd < nextStart) nextEnd = nextStart;
                    setFormData({ ...formData, shiftDate: nextStart, endDate: nextEnd });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="End date (optional)"
                  type="date"
                  value={formData.endDate || ''}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    const nextStart = formData.shiftDate;
                    setFormData({
                      ...formData,
                      endDate:
                        nextStart && nextEnd && nextEnd < nextStart ? nextStart : nextEnd,
                    });
                  }}
                  InputLabelProps={{ shrink: true }}
                  helperText="Blank = ongoing / rolling crew (close out later)"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Workers needed (crew size)"
                  type="number"
                  inputProps={{ min: 1, max: 999 }}
                  value={formData.totalStaffRequested ?? 1}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      totalStaffRequested: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  InputLabelProps={{ shrink: true }}
                  helperText="Target headcount for this crew"
                />
              </Grid>
            </Grid>
          </Box>
        ) : (
          <>

        {/* Single vs Multi toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={formData.shiftMode === 'multi'}
              onChange={(e) => {
                const nextMode: 'single' | 'multi' = e.target.checked ? 'multi' : 'single';
                const nextStart = formData.shiftDate;
                const nextEnd =
                  nextMode === 'multi'
                    ? isGigJob
                      ? formData.endDate || nextStart
                      : ''
                    : '';
                const nextSchedule =
                  nextMode === 'multi'
                    ? formData.weeklySchedule &&
                      Object.keys(formData.weeklySchedule).length > 0
                      ? formData.weeklySchedule
                      : buildDefaultWeeklySchedule(
                          formData.defaultStartTime,
                          formData.defaultEndTime,
                        )
                    : buildDefaultWeeklySchedule('', '');
                setFormData({
                  ...formData,
                  shiftMode: nextMode,
                  endDate: nextEnd,
                  weeklySchedule: nextSchedule,
                });
              }}
            />
          }
          label={
            isGigJob
              ? 'Multi-day shift (one assignment covering multiple days)'
              : 'Weekly schedule (recurring)'
          }
        />

        {/* Dates */}
        {isGigJob ? (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={formData.shiftMode === 'multi' ? 'Start date' : 'Select day'}
                type="date"
                value={formData.shiftDate}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  let nextEnd = formData.endDate;
                  if (formData.shiftMode === 'multi') {
                    if (!nextEnd) nextEnd = nextStart;
                    if (nextEnd && nextStart && nextEnd < nextStart) nextEnd = nextStart;
                  } else {
                    nextEnd = '';
                  }
                  setFormData({ ...formData, shiftDate: nextStart, endDate: nextEnd });
                }}
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid item xs={12} md={6}>
              {formData.shiftMode === 'multi' ? (
                <TextField
                  fullWidth
                  label="End date"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    const nextStart = formData.shiftDate;
                    setFormData({
                      ...formData,
                      endDate:
                        nextStart && nextEnd && nextEnd < nextStart ? nextStart : nextEnd,
                    });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required
                />
              ) : (
                <Box />
              )}
            </Grid>
          </Grid>
        ) : (
          <TextField
            fullWidth
            label="Start date"
            type="date"
            value={formData.shiftDate}
            onChange={(e) =>
              setFormData({ ...formData, shiftDate: e.target.value, endDate: '' })
            }
            InputLabelProps={{ shrink: true }}
            required
          />
        )}

        {/* Time Fields */}
        {!(isGigJob && formData.shiftMode === 'single' && formData.shiftDate) && (() => {
          const showGigDefaults = isGigJob && formData.shiftMode === 'multi';
          const timeColMd = showGigDefaults ? 4 : 6;
          return (
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={timeColMd}>
                <TextField
                  fullWidth
                  label="Default Start Time"
                  type="time"
                  value={formData.defaultStartTime}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextSchedule =
                      formData.shiftMode === 'multi'
                        ? (() => {
                            const prev = formData.weeklySchedule || {};
                            const out: typeof prev = { ...prev };
                            for (const k of Object.keys(out)) {
                              if (!out[k]) continue;
                              if (!out[k].startTime)
                                out[k] = { ...out[k], startTime: next };
                            }
                            return out;
                          })()
                        : formData.weeklySchedule;
                    setFormData({
                      ...formData,
                      defaultStartTime: next,
                      weeklySchedule: nextSchedule,
                    });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required={!isGigJob}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={timeColMd}>
                <TextField
                  fullWidth
                  label="Default End Time"
                  type="time"
                  value={formData.defaultEndTime}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextSchedule =
                      formData.shiftMode === 'multi'
                        ? (() => {
                            const prev = formData.weeklySchedule || {};
                            const out: typeof prev = { ...prev };
                            for (const k of Object.keys(out)) {
                              if (!out[k]) continue;
                              if (!out[k].endTime) out[k] = { ...out[k], endTime: next };
                            }
                            return out;
                          })()
                        : formData.weeklySchedule;
                    setFormData({
                      ...formData,
                      defaultEndTime: next,
                      weeklySchedule: nextSchedule,
                    });
                  }}
                  InputLabelProps={{ shrink: true }}
                  required={!isGigJob}
                />
              </Grid>
              {showGigDefaults && (
                <>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      label="Default Over"
                      type="number"
                      inputProps={{ min: 0, max: 999 }}
                      value={formData.overstaffCount ?? 0}
                      onChange={(e) => {
                        const next = Math.max(0, parseInt(e.target.value, 10) || 0);
                        const oldDefault = formData.overstaffCount ?? 0;
                        const prev = formData.dateSchedule || {};
                        const out: typeof prev = { ...prev };
                        for (const k of Object.keys(out)) {
                          const entry = out[k];
                          if (!entry) continue;
                          if ((entry.overstaff ?? oldDefault) === oldDefault) {
                            out[k] = { ...entry, overstaff: next };
                          }
                        }
                        setFormData({
                          ...formData,
                          overstaffCount: next,
                          dateSchedule: out,
                        });
                      }}
                      InputLabelProps={{ shrink: true }}
                      helperText="Applies to dates not yet customized"
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <TextField
                      fullWidth
                      label="Default Workers"
                      type="number"
                      inputProps={{ min: 1, max: 999 }}
                      value={formData.totalStaffRequested ?? 1}
                      onChange={(e) => {
                        const next = Math.max(1, parseInt(e.target.value, 10) || 1);
                        const oldDefault = formData.totalStaffRequested ?? 1;
                        const prev = formData.dateSchedule || {};
                        const out: typeof prev = { ...prev };
                        for (const k of Object.keys(out)) {
                          const entry = out[k];
                          if (!entry) continue;
                          if ((entry.workersNeeded ?? oldDefault) === oldDefault) {
                            out[k] = { ...entry, workersNeeded: next };
                          }
                        }
                        setFormData({
                          ...formData,
                          totalStaffRequested: next,
                          dateSchedule: out,
                        });
                      }}
                      InputLabelProps={{ shrink: true }}
                      helperText="Applies to dates not yet customized"
                    />
                  </Grid>
                </>
              )}
            </Grid>
          );
        })()}

        {/* GIG single-day boxed row */}
        {isGigJob && formData.shiftMode === 'single' && formData.shiftDate && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Shift hours for this day
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Set start and end times and workers needed for this date — same fields as when
              multi-day is on; only one day is listed.
            </Typography>
            <Grid container spacing={1} sx={{ alignItems: 'center' }}>
              <Grid item xs={12} md={2}>
                <Typography variant="body2" fontWeight={600}>
                  {formatDayAndDate(formData.shiftDate)}
                </Typography>
              </Grid>
              <Grid item xs={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="Start"
                  type="time"
                  value={formData.defaultStartTime || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultStartTime: e.target.value })
                  }
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="End"
                  type="time"
                  value={formData.defaultEndTime || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultEndTime: e.target.value })
                  }
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Over"
                  type="number"
                  inputProps={{ min: 0, max: 999 }}
                  value={formData.overstaffCount ?? 0}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      overstaffCount: Math.max(0, parseInt(e.target.value, 10) || 0),
                    })
                  }
                />
              </Grid>
              <Grid item xs={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  label="Workers"
                  type="number"
                  inputProps={{ min: 1, max: 999 }}
                  value={formData.totalStaffRequested ?? 1}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      totalStaffRequested: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ClearIcon />}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      defaultStartTime: '',
                      defaultEndTime: '',
                    })
                  }
                  title="Clear times for this day (date will not appear on job posting)"
                  aria-label="Clear times for this day"
                  sx={{ minWidth: 'fit-content' }}
                >
                  Clear
                </Button>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* GIG multi-day per-date schedule */}
        {formData.shiftMode === 'multi' &&
          isGigJob &&
          formData.shiftDate &&
          formData.endDate &&
          formData.endDate >= formData.shiftDate && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Shift hours by date
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Set start and end times and workers needed for each date. Only dates with
                times set will appear on the job posting for workers.
              </Typography>
              <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                {getDateRange(formData.shiftDate, formData.endDate).map((iso) => {
                  const entry =
                    formData.dateSchedule?.[iso] ?? {
                      startTime: formData.defaultStartTime,
                      endTime: formData.defaultEndTime,
                      workersNeeded: formData.totalStaffRequested ?? 1,
                      overstaff: formData.overstaffCount ?? 0,
                    };
                  return (
                    <React.Fragment key={iso}>
                      <Grid item xs={12} md={2}>
                        <Typography variant="body2" fontWeight={600}>
                          {formatDayAndDate(iso)}
                        </Typography>
                      </Grid>
                      <Grid item xs={3} md={2}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Start"
                          type="time"
                          value={entry.startTime || ''}
                          onChange={(e) => {
                            const next = {
                              ...(formData.dateSchedule || {}),
                              [iso]: { ...entry, startTime: e.target.value },
                            };
                            setFormData({ ...formData, dateSchedule: next });
                          }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={3} md={2}>
                        <TextField
                          fullWidth
                          size="small"
                          label="End"
                          type="time"
                          value={entry.endTime || ''}
                          onChange={(e) => {
                            const next = {
                              ...(formData.dateSchedule || {}),
                              [iso]: { ...entry, endTime: e.target.value },
                            };
                            setFormData({ ...formData, dateSchedule: next });
                          }}
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={3} md={1.5}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Over"
                          type="number"
                          inputProps={{ min: 0, max: 999 }}
                          value={entry.overstaff ?? 0}
                          onChange={(e) => {
                            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                            const next = {
                              ...(formData.dateSchedule || {}),
                              [iso]: { ...entry, overstaff: v },
                            };
                            setFormData({ ...formData, dateSchedule: next });
                          }}
                        />
                      </Grid>
                      <Grid item xs={3} md={1.5}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Workers"
                          type="number"
                          inputProps={{ min: 1, max: 999 }}
                          value={entry.workersNeeded ?? 1}
                          onChange={(e) => {
                            const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                            const next = {
                              ...(formData.dateSchedule || {}),
                              [iso]: { ...entry, workersNeeded: v },
                            };
                            setFormData({ ...formData, dateSchedule: next });
                          }}
                        />
                      </Grid>
                      <Grid item xs={12} md={2}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ClearIcon />}
                          onClick={() => {
                            const next = {
                              ...(formData.dateSchedule || {}),
                              [iso]: {
                                startTime: '',
                                endTime: '',
                                workersNeeded: entry.workersNeeded ?? 1,
                                overstaff: 0,
                              },
                            };
                            setFormData({ ...formData, dateSchedule: next });
                          }}
                          title="Clear times for this day (date will not appear on job posting)"
                          aria-label="Clear times for this day"
                          sx={{ minWidth: 'fit-content' }}
                        >
                          Clear
                        </Button>
                      </Grid>
                    </React.Fragment>
                  );
                })}
              </Grid>
            </Box>
          )}

        {/* Career multi-day weekly schedule */}
        {formData.shiftMode === 'multi' && !isGigJob && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Weekly schedule (recurring)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Choose which days are worked and set start/end times per day (e.g., Wed 10–6).
              Workers / Over default to the shift-level totals above; override per day if your
              staffing varies (e.g., 5 dishwashers Mon–Fri, 3 on Sat).
            </Typography>
            <Grid container spacing={1} sx={{ alignItems: 'center' }}>
              {DOWS.map(({ dow, short }) => {
                const key = String(dow);
                const day =
                  formData.weeklySchedule?.[key] || {
                    enabled: false,
                    startTime: formData.defaultStartTime,
                    endTime: formData.defaultEndTime,
                  };
                const dayWorkers = day.workersNeeded ?? formData.totalStaffRequested ?? 1;
                const dayOver = day.overstaff ?? formData.overstaffCount ?? 0;
                return (
                  <React.Fragment key={key}>
                    <Grid item xs={12} md={2}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={!!day.enabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              const nextSchedule = {
                                ...(formData.weeklySchedule || {}),
                                [key]: {
                                  ...day,
                                  enabled,
                                  startTime: day.startTime || formData.defaultStartTime,
                                  endTime: day.endTime || formData.defaultEndTime,
                                },
                              };
                              setFormData({ ...formData, weeklySchedule: nextSchedule });
                            }}
                          />
                        }
                        label={short}
                      />
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Start"
                        type="time"
                        value={day.startTime || ''}
                        onChange={(e) => {
                          const nextSchedule = {
                            ...(formData.weeklySchedule || {}),
                            [key]: { ...day, startTime: e.target.value },
                          };
                          setFormData({ ...formData, weeklySchedule: nextSchedule });
                        }}
                        InputLabelProps={{ shrink: true }}
                        disabled={!day.enabled}
                      />
                    </Grid>
                    <Grid item xs={6} md={3}>
                      <TextField
                        fullWidth
                        size="small"
                        label="End"
                        type="time"
                        value={day.endTime || ''}
                        onChange={(e) => {
                          const nextSchedule = {
                            ...(formData.weeklySchedule || {}),
                            [key]: { ...day, endTime: e.target.value },
                          };
                          setFormData({ ...formData, weeklySchedule: nextSchedule });
                        }}
                        InputLabelProps={{ shrink: true }}
                        disabled={!day.enabled}
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Over"
                        type="number"
                        inputProps={{ min: 0, max: 999 }}
                        value={dayOver}
                        onChange={(e) => {
                          const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                          const nextSchedule = {
                            ...(formData.weeklySchedule || {}),
                            [key]: { ...day, overstaff: v },
                          };
                          setFormData({ ...formData, weeklySchedule: nextSchedule });
                        }}
                        disabled={!day.enabled}
                      />
                    </Grid>
                    <Grid item xs={6} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Workers"
                        type="number"
                        inputProps={{ min: 1, max: 999 }}
                        value={dayWorkers}
                        onChange={(e) => {
                          const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                          const nextSchedule = {
                            ...(formData.weeklySchedule || {}),
                            [key]: { ...day, workersNeeded: v },
                          };
                          setFormData({ ...formData, weeklySchedule: nextSchedule });
                        }}
                        disabled={!day.enabled}
                      />
                    </Grid>
                  </React.Fragment>
                );
              })}
            </Grid>
          </Box>
        )}
          </>
        )}

        <TextField
          fullWidth
          label="Clock-In URL (optional)"
          placeholder="https://…"
          value={formData.clockInUrl}
          onChange={(e) => setFormData({ ...formData, clockInUrl: e.target.value })}
          helperText="Workers see this on their assignment below shift hours. Use a full URL (https://…)."
          InputProps={{
            // Right-aligned copy icon. Disabled when the field is
            // empty/whitespace (nothing to copy) and on browsers
            // without the async clipboard API (rare — only matters
            // for non-https local dev).
            endAdornment: (() => {
              const value = formData.clockInUrl?.trim() ?? '';
              const canCopy =
                value.length > 0 &&
                typeof navigator !== 'undefined' &&
                !!navigator.clipboard;
              return (
                <InputAdornment position="end">
                  <Tooltip
                    title={
                      clockInUrlCopied
                        ? 'Copied'
                        : canCopy
                          ? 'Copy URL'
                          : value.length === 0
                            ? 'Nothing to copy yet'
                            : 'Clipboard unavailable'
                    }
                  >
                    <Box component="span">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label="Copy clock-in URL to clipboard"
                        disabled={!canCopy}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(value);
                            setClockInUrlCopied(true);
                            window.setTimeout(
                              () => setClockInUrlCopied(false),
                              1500,
                            );
                          } catch (err) {
                            // Swallow — the disabled-state guard
                            // covers the "no clipboard API" case;
                            // a permission denial here is rare and
                            // not worth a banner. Surface in console
                            // for debugging.
                            // eslint-disable-next-line no-console
                            console.warn('clock-in URL copy failed', err);
                          }
                        }}
                      >
                        {clockInUrlCopied ? (
                          <CheckIcon
                            fontSize="small"
                            color="success"
                          />
                        ) : (
                          <ContentCopyIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Box>
                  </Tooltip>
                </InputAdornment>
              );
            })(),
          }}
        />

        <TextField
          fullWidth
          label="Shift-Specific Details or Job Description"
          multiline
          rows={4}
          value={formData.shiftDescription}
          onChange={(e) => setFormData({ ...formData, shiftDescription: e.target.value })}
        />
      </Box>

      {!hideActions && (
        <Stack
          direction="row"
          spacing={1}
          justifyContent="flex-end"
          sx={{ pt: 2.5, mt: 1.5 }}
        >
          <Button onClick={onCancel} disabled={submitting || workerNotifySaving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSubmit} disabled={submitDisabled}>
            {computedSubmitLabel}
          </Button>
        </Stack>
      )}

      {/* Worker-notify follow-up dialog. We keep it inside the form so
          it travels with the component — both the original
          `ShiftSetupTab` dialog and the drawer Settings tab pick this
          up automatically.

          Backdrop / Esc are intentionally a no-op now (`reason` filter
          below). Pre-fix, dismissing this dialog cleared
          `pendingWorkerSave` and silently aborted the save — easy to
          trigger by mistake when this dialog stacks on top of the
          parent Edit Shift dialog. Users now have to make an explicit
          choice via the three buttons in the footer (Cancel /
          Don't notify / Notify), so a stray click can't lose their
          edits. The pre-check in `handleSubmit` further suppresses
          this dialog entirely for shifts with zero assignments, which
          was the most common path to "I clicked Update and nothing
          happened". */}
      <Dialog
        open={workerNotifyDialogOpen}
        onClose={(_event, reason) => {
          if (workerNotifySaving) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setWorkerNotifyDialogOpen(false);
          setPendingWorkerSave(null);
        }}
        disableEscapeKeyDown
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Notify assigned workers?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The schedule or instructions for this shift changed. Send an update by SMS,
            email, and push to workers assigned to this shift?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              if (workerNotifySaving) return;
              setWorkerNotifyDialogOpen(false);
              setPendingWorkerSave(null);
            }}
            disabled={workerNotifySaving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleWorkerNotifyChoice(false)}
            disabled={workerNotifySaving}
          >
            Save without notifying
          </Button>
          <Button
            variant="contained"
            onClick={() => handleWorkerNotifyChoice(true)}
            disabled={workerNotifySaving}
          >
            Save and notify workers
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EditShiftForm;

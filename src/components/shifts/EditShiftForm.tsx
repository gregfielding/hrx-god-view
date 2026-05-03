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
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
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
import { getDateRange, formatDayAndDate, dateHasHours } from '../../utils/dateSchedule';
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
  endDate?: string;
  weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
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
   * Worksite 2-letter state code derived from the JO doc. Tolerates the
   * canonical `worksiteAddress.state` shape (set by `JobOrderForm` and
   * the auto-spawn helper) plus a couple of legacy/fallback paths used
   * by older job orders. Empty when the JO has no resolvable state.
   */
  const worksiteStateForJo = useMemo<string>(() => {
    if (!jobOrder) return '';
    const candidates: Array<unknown> = [
      jobOrder.worksiteAddress?.state,
      jobOrder.worksiteState,
      jobOrder.locationState,
      jobOrder.address?.state,
    ];
    for (const c of candidates) {
      const code = normalizeStateCode(typeof c === 'string' ? c : '')
        .trim()
        .toUpperCase();
      if (code) return code;
    }
    return '';
  }, [jobOrder]);

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
    shiftDate: string;
    endDate: string;
    weeklySchedule: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
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
  ) => {
    const dataForAdd = { ...shiftData };
    if (!isSchedule) {
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
      if (!isGigJob && (!formData.defaultStartTime || !formData.defaultEndTime)) {
        setError('Start and end times are required');
        return;
      }
      if (!isGigJob && formData.totalStaffRequested < 1) {
        setError('Total staff requested must be at least 1');
        return;
      }

      const isSchedule =
        formData.shiftMode === 'multi' &&
        (!isGigJob ||
          (!!formData.endDate && formData.endDate !== formData.shiftDate));

      if (!formData.shiftDate) {
        setError(isSchedule ? 'Start date is required' : 'Shift date is required');
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
          const withHours = range.filter((iso) => dateHasHours(dateSchedule[iso]));
          if (withHours.length === 0) {
            setError('Enter start and end times for at least one date in the range');
            return;
          }
          for (const iso of withHours) {
            const d = dateSchedule[iso];
            if (!d?.startTime?.trim() || !d?.endTime?.trim()) {
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
        const payN = optNum(selectedPosition.payRate);
        const billN = optNum(selectedPosition.billRate);
        const markupN = optNum(selectedPosition.markupPercent);
        const wcCode = optStr(selectedPosition.workersCompCode);
        const wcRateN = optNum(selectedPosition.workersCompRate);
        const sutaN = optNum(selectedPosition.sutaRate);
        const futaN = optNum(selectedPosition.futaRate);
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
          range.forEach((iso) => {
            const existing = formData.dateSchedule?.[iso];
            mergedGigDateSchedule![iso] = {
              startTime: existing?.startTime ?? formData.defaultStartTime,
              endTime: existing?.endTime ?? formData.defaultEndTime,
              workersNeeded:
                existing?.workersNeeded != null
                  ? Math.max(1, Number(existing.workersNeeded))
                  : 1,
              overstaff:
                existing?.overstaff != null ? Math.max(0, Number(existing.overstaff)) : 0,
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

      if (!editingShift) {
        await persistNewShift(shiftData, isSchedule, isGigJob);
        JobsBoardService.getInstance()
          .syncJobOrderToLinkedPostings(tenantId, jobOrderId)
          .catch(() => {});
        onSaved('Shift created successfully');
        return;
      }

      const diff = computeShiftNotifyDiff(editingShift as any, plainNext);
      if (shouldPromptShiftWorkerNotify(diff)) {
        setPendingWorkerSave({
          shiftData,
          plainNext,
          diff,
          shiftId: editingShift.id,
        });
        setWorkerNotifyDialogOpen(true);
        return;
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
    (!isGigJob && (!formData.defaultStartTime || !formData.defaultEndTime)) ||
    (isGigJob &&
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

        {/* Position pricing — read-only preview (same column flow as the rest
            of the form; no extra card chrome). */}
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
                Inherited from job order — edit on the Overview tab to change.
              </Typography>
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Pay Rate"
                  value={selectedPosition.payRate || ''}
                  InputProps={{ readOnly: true, startAdornment: <span>$</span> }}
                  variant="outlined"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Markup (%)"
                  value={selectedPosition.markupPercent || ''}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="Bill Rate"
                  value={selectedPosition.billRate || ''}
                  InputProps={{ readOnly: true, startAdornment: <span>$</span> }}
                  variant="outlined"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Workers Comp Class Code"
                  value={selectedPosition.workersCompCode || ''}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                  helperText="From Settings > Onboarding Library > WC Class Codes"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Workers Comp Rate"
                  value={selectedPosition.workersCompRate || ''}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="SUTA %"
                  value={selectedPosition.sutaRate || ''}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                  helperText={
                    sutaFutaSource.suta === 'estimated' && worksiteStateForJo
                      ? `Estimated from ${worksiteStateForJo} (new-employer rate; not yet saved on the job order)`
                      : 'State unemployment on pay (C1 Workforce / C1 Select)'
                  }
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="FUTA %"
                  value={selectedPosition.futaRate || ''}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                  helperText={
                    sutaFutaSource.futa === 'estimated' && worksiteStateForJo
                      ? `Estimated from ${worksiteStateForJo} (state-effective rate; not yet saved on the job order)`
                      : 'Federal unemployment on pay'
                  }
                />
              </Grid>
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
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    totalStaffRequested: parseInt(e.target.value) || 1,
                  })
                }
                inputProps={{ min: 1 }}
                required
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Overstaff (extra)"
                type="number"
                value={formData.overstaffCount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    overstaffCount: parseInt(e.target.value) || 0,
                  })
                }
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
        {!(isGigJob && formData.shiftMode === 'single' && formData.shiftDate) && (
          <Box sx={{ display: 'flex', gap: 2 }}>
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
          </Box>
        )}

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
                      workersNeeded: 1,
                      overstaff: 0,
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
                return (
                  <React.Fragment key={key}>
                    <Grid item xs={12} md={3}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={!!day.enabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              const nextSchedule = {
                                ...(formData.weeklySchedule || {}),
                                [key]: {
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
                    <Grid item xs={6} md={4.5}>
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
                    <Grid item xs={6} md={4.5}>
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
                  </React.Fragment>
                );
              })}
            </Grid>
          </Box>
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
          up automatically. */}
      <Dialog
        open={workerNotifyDialogOpen}
        onClose={() => {
          if (workerNotifySaving) return;
          setWorkerNotifyDialogOpen(false);
          setPendingWorkerSave(null);
        }}
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
            onClick={() => handleWorkerNotifyChoice(false)}
            disabled={workerNotifySaving}
          >
            No, don&apos;t notify
          </Button>
          <Button
            variant="contained"
            onClick={() => handleWorkerNotifyChoice(true)}
            disabled={workerNotifySaving}
          >
            Yes, notify workers
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EditShiftForm;

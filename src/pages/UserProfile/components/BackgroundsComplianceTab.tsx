/**
 * User Details → Backgrounds: compliance operations (E-Verify + AccuSource).
 * Read-only Firestore-backed rows; actions use existing server callables only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { format, parseISO } from 'date-fns';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { logCustomActivity } from '../../../utils/activityLogger';
import { AccusourcePackageSelector } from '../../../components/recruiter/AccusourcePackageSelector';
import { useAccusourceCatalog } from '../../../hooks/useAccusourceCatalog';
import { fetchMergedScreeningPackageForCandidate } from '../../../utils/screeningPackageDefaultsLoader';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import {
  USER_EMPLOYMENT_I9_STATUS_LABELS,
  USER_EMPLOYMENT_I9_STATUS_VALUES,
} from '../../../constants/userEmploymentI9Status';
import { useAuth } from '../../../contexts/AuthContext';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
import {
  buildComplianceSummary,
  canAccusourceAdminFromUserDoc,
  canManageEverifyFromClaims,
  evaluateScreeningSatisfied,
  normalizeEverifyRow,
  normalizeScreeningRow,
  statusToneFromStatusString,
  type ScreeningPackageMergeResult,
} from './backgroundsComplianceModel';

const PAGE_LIMIT = 100;

const everifyCasesCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'everify_cases');
const userEmploymentsCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'user_employments');

/** ICA citizenship_status_code — confirm against your signed ICA (matches DEFAULT_CITIZENSHIP_ICA_CODE on server). */
const EVERIFY_CITIZENSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'U.S. citizen' },
  { value: '2', label: 'U.S. noncitizen national' },
  { value: '3', label: 'Lawful permanent resident' },
  { value: '4', label: 'Alien authorized to work' },
  { value: '5', label: 'Other (verify with ICA)' },
];

const everifyCheckEligibility = httpsCallable(functions, 'everifyCheckEligibility');
const everifyCreateCase = httpsCallable(functions, 'everifyCreateCase');
const everifyRetryCase = httpsCallable(functions, 'everifyRetryCase');
const createAccusourceBackgroundCheck = httpsCallable(functions, 'createAccusourceBackgroundCheck');
const getAccusourcePdf = httpsCallable(functions, 'getAccusourceBackgroundCheckPdf');
const syncAccusourcePackageCatalog = httpsCallable(functions, 'syncAccusourcePackageCatalog');

function formatTime(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) {
    return value.toDate().toLocaleString();
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

/** yyyy-MM-dd from Firestore Timestamp / string / Date */
function toDateInputValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const s = value.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  if (value instanceof Timestamp) {
    try {
      return value.toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return '';
}

/** Read-only label for modal (same pattern as other profile read-only fields — not `type="date"`; native date + readOnly breaks picker/typing). */
function formatEmploymentDateDisplay(value: unknown): string {
  const iso = toDateInputValue(value);
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}

type TenantEntityOption = {
  id: string;
  name: string;
  entityCode?: string;
  workerType: 'W2' | '1099' | 'BOTH';
  everifyRequired?: boolean;
};

/** E-Verify hiring is always under this employer of record (resolved to a tenants/…/entities doc). */
const EVERIFY_HIRING_ENTITY_LABEL = 'C1 Select LLC';

function resolveEverifyHiringEntity(entities: TenantEntityOption[]): TenantEntityOption | null {
  const byCode = entities.find((e) => (e.entityCode || '').trim().toUpperCase() === 'C1SL');
  if (byCode) return byCode;
  return (
    entities.find((e) => {
      const n = e.name.trim().toLowerCase();
      return n === 'c1 select llc' || /^c1\s+select\b/i.test(e.name.trim());
    }) ?? null
  );
}

function mapEntityWorkerTypeToEmployment(workerType: 'W2' | '1099' | 'BOTH' | undefined): 'W2' | '1099' {
  if (workerType === '1099') return '1099';
  return 'W2';
}

export interface BackgroundsComplianceTabProps {
  uid: string;
  tenantId: string | null;
}

const EVERIFY_PERM_HINT =
  'E-Verify actions require tenant role Recruiter, Manager, or Admin, or HRX access (matches server).';
const ACCUSOURCE_PERM_HINT =
  'AccuSource requires security level ≥ 5 or admin/manager role for this tenant (same as System Access tab).';

const BackgroundsComplianceTab: React.FC<BackgroundsComplianceTabProps> = ({ uid, tenantId }) => {
  const { user, isHRX, claimsRoles } = useAuth();
  const [viewerUserDoc, setViewerUserDoc] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [everifyRows, setEverifyRows] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [screeningRows, setScreeningRows] = useState<BackgroundCheckRecord[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [evModalOpen, setEvModalOpen] = useState(false);
  const [bgModalOpen, setBgModalOpen] = useState(false);
  const [userEmploymentIds, setUserEmploymentIds] = useState<
    Array<{ id: string; label: string; entityName: string; raw: Record<string, unknown> }>
  >([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  /** Human-readable hire date from employment.startDate (read-only; do not use type="date" + readOnly) */
  const [hireDateDisplayText, setHireDateDisplayText] = useState('');
  /** Always EVERIFY_HIRING_ENTITY_LABEL; state exists so setHiringEntityDisplay calls stay valid and the field can reset with the modal. */
  const [hiringEntityDisplay, setHiringEntityDisplay] = useState(EVERIFY_HIRING_ENTITY_LABEL);
  const [worksiteDisplay, setWorksiteDisplay] = useState('');
  const [i9Confirmed, setI9Confirmed] = useState(false);
  const [evNotes, setEvNotes] = useState('');
  const [evSubmitting, setEvSubmitting] = useState(false);
  const [evMessage, setEvMessage] = useState<string | null>(null);
  /** Employee identity for USCIS (callable i9Employee); not written to Firestore by this flow. */
  const [evWorkerFirstName, setEvWorkerFirstName] = useState('');
  const [evWorkerLastName, setEvWorkerLastName] = useState('');
  const [evWorkerDob, setEvWorkerDob] = useState('');
  const [evWorkerSsn, setEvWorkerSsn] = useState('');
  const [evCitizenshipCode, setEvCitizenshipCode] = useState('');

  /** Loading tenants/…/entities to resolve C1 Select LLC for E-Verify. */
  const [tenantEntitiesLoading, setTenantEntitiesLoading] = useState(false);
  /** Resolved Firestore entity for EVERIFY_HIRING_ENTITY_LABEL; required to create employment from this modal. */
  const [everifyHiringEntityResolved, setEverifyHiringEntityResolved] = useState<TenantEntityOption | null>(null);
  /** yyyy-MM-dd when creating a user_employment (no existing rows). */
  const [newEmploymentStartIso, setNewEmploymentStartIso] = useState('');
  const [creatingEmployment, setCreatingEmployment] = useState(false);
  const [createEmploymentError, setCreateEmploymentError] = useState<string | null>(null);
  const [i9StatusSaving, setI9StatusSaving] = useState(false);

  const [profileUser, setProfileUser] = useState<Record<string, unknown> | null>(null);
  const [defaultJobOrderId, setDefaultJobOrderId] = useState('');
  const [defaultWorksiteId, setDefaultWorksiteId] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [defaultAccountName, setDefaultAccountName] = useState('');
  const [pkgName, setPkgName] = useState('');
  const [pkgId, setPkgId] = useState('');
  /** Service IDs from synced catalog (order payload uses these exact strings). */
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [bgNotes, setBgNotes] = useState('');
  const [bgSubmitting, setBgSubmitting] = useState(false);
  const [bgMessage, setBgMessage] = useState<string | null>(null);
  /** Refresh can surface warnings (0 packages); submit errors stay error. */
  const [bgMessageSeverity, setBgMessageSeverity] = useState<'error' | 'warning'>('error');

  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [packageDefaultsTrace, setPackageDefaultsTrace] = useState('');
  const { catalog: accusourceCatalog, loading: catalogLoading, refetch: refetchAccusourceCatalog } =
    useAccusourceCatalog();
  const [catalogSyncing, setCatalogSyncing] = useState(false);

  /** Resolved default package for main-body preview (job → location → account). */
  const [resolvedPreview, setResolvedPreview] = useState<{
    merged: ScreeningPackageMergeResult;
    trace: string;
  } | null>(null);
  const [resolvedPreviewLoading, setResolvedPreviewLoading] = useState(false);

  useEffect(() => {
    const vid = user?.uid;
    if (!vid) {
      setViewerUserDoc(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', vid))
      .then((s) => {
        if (cancelled) return;
        setViewerUserDoc(s.exists() ? (s.data() as Record<string, unknown>) : null);
      })
      .catch(() => {
        if (!cancelled) setViewerUserDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const canManageEverify = useMemo(
    () => canManageEverifyFromClaims(isHRX, tenantId, claimsRoles),
    [isHRX, tenantId, claimsRoles]
  );

  const canAccusourceAdmin = useMemo(() => {
    if (viewerUserDoc === undefined) return false;
    return canAccusourceAdminFromUserDoc(viewerUserDoc, tenantId);
  }, [viewerUserDoc, tenantId]);

  const previewPackageNotInCatalog = useMemo(() => {
    const id = resolvedPreview?.merged.packageId?.trim();
    if (!id || !accusourceCatalog?.packages?.length) return false;
    return !accusourceCatalog.packages.some((pkg) => pkg.id === id);
  }, [resolvedPreview, accusourceCatalog]);

  const loadAll = useCallback(async () => {
    if (!tenantId || !uid) {
      setEverifyRows([]);
      setScreeningRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [evSnap, bgSnap] = await Promise.all([
        getDocs(query(everifyCasesCol(tenantId), where('userId', '==', uid))),
        getDocs(query(collection(db, 'backgroundChecks'), where('candidateId', '==', uid), limit(PAGE_LIMIT))),
      ]);
      const evList = evSnap.docs
        .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
        .sort((a, b) => {
          const ta = (a.data.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          const tb = (b.data.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setEverifyRows(evList);
      const bg = bgSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as BackgroundCheckRecord)
        .filter((r) => !r.tenantId || r.tenantId === tenantId)
        .sort((a, b) => {
          const ta = (a.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          const tb = (b.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setScreeningRows(bg);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load compliance data');
      setEverifyRows([]);
      setScreeningRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, uid]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!tenantId || !uid) {
      setResolvedPreview(null);
      return;
    }
    let cancelled = false;
    setResolvedPreviewLoading(true);
    fetchMergedScreeningPackageForCandidate(tenantId, uid)
      .then((r) => {
        if (!cancelled) setResolvedPreview({ merged: r.merged, trace: r.trace });
      })
      .catch(() => {
        if (!cancelled) setResolvedPreview(null);
      })
      .finally(() => {
        if (!cancelled) setResolvedPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid, lastRefresh]);

  const summary = useMemo(
    () => buildComplianceSummary(everifyRows, screeningRows),
    [everifyRows, screeningRows]
  );

  const normalizedRows = useMemo(() => {
    const ev = everifyRows.map(({ id, data }) => normalizeEverifyRow(id, data));
    const bg = screeningRows.map(normalizeScreeningRow);
    return [...ev, ...bg];
  }, [everifyRows, screeningRows]);

  const loadEmploymentOptionsForUser = useCallback(
    async (tid: string, userId: string) => {
      const empQ = query(userEmploymentsCol(tid), where('userId', '==', userId));
      const snap = await getDocs(empQ);
      const opts: Array<{ id: string; label: string; entityName: string; raw: Record<string, unknown> }> = [];
      for (const d of snap.docs) {
        const raw = d.data() as Record<string, unknown>;
        const entityId = (raw.entityId as string) || '';
        let entityName = '';
        if (entityId) {
          const entSnap = await getDoc(doc(db, 'tenants', tid, 'entities', entityId));
          entityName = String((entSnap.data() as { name?: string } | undefined)?.name || entityId);
        }
        const start = raw.startDate ? formatTime(raw.startDate) : '—';
        opts.push({
          id: d.id,
          entityName: entityName || entityId || '—',
          raw,
          label: `${entityName || 'Entity'} · start ${start}`,
        });
      }
      return opts;
    },
    []
  );

  const loadTenantEntitiesForTenant = useCallback(async (tid: string): Promise<TenantEntityOption[]> => {
    const entSnap = await getDocs(collection(db, 'tenants', tid, 'entities'));
    return entSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const wt = String(data.workerType || 'W2');
        const normalized = (['W2', '1099', 'BOTH'].includes(wt) ? wt : 'W2') as 'W2' | '1099' | 'BOTH';
        return {
          id: d.id,
          name: String(data.name || d.id),
          entityCode: String(data.entityCode || ''),
          workerType: normalized,
          everifyRequired: Boolean(data.everifyRequired),
          isActive: data.isActive !== false,
        };
      })
      .filter((e) => e.isActive)
      .map((e) => ({
        id: e.id,
        name: e.name,
        entityCode: e.entityCode,
        workerType: e.workerType,
        everifyRequired: e.everifyRequired,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const applyEmploymentSelection = (
    opt: { id: string; entityName?: string; raw: Record<string, unknown> } | undefined
  ) => {
    if (!opt || !tenantId) return;
    const raw = opt.raw;
    setHireDateDisplayText(formatEmploymentDateDisplay(raw.startDate));
    setHiringEntityDisplay(EVERIFY_HIRING_ENTITY_LABEL);
    const assignId = (raw.currentAssignmentId as string) || '';
    if (assignId) {
      getDoc(doc(db, 'tenants', tenantId, 'assignments', assignId)).then((as) => {
        const ad = as.data() as { jobOrderId?: string; worksiteLabel?: string } | undefined;
        setWorksiteDisplay(ad?.worksiteLabel || ad?.jobOrderId || assignId);
      });
    } else {
      setWorksiteDisplay('—');
    }
  };

  const openEverifyModal = async () => {
    if (!tenantId) return;
    setEvMessage(null);
    setSelectedEmpId('');
    setHireDateDisplayText('');
    setHiringEntityDisplay(EVERIFY_HIRING_ENTITY_LABEL);
    setWorksiteDisplay('');
    setI9Confirmed(false);
    setEvNotes('');
    setEvWorkerFirstName('');
    setEvWorkerLastName('');
    setEvWorkerDob('');
    setEvWorkerSsn('');
    setEvCitizenshipCode('');
    setCreateEmploymentError(null);
    setEverifyHiringEntityResolved(null);
    setNewEmploymentStartIso(new Date().toISOString().slice(0, 10));
    setEvModalOpen(true);
    setTenantEntitiesLoading(true);
    try {
      const [entities, opts, workerSnap] = await Promise.all([
        loadTenantEntitiesForTenant(tenantId),
        loadEmploymentOptionsForUser(tenantId, uid),
        getDoc(doc(db, 'users', uid)),
      ]);
      const wd = workerSnap.exists() ? (workerSnap.data() as Record<string, unknown>) : {};
      setEvWorkerFirstName(String(wd.firstName || '').trim());
      setEvWorkerLastName(String(wd.lastName || '').trim());
      setEvWorkerDob(toDateInputValue(wd.dob ?? wd.dateOfBirth));
      setEvWorkerSsn('');
      setEvCitizenshipCode('');
      setEverifyHiringEntityResolved(resolveEverifyHiringEntity(entities));
      setUserEmploymentIds(opts);
      if (opts.length === 1) {
        setSelectedEmpId(opts[0].id);
        applyEmploymentSelection(opts[0]);
      }
    } catch {
      setUserEmploymentIds([]);
      setEverifyHiringEntityResolved(null);
      setHiringEntityDisplay(EVERIFY_HIRING_ENTITY_LABEL);
      setCreateEmploymentError('Could not load entities or employments.');
    } finally {
      setTenantEntitiesLoading(false);
    }
  };

  const handleCreateUserEmployment = async () => {
    if (!tenantId || !everifyHiringEntityResolved || !newEmploymentStartIso) return;
    const entity = everifyHiringEntityResolved;
    setCreatingEmployment(true);
    setCreateEmploymentError(null);
    const startTs = Timestamp.fromDate(new Date(`${newEmploymentStartIso}T12:00:00`));
    const entityId = entity.id;
    try {
      const workerType = mapEntityWorkerTypeToEmployment(entity.workerType);
      await addDoc(userEmploymentsCol(tenantId), {
        userId: uid,
        entityId,
        startDate: startTs,
        workerType,
        i9Status: 'pending',
        tenantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const opts = await loadEmploymentOptionsForUser(tenantId, uid);
      setUserEmploymentIds(opts);
      const created = opts.find((o) => {
        if ((o.raw.entityId as string) !== entityId) return false;
        const sd = o.raw.startDate;
        if (sd instanceof Timestamp) return sd.toMillis() === startTs.toMillis();
        return false;
      });
      if (created) {
        setSelectedEmpId(created.id);
        applyEmploymentSelection(created);
      }
    } catch (e: unknown) {
      setCreateEmploymentError(e instanceof Error ? e.message : 'Failed to create employment record');
    } finally {
      setCreatingEmployment(false);
    }
  };

  const selectedEmploymentRow = selectedEmpId ? userEmploymentIds.find((o) => o.id === selectedEmpId) : undefined;
  const employmentEntityMismatch = Boolean(
    everifyHiringEntityResolved &&
      selectedEmploymentRow &&
      typeof selectedEmploymentRow.raw.entityId === 'string' &&
      selectedEmploymentRow.raw.entityId.length > 0 &&
      selectedEmploymentRow.raw.entityId !== everifyHiringEntityResolved.id
  );

  /** Server requires `user_employments.i9Status === 'completed'` (everifyEligibility); checkbox alone does not update Firestore. */
  const selectedEmploymentI9StatusRaw = String(selectedEmploymentRow?.raw?.i9Status ?? '').trim();
  const currentI9Normalized = selectedEmploymentI9StatusRaw.toLowerCase();
  const i9StatusIsKnown = (USER_EMPLOYMENT_I9_STATUS_VALUES as readonly string[]).includes(currentI9Normalized);
  const i9SystemCompleted = currentI9Normalized === 'completed';

  const handleUserEmploymentI9StatusChange = async (next: string) => {
    if (!tenantId || !selectedEmpId || !canManageEverify) return;
    setI9StatusSaving(true);
    setEvMessage(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'user_employments', selectedEmpId), {
        i9Status: next,
        updatedAt: serverTimestamp(),
      });
      setUserEmploymentIds((prev) =>
        prev.map((o) =>
          o.id === selectedEmpId ? { ...o, raw: { ...o.raw, i9Status: next } } : o
        )
      );
    } catch (e: unknown) {
      setEvMessage(e instanceof Error ? e.message : 'Could not update I-9 status');
    } finally {
      setI9StatusSaving(false);
    }
  };

  const loadProfileForScreening = async () => {
    if (!uid) return;
    const uref = doc(db, 'users', uid);
    const snap = await getDoc(uref);
    setProfileUser(snap.exists() ? (snap.data() as Record<string, unknown>) : {});
    setPackageDefaultsTrace('');
    if (!tenantId) return;

    setDefaultJobOrderId('');
    setDefaultWorksiteId('');
    setDefaultAccountId('');
    setDefaultAccountName('');
    setPkgName('');
    setPkgId('');

    try {
      const result = await fetchMergedScreeningPackageForCandidate(tenantId, uid);
      setPkgName(result.merged.packageName);
      setPkgId(result.merged.packageId);
      setPackageDefaultsTrace(result.trace);
      setDefaultJobOrderId(result.defaultJobOrderId);
      setDefaultWorksiteId(result.defaultWorksiteId);
      setDefaultAccountId(result.defaultAccountId);
      setDefaultAccountName(result.defaultAccountName);
    } catch {
      setPackageDefaultsTrace('Could not load assignment defaults — choose a package from the synced catalog.');
    }
  };

  const handleRefreshAccusourceCatalog = async () => {
    if (!canAccusourceAdmin) {
      setBgMessageSeverity('error');
      setBgMessage(ACCUSOURCE_PERM_HINT);
      return;
    }
    setCatalogSyncing(true);
    setBgMessage(null);
    setBgMessageSeverity('error');
    try {
      const res = (await syncAccusourcePackageCatalog({
        tenantId: tenantId || undefined,
      })) as {
        data?: { ok?: boolean; packageCount?: number; serviceCount?: number };
      };
      const syncData = res.data;
      const readResult = await refetchAccusourceCatalog();
      if (readResult.ok === false) {
        const readErr = readResult.error;
        setBgMessageSeverity('error');
        setBgMessage(
          `Sync may have completed on the server (${syncData?.packageCount ?? '—'} packages), but this session could not read integrations_accusource/catalog from Firestore (${readErr}). Check Firestore rules for integrations_accusource and the browser console for details.`
        );
        return;
      }
      if (syncData != null && syncData.packageCount === 0) {
        setBgMessageSeverity('warning');
        setBgMessage(
          'Sync finished but AccuSource returned 0 active packages. Confirm SourceDirect credentials, environment, and that packages exist for this company.'
        );
      }
    } catch (e: unknown) {
      const msg = formatFirebaseHttpsError(e);
      setBgMessageSeverity('error');
      setBgMessage(msg);
      console.warn('[AccuSource] syncAccusourcePackageCatalog failed', e);
    } finally {
      setCatalogSyncing(false);
    }
  };

  const openScreeningModal = async () => {
    setBgMessage(null);
    setBgMessageSeverity('error');
    setBgNotes('');
    setSelectedServiceIds([]);
    setBgModalOpen(true);
    await loadProfileForScreening();
  };

  const submitEverify = async () => {
    if (!canManageEverify) {
      setEvMessage(EVERIFY_PERM_HINT);
      return;
    }
    if (!tenantId || !selectedEmpId) {
      setEvMessage('Select a hiring employment record.');
      return;
    }
    if (!i9Confirmed) {
      setEvMessage('Confirm I-9 is complete before starting E-Verify.');
      return;
    }
    const fn = evWorkerFirstName.trim();
    const ln = evWorkerLastName.trim();
    const dob = evWorkerDob.trim();
    const ssnRaw = evWorkerSsn.trim();
    const cit = evCitizenshipCode.trim();
    if (!fn || !ln || !dob || !ssnRaw || !cit) {
      setEvMessage('Enter legal first name, last name, date of birth, SSN, and citizenship for E-Verify.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setEvMessage('Date of birth must be YYYY-MM-DD.');
      return;
    }
    const ssnDigits = ssnRaw.replace(/\D/g, '');
    if (ssnDigits.length !== 9) {
      setEvMessage('SSN must be 9 digits (dashes optional).');
      return;
    }
    setEvSubmitting(true);
    setEvMessage(null);
    try {
      const check = (await everifyCheckEligibility({
        tenantId,
        userEmploymentId: selectedEmpId,
      })) as { data: { eligible: boolean; blockingReasons?: string[] } };
      if (!check.data.eligible) {
        setEvMessage((check.data.blockingReasons || []).join(' ') || 'Not eligible');
        setEvSubmitting(false);
        return;
      }
    } catch (e: unknown) {
      const msg = formatFirebaseHttpsError(e);
      setEvMessage(msg);
      console.warn('[E-Verify] everifyCheckEligibility failed', e);
      setEvSubmitting(false);
      return;
    }
    try {
      await everifyCreateCase({
        tenantId,
        userEmploymentId: selectedEmpId,
        i9Employee: {
          first_name: fn,
          last_name: ln,
          date_of_birth: dob,
          ssn: ssnRaw,
          citizenship_status_code: cit,
        },
      });
      if (evNotes.trim()) {
        await logCustomActivity(uid, 'everify_start_requested', evNotes.trim(), 'medium', {
          userEmploymentId: selectedEmpId,
        });
      }
      setEvModalOpen(false);
      await loadAll();
    } catch (e: unknown) {
      const msg = formatFirebaseHttpsError(e);
      setEvMessage(msg);
      console.warn('[E-Verify] everifyCreateCase failed', e);
    } finally {
      setEvSubmitting(false);
    }
  };

  const submitScreening = async () => {
    if (!canAccusourceAdmin) {
      setBgMessageSeverity('error');
      setBgMessage(ACCUSOURCE_PERM_HINT);
      return;
    }
    if (!tenantId || !profileUser) {
      setBgMessageSeverity('error');
      setBgMessage('Missing profile or tenant.');
      return;
    }
    setBgSubmitting(true);
    setBgMessage(null);
    setBgMessageSeverity('error');
    try {
      if (!accusourceCatalog?.packages?.length) {
        setBgMessage('Package catalog is empty — an admin must run Refresh packages to sync from AccuSource.');
        setBgSubmitting(false);
        return;
      }
      if (!pkgId.trim()) {
        setBgMessage('Select a package from the synced catalog.');
        setBgSubmitting(false);
        return;
      }
      const services = selectedServiceIds;
      await createAccusourceBackgroundCheck({
        tenantId,
        candidateId: uid,
        candidateName: [profileUser.firstName, profileUser.lastName].filter(Boolean).join(' ') || String(profileUser.email || ''),
        accountId: defaultAccountId || undefined,
        accountName: defaultAccountName || undefined,
        jobOrderId: defaultJobOrderId || undefined,
        worksiteId: defaultWorksiteId || undefined,
        requestedPackageId: pkgId || undefined,
        requestedPackageName: pkgName || undefined,
        requestedServices: services,
        candidate: {
          firstName: String(profileUser.firstName || ''),
          lastName: String(profileUser.lastName || ''),
          email: String(profileUser.email || ''),
          phone: String(profileUser.phone || profileUser.phoneE164 || ''),
          dateOfBirth: String(profileUser.dateOfBirth || profileUser.dob || ''),
        },
      });
      if (bgNotes.trim()) {
        await logCustomActivity(uid, 'screening_order_requested', bgNotes.trim(), 'medium');
      }
      setBgModalOpen(false);
      await loadAll();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setBgMessageSeverity('error');
      setBgMessage(err.message || 'Failed to order screening');
    } finally {
      setBgSubmitting(false);
    }
  };

  const handleRetryEverify = async (caseId: string, userEmploymentId?: string | null) => {
    if (!tenantId || !canManageEverify) return;
    try {
      await everifyRetryCase({ tenantId, caseId, userEmploymentId: userEmploymentId || undefined });
      await loadAll();
    } catch {
      /* ignore */
    }
  };

  const openPdf = async (backgroundCheckId: string, kind: 'final' | 'drug') => {
    if (!canAccusourceAdmin) return;
    setPdfLoading(`${backgroundCheckId}-${kind}`);
    try {
      const res = (await getAccusourcePdf({ backgroundCheckId, kind })) as {
        data?: { url?: string; base64?: string };
      };
      const url = res.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setPdfLoading(null);
    }
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">Select a tenant to view compliance.</Alert>
      </Box>
    );
  }

  if (loading && everifyRows.length === 0 && screeningRows.length === 0) {
    return (
      <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">
        Compliance control center — E-Verify and AccuSource screening. Data is loaded from Firestore; actions use server functions only.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 1. Summary */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <GavelIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={700}>
              Compliance summary
            </Typography>
            {summary.actionNeeded && (
              <Chip
                size="small"
                color="warning"
                icon={<WarningAmberIcon />}
                label="Action needed"
              />
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Last updated: {lastRefresh ? lastRefresh.toLocaleString() : '—'}
            {summary.maxMillis > 0 && ` · data max ${new Date(summary.maxMillis).toLocaleString()}`}
          </Typography>
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5, mb: 1 }}>
          <Chip
            size="small"
            label={`E-Verify: ${summary.evStatusLabel}`}
            color={statusToneFromStatusString(summary.evStatusLabel)}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Background screening: ${summary.bgStatusLabel}`}
            color={statusToneFromStatusString(summary.bgStatusLabel)}
            variant="outlined"
          />
          <Chip size="small" label={`Drug screening: ${summary.drugSummaryLabel}`} variant="outlined" />
          <Chip size="small" label={`Additional: ${summary.additionalSummaryLabel}`} variant="outlined" />
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          <Tooltip title={!canManageEverify ? EVERIFY_PERM_HINT : ''}>
            <span>
              <Button variant="contained" size="small" onClick={openEverifyModal} disabled={!canManageEverify}>
                Start E-Verify
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={!canAccusourceAdmin ? ACCUSOURCE_PERM_HINT : ''}>
            <span>
              <Button variant="outlined" size="small" onClick={openScreeningModal} disabled={!canAccusourceAdmin}>
                Order screening
              </Button>
            </span>
          </Tooltip>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={() => loadAll()} disabled={loading}>
            Refresh status
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          Default screening package (resolved)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Job order → location defaults → account. This is what the order modal pre-fills when available.
        </Typography>
        {resolvedPreviewLoading ? (
          <Stack direction="row" alignItems="center" gap={1}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          </Stack>
        ) : resolvedPreview ? (
          <Stack spacing={0.75}>
            <Typography variant="body2">
              {resolvedPreview.merged.packageName?.trim() || '—'}
              {resolvedPreview.merged.packageId?.trim() ? (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({resolvedPreview.merged.packageId.trim()})
                </Typography>
              ) : null}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {resolvedPreview.trace}
            </Typography>
            {previewPackageNotInCatalog && (
              <Alert severity="warning" sx={{ mt: 0.5 }}>
                Resolved package id is not in the current synced catalog — refresh packages or pick a matching id before ordering.
              </Alert>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Could not load resolved defaults.
          </Typography>
        )}
      </Paper>

      {/* 2. Table */}
      <Paper variant="outlined" sx={{ p: 0 }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Active orders & compliance items
          </Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Package / screen</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Ordered / submitted</TableCell>
                <TableCell>Provider</TableCell>
                <TableCell>Action needed</TableCell>
                <TableCell>Report</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {everifyRows.length === 0 && screeningRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant="body2" color="text.secondary">
                      No E-Verify cases or screening orders for this worker yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {normalizedRows.map((row) => {
                if (row.channel === 'everify') {
                  const ev = row.everify!;
                  const { id, data } = ev;
                  const retryEligible = data.status === 'error' || data.error;
                  return (
                    <TableRow key={row.key}>
                      <TableCell>E-Verify</TableCell>
                      <TableCell>{row.packageLabel}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.statusPrimary}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.statusSecondary}
                        </Typography>
                      </TableCell>
                      <TableCell>{formatTime(row.submittedAt)}</TableCell>
                      <TableCell>{row.providerLabel}</TableCell>
                      <TableCell>{row.actionNeeded || '—'}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell align="right">
                        {retryEligible && (
                          <Tooltip title={!canManageEverify ? EVERIFY_PERM_HINT : ''}>
                            <span>
                              <Button
                                size="small"
                                disabled={!canManageEverify}
                                onClick={() => handleRetryEverify(id, (data.userEmploymentId as string) || null)}
                              >
                                Retry
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }
                const r = row.screening!;
                return (
                  <TableRow key={row.key}>
                    <TableCell>
                      Background
                      {row.drugReportReady && (
                        <Typography component="span" variant="caption" display="block" color="text.secondary">
                          (+ drug component)
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{row.packageLabel}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.statusPrimary}</Typography>
                    </TableCell>
                    <TableCell>{formatTime(row.submittedAt)}</TableCell>
                    <TableCell>{row.providerLabel}</TableCell>
                    <TableCell>{row.actionNeeded || '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {r.finalReportReady && (
                          <Tooltip title={!canAccusourceAdmin ? ACCUSOURCE_PERM_HINT : ''}>
                            <span>
                              <Button
                                size="small"
                                disabled={!!pdfLoading || !canAccusourceAdmin}
                                onClick={() => openPdf(r.id, 'final')}
                              >
                                Final PDF
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        {r.drugReportReady && (
                          <Tooltip title={!canAccusourceAdmin ? ACCUSOURCE_PERM_HINT : ''}>
                            <span>
                              <Button
                                size="small"
                                disabled={!!pdfLoading || !canAccusourceAdmin}
                                onClick={() => openPdf(r.id, 'drug')}
                              >
                                Drug PDF
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        {!r.finalReportReady && !r.drugReportReady && '—'}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      {r.applicantPortalLink && (
                        <Link href={r.applicantPortalLink} target="_blank" rel="noopener noreferrer">
                          Portal
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 3A E-Verify modal */}
      <Dialog open={evModalOpen} onClose={() => setEvModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Start E-Verify</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Eligibility uses <code>user_employments</code> (entity, start date, I-9) plus assignment/entity rules on the server. For E-Verify,
              hiring entity is always <strong>{EVERIFY_HIRING_ENTITY_LABEL}</strong> (resolved from Settings → Entities).
            </Typography>
            {!tenantEntitiesLoading && !everifyHiringEntityResolved && (
              <Alert severity="error">
                Could not find <strong>{EVERIFY_HIRING_ENTITY_LABEL}</strong> in this tenant (match <code>entityCode</code> C1SL or name). Add or
                fix the entity under Settings → Entities.
              </Alert>
            )}
            {employmentEntityMismatch && (
              <Alert severity="warning">
                This employment record is linked to a different entity in Firestore. E-Verify eligibility uses the employment document’s{' '}
                <code>entityId</code>, not only this label.
              </Alert>
            )}
            {userEmploymentIds.length === 0 && (
              <Alert severity="info">
                No <code>user_employments</code> for this worker yet. Set start date below, then <strong>Create employment record</strong> (saved
                under {EVERIFY_HIRING_ENTITY_LABEL}) before running eligibility.
              </Alert>
            )}
            {createEmploymentError && (
              <Alert severity="error" onClose={() => setCreateEmploymentError(null)}>
                {createEmploymentError}
              </Alert>
            )}
            {userEmploymentIds.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>User employment</InputLabel>
                <Select
                  value={selectedEmpId}
                  label="User employment"
                  displayEmpty={userEmploymentIds.length > 1}
                  onChange={(e) => {
                    const v = e.target.value as string;
                    setEvMessage(null);
                    setSelectedEmpId(v);
                    const opt = userEmploymentIds.find((o) => o.id === v);
                    if (opt) applyEmploymentSelection(opt);
                  }}
                >
                  {userEmploymentIds.length > 1 && (
                    <MenuItem value="">
                      <em>Select employment…</em>
                    </MenuItem>
                  )}
                  {userEmploymentIds.map((o) => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <TextField
              size="small"
              label="Hiring entity"
              value={hiringEntityDisplay}
              fullWidth
              InputProps={{ readOnly: true }}
              InputLabelProps={{ shrink: true }}
              helperText={
                everifyHiringEntityResolved
                  ? `Linked to entities/${everifyHiringEntityResolved.id} (${everifyHiringEntityResolved.workerType}).`
                  : 'Resolve this entity in Settings → Entities (C1SL or C1 Select LLC).'
              }
            />
            {userEmploymentIds.length > 0 ? (
              <TextField
                size="small"
                label="Hire date (from employment record)"
                value={hireDateDisplayText || '—'}
                fullWidth
                InputProps={{ readOnly: true }}
                InputLabelProps={{ shrink: true }}
                helperText="Stored on the employment record; shown for confirmation."
              />
            ) : (
              <TextField
                type="date"
                size="small"
                label="Hire date (start)"
                value={newEmploymentStartIso}
                onChange={(e) => setNewEmploymentStartIso(e.target.value)}
                fullWidth
                InputLabelProps={{ shrink: true }}
                helperText="Saved as employment.startDate when you create the employment record."
              />
            )}
            {userEmploymentIds.length === 0 && (
              <Button
                variant="outlined"
                disabled={
                  !everifyHiringEntityResolved ||
                  !newEmploymentStartIso ||
                  creatingEmployment ||
                  tenantEntitiesLoading
                }
                onClick={() => void handleCreateUserEmployment()}
              >
                {creatingEmployment ? <CircularProgress size={22} /> : 'Create employment record'}
              </Button>
            )}
            <TextField
              size="small"
              label="Worksite / assignment context"
              value={worksiteDisplay}
              fullWidth
              InputProps={{ readOnly: true }}
              helperText="Informational only (from linked assignment). Not required for E-Verify eligibility or case creation in this integration."
            />
            {userEmploymentIds.length > 0 && selectedEmpId ? (
              canManageEverify ? (
                <FormControl fullWidth size="small" disabled={i9StatusSaving || tenantEntitiesLoading}>
                  <InputLabel id="ev-i9-status-label" shrink>
                    I-9 status (employment record)
                  </InputLabel>
                  <Select
                    labelId="ev-i9-status-label"
                    label="I-9 status (employment record)"
                    value={i9StatusIsKnown ? currentI9Normalized : selectedEmploymentI9StatusRaw || 'pending'}
                    displayEmpty
                    onChange={(e) => void handleUserEmploymentI9StatusChange(e.target.value as string)}
                  >
                    {!i9StatusIsKnown && selectedEmploymentI9StatusRaw ? (
                      <MenuItem value={selectedEmploymentI9StatusRaw}>
                        Legacy / other: {selectedEmploymentI9StatusRaw}
                      </MenuItem>
                    ) : null}
                    {USER_EMPLOYMENT_I9_STATUS_VALUES.map((v) => (
                      <MenuItem key={v} value={v}>
                        {USER_EMPLOYMENT_I9_STATUS_LABELS[v]}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText sx={{ mx: 0 }}>
                    Same field as <code>user_employments.i9Status</code> everywhere (onboarding, E-Verify). Set to{' '}
                    <strong>Completed</strong> when Section 2 is done so eligibility can pass. The checkbox below is an
                    extra attestation only.
                  </FormHelperText>
                </FormControl>
              ) : (
                <TextField
                  size="small"
                  label="I-9 status (employment record)"
                  value={selectedEmploymentI9StatusRaw || '—'}
                  fullWidth
                  InputProps={{ readOnly: true }}
                  InputLabelProps={{ shrink: true }}
                  helperText="E-Verify reads this field from Firestore. It must be “completed” before a case can start."
                />
              )
            ) : null}
            {selectedEmpId && !i9SystemCompleted ? (
              <Alert severity="warning">
                E-Verify requires I-9 status <strong>Completed</strong> on this employment (current:{' '}
                <strong>{selectedEmploymentI9StatusRaw || 'not set'}</strong>). Choose <strong>Completed</strong> above
                when Section 2 is finished, or update it elsewhere in your HR workflow.
              </Alert>
            ) : null}
            {selectedEmpId && canManageEverify ? (
              <>
                <Divider />
                <Typography variant="subtitle2">Employee data for USCIS (this submission)</Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Sent only to the E-Verify API for this case. Not stored on the <code>everify_cases</code> Firestore doc.
                  Optional env defaults (<code>EVERIFY_I9_FIXTURE_JSON</code>) are merged under these values.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    label="Legal first name"
                    value={evWorkerFirstName}
                    onChange={(e) => setEvWorkerFirstName(e.target.value)}
                    fullWidth
                    required
                    autoComplete="off"
                  />
                  <TextField
                    size="small"
                    label="Legal last name"
                    value={evWorkerLastName}
                    onChange={(e) => setEvWorkerLastName(e.target.value)}
                    fullWidth
                    required
                    autoComplete="off"
                  />
                </Stack>
                <TextField
                  type="date"
                  size="small"
                  label="Date of birth"
                  value={evWorkerDob}
                  onChange={(e) => setEvWorkerDob(e.target.value)}
                  fullWidth
                  required
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  label="SSN"
                  value={evWorkerSsn}
                  onChange={(e) => setEvWorkerSsn(e.target.value)}
                  fullWidth
                  required
                  autoComplete="off"
                  placeholder="###-##-####"
                  helperText="Must match the completed I-9. Format with or without dashes."
                />
                <FormControl fullWidth size="small" required>
                  <InputLabel id="ev-cit-label">Citizenship / status (ICA code)</InputLabel>
                  <Select
                    labelId="ev-cit-label"
                    label="Citizenship / status (ICA code)"
                    value={evCitizenshipCode}
                    displayEmpty
                    onChange={(e) => setEvCitizenshipCode(e.target.value as string)}
                  >
                    <MenuItem value="">
                      <em>Select…</em>
                    </MenuItem>
                    {EVERIFY_CITIZENSHIP_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.value} — {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText sx={{ mx: 0 }}>Must match Section 1 of the I-9.</FormHelperText>
                </FormControl>
              </>
            ) : null}
            <FormControlLabel
              control={<Checkbox checked={i9Confirmed} onChange={(_, v) => setI9Confirmed(v)} />}
              label="I confirm I-9 is complete for this employment (attestation)"
            />
            <TextField label="Notes (internal)" value={evNotes} onChange={(e) => setEvNotes(e.target.value)} multiline minRows={2} fullWidth />
            {evMessage && <Alert severity="warning">{evMessage}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEvModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitEverify}
            disabled={
              evSubmitting ||
              !canManageEverify ||
              !selectedEmpId ||
              !i9SystemCompleted ||
              !i9Confirmed
            }
          >
            {evSubmitting ? <CircularProgress size={22} /> : 'Submit'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 3B Screening modal */}
      <Dialog open={bgModalOpen} onClose={() => setBgModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Order screening (AccuSource)</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {bgMessage && (
              <Alert
                severity={bgMessageSeverity}
                onClose={() => {
                  setBgMessage(null);
                  setBgMessageSeverity('error');
                }}
              >
                {bgMessage}
              </Alert>
            )}
            <AccusourcePackageSelector
              catalog={accusourceCatalog}
              catalogLoading={catalogLoading || catalogSyncing}
              packageId={pkgId}
              packageName={pkgName}
              onChange={(next) => {
                setPkgId(next.packageId);
                setPkgName(next.packageName);
              }}
              selectedServiceIds={selectedServiceIds}
              onServicesChange={setSelectedServiceIds}
              showCatalogMeta
              showRefresh
              onRefreshCatalog={handleRefreshAccusourceCatalog}
              catalogRefreshing={catalogSyncing}
              canRefreshCatalog={canAccusourceAdmin}
              showDiagnostics={false}
              emptyCatalogSeverity="warning"
              selectLabel="Package"
              emptyMenuLabel="Select a package…"
              packageNameFieldLabel="Package name (from selection)"
              packageNameHelperText={packageDefaultsTrace || ' '}
              description="Packages and services come from the Firestore catalog (synced from SourceDirect). Default package fields resolve from job order, then location_defaults, then account — IDs you pick here must match the synced list so orders match AccuSource exactly."
            />
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Already satisfied (completed / report-ready; validity window + package match are policy hooks for future deduping)
            </Typography>
            <Stack spacing={0.5}>
              {screeningRows
                .map((r) => ({ r, sat: evaluateScreeningSatisfied(r) }))
                .filter((x) => x.sat.satisfied)
                .slice(0, 5)
                .map(({ r, sat }) => (
                  <Box key={r.id}>
                    <Typography variant="body2">
                      {r.requestedPackageName || r.id} — {r.hrxStatus}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Package key: {sat.equivalencyKey}
                      {sat.expiresAtMs != null
                        ? ` · assumed valid through ${new Date(sat.expiresAtMs).toLocaleDateString()} (placeholder window)`
                        : ''}
                    </Typography>
                  </Box>
                ))}
              {screeningRows.filter((r) => evaluateScreeningSatisfied(r).satisfied).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  None found
                </Typography>
              )}
            </Stack>
            <TextField label="Notes (internal)" value={bgNotes} onChange={(e) => setBgNotes(e.target.value)} multiline minRows={2} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBgModalOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitScreening} disabled={bgSubmitting || !canAccusourceAdmin}>
            {bgSubmitting ? <CircularProgress size={22} /> : 'Submit order'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default BackgroundsComplianceTab;

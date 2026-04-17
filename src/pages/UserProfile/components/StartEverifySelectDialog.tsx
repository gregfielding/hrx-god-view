/**
 * Shared "Start E-Verify (C1 Select)" dialog — Employment tab (C1 Select entity) and other call sites.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { format, parseISO } from 'date-fns';
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  where,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { logCustomActivity } from '../../../utils/activityLogger';
import {
  USER_EMPLOYMENT_I9_STATUS_LABELS,
  USER_EMPLOYMENT_I9_STATUS_VALUES,
} from '../../../constants/userEmploymentI9Status';
import {
  EVERIFY_DOC_CUSTOM,
  EVERIFY_LIST_A_NUMBER_FIELD_LABELS,
  EVERIFY_LIST_A_PRESETS,
  EVERIFY_LIST_B_PRESETS,
  EVERIFY_LIST_C_PRESETS,
  everifyListBRequiresUsStateCode,
  filterDocPresetsByCitizenship,
  type EverifyListANumberField,
} from '../../../constants/everifyI9DocumentWizard';
import { US_STATE_CODES } from '../../../utils/unemploymentRates';
import { useAuth } from '../../../contexts/AuthContext';
import { canManageEverifyFromClaims } from './backgroundsComplianceModel';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import { isValidAlienNumber, normalizeAlienNumberForApi } from '../../../utils/everifyAlienNumber';
import {
  isValidI551NumberForEverifyApi,
  normalizeI551NumberForEverifyApi,
} from '../../../utils/everifyI551DocumentNumber';
import {
  i9CaseFlatPartialToDialogPrefill,
  i9SupportingApprovedToDialogPrefill,
  mergeEverifyDialogPrefill,
  type I9CaseFlatPartialFromSupporting,
  type I9SupportingDocLike,
} from '../../../utils/i9SupportingToEverifyPrefill';

const userEmploymentsCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'user_employments');

const EVERIFY_CITIZENSHIP_OPTIONS: { value: string; label: string }[] = [
  { value: 'US_CITIZEN', label: 'U.S. citizen' },
  { value: 'NONCITIZEN', label: 'U.S. noncitizen national' },
  { value: 'LAWFUL_PERMANENT_RESIDENT', label: 'Lawful permanent resident' },
  { value: 'ALIEN_AUTHORIZED_TO_WORK', label: 'Alien authorized to work' },
  { value: 'NONCITIZEN_AUTHORIZED_TO_WORK', label: 'Noncitizen authorized to work' },
];

const everifyCheckEligibility = httpsCallable(functions, 'everifyCheckEligibility');
const everifyCreateCase = httpsCallable(functions, 'everifyCreateCase');

/** Stable fingerprint of approved I-9 supporting rows (for prefill refresh without clobbering unrelated state). */
function i9ApprovedSignature(rows: I9SupportingDocLike[]): string {
  const approved = rows.filter((r) => String(r.status || '').toLowerCase() === 'approved');
  return approved
    .map((r) => {
      let ms = 0;
      const ra = r.reviewedAt as { toMillis?: () => number } | undefined;
      if (ra && typeof ra.toMillis === 'function') ms = ra.toMillis();
      return `${String(r.documentType || '')}:${ms}`;
    })
    .sort()
    .join('|');
}

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

/** SSN display ###-##-#### while typing (stores digits + dashes in state; submit strips non-digits). */
function formatSsnInputDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
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

export const EVERIFY_SELECT_PERM_HINT =
  'E-Verify actions require Recruiter/Manager/Admin, HRX, or tenant security level ≥ 4 (includes 5–7) per Firestore (matches server).';

export interface StartEverifySelectDialogProps {
  open: boolean;
  onClose: () => void;
  uid: string;
  tenantId: string;
  /** Called after a successful case create (reload parent lists). */
  onSuccess?: () => void | Promise<void>;
  dialogTitle?: string;
  /**
   * Retry / fix flow: load `everify_cases/{id}` and pre-select matching `user_employments` when present.
   */
  prefillEverifyCaseId?: string | null;
}

export const StartEverifySelectDialog: React.FC<StartEverifySelectDialogProps> = ({
  open,
  onClose,
  uid,
  tenantId,
  onSuccess,
  dialogTitle,
  prefillEverifyCaseId,
}) => {
  const { user, isHRX, claimsRoles, tenantRolesFromProfile, legacyUserSecurityLevel, legacyUserRole } = useAuth();

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
  /** List A vs List B + C for `i9_case_flat` document fields (USCIS create-draft). */
  const [evDocMode, setEvDocMode] = useState<'list_a' | 'list_bc'>('list_a');
  const [evDocASelection, setEvDocASelection] = useState('');
  const [evDocACustomCode, setEvDocACustomCode] = useState('');
  const [evDocANumberField, setEvDocANumberField] = useState<EverifyListANumberField | ''>('');
  const [evDocANumberValue, setEvDocANumberValue] = useState('');
  const [evDocExpiration, setEvDocExpiration] = useState('');
  const [evDocNoExpiration, setEvDocNoExpiration] = useState(false);
  const [evDocBSelection, setEvDocBSelection] = useState('');
  const [evDocBCustomCode, setEvDocBCustomCode] = useState('');
  const [evDocBNumber, setEvDocBNumber] = useState('');
  const [evDocCSelection, setEvDocCSelection] = useState('');
  const [evDocCCustomCode, setEvDocCCustomCode] = useState('');
  const [evDocCNumber, setEvDocCNumber] = useState('');
  /** List B issuing state (`us_state_code`); required for DRIVERS_LICENSE / GOVERNMENT_ID_CARD per E-Verify preflight. */
  const [evDocUsStateCode, setEvDocUsStateCode] = useState('');
  /** Loading tenants/…/entities to resolve C1 Select LLC for E-Verify. */
  const [tenantEntitiesLoading, setTenantEntitiesLoading] = useState(false);
  /** Resolved Firestore entity for EVERIFY_HIRING_ENTITY_LABEL; required to create employment from this modal. */
  const [everifyHiringEntityResolved, setEverifyHiringEntityResolved] = useState<TenantEntityOption | null>(null);
  /** yyyy-MM-dd when creating a user_employment (no existing rows). */
  const [newEmploymentStartIso, setNewEmploymentStartIso] = useState('');
  const [creatingEmployment, setCreatingEmployment] = useState(false);
  const [createEmploymentError, setCreateEmploymentError] = useState<string | null>(null);
  const [i9StatusSaving, setI9StatusSaving] = useState(false);

  const canManageEverify = useMemo(
    () =>
      canManageEverifyFromClaims(
        isHRX,
        tenantId,
        claimsRoles,
        user?.uid,
        uid,
        tenantRolesFromProfile,
        legacyUserSecurityLevel,
        legacyUserRole,
      ),
    [
      isHRX,
      tenantId,
      claimsRoles,
      user?.uid,
      uid,
      tenantRolesFromProfile,
      legacyUserSecurityLevel,
      legacyUserRole,
    ],
  );

  const listAFilteredPresets = useMemo(
    () => filterDocPresetsByCitizenship(EVERIFY_LIST_A_PRESETS, evCitizenshipCode),
    [evCitizenshipCode]
  );
  const listBFilteredPresets = useMemo(
    () => filterDocPresetsByCitizenship(EVERIFY_LIST_B_PRESETS, evCitizenshipCode),
    [evCitizenshipCode]
  );
  const listCFilteredPresets = useMemo(
    () => filterDocPresetsByCitizenship(EVERIFY_LIST_C_PRESETS, evCitizenshipCode),
    [evCitizenshipCode]
  );

  const listBResolvedIcaCode = useMemo(() => {
    if (evDocMode !== 'list_bc') return '';
    return evDocBSelection === EVERIFY_DOC_CUSTOM ? evDocBCustomCode.trim() : evDocBSelection;
  }, [evDocMode, evDocBSelection, evDocBCustomCode]);
  const showListBStateField = everifyListBRequiresUsStateCode(listBResolvedIcaCode);

  const everifyDocFormValid = useMemo(() => {
    if (!evCitizenshipCode.trim()) return false;
    if (evDocMode === 'list_a') {
      if (!evDocASelection) return false;
      if (evDocASelection === EVERIFY_DOC_CUSTOM) {
        if (!evDocACustomCode.trim()) return false;
        if (evDocANumberField === 'i551_number') return isValidI551NumberForEverifyApi(evDocANumberValue);
        if (evDocANumberField === 'alien_number') return isValidAlienNumber(evDocANumberValue);
        if (evDocANumberField) return evDocANumberValue.trim() !== '';
        return true;
      }
      if (evDocASelection === 'FORM_I551') {
        return isValidAlienNumber(evDocANumberValue);
      }
      const preset = EVERIFY_LIST_A_PRESETS.find((x) => x.code === evDocASelection);
      if (preset?.numberField === 'i551_number') return isValidI551NumberForEverifyApi(evDocANumberValue);
      if (preset?.numberField) return evDocANumberValue.trim() !== '';
      return true;
    }
    const bOk =
      evDocBSelection === EVERIFY_DOC_CUSTOM
        ? evDocBCustomCode.trim() !== ''
        : Boolean(evDocBSelection);
    const cOk =
      evDocCSelection === EVERIFY_DOC_CUSTOM
        ? evDocCCustomCode.trim() !== ''
        : Boolean(evDocCSelection);
    const listBcExpOk =
      evDocNoExpiration ||
      (evDocExpiration.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(evDocExpiration.trim()));
    const resolvedBCode =
      evDocBSelection === EVERIFY_DOC_CUSTOM ? evDocBCustomCode.trim() : evDocBSelection;
    const listBNeedsState = everifyListBRequiresUsStateCode(resolvedBCode);
    const stUpper = evDocUsStateCode.trim().toUpperCase();
    const listBcStateOk =
      !listBNeedsState ||
      (stUpper.length === 2 && (US_STATE_CODES as readonly string[]).includes(stUpper));
    return bOk && cOk && listBcExpOk && listBcStateOk;
  }, [
    evCitizenshipCode,
    evDocMode,
    evDocASelection,
    evDocACustomCode,
    evDocANumberField,
    evDocBSelection,
    evDocBCustomCode,
    evDocCSelection,
    evDocCCustomCode,
    evDocANumberValue,
    evDocExpiration,
    evDocNoExpiration,
    evDocUsStateCode,
  ]);

  /** `i551_number` invalid while non-empty (custom List A only; Green Card preset uses Alien # only). */
  const showI551FormatError = useMemo(() => {
    if (evDocMode !== 'list_a') return false;
    if (evDocASelection === EVERIFY_DOC_CUSTOM && evDocANumberField === 'i551_number') {
      const v = evDocANumberValue.trim();
      return v.length > 0 && !isValidI551NumberForEverifyApi(evDocANumberValue);
    }
    return false;
  }, [evDocMode, evDocASelection, evDocANumberField, evDocANumberValue]);

  const showAlienFormatError = useMemo(() => {
    if (evDocMode !== 'list_a') return false;
    if (evDocASelection === 'FORM_I551' || (evDocASelection === EVERIFY_DOC_CUSTOM && evDocANumberField === 'alien_number')) {
      const v = evDocANumberValue.trim();
      return v.length > 0 && !isValidAlienNumber(evDocANumberValue);
    }
    return false;
  }, [evDocMode, evDocASelection, evDocANumberField, evDocANumberValue]);

  useEffect(() => {
    if (!evDocASelection || evDocASelection === EVERIFY_DOC_CUSTOM) return;
    if (!listAFilteredPresets.some((p) => p.code === evDocASelection)) {
      setEvDocASelection('');
      setEvDocANumberField('');
      setEvDocANumberValue('');
    }
  }, [evCitizenshipCode, listAFilteredPresets, evDocASelection]);

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

  const applyEmploymentSelection = useCallback(
    (opt: { id: string; entityName?: string; raw: Record<string, unknown> } | undefined) => {
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
    },
    [tenantId]
  );

  const lastI9PrefillSigRef = useRef<string | null>(null);

  const applyI9SupportingEverifyPrefill = useCallback((wd: Record<string, unknown>, i9Rows: I9SupportingDocLike[]) => {
    const rawPref = wd.everifyI9SupportingPrefill as { flatPartial?: Record<string, string> } | undefined;
    const fp = rawPref?.flatPartial;
    const userPre = i9CaseFlatPartialToDialogPrefill((fp || {}) as I9CaseFlatPartialFromSupporting);
    const fromRows = i9SupportingApprovedToDialogPrefill(i9Rows);
    const i9Pre = mergeEverifyDialogPrefill(fromRows, userPre);
    setEvWorkerFirstName((String(wd.firstName || '').trim() || i9Pre.evWorkerFirstName).trim());
    setEvWorkerLastName((String(wd.lastName || '').trim() || i9Pre.evWorkerLastName).trim());
    setEvWorkerDob(toDateInputValue(wd.dob ?? wd.dateOfBirth) || i9Pre.evWorkerDob);
    setEvWorkerSsn('');
    setEvCitizenshipCode('');
    if (i9Pre.evDocASelection || (i9Pre.evDocBSelection && i9Pre.evDocCSelection)) {
      setEvDocMode(i9Pre.docMode);
      if (i9Pre.evDocASelection) setEvDocASelection(i9Pre.evDocASelection);
      if (i9Pre.evDocANumberField) setEvDocANumberField(i9Pre.evDocANumberField);
      if (i9Pre.evDocANumberValue) setEvDocANumberValue(i9Pre.evDocANumberValue);
      if (i9Pre.evDocBSelection) setEvDocBSelection(i9Pre.evDocBSelection);
      if (i9Pre.evDocCSelection) setEvDocCSelection(i9Pre.evDocCSelection);
      if (i9Pre.evDocBNumber) setEvDocBNumber(i9Pre.evDocBNumber);
      if (i9Pre.evDocCNumber) setEvDocCNumber(i9Pre.evDocCNumber);
      if (i9Pre.evDocExpiration) setEvDocExpiration(i9Pre.evDocExpiration);
      if (i9Pre.evDocUsStateCode) setEvDocUsStateCode(i9Pre.evDocUsStateCode);
    }
  }, []);

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

  const submitBlockingMessages = useMemo((): string[] => {
    const msgs: string[] = [];
    if (!canManageEverify) msgs.push(EVERIFY_SELECT_PERM_HINT);
    if (!selectedEmpId) msgs.push('Select a user employment record.');
    if (!i9SystemCompleted) {
      msgs.push(
        'Set I-9 status to “Completed” on the employment record (dropdown above). E-Verify eligibility requires this in Firestore—not only the checkbox below.'
      );
    }
    if (!i9Confirmed) msgs.push('Check “I confirm I-9 is complete for this employment.”');
    if (!everifyDocFormValid) {
      if (!evCitizenshipCode.trim()) {
        msgs.push('Select citizenship / work authorization.');
      } else if (evDocMode === 'list_a') {
        if (evDocASelection === 'FORM_I551') {
          if (!isValidAlienNumber(evDocANumberValue)) {
            msgs.push(
              evDocANumberValue.trim() === ''
                ? 'Enter the 9-digit USCIS / Alien number from the Green Card (with or without a leading A).'
                : 'USCIS / Alien number must be 9 digits (optional A prefix).'
            );
          }
        } else if (
          evDocASelection === EVERIFY_DOC_CUSTOM &&
          evDocANumberField === 'i551_number' &&
          !isValidI551NumberForEverifyApi(evDocANumberValue)
        ) {
          msgs.push(
            evDocANumberValue.trim() === ''
              ? 'Enter i551_number in the 13-character format required by E-Verify.'
              : 'i551_number must match E-Verify format (3 letters + 10 digits or * variant).'
          );
        } else if (
          evDocASelection === EVERIFY_DOC_CUSTOM &&
          evDocANumberField === 'alien_number' &&
          !isValidAlienNumber(evDocANumberValue)
        ) {
          msgs.push('Alien number must be 9 digits (optional A). E-Verify expects A#########.');
        } else {
          msgs.push('Complete the I-9 document section (List A type, numbers, and expiration rules).');
        }
      } else {
        msgs.push(
          'Complete List B and List C document types, List B identity document number (document_bc_number), issuing state for driver license / state ID (us_state_code), and expiration (YYYY-MM-DD) or “no expiration” per ICA.',
        );
      }
    }
    return msgs;
  }, [
    canManageEverify,
    selectedEmpId,
    i9SystemCompleted,
    i9Confirmed,
    everifyDocFormValid,
    evCitizenshipCode,
    evDocMode,
    evDocASelection,
    evDocANumberField,
    evDocANumberValue,
    evDocExpiration,
    evDocNoExpiration,
  ]);

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

  useEffect(() => {
    if (!open || !tenantId) return;
    let cancelled = false;
    lastI9PrefillSigRef.current = null;
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
    setEvDocMode('list_a');
    setEvDocASelection('');
    setEvDocACustomCode('');
    setEvDocANumberField('');
    setEvDocANumberValue('');
    setEvDocExpiration('');
    setEvDocNoExpiration(false);
    setEvDocBSelection('');
    setEvDocBCustomCode('');
    setEvDocBNumber('');
    setEvDocUsStateCode('');
    setEvDocCSelection('');
    setEvDocCCustomCode('');
    setEvDocCNumber('');
    setCreateEmploymentError(null);
    setEverifyHiringEntityResolved(null);
    setNewEmploymentStartIso(new Date().toISOString().slice(0, 10));
    setTenantEntitiesLoading(true);
    (async () => {
      try {
        const [entities, opts, workerSnap, i9SupportingSnap] = await Promise.all([
          loadTenantEntitiesForTenant(tenantId),
          loadEmploymentOptionsForUser(tenantId, uid),
          getDoc(doc(db, 'users', uid)),
          getDocs(query(collection(db, p.workerI9SupportingDocuments(tenantId)), where('userId', '==', uid))),
        ]);
        if (cancelled) return;
        const wd = workerSnap.exists() ? (workerSnap.data() as Record<string, unknown>) : {};
        const i9Rows: I9SupportingDocLike[] = i9SupportingSnap.docs.map((d) => d.data() as I9SupportingDocLike);
        applyI9SupportingEverifyPrefill(wd, i9Rows);
        lastI9PrefillSigRef.current = i9ApprovedSignature(i9Rows);
        setEverifyHiringEntityResolved(resolveEverifyHiringEntity(entities));
        setUserEmploymentIds(opts);
        let pickEmpId = '';
        if (prefillEverifyCaseId) {
          const cs = await getDoc(doc(db, 'tenants', tenantId, 'everify_cases', prefillEverifyCaseId));
          if (cs.exists()) {
            const ueid = String((cs.data() as { userEmploymentId?: string }).userEmploymentId || '').trim();
            if (ueid && opts.some((o) => o.id === ueid)) pickEmpId = ueid;
          }
        }
        if (!pickEmpId && opts.length === 1) pickEmpId = opts[0].id;
        if (pickEmpId) {
          setSelectedEmpId(pickEmpId);
          const opt = opts.find((o) => o.id === pickEmpId);
          if (opt) applyEmploymentSelection(opt);
        }
      } catch {
        if (cancelled) return;
        setUserEmploymentIds([]);
        setEverifyHiringEntityResolved(null);
        setHiringEntityDisplay(EVERIFY_HIRING_ENTITY_LABEL);
        setCreateEmploymentError('Could not load entities or employments.');
      } finally {
        setTenantEntitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    tenantId,
    uid,
    prefillEverifyCaseId,
    loadTenantEntitiesForTenant,
    loadEmploymentOptionsForUser,
    applyEmploymentSelection,
    applyI9SupportingEverifyPrefill,
  ]);

  useEffect(() => {
    if (!open || !tenantId) return;
    const q = query(collection(db, p.workerI9SupportingDocuments(tenantId)), where('userId', '==', uid));
    const unsub = onSnapshot(q, (snap) => {
      const i9Rows = snap.docs.map((d) => d.data() as I9SupportingDocLike);
      const sig = i9ApprovedSignature(i9Rows);
      if (sig === lastI9PrefillSigRef.current && lastI9PrefillSigRef.current !== null) return;
      lastI9PrefillSigRef.current = sig;
      getDoc(doc(db, 'users', uid)).then((workerSnap) => {
        const wd = workerSnap.exists() ? (workerSnap.data() as Record<string, unknown>) : {};
        applyI9SupportingEverifyPrefill(wd, i9Rows);
      });
    });
    return () => unsub();
  }, [open, tenantId, uid, applyI9SupportingEverifyPrefill]);

  const submitEverify = async () => {
    if (!canManageEverify) {
      setEvMessage(EVERIFY_SELECT_PERM_HINT);
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
    const resolveIcaDocCode = (sel: string, custom: string) =>
      sel === EVERIFY_DOC_CUSTOM ? custom.trim() : sel.trim();
    const docFields: Record<string, string | boolean> = {};
    if (evDocMode === 'list_a') {
      const aCode = resolveIcaDocCode(evDocASelection, evDocACustomCode);
      if (!aCode) {
        setEvMessage('Select or enter a List A document type (ICA code).');
        return;
      }
      docFields.document_a_type_code = aCode;
      if (evDocExpiration.trim()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(evDocExpiration.trim())) {
          setEvMessage('Document expiration must be YYYY-MM-DD.');
          return;
        }
        docFields.expiration_date = evDocExpiration.trim();
      }
      // E-Verify rejects no_expiration_date for FORM_I551 (ATTRIBUTE_EXTRANEOUS_FIELD).
      if (evDocNoExpiration && evDocASelection !== 'FORM_I551') {
        docFields.no_expiration_date = true;
      }
      if (evDocASelection === 'FORM_I551') {
        const alienNorm = normalizeAlienNumberForApi(evDocANumberValue.trim());
        if (!alienNorm) {
          setEvMessage('USCIS / Alien number must be 9 digits (optional A). E-Verify format: A + 9 digits.');
          return;
        }
        docFields.alien_number = alienNorm;
        // `i551_number` is filled server-side (ICA mask from Alien #) in applyRestDraftPayloadNormalization.
      } else {
        const aNumKey: EverifyListANumberField | '' =
          evDocASelection === EVERIFY_DOC_CUSTOM
            ? evDocANumberField
            : EVERIFY_LIST_A_PRESETS.find((x) => x.code === evDocASelection)?.numberField ?? '';
        if (aNumKey) {
          const numTrim = evDocANumberValue.trim();
          if (!numTrim) {
            setEvMessage('Enter the document number for the selected List A document.');
            return;
          }
          if (aNumKey === 'i551_number') {
            const norm = normalizeI551NumberForEverifyApi(numTrim);
            if (!norm) {
              setEvMessage(
                'E-Verify requires i551_number as 3 letters + 10 digits (or * + 9 digits), not the 9-digit Alien # alone.'
              );
              return;
            }
            docFields[aNumKey] = norm;
          } else if (aNumKey === 'alien_number') {
            const norm = normalizeAlienNumberForApi(numTrim);
            if (!norm) {
              setEvMessage('Alien number must be 9 digits (optional A). Sent as A######### to E-Verify.');
              return;
            }
            docFields.alien_number = norm;
          } else {
            docFields[aNumKey] = numTrim;
          }
        }
      }
    } else {
      const bCode = resolveIcaDocCode(evDocBSelection, evDocBCustomCode);
      const cCode = resolveIcaDocCode(evDocCSelection, evDocCCustomCode);
      if (!bCode || !cCode) {
        setEvMessage('Select or enter List B and List C document types (ICA codes).');
        return;
      }
      docFields.document_b_type_code = bCode;
      docFields.document_c_type_code = cCode;
      if (evDocBNumber.trim()) docFields.document_bc_number = evDocBNumber.trim();
      if (evDocCNumber.trim()) docFields.document_c_number = evDocCNumber.trim();
      if (everifyListBRequiresUsStateCode(bCode)) {
        const st = evDocUsStateCode.trim().toUpperCase();
        if (st.length !== 2 || !(US_STATE_CODES as readonly string[]).includes(st)) {
          setEvMessage('Select the issuing state (2-letter us_state_code) for this List B document.');
          return;
        }
        docFields.us_state_code = st;
      }
      if (evDocNoExpiration) {
        docFields.no_expiration_date = true;
      } else if (evDocExpiration.trim()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(evDocExpiration.trim())) {
          setEvMessage('List B + C path: document expiration must be YYYY-MM-DD.');
          setEvSubmitting(false);
          return;
        }
        docFields.expiration_date = evDocExpiration.trim();
      } else {
        setEvMessage(
          'List B + C: E-Verify requires expiration_date or no_expiration_date=true — enter the date or check “no expiration”.',
        );
        setEvSubmitting(false);
        return;
      }
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
      const i9Payload: Record<string, string | boolean> = {
        first_name: fn,
        last_name: ln,
        date_of_birth: dob,
        ssn: ssnRaw,
        citizenship_status_code: cit,
        ...docFields,
      };
      const i9Employee = Object.fromEntries(
        Object.entries(i9Payload).filter(([, v]) => {
          if (v === undefined || v === null) return false;
          if (typeof v === 'string' && v.trim() === '') return false;
          return true;
        })
      ) as typeof i9Payload;

      await everifyCreateCase({
        tenantId,
        userEmploymentId: selectedEmpId,
        i9Employee,
      });
      if (evNotes.trim()) {
        await logCustomActivity(uid, 'everify_start_requested', evNotes.trim(), 'medium', {
          userEmploymentId: selectedEmpId,
        });
      }
      onClose();
      await onSuccess?.();
    } catch (e: unknown) {
      const msg = formatFirebaseHttpsError(e);
      setEvMessage(msg);
      const det = e && typeof e === 'object' && 'details' in e ? (e as { details?: unknown }).details : undefined;
      console.warn('[E-Verify] everifyCreateCase failed', e, det != null ? { details: det } : '');
    } finally {
      setEvSubmitting(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>{dialogTitle ?? 'Start E-Verify (C1 Select)'}</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ mt: 1 }}>
        {prefillEverifyCaseId ? (
          <Alert severity="info">
            Enter the correct List A document (or List B and List C) ICA codes and numbers, confirm I-9 complete, then submit. This runs the same
            create flow as Start E-Verify and replaces a failed attempt when eligibility allows a new case.
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary">
          Eligibility uses <code>user_employments</code> (entity, start date, I-9) plus assignment/entity rules on the server. For E-Verify, hiring
          entity is always <strong>{EVERIFY_HIRING_ENTITY_LABEL}</strong> (resolved from Settings → Entities).
        </Typography>
        {!tenantEntitiesLoading && !everifyHiringEntityResolved && (
          <Alert severity="error">
            Could not find <strong>{EVERIFY_HIRING_ENTITY_LABEL}</strong> in this tenant (match <code>entityCode</code> C1SL or name). Add or fix the
            entity under Settings → Entities.
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
            No <code>user_employments</code> for this worker yet. Set start date below, then <strong>Create employment record</strong> (saved under{' '}
            {EVERIFY_HIRING_ENTITY_LABEL}) before running eligibility.
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
              !everifyHiringEntityResolved || !newEmploymentStartIso || creatingEmployment || tenantEntitiesLoading
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
                      onChange={(e) => setEvWorkerSsn(formatSsnInputDisplay(e.target.value))}
                      fullWidth
                      required
                      autoComplete="off"
                      inputProps={{ maxLength: 11, inputMode: 'numeric' }}
                      placeholder="###-##-####"
                      helperText="Must match the completed I-9. Enter 9 digits; dashes are added automatically."
                    />
                    <FormControl fullWidth size="small" required>
                      <InputLabel id="ev-cit-label">Citizenship / work authorization</InputLabel>
                      <Select
                        labelId="ev-cit-label"
                        label="Citizenship / work authorization"
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
                    <Divider />
                    <Typography variant="subtitle2">I-9 document data (USCIS create case)</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      E-Verify requires List A <strong>or</strong> List B + List C type codes in the API payload. Preset codes are
                      placeholders — confirm exact strings in your signed ICA; use &quot;Other&quot; to paste the code from your
                      ICA appendix.
                    </Typography>
                    <RadioGroup
                      row
                      value={evDocMode}
                      onChange={(e) => setEvDocMode(e.target.value as 'list_a' | 'list_bc')}
                    >
                      <FormControlLabel
                        value="list_a"
                        control={<Radio size="small" />}
                        label="List A (one document)"
                      />
                      <FormControlLabel
                        value="list_bc"
                        control={<Radio size="small" />}
                        label="List B + List C"
                      />
                    </RadioGroup>
                    {evDocMode === 'list_a' ? (
                      <Stack spacing={1.5}>
                        <FormControl fullWidth size="small" required>
                          <InputLabel id="ev-doc-a-label">List A document type</InputLabel>
                          <Select
                            labelId="ev-doc-a-label"
                            label="List A document type"
                            value={evDocASelection}
                            displayEmpty
                            onChange={(e) => {
                              const v = e.target.value as string;
                              setEvDocASelection(v);
                              setEvDocANumberValue('');
                              if (v === 'FORM_I551') {
                                setEvDocNoExpiration(false);
                              }
                              if (v === EVERIFY_DOC_CUSTOM) {
                                setEvDocANumberField('');
                              } else {
                                const p = EVERIFY_LIST_A_PRESETS.find((x) => x.code === v);
                                setEvDocANumberField(p?.numberField ?? '');
                              }
                            }}
                          >
                            <MenuItem value="">
                              <em>Select…</em>
                            </MenuItem>
                            {listAFilteredPresets.map((p) => (
                              <MenuItem key={p.code} value={p.code}>
                                {p.label}
                              </MenuItem>
                            ))}
                            <MenuItem value={EVERIFY_DOC_CUSTOM}>Other (enter ICA code)</MenuItem>
                          </Select>
                        </FormControl>
                        {evDocASelection === EVERIFY_DOC_CUSTOM ? (
                          <TextField
                            size="small"
                            label="List A ICA type code"
                            value={evDocACustomCode}
                            onChange={(e) => setEvDocACustomCode(e.target.value)}
                            fullWidth
                            required
                            autoComplete="off"
                            helperText="Exact value for document_a_type_code from your ICA."
                          />
                        ) : null}
                        {evDocASelection === EVERIFY_DOC_CUSTOM ? (
                          <FormControl fullWidth size="small">
                            <InputLabel id="ev-doc-a-numkey-label">Primary document number field (ICA)</InputLabel>
                            <Select
                              labelId="ev-doc-a-numkey-label"
                              label="Primary document number field (ICA)"
                              value={evDocANumberField}
                              displayEmpty
                              onChange={(e) => setEvDocANumberField(e.target.value as EverifyListANumberField | '')}
                            >
                              <MenuItem value="">
                                <em>None / not sending number</em>
                              </MenuItem>
                              {(Object.keys(EVERIFY_LIST_A_NUMBER_FIELD_LABELS) as EverifyListANumberField[]).map((k) => (
                                <MenuItem key={k} value={k}>
                                  {EVERIFY_LIST_A_NUMBER_FIELD_LABELS[k]}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : null}
                        {evDocASelection && evDocASelection !== EVERIFY_DOC_CUSTOM && evDocANumberField ? (
                          <TextField
                            size="small"
                            label={EVERIFY_LIST_A_NUMBER_FIELD_LABELS[evDocANumberField]}
                            value={evDocANumberValue}
                            onChange={(e) => setEvDocANumberValue(e.target.value)}
                            fullWidth
                            autoComplete="off"
                            error={
                              (evDocANumberField === 'i551_number' && showI551FormatError) ||
                              (evDocANumberField === 'alien_number' && showAlienFormatError)
                            }
                            helperText={
                              evDocANumberField === 'alien_number'
                                ? showAlienFormatError
                                  ? 'Enter 9 digits (optional A).'
                                  : evDocASelection === 'FORM_I551'
                                    ? 'USCIS / Alien # (9 digits; optional leading A). Cloud Functions add the separate E-Verify card-number field from this value so you only enter it once.'
                                    : '9-digit Alien #; we normalize to A######### for E-Verify.'
                                : evDocANumberField === 'i551_number'
                                  ? showI551FormatError
                                    ? 'Use the format your ICA specifies for i551_number.'
                                    : 'E-Verify i551_number: 3 letters + 10 digits (e.g. SRC1234567890), or * + 9 digits after letters.'
                                  : 'Must match the physical document shown for Section 2.'
                            }
                          />
                        ) : null}
                        {evDocASelection === EVERIFY_DOC_CUSTOM && evDocANumberField ? (
                          <TextField
                            size="small"
                            label={EVERIFY_LIST_A_NUMBER_FIELD_LABELS[evDocANumberField]}
                            value={evDocANumberValue}
                            onChange={(e) => setEvDocANumberValue(e.target.value)}
                            fullWidth
                            autoComplete="off"
                            error={
                              (evDocANumberField === 'i551_number' && showI551FormatError) ||
                              (evDocANumberField === 'alien_number' && showAlienFormatError)
                            }
                            helperText={
                              evDocANumberField === 'i551_number'
                                ? showI551FormatError
                                  ? 'Use the 13-character i551_number format.'
                                  : '3 letters + 10 digits (or * + 9 digits after letters).'
                                : evDocANumberField === 'alien_number'
                                  ? showAlienFormatError
                                    ? '9 digits (optional A).'
                                    : 'E-Verify pattern A + 9 digits; we add A if you enter digits only.'
                                  : undefined
                            }
                          />
                        ) : null}
                        <TextField
                          type="date"
                          size="small"
                          label="Document expiration (if any)"
                          value={evDocExpiration}
                          onChange={(e) => setEvDocExpiration(e.target.value)}
                          fullWidth
                          InputLabelProps={{ shrink: true }}
                          helperText={
                            evDocASelection === 'FORM_I551'
                              ? 'YYYY-MM-DD if the card shows an expiration. E-Verify does not accept “no expiration” for Green Card—leave date blank only if the card has no expiry.'
                              : 'YYYY-MM-DD. Leave blank if not applicable or use “no expiration” below per ICA.'
                          }
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={evDocNoExpiration}
                              disabled={evDocASelection === 'FORM_I551'}
                              onChange={(_, v) => setEvDocNoExpiration(v)}
                            />
                          }
                          label="Document has no expiration (no_expiration_date)"
                        />
                        {evDocASelection === 'FORM_I551' ? (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: -0.5 }}>
                            Not used for Permanent Resident Card — E-Verify returns an error if this is sent for FORM_I551.
                          </Typography>
                        ) : null}
                      </Stack>
                    ) : (
                      <Stack spacing={1.5}>
                        <FormControl fullWidth size="small" required>
                          <InputLabel id="ev-doc-b-label">List B document type</InputLabel>
                          <Select
                            labelId="ev-doc-b-label"
                            label="List B document type"
                            value={evDocBSelection}
                            displayEmpty
                            onChange={(e) => setEvDocBSelection(e.target.value as string)}
                          >
                            <MenuItem value="">
                              <em>Select…</em>
                            </MenuItem>
                            {listBFilteredPresets.map((p) => (
                              <MenuItem key={p.code} value={p.code}>
                                {p.label}
                              </MenuItem>
                            ))}
                            <MenuItem value={EVERIFY_DOC_CUSTOM}>Other (enter ICA code)</MenuItem>
                          </Select>
                        </FormControl>
                        {evDocBSelection === EVERIFY_DOC_CUSTOM ? (
                          <TextField
                            size="small"
                            label="List B ICA type code"
                            value={evDocBCustomCode}
                            onChange={(e) => setEvDocBCustomCode(e.target.value)}
                            fullWidth
                            required
                            autoComplete="off"
                          />
                        ) : null}
                        {showListBStateField ? (
                          <FormControl fullWidth size="small" required>
                            <InputLabel id="ev-doc-b-us-state-label">Issuing state (us_state_code)</InputLabel>
                            <Select
                              labelId="ev-doc-b-us-state-label"
                              label="Issuing state (us_state_code)"
                              value={evDocUsStateCode}
                              displayEmpty
                              onChange={(e) => setEvDocUsStateCode(String(e.target.value))}
                            >
                              <MenuItem value="">
                                <em>Select state…</em>
                              </MenuItem>
                              {US_STATE_CODES.map((code) => (
                                <MenuItem key={code} value={code}>
                                  {code}
                                </MenuItem>
                              ))}
                            </Select>
                            <FormHelperText>
                              Required for List B driver license and state-issued ID (E-Verify ICA preflight).
                            </FormHelperText>
                          </FormControl>
                        ) : null}
                        <TextField
                          size="small"
                          label="List B document number (document_bc_number)"
                          value={evDocBNumber}
                          onChange={(e) => setEvDocBNumber(e.target.value)}
                          fullWidth
                          autoComplete="off"
                          helperText="ICA field name may differ; confirm in your ICA."
                        />
                        <TextField
                          type="date"
                          size="small"
                          label="List B identity document expiration"
                          value={evDocExpiration}
                          onChange={(e) => setEvDocExpiration(e.target.value)}
                          fullWidth
                          InputLabelProps={{ shrink: true }}
                          disabled={evDocNoExpiration}
                          helperText="Required for List B + C (E-Verify ICA). Prefilled from I-9 document review / extraction when available (List B or List C date)."
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={evDocNoExpiration}
                              onChange={(_, v) => {
                                setEvDocNoExpiration(v);
                                if (v) setEvDocExpiration('');
                              }}
                            />
                          }
                          label="Document has no expiration (no_expiration_date)"
                        />
                        <FormControl fullWidth size="small" required>
                          <InputLabel id="ev-doc-c-label">List C document type</InputLabel>
                          <Select
                            labelId="ev-doc-c-label"
                            label="List C document type"
                            value={evDocCSelection}
                            displayEmpty
                            onChange={(e) => setEvDocCSelection(e.target.value as string)}
                          >
                            <MenuItem value="">
                              <em>Select…</em>
                            </MenuItem>
                            {listCFilteredPresets.map((p) => (
                              <MenuItem key={p.code} value={p.code}>
                                {p.label}
                              </MenuItem>
                            ))}
                            <MenuItem value={EVERIFY_DOC_CUSTOM}>Other (enter ICA code)</MenuItem>
                          </Select>
                        </FormControl>
                        {evDocCSelection === EVERIFY_DOC_CUSTOM ? (
                          <TextField
                            size="small"
                            label="List C ICA type code"
                            value={evDocCCustomCode}
                            onChange={(e) => setEvDocCCustomCode(e.target.value)}
                            fullWidth
                            required
                            autoComplete="off"
                          />
                        ) : null}
                        <TextField
                          size="small"
                          label="List C document number (document_c_number)"
                          value={evDocCNumber}
                          onChange={(e) => setEvDocCNumber(e.target.value)}
                          fullWidth
                          autoComplete="off"
                          helperText="If USCIS rejects this attribute name, adjust mapping in everifySchemas / ICA."
                        />
                      </Stack>
                    )}
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
            <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', px: 3, pb: 2, pt: 0, gap: 1.5 }}>
              {!evSubmitting && submitBlockingMessages.length > 0 ? (
                <Alert severity="warning" sx={{ mb: 0 }}>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Submit is disabled until:
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 0 }}>
                    {submitBlockingMessages.map((m, i) => (
                      <Typography key={`submit-block-${i}`} component="li" variant="body2" sx={{ mb: 0.25 }}>
                        {m}
                      </Typography>
                    ))}
                  </Box>
                </Alert>
              ) : null}
              <Stack direction="row" justifyContent="flex-end" gap={1} width="100%">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  variant="contained"
                  onClick={submitEverify}
                  disabled={
                    evSubmitting ||
                    !canManageEverify ||
                    !selectedEmpId ||
                    !i9SystemCompleted ||
                    !i9Confirmed ||
                    !everifyDocFormValid
                  }
                >
                  {evSubmitting ? <CircularProgress size={22} /> : 'Submit'}
                </Button>
              </Stack>
            </DialogActions>
          </Dialog>
  );

};

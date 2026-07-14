/**
 * User Details → Backgrounds: compliance operations (AccuSource + C1 Select work authorization summary).
 * Start E-Verify lives on Employment → C1 Select. E-Verify rows in the table remain C1 Select–scoped; Workforce I-9 is shown without E-Verify.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Paper,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { logCustomActivity } from '../../../utils/activityLogger';
import AccusourceScreeningDebugSection from '../../../components/recruiter/AccusourceScreeningDebugSection';
import { AccusourcePackageSelector } from '../../../components/recruiter/AccusourcePackageSelector';
import { useAccusourceCatalog } from '../../../hooks/useAccusourceCatalog';
import { fetchMergedScreeningPackageForCandidate } from '../../../utils/screeningPackageDefaultsLoader';
import { formatFirebaseHttpsError } from '../../../utils/firebaseHttpsErrors';
import {
  computePackageRollup,
  PACKAGE_ROLLUP_LABEL,
  PACKAGE_ROLLUP_COLOR,
} from '../../../utils/accusourceVerdictBands';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import { useAuth } from '../../../contexts/AuthContext';
import {
  deriveC1EntityKeyFromEntityName,
  filterEverifyCasesForSelectUi,
  resolveC1SelectEntityId,
} from '../../../utils/c1EntityWorkAuthorizationUi';
import { backgroundComplianceScreeningRowElementId } from '../../../utils/employmentOnboardingPath';
import { normalizeUserDocumentDobToYyyyMmDd } from '../../../utils/userProfileDob';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
import {
  canAccusourceAdminFromUserDoc,
  canManageEverifyFromClaims,
  evaluateScreeningSatisfied,
  normalizeEverifyRow,
  normalizeScreeningRow,
  type ScreeningPackageMergeResult,
} from './backgroundsComplianceModel';
import { EVERIFY_SELECT_PERM_HINT } from './StartEverifySelectDialog';
// import I9SupportingDocumentsSection from '../../../components/i9SupportingDocuments/I9SupportingDocumentsSection';
import ProfileTabPointerAlert from '../../../components/profile/ProfileTabPointerAlert';
import AccusourceApplicantSetupPanel from '../../../components/recruiter/AccusourceApplicantSetupPanel';
import { resolveApplicantPortalUrl } from '../../../utils/backgroundCheckApplicantPortal';
import AccusourceOrderServiceLinesTable from './AccusourceOrderServiceLinesTable';
import AdjudicationCaseSection from '../../../components/compliance/AdjudicationCaseSection';

const PAGE_LIMIT = 100;

const everifyCasesCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'everify_cases');
const userEmploymentsCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'user_employments');

const everifyRetryCase = httpsCallable(functions, 'everifyRetryCase');
const createAccusourceBackgroundCheck = httpsCallable(functions, 'createAccusourceBackgroundCheck');
const markAccusourceBackgroundCheckCompleteOutside = httpsCallable(
  functions,
  'markAccusourceBackgroundCheckCompleteOutside',
);
const getAccusourcePdf = httpsCallable(functions, 'getAccusourceBackgroundCheckPdf');
const setAccusourceLineAdjudicationCallable = httpsCallable(
  functions,
  'setAccusourceLineAdjudication',
);
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

export interface BackgroundsComplianceTabProps {
  uid: string;
  tenantId: string | null;
  /** When set (e.g. from staff onboarding queue deep link), row scrolls into view and is highlighted briefly. */
  highlightScreeningRowId?: string | null;
  /** Worker self: jump to Employment for payroll / I-9 ownership. */
  onNavigateToProfileTab?: (tabLabel: string) => void;
}

const ACCUSOURCE_PERM_HINT =
  'AccuSource requires security level ≥ 5 or admin/manager role for this tenant (same as System Access tab).';

const BackgroundsComplianceTab: React.FC<BackgroundsComplianceTabProps> = ({
  uid,
  tenantId,
  highlightScreeningRowId = null,
  onNavigateToProfileTab,
}) => {
  const {
    user,
    isHRX,
    claimsRoles,
    tenantRolesFromProfile,
    legacyUserSecurityLevel,
    legacyUserRole,
  } = useAuth();
  const [viewerUserDoc, setViewerUserDoc] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [everifyRows, setEverifyRows] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [screeningRows, setScreeningRows] = useState<BackgroundCheckRecord[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  /** tenants/…/entities/{id}.name for E-Verify row filtering (Select-only). */
  const [entityNameById, setEntityNameById] = useState<Record<string, string>>({});
  /** Id + name + entityCode for resolveC1SelectEntityId (C1SL code match). */
  const [tenantEntitiesBrief, setTenantEntitiesBrief] = useState<
    Array<{ id: string; name: string; entityCode: string }>
  >([]);
  const [userEmploymentsSnapshot, setUserEmploymentsSnapshot] = useState<
    Array<{ id: string; entityId: string; i9Status: string }>
  >([]);

  const [bgModalOpen, setBgModalOpen] = useState(false);
  /**
   * `order` = real AccuSource order (calls `createAccusourceBackgroundCheck`).
   * `mark-complete` = back-fill a pre-completed row for screenings done outside HRX
   *   (calls `markAccusourceBackgroundCheckCompleteOutside`). Same modal, different
   *   title + submit label + backend callable.
   */
  const [screeningMode, setScreeningMode] = useState<'order' | 'mark-complete'>('order');
  // Pass/Fail when marking a screening complete outside HRX (Phase 4).
  const [markCompleteVerdict, setMarkCompleteVerdict] = useState<'PASSED' | 'FAILED'>('PASSED');

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
  /** Duplicate guard pause: the server refused because the worker's prior
   *  screenings already cover the request — either the WHOLE package
   *  ('package') or individual items shared across packages ('items', e.g.
   *  a 4 Panel Quick Test passed inside a different package). Holds what
   *  the recruiter needs to decide: order just the newly needed items
   *  à-la-carte, or knowingly "Order anyway". */
  const [duplicateSatisfied, setDuplicateSatisfied] = useState<
    | { kind: 'package'; backgroundCheckId: string; packageLabel: string | null }
    | { kind: 'items'; alreadyPassed: string[]; newlyNeeded: string[] }
    | null
  >(null);

  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [adjudicationLoadingKey, setAdjudicationLoadingKey] = useState<string | null>(null);
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

  const canAccusourceAdmin = useMemo(() => {
    if (viewerUserDoc === undefined) return false;
    return canAccusourceAdminFromUserDoc(viewerUserDoc, tenantId);
  }, [viewerUserDoc, tenantId]);

  const viewerIsProfileSubject = Boolean(user?.uid && uid && user.uid === uid);
  const showEmploymentPointer =
    viewerIsProfileSubject && Boolean(onNavigateToProfileTab) && userEmploymentsSnapshot.length > 0;

  const previewPackageNotInCatalog = useMemo(() => {
    const id = resolvedPreview?.merged.packageId?.trim();
    if (!id || !accusourceCatalog?.packages?.length) return false;
    return !accusourceCatalog.packages.some((pkg) => pkg.id === id);
  }, [resolvedPreview, accusourceCatalog]);

  const loadAll = useCallback(async () => {
    if (!tenantId || !uid) {
      setEverifyRows([]);
      setScreeningRows([]);
      setEntityNameById({});
      setTenantEntitiesBrief([]);
      setUserEmploymentsSnapshot([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [evSnap, bgSnap, empSnap, entSnap] = await Promise.all([
        getDocs(query(everifyCasesCol(tenantId), where('userId', '==', uid))),
        getDocs(
          query(
            collection(db, 'backgroundChecks'),
            where('candidateId', '==', uid),
            where('tenantId', '==', tenantId),
            limit(PAGE_LIMIT)
          )
        ),
        getDocs(query(userEmploymentsCol(tenantId), where('userId', '==', uid))),
        getDocs(collection(db, 'tenants', tenantId, 'entities')),
      ]);
      const names: Record<string, string> = {};
      const brief: Array<{ id: string; name: string; entityCode: string }> = [];
      entSnap.docs.forEach((d) => {
        const data = d.data() as { name?: string; entityCode?: string };
        const name = String(data.name || d.id);
        names[d.id] = name;
        brief.push({ id: d.id, name, entityCode: String(data.entityCode || '') });
      });
      setEntityNameById(names);
      setTenantEntitiesBrief(brief);
      setUserEmploymentsSnapshot(
        empSnap.docs.map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            entityId: String(raw.entityId || ''),
            i9Status: String(raw.i9Status || '—'),
          };
        })
      );
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
      setEntityNameById({});
      setTenantEntitiesBrief([]);
      setUserEmploymentsSnapshot([]);
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

  const selectEntityIdResolved = useMemo(() => resolveC1SelectEntityId(tenantEntitiesBrief), [tenantEntitiesBrief]);

  const selectEverifyRows = useMemo(
    () => filterEverifyCasesForSelectUi(everifyRows, new Map(Object.entries(entityNameById))),
    [everifyRows, entityNameById]
  );

  const hiddenEverifyCount = everifyRows.length - selectEverifyRows.length;

  const workforceI9Employments = useMemo(() => {
    return userEmploymentsSnapshot.filter((e) => {
      if (!e.entityId) return false;
      const n = entityNameById[e.entityId] || '';
      return deriveC1EntityKeyFromEntityName(n) === 'workforce';
    });
  }, [userEmploymentsSnapshot, entityNameById]);

  const selectI9Employment = useMemo(() => {
    if (!selectEntityIdResolved) return null;
    return userEmploymentsSnapshot.find((e) => e.entityId === selectEntityIdResolved) ?? null;
  }, [userEmploymentsSnapshot, selectEntityIdResolved]);

  const normalizedRows = useMemo(() => {
    const ev = selectEverifyRows.map(({ id, data }) => normalizeEverifyRow(id, data));
    const bg = screeningRows.map(normalizeScreeningRow);
    return [...ev, ...bg];
  }, [selectEverifyRows, screeningRows]);

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
    setDuplicateSatisfied(null);
    setScreeningMode('order');
    setBgModalOpen(true);
    await loadProfileForScreening();
  };

  /**
   * Opens the same modal but puts it in "mark complete outside HRX" mode.
   * The recruiter picks the package that was actually run in AccuSource and
   * submits — we write a pre-completed `backgroundChecks/{id}` doc (no call
   * to AccuSource). Used for the 200+ workers who were entered in AccuSource
   * before the API integration came online.
   */
  const openMarkAsCompleteModal = async () => {
    setBgMessage(null);
    setBgMessageSeverity('error');
    setBgNotes('');
    setSelectedServiceIds([]);
    setScreeningMode('mark-complete');
    setBgModalOpen(true);
    await loadProfileForScreening();
  };

  const submitScreening = async (allowDuplicateOfSatisfied = false) => {
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
    if (allowDuplicateOfSatisfied) setDuplicateSatisfied(null);
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
      const dobForOrder = normalizeUserDocumentDobToYyyyMmDd(profileUser.dateOfBirth ?? profileUser.dob);
      if (!dobForOrder) {
        setBgMessage(
          'AccuSource requires a valid date of birth (MM/DD/YYYY once sent). Add date of birth on this worker’s Profile → Overview, then retry.'
        );
        setBgSubmitting(false);
        return;
      }
      if (!String(profileUser.email || '').trim()) {
        setBgMessage('AccuSource requires a work email on the worker profile.');
        setBgSubmitting(false);
        return;
      }
      const services = selectedServiceIds;
      const selectedPkg = accusourceCatalog?.packages?.find((p) => String(p.id) === String(pkgId).trim());
      const requestedServicesCatalog =
        selectedPkg?.services?.filter((s) => services.includes(String(s.id))) ?? [];
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
        requestedServicesCatalog:
          requestedServicesCatalog.length > 0
            ? requestedServicesCatalog.map((s) => ({
                id: String(s.id),
                name: String(s.name || s.id),
                type: s.type != null ? String(s.type) : undefined,
              }))
            : undefined,
        candidate: {
          firstName: String(profileUser.firstName || ''),
          lastName: String(profileUser.lastName || ''),
          email: String(profileUser.email || ''),
          phone: String(profileUser.phone || profileUser.phoneE164 || ''),
          dateOfBirth: dobForOrder,
        },
        ...(allowDuplicateOfSatisfied ? { allowDuplicateOfSatisfied: true } : {}),
      });
      setDuplicateSatisfied(null);
      if (bgNotes.trim()) {
        await logCustomActivity(uid, 'screening_order_requested', bgNotes.trim(), 'medium');
      }
      setBgModalOpen(false);
      await loadAll();
    } catch (e: unknown) {
      const err = e as {
        message?: string;
        details?: {
          code?: string;
          backgroundCheckId?: string;
          packageLabel?: string | null;
          alreadyPassed?: string[];
          newlyNeeded?: string[];
        };
      };
      // Duplicate guard pause — the worker's prior screenings already cover
      // this request (whole package, or overlapping items shared across
      // packages). Surface it as a warning with an explicit "Order anyway"
      // path instead of a generic failure.
      if (err.details?.code === 'screening_already_satisfied') {
        setDuplicateSatisfied({
          kind: 'package',
          backgroundCheckId: String(err.details.backgroundCheckId || ''),
          packageLabel: err.details.packageLabel ?? null,
        });
        return;
      }
      if (err.details?.code === 'screening_items_already_passed') {
        setDuplicateSatisfied({
          kind: 'items',
          alreadyPassed: Array.isArray(err.details.alreadyPassed) ? err.details.alreadyPassed : [],
          newlyNeeded: Array.isArray(err.details.newlyNeeded) ? err.details.newlyNeeded : [],
        });
        return;
      }
      setBgMessageSeverity('error');
      setBgMessage(err.message || 'Failed to order screening');
    } finally {
      setBgSubmitting(false);
    }
  };

  /**
   * Phase 2 — re-order a SINGLE service line (e.g. a canceled/expired drug
   * screen) as an à-la-carte AccuSource order, without re-ordering the whole
   * package. Reuses the same candidate context as a fresh order; inherits the
   * original record's account/JO when present.
   */
  const handleReorderLine = async (
    rec: BackgroundCheckRecord,
    line: AccusourceScreeningLineItem,
  ): Promise<void> => {
    const serviceId = String(line.id || '').trim();
    if (!serviceId || !tenantId || !profileUser) return;
    const dobForOrder = normalizeUserDocumentDobToYyyyMmDd(profileUser.dateOfBirth ?? profileUser.dob);
    if (!dobForOrder) {
      setBgMessageSeverity('error');
      setBgMessage('AccuSource requires a valid date of birth. Add it on this worker’s Profile → Overview, then retry.');
      return;
    }
    if (!String(profileUser.email || '').trim()) {
      setBgMessageSeverity('error');
      setBgMessage('AccuSource requires a work email on the worker profile.');
      return;
    }
    const ok = window.confirm(
      `Re-order "${line.name}" only?\n\nThis places a NEW à-la-carte AccuSource order for just this screen (not the whole package). The previous result stays on record until the new one comes back.`,
    );
    if (!ok) return;
    const recAny = rec as unknown as Record<string, unknown>;
    try {
      await createAccusourceBackgroundCheck({
        tenantId,
        candidateId: uid,
        candidateName:
          [profileUser.firstName, profileUser.lastName].filter(Boolean).join(' ') ||
          String(profileUser.email || ''),
        accountId: String(recAny.accountId || '') || defaultAccountId || undefined,
        accountName: String(recAny.accountName || '') || defaultAccountName || undefined,
        jobOrderId: String(recAny.jobOrderId || '') || defaultJobOrderId || undefined,
        worksiteId: String(recAny.worksiteId || '') || defaultWorksiteId || undefined,
        // À-la-carte: single service, no package. The recruiter already
        // confirmed this is a deliberate RE-order of this exact line, so the
        // duplicate guard is bypassed.
        allowDuplicateOfSatisfied: true,
        requestedServices: [serviceId],
        requestedServicesCatalog: [
          { id: serviceId, name: String(line.name || serviceId), type: line.type != null ? String(line.type) : undefined },
        ],
        candidate: {
          firstName: String(profileUser.firstName || ''),
          lastName: String(profileUser.lastName || ''),
          email: String(profileUser.email || ''),
          phone: String(profileUser.phone || profileUser.phoneE164 || ''),
          dateOfBirth: dobForOrder,
        },
      });
      await logCustomActivity(uid, 'screening_line_reordered', `Re-ordered ${line.name}`, 'medium');
      await loadAll();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setBgMessageSeverity('error');
      setBgMessage(err.message || 'Failed to re-order screening line');
    }
  };

  /**
   * Back-fill path: the recruiter is telling us this screening was already
   * completed outside HRX (in the AccuSource portal, before the API integration
   * worked). We call the companion callable which writes a pre-completed
   * `backgroundChecks/{id}` doc: hrxStatus='completed', every requested service
   * marked PASSED. The existing readiness-sync trigger clears the screening
   * blocker automatically from there. No call to AccuSource is made.
   */
  const submitMarkAsComplete = async () => {
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
        setBgMessage('Select the package that was actually run in AccuSource.');
        setBgSubmitting(false);
        return;
      }
      const services = selectedServiceIds;
      const selectedPkg = accusourceCatalog?.packages?.find((p) => String(p.id) === String(pkgId).trim());
      const requestedServicesCatalog =
        selectedPkg?.services?.filter((s) => services.includes(String(s.id))) ?? [];
      await markAccusourceBackgroundCheckCompleteOutside({
        tenantId,
        candidateId: uid,
        candidateName:
          [profileUser.firstName, profileUser.lastName].filter(Boolean).join(' ') ||
          String(profileUser.email || ''),
        accountId: defaultAccountId || undefined,
        accountName: defaultAccountName || undefined,
        jobOrderId: defaultJobOrderId || undefined,
        worksiteId: defaultWorksiteId || undefined,
        requestedPackageId: pkgId || undefined,
        requestedPackageName: pkgName || undefined,
        requestedServices: services,
        requestedServicesCatalog:
          requestedServicesCatalog.length > 0
            ? requestedServicesCatalog.map((s) => ({
                id: String(s.id),
                name: String(s.name || s.id),
                type: s.type != null ? String(s.type) : undefined,
              }))
            : undefined,
        notes: bgNotes.trim() || undefined,
        verdict: markCompleteVerdict,
      });
      if (bgNotes.trim()) {
        await logCustomActivity(
          uid,
          'screening_marked_complete_outside_hrx',
          bgNotes.trim(),
          'medium',
        );
      }
      setBgModalOpen(false);
      await loadAll();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setBgMessageSeverity('error');
      setBgMessage(err.message || 'Failed to mark screening complete');
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
    // Synchronously open a blank tab on click so popup blockers (esp. Safari) treat this as a
    // user gesture. Intentionally OMIT `noopener` here — per spec that returns `null` from
    // `window.open`, leaving us without a handle to navigate to the blob URL after the await.
    const popup = window.open('', '_blank');
    if (popup) {
      try {
        popup.document.title = 'Loading PDF…';
        popup.document.body.style.font = '14px system-ui, sans-serif';
        popup.document.body.style.padding = '24px';
        popup.document.body.textContent = 'Loading PDF…';
      } catch {
        /* about:blank doc may be locked down in some browsers; ignore. */
      }
    }
    setPdfLoading(`${backgroundCheckId}-${kind}`);
    try {
      // Server contract (see `functions/.../getAccusourceBackgroundCheckPdf.ts`):
      // `{ pdfBase64, mimeType, kind, profileId }` — NOT `{ url }`. Older builds of this handler
      // destructured `url`, which silently swallowed the response.
      const res = (await getAccusourcePdf({ backgroundCheckId, kind })) as {
        data?: {
          pdfBase64?: string;
          mimeType?: string;
          // Legacy / alternate shapes kept for forward-compat with any server swap.
          url?: string;
          base64?: string;
        };
      };
      const payload = res.data ?? {};
      const directUrl = payload.url;
      const base64 = payload.pdfBase64 ?? payload.base64;
      const mimeType = payload.mimeType ?? 'application/pdf';

      let objectUrl: string | null = null;
      let targetUrl: string | null = null;
      if (directUrl) {
        targetUrl = directUrl;
      } else if (base64) {
        // Decode base64 → Uint8Array → Blob → object URL. No `atob(...).split('')` shortcut so we
        // handle the full byte range correctly.
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });
        objectUrl = URL.createObjectURL(blob);
        targetUrl = objectUrl;
      }

      if (!targetUrl) {
        if (popup && !popup.closed) popup.close();
        setBgMessageSeverity('error');
        setBgMessage('PDF callable returned no content. Check SourceDirect profile status.');
        return;
      }

      const filename = `${backgroundCheckId}-${kind}.pdf`;
      let navigated = false;
      if (popup && !popup.closed) {
        try {
          popup.location.replace(targetUrl);
          navigated = true;
        } catch {
          /* Cross-origin or sandboxed popup — fall through to anchor fallback. */
        }
      }

      if (!navigated) {
        // Popup blocked or unable to navigate — trigger a download/new-tab via anchor element.
        const a = document.createElement('a');
        a.href = targetUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        // `download` only works for blob/same-origin URLs; for direct cross-origin URLs the
        // browser will navigate to it in the new tab instead, which is the desired fallback.
        if (objectUrl) a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      // Revoke the object URL after the new tab has had time to load the PDF.
      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl as string), 60_000);
      }
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setBgMessageSeverity('error');
      setBgMessage(`Failed to open PDF: ${formatFirebaseHttpsError(err)}`);
    } finally {
      setPdfLoading(null);
    }
  };

  const setLineAdjudication = async (
    backgroundCheckId: string,
    serviceKey: string,
    verdict: 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | null,
    reason: string | null,
  ) => {
    if (!canAccusourceAdmin) {
      setBgMessageSeverity('error');
      setBgMessage(ACCUSOURCE_PERM_HINT);
      return;
    }
    const key = `${backgroundCheckId}::${serviceKey}`;
    setAdjudicationLoadingKey(key);
    try {
      await setAccusourceLineAdjudicationCallable({
        backgroundCheckId,
        serviceKey,
        verdict,
        reason,
      });
      // Firestore snapshot subscriptions keep the table in sync; show a lightweight confirmation.
      setBgMessageSeverity('warning');
      setBgMessage(
        verdict === null
          ? 'Reverted line to system verdict.'
          : `Line marked as ${verdict === 'PASSED' ? 'Passed' : verdict === 'FAILED' ? 'Failed' : 'Needs review'}.`,
      );
    } catch (err) {
      setBgMessageSeverity('error');
      setBgMessage(`Failed to update verdict: ${formatFirebaseHttpsError(err)}`);
      throw err;
    } finally {
      setAdjudicationLoadingKey(null);
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
    <Stack spacing={2}>
      {showEmploymentPointer && onNavigateToProfileTab ? (
        <ProfileTabPointerAlert
          message="Payroll setup and I-9 documents are in Employment."
          onNavigate={() => onNavigateToProfileTab('Employment')}
        />
      ) : null}
      {/* Screening tab intro + I-9 supporting documents card (disabled).
      <Alert severity="info" variant="outlined">
        <Typography variant="body2" component="div" sx={{ lineHeight: 1.45 }}>
          This tab is the <strong>screening record</strong> surface (orders, PDFs, E-Verify / I-9 context). It does not
          drive assignment readiness — use <strong>Assignments</strong> for per-placement readiness, blockers, and actions.
        </Typography>
      </Alert>
      <Typography variant="subtitle2" color="text.secondary">
        <strong>C1 Select</strong> work authorization (I-9 + E-Verify), <strong>C1 Workforce</strong> I-9 status, and
        AccuSource screening rows. E-Verify cases tied to non-Select entities are hidden here (fix <code>entityId</code>{' '}
        on the case if needed). Data loads from Firestore; actions use server functions only.
      </Typography>

      {!viewerIsProfileSubject ? (
        <Typography variant="caption" color="text.secondary" display="block">
          Primary I-9 supporting document requests and uploads live on the <strong>Employment</strong> tab. This section is
          the full audit trail and review surface.
        </Typography>
      ) : null}

      {!viewerIsProfileSubject ? (
        <I9SupportingDocumentsSection tenantId={tenantId} workerUserId={uid} />
      ) : null}
      */}

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 1. Actions (Compliance summary card removed; Order Screening + Refresh kept at top) */}
      <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" flexWrap="wrap" gap={0.5} alignItems="center">
          <Tooltip title={!canAccusourceAdmin ? ACCUSOURCE_PERM_HINT : 'Order a new screening'}>
            <span>
              <Button
                variant="text"
                size="small"
                onClick={openScreeningModal}
                disabled={!canAccusourceAdmin}
                sx={{ textTransform: 'none' }}
              >
                Order screening
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              !canAccusourceAdmin
                ? ACCUSOURCE_PERM_HINT
                : 'For workers whose screening was already run in AccuSource before we had the API wired up — writes a pre-completed record so blockers clear.'
            }
          >
            <span>
              <Button
                variant="text"
                size="small"
                onClick={openMarkAsCompleteModal}
                disabled={!canAccusourceAdmin}
                sx={{ textTransform: 'none' }}
              >
                Completed Outside of HRX
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Refresh status">
            <span>
              <IconButton size="small" onClick={() => loadAll()} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Last updated: {lastRefresh ? lastRefresh.toLocaleString() : '—'}
        </Typography>
      </Stack>

      {/* Default screening package (resolved) card — commented out per UI cleanup.
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
      */}

      {/* 2. Table */}
      <Paper variant="outlined" sx={{ p: 0, maxWidth: '100%', minWidth: 0 }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            Active orders & compliance items
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            E-Verify rows are <strong>C1 Select</strong> only. Screenings (AccuSource) apply per job/account rules.
          </Typography>
        </Box>
        <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
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
              {selectEverifyRows.length === 0 && screeningRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant="body2" color="text.secondary">
                      No C1 Select E-Verify cases or screening orders for this worker yet.
                      {hiddenEverifyCount > 0
                        ? ' Other E-Verify cases exist but are hidden until linked to C1 Select (see note above).'
                        : ''}
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
                      <TableCell>
                        E-Verify
                        <Typography variant="caption" display="block" color="text.secondary">
                          C1 Select
                        </Typography>
                      </TableCell>
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
                          <Tooltip title={!canManageEverify ? EVERIFY_SELECT_PERM_HINT : ''}>
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
                const applicantPortalResolved = resolveApplicantPortalUrl(r);
                const rowDomId = backgroundComplianceScreeningRowElementId(r.id);
                const rowHighlighted = Boolean(highlightScreeningRowId && highlightScreeningRowId === r.id);
                return (
                  <React.Fragment key={row.key}>
                    <TableRow
                      id={rowDomId}
                      sx={
                        rowHighlighted
                          ? {
                              outline: '2px solid',
                              outlineColor: 'primary.main',
                              outlineOffset: -2,
                              bgcolor: 'action.selected',
                              transition: 'background-color 0.2s ease',
                            }
                          : undefined
                      }
                    >
                      <TableCell>
                        Background
                        {row.drugReportReady && (
                          <Typography component="span" variant="caption" display="block" color="text.secondary">
                            (+ drug component)
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
                          <span>{row.packageLabel}</span>
                          {(() => {
                            // Package-level rollup: one verdict for the whole
                            // package (e.g. "CORT Basic · Cleared / Action needed").
                            // markedCompleteOutsideHrx forces Cleared (manual
                            // pass) unless a line is hard-FAILED.
                            const lines = row.screeningServiceLines ?? [];
                            let rollup = computePackageRollup(lines);
                            if (r.markedCompleteOutsideHrx === true && rollup !== 'FAILED') {
                              rollup = 'CLEARED';
                            }
                            if (rollup === 'NONE') return null;
                            return (
                              <Chip
                                size="small"
                                color={PACKAGE_ROLLUP_COLOR[rollup]}
                                label={PACKAGE_ROLLUP_LABEL[rollup]}
                                variant={rollup === 'CLEARED' ? 'filled' : 'outlined'}
                                sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }}
                              />
                            );
                          })()}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.statusPrimary}</Typography>
                        {row.statusSecondary ? (
                          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                            {row.statusSecondary}
                          </Typography>
                        ) : null}
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
                        {applicantPortalResolved ? (
                          <Link href={applicantPortalResolved} target="_blank" rel="noopener noreferrer">
                            Portal
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {row.screeningServiceLines && row.screeningServiceLines.length > 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          sx={{
                            p: 0,
                            pl: 0,
                            borderLeft: '4px solid',
                            borderColor: 'divider',
                            bgcolor: 'grey.50',
                            verticalAlign: 'top',
                          }}
                        >
                          <AccusourceOrderServiceLinesTable
                            record={r}
                            onOpenFinalPdf={(id) => openPdf(id, 'final')}
                            pdfLoading={pdfLoading}
                            canAccusourceAdmin={canAccusourceAdmin}
                            onSetAdjudication={setLineAdjudication}
                            adjudicationLoadingKey={adjudicationLoadingKey}
                            onReorderLine={canAccusourceAdmin ? (line) => void handleReorderLine(r, line) : undefined}
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {/* Adjudication case (P2, policy §5-§7): entry point +
                        case panel for reports needing compliance review. */}
                    {(() => {
                      const lines = row.screeningServiceLines ?? [];
                      let caseRollup = computePackageRollup(lines);
                      if (r.markedCompleteOutsideHrx === true && caseRollup !== 'FAILED') {
                        caseRollup = 'CLEARED';
                      }
                      const show =
                        caseRollup === 'ACTION_NEEDED' ||
                        caseRollup === 'FAILED' ||
                        Boolean((r as any).adjudicationCaseId);
                      if (!show) return null;
                      return (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            sx={{ py: 1, px: 2, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}
                          >
                            <AdjudicationCaseSection
                              record={r as any}
                              canAccusourceAdmin={canAccusourceAdmin}
                              rollup={caseRollup}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })()}
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        sx={{
                          py: 1.5,
                          px: 2,
                          bgcolor: 'grey.50',
                          borderBottom: 1,
                          borderColor: 'divider',
                          verticalAlign: 'top',
                        }}
                      >
                        <AccusourceApplicantSetupPanel record={r} />
                      </TableCell>
                    </TableRow>
                    {canAccusourceAdmin ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          sx={{
                            py: 1,
                            px: 2,
                            bgcolor: 'action.hover',
                            borderBottom: 1,
                            borderColor: 'divider',
                            verticalAlign: 'top',
                          }}
                        >
                          <AccusourceScreeningDebugSection record={r} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 3B Screening modal — dual-mode: "order" (live AccuSource order) vs
            "mark-complete" (back-fill for screenings done outside HRX). */}
      <Dialog open={bgModalOpen} onClose={() => setBgModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {screeningMode === 'mark-complete'
            ? 'Mark screening complete (outside HRX)'
            : 'Order screening (AccuSource)'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {screeningMode === 'mark-complete' && (
              <>
                <Alert severity={markCompleteVerdict === 'FAILED' ? 'warning' : 'info'}>
                  This records a screening that was already run outside HRX (e.g. in the AccuSource
                  portal). No request is sent to AccuSource — we write a pre-completed record.
                  {markCompleteVerdict === 'FAILED'
                    ? ' Marked FAILED: the package shows Failed and the worker is NOT cleared.'
                    : ' Marked PASSED: the package shows Cleared and readiness blockers clear.'}
                </Alert>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Outcome
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant={markCompleteVerdict === 'PASSED' ? 'contained' : 'outlined'}
                      color="success"
                      onClick={() => setMarkCompleteVerdict('PASSED')}
                    >
                      Passed
                    </Button>
                    <Button
                      size="small"
                      variant={markCompleteVerdict === 'FAILED' ? 'contained' : 'outlined'}
                      color="error"
                      onClick={() => setMarkCompleteVerdict('FAILED')}
                    >
                      Failed
                    </Button>
                  </Stack>
                </Box>
              </>
            )}
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
            {/* Duplicate guard pause — server refused the order because a
                completed screening already satisfies this package. Requires
                an explicit "Order anyway" to place a duplicate. */}
            {duplicateSatisfied && (
              <Alert
                severity="warning"
                onClose={() => setDuplicateSatisfied(null)}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    disabled={bgSubmitting}
                    onClick={() => void submitScreening(true)}
                  >
                    Order anyway
                  </Button>
                }
              >
                {duplicateSatisfied.kind === 'package' ? (
                  <>
                    {pkgName || 'This package'} is already satisfied by a completed screening on
                    this worker
                    {duplicateSatisfied.packageLabel
                      ? ` (${duplicateSatisfied.packageLabel})`
                      : ''}{' '}
                    — order {duplicateSatisfied.backgroundCheckId}. No new order was placed. Only
                    order again if the account explicitly requires a fresh screening.
                  </>
                ) : (
                  <>
                    Already passed on this worker: {duplicateSatisfied.alreadyPassed.join(', ')}.
                    {duplicateSatisfied.newlyNeeded.length > 0 ? (
                      <>
                        {' '}
                        Newly needed from this package:{' '}
                        <strong>{duplicateSatisfied.newlyNeeded.join(', ')}</strong> — consider
                        ordering just those à-la-carte instead of the full package.
                      </>
                    ) : (
                      <> Every item in this package is already covered.</>
                    )}{' '}
                    No new order was placed.
                  </>
                )}
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
              Already satisfied — ordering the same package again pauses with an "Order anyway"
              override (completed / report-ready, package match, within the validity window)
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
          <Button
            variant="contained"
            onClick={() =>
              // NOTE: submitScreening takes an optional override flag — never
              // pass it the click event or the duplicate guard gets bypassed.
              screeningMode === 'mark-complete' ? submitMarkAsComplete() : submitScreening()
            }
            disabled={bgSubmitting || !canAccusourceAdmin}
          >
            {bgSubmitting ? (
              <CircularProgress size={22} />
            ) : screeningMode === 'mark-complete' ? (
              'Mark as Complete'
            ) : (
              'Submit order'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default BackgroundsComplianceTab;

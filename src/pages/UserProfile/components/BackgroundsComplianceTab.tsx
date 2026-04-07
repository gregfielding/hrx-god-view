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
import GavelIcon from '@mui/icons-material/Gavel';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
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
  buildComplianceSummary,
  canAccusourceAdminFromUserDoc,
  canManageEverifyFromClaims,
  evaluateScreeningSatisfied,
  normalizeEverifyRow,
  normalizeScreeningRow,
  statusToneFromStatusString,
  type ScreeningPackageMergeResult,
} from './backgroundsComplianceModel';
import { EVERIFY_SELECT_PERM_HINT } from './StartEverifySelectDialog';
import I9SupportingDocumentsSection from '../../../components/i9SupportingDocuments/I9SupportingDocumentsSection';
import ProfileTabPointerAlert from '../../../components/profile/ProfileTabPointerAlert';

const PAGE_LIMIT = 100;

const everifyCasesCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'everify_cases');
const userEmploymentsCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'user_employments');

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
  const { user, isHRX, claimsRoles } = useAuth();
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

  const summary = useMemo(
    () => buildComplianceSummary(selectEverifyRows, screeningRows),
    [selectEverifyRows, screeningRows]
  );

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
    setBgModalOpen(true);
    await loadProfileForScreening();
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
          dateOfBirth: dobForOrder,
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
      {showEmploymentPointer && onNavigateToProfileTab ? (
        <ProfileTabPointerAlert
          message="Payroll setup and I-9 documents are in Employment."
          onNavigate={() => onNavigateToProfileTab('Employment')}
        />
      ) : null}
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
        {hiddenEverifyCount > 0 && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {hiddenEverifyCount} E-Verify case(s) on file are not shown because they are not linked to a <strong>C1 Select</strong> hiring entity
            (check <code>everify_cases.entityId</code>).
          </Alert>
        )}
        {(selectI9Employment || workforceI9Employments.length > 0) && (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {selectI9Employment && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  Work authorization — C1 Select (I-9)
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                  <Chip size="small" variant="outlined" label={`I-9: ${selectI9Employment.i9Status || '—'}`} />
                </Stack>
              </Box>
            )}
            {workforceI9Employments.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  Work authorization — C1 Workforce (I-9 only)
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                  {workforceI9Employments.map((e) => (
                    <Chip
                      key={e.id}
                      size="small"
                      variant="outlined"
                      label={`I-9: ${e.i9Status || '—'} (${entityNameById[e.entityId] || e.entityId})`}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5, mb: 1 }}>
          <Chip
            size="small"
            label={`Select — E-Verify: ${summary.evStatusLabel}`}
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
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            E-Verify rows are <strong>C1 Select</strong> only. Screenings (AccuSource) apply per job/account rules.
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

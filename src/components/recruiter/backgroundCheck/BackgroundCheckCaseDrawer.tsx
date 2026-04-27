/**
 * **R.6** — `BackgroundCheckCaseDrawer`
 *
 * Single, right-anchored MUI Drawer (mirrors R.5 `EverifyCaseDrawer`)
 * used everywhere recruiters need to inspect / act on an AccuSource
 * background check case:
 *   - `ProfileReadinessTabContent` — auto-opens via the URL deep-link
 *     `?tab=readiness&type=background_check&caseId=…` (R.4 chip drill-in
 *     + R.6 plumbing on `background_check` / `drug_screen` items), and
 *     from the new "Adjudicate" banner button when a screening line
 *     needs review.
 *   - Future: `BackgroundsComplianceTab` line table can also open this
 *     drawer for a single shared adjudication surface.
 *
 * Single source of truth for case-level adjudication (Master Plan §4.7):
 * lists every service line, lets a recruiter override Pass / Fail /
 * Needs-review per line, and surfaces a flattened audit trail across
 * every line's `adjudication.history[]`.
 *
 * Permission gating is the caller's job — we still defensively gate the
 * write controls behind `canManage`. Backend re-checks via
 * `ensureAccusourceAdmin` (admin/super_admin/manager OR security level
 * ≥5) on every callable.
 *
 * What this component *does not* do:
 *   - Place new orders — that's `BackgroundsComplianceTab`'s job.
 *   - Generate the AccuSource final PDF — the existing
 *     `getAccusourceBackgroundCheckPdf` callable lives on the parent
 *     screening table; we only deep-link to the per-line `reportUrl`s
 *     when the vendor sent them.
 *
 * @see ./openMarkClearedViaPriorCheckDialog — separate "Mark cleared via
 *      prior check" path (creates a synthetic completed `backgroundChecks`
 *      doc via `markAccusourceBackgroundCheckCompleteOutside`).
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
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RestoreIcon from '@mui/icons-material/Restore';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { accusourceScreeningLineItems } from '../../../utils/accusourceScreeningLineItems';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import type {
  AccusourceAdjudicationHistoryEntry,
  AccusourceLineVerdict,
  AccusourceManualVerdict,
  BackgroundCheckRecord,
} from '../../../types/backgroundCheck';

const HRX_STATUS_PALETTE: Record<
  string,
  { color: 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'; label: string }
> = {
  draft: { color: 'default', label: 'Draft' },
  queued: { color: 'default', label: 'Queued' },
  submitted: { color: 'info', label: 'Submitted' },
  awaiting_applicant: { color: 'warning', label: 'Awaiting applicant' },
  in_progress: { color: 'primary', label: 'In progress' },
  report_ready: { color: 'success', label: 'Report ready' },
  drug_report_ready: { color: 'success', label: 'Drug report ready' },
  completed: { color: 'success', label: 'Completed' },
  canceled: { color: 'default', label: 'Canceled' },
  error: { color: 'error', label: 'Error' },
};

function verdictChipColor(v: AccusourceLineVerdict): 'success' | 'error' | 'warning' | 'default' {
  if (v === 'PASSED') return 'success';
  if (v === 'FAILED') return 'error';
  if (v === 'NEEDS_REVIEW') return 'warning';
  return 'default';
}

function verdictChipLabel(v: AccusourceLineVerdict): string {
  if (v === 'PASSED') return 'Passed';
  if (v === 'FAILED') return 'Failed';
  if (v === 'NEEDS_REVIEW') return 'Needs review';
  return 'Waiting';
}

function statusChipColor(status: string): 'success' | 'primary' | 'warning' | 'default' {
  const s = (status || '').toLowerCase();
  if (s.includes('complete') || s.includes('closed') || s === 'pass' || s.includes('clear'))
    return 'success';
  if (s.includes('review') || s.includes('pending review') || s.includes('adjudicat'))
    return 'warning';
  if (s.includes('progress') || s.includes('pending') || s.includes('submitted') || s.includes('ordered'))
    return 'primary';
  return 'default';
}

/** Firestore Timestamp | ISO string | undefined → human label or em-dash. */
function formatTimestamp(v: unknown): string {
  if (!v) return '—';
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
  if (typeof v === 'object' && v !== null) {
    const t = v as { toMillis?: () => number; toDate?: () => Date };
    if (typeof t.toMillis === 'function') return new Date(t.toMillis()).toLocaleString();
    if (typeof t.toDate === 'function') {
      try {
        return t.toDate().toLocaleString();
      } catch {
        /* fall through */
      }
    }
  }
  return '—';
}

interface FlattenedHistoryEntry extends AccusourceAdjudicationHistoryEntry {
  /** Service line key (`providerServiceOrderStatus.{serviceKey}`). */
  serviceKey: string;
  /** Display name for the service line, falls back to the key. */
  serviceName: string;
  /** Numeric millis for stable sort. */
  atMs: number;
}

function historyEntryMs(entry: AccusourceAdjudicationHistoryEntry): number {
  const at = entry.at as unknown;
  if (at && typeof at === 'object') {
    const t = at as { toMillis?: () => number; toDate?: () => Date };
    if (typeof t.toMillis === 'function') {
      try {
        return t.toMillis();
      } catch {
        /* fall through */
      }
    }
    if (typeof t.toDate === 'function') {
      try {
        return t.toDate().getTime();
      } catch {
        /* fall through */
      }
    }
  }
  if (typeof at === 'string') {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

function flattenHistory(lines: AccusourceScreeningLineItem[]): FlattenedHistoryEntry[] {
  const flat: FlattenedHistoryEntry[] = [];
  for (const line of lines) {
    const history = line.adjudication?.history;
    if (!Array.isArray(history)) continue;
    for (const entry of history) {
      flat.push({
        ...entry,
        serviceKey: line.id,
        serviceName: line.name || line.id,
        atMs: historyEntryMs(entry),
      });
    }
  }
  // Newest first.
  flat.sort((a, b) => b.atMs - a.atMs);
  return flat;
}

function historyKindLabel(kind: AccusourceAdjudicationHistoryEntry['kind']): string {
  switch (kind) {
    case 'manual_override_set':
      return 'Override set';
    case 'manual_override_cleared':
      return 'Override cleared';
    case 'auto_verdict_changed':
      return 'Auto verdict changed';
    default:
      return String(kind);
  }
}

export interface BackgroundCheckCaseDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Tenant the worker belongs to. The drawer itself reads `backgroundChecks/{checkId}` (top-level), but we still gate the deep-link by tenant. */
  tenantId: string;
  /** `backgroundChecks/{checkId}` doc id. Required when `open === true`. */
  checkId: string | null;
  /**
   * `true` when the current viewer is allowed to set / clear adjudication
   * verdicts and "Mark cleared via prior check" — typically AccuSource
   * admin (security level ≥5 or role admin/super_admin/manager). When
   * `false` the drawer renders read-only — caller is responsible for the
   * actual permission check (backend re-verifies via `ensureAccusourceAdmin`).
   */
  canManage: boolean;
  /**
   * Optional snapshot to render before the live listener fires (avoids a
   * spinner flash when the caller already has the doc — e.g.
   * `BackgroundsComplianceTab` rows). The listener still attaches and
   * overrides this once Firestore responds.
   */
  initialCheck?: BackgroundCheckRecord | null;
  /** Fired after a successful adjudication / mark-complete action. */
  onActionApplied?: () => void;
}

const BackgroundCheckCaseDrawer: React.FC<BackgroundCheckCaseDrawerProps> = ({
  open,
  onClose,
  tenantId,
  checkId,
  canManage,
  initialCheck,
  onActionApplied,
}) => {
  const [checkDoc, setCheckDoc] = useState<BackgroundCheckRecord | null>(initialCheck ?? null);
  const [loading, setLoading] = useState<boolean>(open && !initialCheck);
  const [auditOpen, setAuditOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Per-line override flow.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuLineId, setMenuLineId] = useState<string | null>(null);
  const [overrideLine, setOverrideLine] = useState<AccusourceScreeningLineItem | null>(null);
  const [overrideVerdict, setOverrideVerdict] = useState<AccusourceManualVerdict>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  /** `${checkId}::${serviceKey}` — disables the verdict menu while a callable is in flight. */
  const [adjudicationLoadingKey, setAdjudicationLoadingKey] = useState<string | null>(null);

  // "Mark cleared via prior check" dialog state.
  const [markClearedOpen, setMarkClearedOpen] = useState(false);
  const [markClearedNotes, setMarkClearedNotes] = useState('');
  const [markClearedSubmitting, setMarkClearedSubmitting] = useState(false);
  const [markClearedError, setMarkClearedError] = useState<string | null>(null);
  const [markClearedSuccess, setMarkClearedSuccess] = useState<string | null>(null);

  // Sync `initialCheck` prop → state so reopening for a different row
  // doesn't render the prior case while the listener spins up.
  useEffect(() => {
    if (initialCheck && initialCheck.id !== checkDoc?.id) {
      setCheckDoc(initialCheck);
    }
  }, [initialCheck, checkDoc?.id]);

  // Live-subscribe to the backgroundCheck doc.
  useEffect(() => {
    if (!open || !checkId) return undefined;
    setLoading(!initialCheck);
    setActionError(null);
    const ref = doc(db, 'backgroundChecks', checkId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setCheckDoc(null);
        } else {
          setCheckDoc({ id: snap.id, ...(snap.data() as Omit<BackgroundCheckRecord, 'id'>) });
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [open, checkId, initialCheck]);

  // Reset transient action state when the drawer closes — keep `checkDoc`
  // so reopening the same check is instant.
  useEffect(() => {
    if (!open) {
      setMenuAnchor(null);
      setMenuLineId(null);
      setOverrideLine(null);
      setOverrideVerdict(null);
      setOverrideReason('');
      setOverrideError(null);
      setOverrideSubmitting(false);
      setMarkClearedOpen(false);
      setMarkClearedNotes('');
      setMarkClearedSubmitting(false);
      setMarkClearedError(null);
      setMarkClearedSuccess(null);
      setActionError(null);
    }
  }, [open]);

  const lines = useMemo<AccusourceScreeningLineItem[]>(
    () => (checkDoc ? accusourceScreeningLineItems(checkDoc) : []),
    [checkDoc],
  );

  const history = useMemo<FlattenedHistoryEntry[]>(() => flattenHistory(lines), [lines]);

  const tenantMatches = useMemo(() => {
    if (!checkDoc) return true;
    if (!checkDoc.tenantId) return true; // legacy docs without tenantId — let the caller permission-gate.
    return checkDoc.tenantId === tenantId;
  }, [checkDoc, tenantId]);

  // Tenant mismatch fail-safe: if the deep-link or caller passes a
  // checkId that lives under a different tenant, refuse to show
  // adjudication actions. The data is still read-only visible (already
  // loaded), but write actions are blocked.
  const canManageEffective = canManage && tenantMatches;

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, lineId: string) => {
    setMenuAnchor(event.currentTarget);
    setMenuLineId(lineId);
  };
  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuLineId(null);
  };

  const beginOverride = (
    line: AccusourceScreeningLineItem,
    verdict: NonNullable<AccusourceManualVerdict>,
  ) => {
    handleMenuClose();
    setOverrideLine(line);
    setOverrideVerdict(verdict);
    setOverrideReason(line.adjudication?.overrideReason ?? '');
    setOverrideError(null);
  };

  const closeOverrideDialog = () => {
    if (overrideSubmitting) return;
    setOverrideLine(null);
    setOverrideVerdict(null);
    setOverrideReason('');
    setOverrideError(null);
  };

  const callSetAdjudication = useCallback(
    async (
      backgroundCheckId: string,
      serviceKey: string,
      verdict: AccusourceManualVerdict,
      reason: string | null,
    ): Promise<void> => {
      const key = `${backgroundCheckId}::${serviceKey}`;
      setAdjudicationLoadingKey(key);
      try {
        const fn = httpsCallable(functions, 'setAccusourceLineAdjudication');
        await fn({ backgroundCheckId, serviceKey, verdict, reason });
        onActionApplied?.();
      } finally {
        setAdjudicationLoadingKey(null);
      }
    },
    [onActionApplied],
  );

  const submitOverride = async () => {
    if (!overrideLine || !overrideVerdict || !checkDoc) return;
    const trimmedReason = overrideReason.trim();
    // Greg's R.6 spec: mandatory note on override. The backend allows
    // null but product wants a justification on every CSA action; we
    // block submit at the UI layer.
    if (trimmedReason === '') {
      setOverrideError('A reason is required when overriding the system verdict.');
      return;
    }
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      await callSetAdjudication(checkDoc.id, overrideLine.id, overrideVerdict, trimmedReason);
      setOverrideLine(null);
      setOverrideVerdict(null);
      setOverrideReason('');
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to save override.';
      setOverrideError(message);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const beginClearOverride = async (line: AccusourceScreeningLineItem) => {
    handleMenuClose();
    if (!checkDoc) return;
    setActionError(null);
    try {
      await callSetAdjudication(checkDoc.id, line.id, null, null);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : 'Failed to clear override.';
      setActionError(message);
    }
  };

  const submitMarkCleared = async () => {
    if (!checkDoc) return;
    const trimmed = markClearedNotes.trim();
    if (trimmed === '') {
      setMarkClearedError('A note is required to mark this check cleared via a prior screening.');
      return;
    }
    if (!checkDoc.tenantId || !checkDoc.candidateId || !checkDoc.requestedPackageId) {
      setMarkClearedError(
        'This record is missing tenant / candidate / package metadata; place a new check via Backgrounds instead.',
      );
      return;
    }
    setMarkClearedSubmitting(true);
    setMarkClearedError(null);
    try {
      const fn = httpsCallable<
        Record<string, unknown>,
        { ok: boolean; backgroundCheckId: string }
      >(functions, 'markAccusourceBackgroundCheckCompleteOutside');
      const result = await fn({
        tenantId: checkDoc.tenantId,
        candidateId: checkDoc.candidateId,
        requestedPackageId: String(checkDoc.requestedPackageId),
        requestedPackageName: checkDoc.requestedPackageName ?? null,
        candidateName: checkDoc.candidateName ?? null,
        accountId: checkDoc.accountId ?? null,
        accountName: checkDoc.accountName ?? null,
        applicantId: checkDoc.applicantId ?? null,
        jobOrderId: checkDoc.jobOrderId ?? null,
        worksiteId: checkDoc.worksiteId ?? null,
        requestedServices: Array.isArray(checkDoc.requestedServices)
          ? checkDoc.requestedServices
          : [],
        requestedServicesCatalog: Array.isArray(checkDoc.requestedServicesCatalog)
          ? checkDoc.requestedServicesCatalog
          : [],
        notes: trimmed,
      });
      const newId = result?.data?.backgroundCheckId ?? '';
      setMarkClearedSuccess(
        newId
          ? `Created cleared-outside record (${newId}). Readiness will reflect the cleared screen on the next reconcile.`
          : 'Created cleared-outside record. Readiness will reflect the cleared screen on the next reconcile.',
      );
      setMarkClearedNotes('');
      setMarkClearedOpen(false);
      onActionApplied?.();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to mark cleared via prior check.';
      setMarkClearedError(message);
    } finally {
      setMarkClearedSubmitting(false);
    }
  };

  const menuLine = menuLineId ? lines.find((l) => l.id === menuLineId) ?? null : null;

  const hrxStatusPalette =
    (checkDoc?.hrxStatus && HRX_STATUS_PALETTE[checkDoc.hrxStatus]) ?? {
      color: 'default' as const,
      label: checkDoc?.hrxStatus ?? 'unknown',
    };

  const headerLabel =
    checkDoc?.providerProfileNumber ??
    (checkDoc?.providerProfileId != null ? String(checkDoc.providerProfileId) : null) ??
    checkDoc?.clientId ??
    checkId ??
    '—';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, maxWidth: '100vw' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
            Background Check
          </Typography>
          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ lineHeight: 1.2, wordBreak: 'break-word' }}
          >
            {headerLabel}
          </Typography>
        </Box>
        <IconButton aria-label="Close background check drawer" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider />

      {loading && !checkDoc ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : !checkDoc ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="warning">Background check not found.</Alert>
        </Box>
      ) : (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
            <Chip
              size="small"
              color={hrxStatusPalette.color}
              label={hrxStatusPalette.label}
              sx={{ fontWeight: 600 }}
            />
            {checkDoc.providerStatus && (
              <Tooltip title="Raw vendor status from AccuSource">
                <Chip
                  size="small"
                  variant="outlined"
                  label={`AccuSource: ${checkDoc.providerStatus}`}
                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                />
              </Tooltip>
            )}
            {checkDoc.markedCompleteOutsideHrx === true && (
              <Chip
                size="small"
                variant="outlined"
                color="success"
                label="Cleared outside HRX"
                icon={<VerifiedUserIcon fontSize="small" />}
              />
            )}
            {!tenantMatches && (
              <Chip
                size="small"
                variant="outlined"
                color="error"
                label="Tenant mismatch"
                title="This background check belongs to a different tenant; write actions are disabled."
              />
            )}
          </Stack>

          {(checkDoc.candidateName || checkDoc.requestedPackageName) && (
            <Stack spacing={0.25}>
              {checkDoc.candidateName && (
                <Typography variant="body2">
                  <strong>Worker:</strong> {checkDoc.candidateName}
                </Typography>
              )}
              {checkDoc.requestedPackageName && (
                <Typography variant="body2">
                  <strong>Package:</strong> {checkDoc.requestedPackageName}
                </Typography>
              )}
            </Stack>
          )}

          {actionError && (
            <Alert severity="error" onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
          {markClearedSuccess && (
            <Alert severity="success" onClose={() => setMarkClearedSuccess(null)}>
              {markClearedSuccess}
            </Alert>
          )}

          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                Service lines
              </Typography>
              {checkDoc.finalReportReady && checkDoc.providerFinalReportUrl && (
                <Button
                  size="small"
                  variant="text"
                  component="a"
                  href={checkDoc.providerFinalReportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  startIcon={<OpenInNewIcon fontSize="small" />}
                >
                  Final report
                </Button>
              )}
            </Stack>

            {lines.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No screening lines yet. Lines populate as AccuSource webhooks land.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {lines.map((line) => (
                  <Box
                    key={line.id}
                    sx={{
                      p: 1.25,
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="flex-start"
                      justifyContent="space-between"
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                          {line.name}
                        </Typography>
                        {line.type && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {line.type}
                          </Typography>
                        )}
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                          <Chip
                            size="small"
                            label={line.status || '—'}
                            color={statusChipColor(line.status || '')}
                            variant={line.status === 'Pending' ? 'outlined' : 'filled'}
                            sx={{ fontWeight: 600, height: 22 }}
                          />
                          {line.jurisdiction && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={line.jurisdiction}
                              sx={{ height: 22 }}
                            />
                          )}
                          {line.reportUrl && (
                            <Button
                              size="small"
                              component="a"
                              href={String(line.reportUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ minHeight: 22, py: 0, fontSize: 11 }}
                            >
                              Report
                            </Button>
                          )}
                        </Stack>
                        {line.adjudication?.autoVerdictReason && !line.verdictOverridden && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                            sx={{ mt: 0.75, lineHeight: 1.4 }}
                          >
                            {line.adjudication.autoVerdictReason}
                          </Typography>
                        )}
                        {line.verdictOverridden && line.adjudication?.overrideReason && (
                          <Typography
                            variant="caption"
                            color="warning.main"
                            display="block"
                            sx={{ mt: 0.75, lineHeight: 1.4 }}
                          >
                            <strong>Override:</strong> {line.adjudication.overrideReason}
                          </Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Tooltip
                          title={
                            line.verdictOverridden
                              ? `Manual override${
                                  line.adjudication?.overrideReason
                                    ? ` — ${line.adjudication.overrideReason}`
                                    : ''
                                }. Auto verdict was ${line.adjudication?.autoVerdict ?? 'PENDING'}.`
                              : line.adjudication?.autoVerdictReason ||
                                'System verdict from status + decision'
                          }
                        >
                          <Chip
                            size="small"
                            label={verdictChipLabel(line.verdict)}
                            color={verdictChipColor(line.verdict)}
                            variant={line.verdictOverridden ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 600, flexShrink: 0 }}
                          />
                        </Tooltip>
                        {canManageEffective && (
                          <IconButton
                            size="small"
                            aria-label={`Override verdict for ${line.name}`}
                            onClick={(e) => handleMenuOpen(e, line.id)}
                            disabled={
                              adjudicationLoadingKey === `${checkDoc.id}::${line.id}` ||
                              checkDoc.markedCompleteOutsideHrx === true
                            }
                          >
                            {adjudicationLoadingKey === `${checkDoc.id}::${line.id}` ? (
                              <CircularProgress size={14} />
                            ) : (
                              <MoreVertIcon fontSize="small" />
                            )}
                          </IconButton>
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {canManageEffective && checkDoc.markedCompleteOutsideHrx !== true && (
            <Box>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                Cleared via prior check?
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                If the worker has a passing background check from another platform, record it here.
                We&apos;ll create a separate &quot;completed outside HRX&quot; record so readiness
                clears without disturbing the current order&apos;s history.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                color="success"
                startIcon={<VerifiedUserIcon fontSize="small" />}
                onClick={() => {
                  setMarkClearedError(null);
                  setMarkClearedNotes('');
                  setMarkClearedOpen(true);
                }}
              >
                Mark cleared via prior check
              </Button>
            </Box>
          )}

          <Divider />

          <Box>
            <Button
              size="small"
              variant="text"
              startIcon={<HistoryIcon fontSize="small" />}
              onClick={() => setAuditOpen((v) => !v)}
            >
              {auditOpen ? 'Hide audit trail' : `Show audit trail (${history.length})`}
            </Button>
            {auditOpen && (
              <Box
                sx={{
                  mt: 1,
                  p: 1,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {history.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No adjudication events recorded yet.
                  </Typography>
                ) : (
                  <Stack spacing={0.75}>
                    {history.map((entry, idx) => (
                      <Box key={`${entry.serviceKey}-${entry.atMs}-${idx}`}>
                        <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ minWidth: 130 }}
                          >
                            {formatTimestamp(entry.at)}
                          </Typography>
                          <Typography variant="caption" fontWeight={600}>
                            {historyKindLabel(entry.kind)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            · {entry.serviceName}
                          </Typography>
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ ml: 'calc(130px + 8px)', lineHeight: 1.45 }}
                        >
                          {entry.fromVerdict != null
                            ? `${verdictChipLabel(entry.fromVerdict as AccusourceLineVerdict)} → ${verdictChipLabel(entry.verdict as AccusourceLineVerdict)}`
                            : verdictChipLabel(entry.verdict as AccusourceLineVerdict)}
                          {' · '}
                          {entry.by === 'system' ? 'system' : `actor ${entry.by}`}
                          {entry.reason ? ` · ${entry.reason}` : ''}
                          {entry.autoReason && entry.kind === 'auto_verdict_changed'
                            ? ` · ${entry.autoReason}`
                            : ''}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Box>

          <Box sx={{ pb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Created {formatTimestamp(checkDoc.createdAt)} · Updated {formatTimestamp(checkDoc.updatedAt)}
            </Typography>
          </Box>
        </Box>
      )}

      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != null && menuLine != null}
        onClose={handleMenuClose}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {menuLine && (
          <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Override verdict for
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
              {menuLine.name}
            </Typography>
          </Box>
        )}
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'PASSED'}
          onClick={() => menuLine && beginOverride(menuLine, 'PASSED')}
        >
          Mark as Passed
        </MenuItem>
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'FAILED'}
          onClick={() => menuLine && beginOverride(menuLine, 'FAILED')}
        >
          Mark as Failed
        </MenuItem>
        <MenuItem
          disabled={!menuLine || menuLine.verdict === 'NEEDS_REVIEW'}
          onClick={() => menuLine && beginOverride(menuLine, 'NEEDS_REVIEW')}
        >
          Flag as Needs review
        </MenuItem>
        {menuLine?.verdictOverridden && (
          <MenuItem onClick={() => menuLine && beginClearOverride(menuLine)}>
            <RestoreIcon fontSize="small" sx={{ mr: 1 }} />
            Revert to system verdict
            {menuLine.adjudication?.autoVerdict
              ? ` (${verdictChipLabel(menuLine.adjudication.autoVerdict)})`
              : ''}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={overrideLine != null} onClose={closeOverrideDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {overrideVerdict === 'PASSED' && 'Mark as Passed'}
          {overrideVerdict === 'FAILED' && 'Mark as Failed'}
          {overrideVerdict === 'NEEDS_REVIEW' && 'Flag as Needs review'}
        </DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1.5 }}>
            {overrideLine?.name}
            {overrideLine?.adjudication?.autoVerdict &&
              ` — system verdict is ${verdictChipLabel(overrideLine.adjudication.autoVerdict)}.`}
          </DialogContentText>
          <TextField
            label="Reason (required)"
            placeholder="Why are you overriding this verdict?"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            autoFocus
            required
            error={overrideError != null && overrideError.startsWith('A reason is required')}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            This override is reversible — any recruiter with the same access can later revert to the
            system verdict.
          </Typography>
          {overrideError && (
            <Alert severity="error" onClose={() => setOverrideError(null)} sx={{ mt: 2 }}>
              {overrideError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeOverrideDialog} disabled={overrideSubmitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitOverride}
            disabled={overrideSubmitting || overrideVerdict == null}
          >
            {overrideSubmitting ? 'Saving…' : 'Save override'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={markClearedOpen}
        onClose={() => {
          if (markClearedSubmitting) return;
          setMarkClearedOpen(false);
          setMarkClearedError(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Mark cleared via prior check</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 1.5 }}>
            Records that the worker has a passing screening from another platform. We create a
            separate <strong>completed-outside-HRX</strong> record so readiness clears without
            modifying this order&apos;s line history. The original order remains visible for audit.
          </DialogContentText>
          <TextField
            label="Note (required)"
            placeholder="Where did the prior check come from? (e.g. portal order #, vendor, date)"
            value={markClearedNotes}
            onChange={(e) => setMarkClearedNotes(e.target.value)}
            multiline
            minRows={3}
            maxRows={8}
            fullWidth
            autoFocus
            required
          />
          {markClearedError && (
            <Alert severity="error" onClose={() => setMarkClearedError(null)} sx={{ mt: 2 }}>
              {markClearedError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (markClearedSubmitting) return;
              setMarkClearedOpen(false);
              setMarkClearedError(null);
            }}
            disabled={markClearedSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={submitMarkCleared}
            disabled={markClearedSubmitting}
          >
            {markClearedSubmitting ? 'Saving…' : 'Mark cleared'}
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
};

export default BackgroundCheckCaseDrawer;

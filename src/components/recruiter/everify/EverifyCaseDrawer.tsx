/**
 * **R.5** — `EverifyCaseDrawer`
 *
 * Single, right-anchored MUI Drawer (per Q-R5-2 lock) used everywhere
 * recruiters need to inspect / act on an E-Verify case:
 *   - `EverifyAdminOpsPage` — replaces the inline TNC action row.
 *   - `EverifyComplianceCard` — opens from "Manage TNC" when `actionRequired`.
 *   - `ProfileReadinessTabContent` — opens via the "Manage" button on
 *     `e_verify` requirement rows, AND auto-opens when the URL carries
 *     `?tab=readiness&type=e_verify&caseId=...` (R.4 chip drill-in).
 *
 * Single source of truth for the TNC workflow checklist (Master Plan §4.6).
 * Permission gating is the caller's job (we still defensively gate the
 * write buttons here behind `canManage`).
 *
 * What this component *does not* do:
 *   - Generate the FAN PDF — `EverifyTncNoticePrintable` opens in a new
 *     window (R.5 lock Q-R5-3). This drawer fires `everifyRecordNoticeGenerated`
 *     and surfaces the resulting `noticePacketGeneratedAt` timestamp.
 *   - Worker self-service — the worker app (R.9) reads
 *     `EmployeeReadinessItem.workerAction` and renders its own decision UI.
 *     This drawer represents the recruiter view of the same machine.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import HistoryIcon from '@mui/icons-material/History';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { openEverifyTncNoticePrintable } from './openEverifyTncNoticePrintable';

const STATUS_PALETTE: Record<
  string,
  { color: 'default' | 'success' | 'warning' | 'error' | 'info'; label: string }
> = {
  draft: { color: 'default', label: 'Draft' },
  ready: { color: 'default', label: 'Ready to submit' },
  submitted: { color: 'info', label: 'Submitted' },
  pending: { color: 'info', label: 'Pending USCIS' },
  employment_authorized: { color: 'success', label: 'Employment authorized' },
  tnc: { color: 'warning', label: 'TNC — action required' },
  dhs_verification_in_process: { color: 'info', label: 'DHS verification in process' },
  further_action_required: { color: 'warning', label: 'Further action required' },
  final_nonconfirmation: { color: 'error', label: 'Final non-confirmation' },
  closed: { color: 'default', label: 'Closed' },
  error: { color: 'error', label: 'Error' },
};

interface EverifyCaseDoc {
  id: string;
  tenantId?: string;
  entityId?: string | null;
  userId?: string | null;
  userEmploymentId?: string | null;
  assignmentId?: string | null;
  status?: string;
  providerStatus?: string;
  everifyCaseNumber?: string;
  caseEligibilityStatement?: string;
  createdAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
  closedAt?: { toMillis?: () => number };
  deadlines?: {
    tncResponseDueAt?: { toMillis?: () => number } | unknown;
    referralDueAt?: { toMillis?: () => number } | unknown;
  };
  everifyCaseActions?: {
    employeeNotifiedAt?: { toMillis?: () => number } | unknown;
    employeeContests?: boolean;
    workerDecisionAt?: { toMillis?: () => number } | unknown;
    referralInitiatedAt?: { toMillis?: () => number } | unknown;
    noticePacketGeneratedAt?: { toMillis?: () => number } | unknown;
    caseClosedAt?: { toMillis?: () => number } | unknown;
    notes?: string;
  };
  raw?: Record<string, unknown>;
}

interface EverifyCaseEvent {
  id: string;
  type?: string;
  actor?: string;
  at?: { toMillis?: () => number } | unknown;
  data?: Record<string, unknown>;
}

export interface EverifyCaseDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Tenant the case lives under. */
  tenantId: string;
  /** `everify_cases/{caseId}` doc id. Required when `open === true`. */
  caseId: string | null;
  /**
   * `true` when the current user is allowed to call the TNC workflow
   * callables (`everifyMarkEmployeeNotified` etc.). When `false` the
   * drawer renders read-only — caller is responsible for the actual
   * permission check.
   */
  canManage: boolean;
  /**
   * Optional snapshot to render before the live listener fires (avoids
   * flashing a CircularProgress when the caller already has the case
   * doc — e.g. `EverifyAdminOpsPage` rows). The listener still attaches
   * and overrides this once Firestore responds.
   */
  initialCase?: EverifyCaseDoc | null;
  /** Fired after a successful action so the caller can refresh its list. */
  onActionApplied?: () => void;
}

/** Firestore Timestamp | ISO string | undefined → human label or em-dash. */
function formatTimestamp(v: unknown): string {
  if (!v) return '—';
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
  if (typeof v === 'object' && v !== null) {
    const t = v as { toMillis?: () => number };
    if (typeof t.toMillis === 'function') return new Date(t.toMillis()).toLocaleString();
  }
  return '—';
}

function formatDate(v: unknown): string {
  if (!v) return '—';
  if (typeof v === 'object' && v !== null) {
    const t = v as { toMillis?: () => number };
    if (typeof t.toMillis === 'function') return new Date(t.toMillis()).toLocaleDateString();
  }
  return '—';
}

function daysUntil(v: unknown): number | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as { toMillis?: () => number };
  if (typeof t.toMillis !== 'function') return null;
  const ms = t.toMillis() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** TNC workflow steps the recruiter walks through. Mirrors Master Plan §4.6. */
type TncStepId = 'notified' | 'decision' | 'fan' | 'referral' | 'close';

interface TncStepView {
  id: TncStepId;
  label: string;
  /**
   * `complete` — already done (latched via case actions).
   * `current` — next step in the sequence given the current state.
   * `pending` — depends on prior steps.
   * `skipped` — irrelevant to this case (e.g. referral on a declined TNC).
   */
  state: 'complete' | 'current' | 'pending' | 'skipped';
  /** Optional helper line under the label (deadline / note). */
  detail?: string;
}

function deriveTncSteps(c: EverifyCaseDoc): TncStepView[] {
  const a = c.everifyCaseActions ?? {};
  const notified = Boolean(a.employeeNotifiedAt);
  const decisionRecorded = a.workerDecisionAt != null || typeof a.employeeContests === 'boolean';
  const contests = a.employeeContests === true;
  const fanGenerated = Boolean(a.noticePacketGeneratedAt);
  const referralFiled = Boolean(a.referralInitiatedAt);
  const closed = Boolean(a.caseClosedAt) || c.status === 'closed' || c.status === 'final_nonconfirmation';

  const steps: TncStepView[] = [];

  steps.push({
    id: 'notified',
    label: 'Notify employee',
    state: notified ? 'complete' : 'current',
    detail: notified
      ? `Recorded ${formatTimestamp(a.employeeNotifiedAt)}`
      : 'Hand the FAN to the worker, then mark notified.',
  });

  // FAN is part of the notification step; show it as its own row so
  // recruiters can re-print without re-marking notification.
  steps.push({
    id: 'fan',
    label: 'Generate Further Action Notice (FAN)',
    state: fanGenerated ? 'complete' : notified ? 'current' : 'pending',
    detail: fanGenerated
      ? `Generated ${formatTimestamp(a.noticePacketGeneratedAt)}`
      : 'Print and review with the worker before recording notification.',
  });

  steps.push({
    id: 'decision',
    label: 'Record worker decision',
    state: decisionRecorded ? 'complete' : notified ? 'current' : 'pending',
    detail: decisionRecorded
      ? contests
        ? 'Worker chose to contest — initiate referral next.'
        : 'Worker declined to contest — case will close as FNC.'
      : `Deadline: ${formatDate(c.deadlines?.tncResponseDueAt)}`,
  });

  steps.push({
    id: 'referral',
    label: 'Initiate DHS / SSA referral',
    state: referralFiled
      ? 'complete'
      : !decisionRecorded
        ? 'pending'
        : contests
          ? 'current'
          : 'skipped',
    detail: referralFiled
      ? `Recorded ${formatTimestamp(a.referralInitiatedAt)}`
      : !decisionRecorded
        ? 'Worker decision required first.'
        : contests
          ? `Deadline: ${formatDate(c.deadlines?.referralDueAt)}`
          : 'Skipped — worker declined to contest.',
  });

  steps.push({
    id: 'close',
    label: 'Close case',
    state: closed
      ? 'complete'
      : referralFiled || (decisionRecorded && !contests)
        ? 'current'
        : 'pending',
    detail: closed
      ? `Closed ${formatTimestamp(a.caseClosedAt) === '—' ? c.status : formatTimestamp(a.caseClosedAt)}`
      : 'Wait for USCIS to finalise, then close.',
  });

  return steps;
}

const EverifyCaseDrawer: React.FC<EverifyCaseDrawerProps> = ({
  open,
  onClose,
  tenantId,
  caseId,
  canManage,
  initialCase,
  onActionApplied,
}) => {
  const [caseDoc, setCaseDoc] = useState<EverifyCaseDoc | null>(initialCase ?? null);
  const [events, setEvents] = useState<EverifyCaseEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(open && !initialCase);
  const [auditOpen, setAuditOpen] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<TncStepId | 'fan_print' | 'close' | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync initialCase prop to state so reopening the drawer for a different
  // row doesn't render the prior case while the listener spins up.
  useEffect(() => {
    if (initialCase && initialCase.id !== caseDoc?.id) {
      setCaseDoc(initialCase);
    }
  }, [initialCase, caseDoc?.id]);

  // Live-subscribe to the case document.
  useEffect(() => {
    if (!open || !tenantId || !caseId) return undefined;
    setLoading(!initialCase);
    const ref = doc(db, 'tenants', tenantId, 'everify_cases', caseId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setCaseDoc(null);
        } else {
          setCaseDoc({ id: snap.id, ...(snap.data() as Omit<EverifyCaseDoc, 'id'>) });
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [open, tenantId, caseId, initialCase]);

  // Live-subscribe to events (only when audit panel is opened or once
  // after initial mount, to keep snapshot count low).
  useEffect(() => {
    if (!open || !tenantId || !caseId || !auditOpen) return undefined;
    const ref = collection(db, 'tenants', tenantId, 'everify_cases', caseId, 'events');
    const q = query(ref, orderBy('at', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEvents(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EverifyCaseEvent, 'id'>) })),
        );
      },
      () => {
        // Surface separately from `actionError` to avoid hiding action problems.
      },
    );
    return unsub;
  }, [open, tenantId, caseId, auditOpen]);

  const callAction = useCallback(
    async (
      step: TncStepId | 'fan_print' | 'close',
      callableName:
        | 'everifyMarkEmployeeNotified'
        | 'everifyRecordWorkerDecision'
        | 'everifyMarkReferralInitiated'
        | 'everifyRecordNoticeGenerated'
        | 'everifyCloseCaseManual',
      payload?: Record<string, unknown>,
    ): Promise<void> => {
      if (!tenantId || !caseId) return;
      setActionInFlight(step);
      setActionError(null);
      try {
        const fn = httpsCallable(functions, callableName);
        await fn({ tenantId, caseId, ...payload });
        onActionApplied?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setActionInFlight(null);
      }
    },
    [tenantId, caseId, onActionApplied],
  );

  const handlePrintFan = useCallback(() => {
    if (!tenantId || !caseId || !caseDoc) return;
    openEverifyTncNoticePrintable({
      tenantId,
      caseId,
      caseNumber: caseDoc.everifyCaseNumber,
      eligibilityStatement: caseDoc.caseEligibilityStatement,
      tncResponseDueAt: caseDoc.deadlines?.tncResponseDueAt,
      referralDueAt: caseDoc.deadlines?.referralDueAt,
    });
    // Best-effort audit even if the new window is blocked — recruiter
    // intent was to generate; let them retry the popup separately.
    void callAction('fan_print', 'everifyRecordNoticeGenerated');
  }, [tenantId, caseId, caseDoc, callAction]);

  const tncSteps = useMemo<TncStepView[]>(
    () => (caseDoc ? deriveTncSteps(caseDoc) : []),
    [caseDoc],
  );

  const palette =
    (caseDoc?.status && STATUS_PALETTE[caseDoc.status]) ?? {
      color: 'default' as const,
      label: caseDoc?.status ?? 'unknown',
    };

  const isTncInFlight =
    !!caseDoc &&
    (caseDoc.status === 'tnc' ||
      caseDoc.status === 'further_action_required' ||
      caseDoc.status === 'dhs_verification_in_process');

  const tncDays = daysUntil(caseDoc?.deadlines?.tncResponseDueAt);
  const referralDays = daysUntil(caseDoc?.deadlines?.referralDueAt);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, maxWidth: '100vw' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
            E-Verify Case
          </Typography>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {caseDoc?.everifyCaseNumber ?? caseId ?? '—'}
          </Typography>
        </Box>
        <IconButton aria-label="Close E-Verify case drawer" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider />

      {loading && !caseDoc ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : !caseDoc ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="warning">Case not found.</Alert>
        </Box>
      ) : (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
            <Chip size="small" color={palette.color} label={palette.label} sx={{ fontWeight: 600 }} />
            {caseDoc.providerStatus && (
              <Tooltip title="Raw E-Verify provider status (USCIS / ICA)">
                <Chip
                  size="small"
                  variant="outlined"
                  label={`USCIS: ${caseDoc.providerStatus}`}
                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                />
              </Tooltip>
            )}
            {caseDoc.everifyCaseActions?.employeeContests === true && (
              <Chip size="small" variant="outlined" color="warning" label="Worker contesting" />
            )}
            {caseDoc.everifyCaseActions?.employeeContests === false && (
              <Chip size="small" variant="outlined" label="Worker declined" />
            )}
          </Stack>

          {caseDoc.caseEligibilityStatement && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Eligibility statement
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {caseDoc.caseEligibilityStatement}
              </Typography>
            </Box>
          )}

          {isTncInFlight && (
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                display: 'flex',
                gap: 2,
                flexWrap: 'wrap',
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Worker contest deadline
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {formatDate(caseDoc.deadlines?.tncResponseDueAt)}
                  {tncDays != null && (
                    <Box
                      component="span"
                      sx={{
                        ml: 1,
                        color: tncDays < 3 ? 'error.main' : tncDays < 7 ? 'warning.main' : 'text.secondary',
                        fontWeight: 700,
                      }}
                    >
                      {tncDays >= 0 ? `${tncDays}d` : `${Math.abs(tncDays)}d overdue`}
                    </Box>
                  )}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Referral deadline
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {formatDate(caseDoc.deadlines?.referralDueAt)}
                  {referralDays != null && (
                    <Box
                      component="span"
                      sx={{
                        ml: 1,
                        color: referralDays < 3 ? 'error.main' : referralDays < 7 ? 'warning.main' : 'text.secondary',
                        fontWeight: 700,
                      }}
                    >
                      {referralDays >= 0 ? `${referralDays}d` : `${Math.abs(referralDays)}d overdue`}
                    </Box>
                  )}
                </Typography>
              </Box>
            </Box>
          )}

          {actionError && (
            <Alert severity="error" onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              TNC workflow
            </Typography>
            <Stack spacing={1}>
              {tncSteps.map((step) => {
                const stepActions = caseDoc.everifyCaseActions ?? {};
                const renderActionButton = (): React.ReactNode => {
                  if (!canManage) return null;
                  if (step.state === 'skipped') return null;
                  if (step.state === 'complete') return null;
                  if (step.state === 'pending') return null;

                  switch (step.id) {
                    case 'notified':
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={actionInFlight !== null}
                          onClick={() =>
                            callAction('notified', 'everifyMarkEmployeeNotified')
                          }
                        >
                          {actionInFlight === 'notified' ? (
                            <CircularProgress size={14} />
                          ) : (
                            'Mark employee notified'
                          )}
                        </Button>
                      );
                    case 'fan':
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<OpenInNewIcon fontSize="small" />}
                          disabled={actionInFlight !== null}
                          onClick={handlePrintFan}
                        >
                          {actionInFlight === 'fan_print' ? (
                            <CircularProgress size={14} />
                          ) : (
                            'Open FAN print view'
                          )}
                        </Button>
                      );
                    case 'decision':
                      return (
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            disabled={actionInFlight !== null}
                            onClick={() =>
                              callAction('decision', 'everifyRecordWorkerDecision', {
                                contests: true,
                              })
                            }
                          >
                            Worker contests
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={actionInFlight !== null}
                            onClick={() =>
                              callAction('decision', 'everifyRecordWorkerDecision', {
                                contests: false,
                              })
                            }
                          >
                            Worker declines
                          </Button>
                        </Stack>
                      );
                    case 'referral':
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={actionInFlight !== null}
                          onClick={() =>
                            callAction('referral', 'everifyMarkReferralInitiated')
                          }
                        >
                          {actionInFlight === 'referral' ? (
                            <CircularProgress size={14} />
                          ) : (
                            'Mark referral initiated'
                          )}
                        </Button>
                      );
                    case 'close':
                      return (
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          disabled={actionInFlight !== null || Boolean(stepActions.caseClosedAt)}
                          onClick={() => callAction('close', 'everifyCloseCaseManual')}
                        >
                          Close case
                        </Button>
                      );
                    default:
                      return null;
                  }
                };
                return (
                  <Box
                    key={step.id}
                    sx={{
                      p: 1,
                      borderRadius: 1,
                      bgcolor:
                        step.state === 'current'
                          ? 'action.selected'
                          : step.state === 'skipped'
                            ? 'transparent'
                            : 'transparent',
                      opacity: step.state === 'pending' || step.state === 'skipped' ? 0.55 : 1,
                    }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Box sx={{ pt: 0.25 }}>
                        {step.state === 'complete' ? (
                          <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                        ) : (
                          <RadioButtonUncheckedIcon
                            sx={{
                              fontSize: 20,
                              color:
                                step.state === 'current' ? 'warning.main' : 'action.disabled',
                            }}
                          />
                        )}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {step.label}
                        </Typography>
                        {step.detail && (
                          <Typography variant="caption" color="text.secondary">
                            {step.detail}
                          </Typography>
                        )}
                        {step.state === 'current' && (
                          <Box sx={{ mt: 0.75 }}>{renderActionButton()}</Box>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Button
              size="small"
              variant="text"
              startIcon={<HistoryIcon fontSize="small" />}
              onClick={() => setAuditOpen((v) => !v)}
            >
              {auditOpen ? 'Hide audit trail' : 'Show audit trail'}
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
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {events.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No events recorded.
                  </Typography>
                ) : (
                  <Stack spacing={0.5}>
                    {events.map((e) => (
                      <Stack key={e.id} direction="row" spacing={1}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ minWidth: 130 }}
                        >
                          {formatTimestamp(e.at)}
                        </Typography>
                        <Typography variant="caption" fontWeight={600} sx={{ minWidth: 160 }}>
                          {e.type}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {e.actor ?? 'system'}
                          {e.data && Object.keys(e.data).length > 0
                            ? ` · ${JSON.stringify(e.data)}`
                            : ''}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            )}
          </Box>

          <Box sx={{ pb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Created {formatTimestamp(caseDoc.createdAt)} · Updated {formatTimestamp(caseDoc.updatedAt)}
            </Typography>
          </Box>
        </Box>
      )}
    </Drawer>
  );
};

export default EverifyCaseDrawer;

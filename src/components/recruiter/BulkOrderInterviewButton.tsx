import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { hasRecruiterInterviewCompletionEvidence } from '../../utils/scoreSummary';

/**
 * Minimal user shape needed by the bulk order-interview action. This is a
 * structural superset of the per-row inline action so the same selection
 * arrays used by Bulk Email / Bulk SMS work without reshaping.
 */
export interface BulkOrderInterviewCandidate {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  scoreSummary?: any;
  hasWorkerAiPrescreenInterview?: boolean;
  interviewStatus?: string;
  lastInterviewCompletedAt?: unknown;
  /** Optional — if present, security-elevated accounts (>=5) are skipped. */
  securityLevel?: string | number;
}

export interface BulkOrderInterviewButtonProps {
  /** Tenant context. Falls back to viewer's active tenant if omitted. */
  tenantId?: string | null;
  /**
   * The selection passed by the parent toolbar. The button filters this
   * down to recipients who don't yet show interview-completion evidence
   * and have a usable phone, then iterates the same callable used by the
   * per-row CTA (`sendWorkerOrderInterviewSms`).
   */
  selectedUsers: BulkOrderInterviewCandidate[];
  /**
   * Optional override for the success snackbar callback (e.g. to
   * re-fetch the table). Always invoked after the run finishes,
   * regardless of mixed success/failure.
   */
  onComplete?: (summary: { sent: number; skipped: number; failed: number }) => void;
}

function hasUsableSmsPhone(user: BulkOrderInterviewCandidate): boolean {
  return String(user?.phone || '').replace(/\D/g, '').length >= 10;
}

function isInternalAccount(user: BulkOrderInterviewCandidate): boolean {
  if (user.securityLevel == null) return false;
  const lvl = Number.parseInt(String(user.securityLevel), 10);
  return Number.isFinite(lvl) && lvl >= 5;
}

/** Run an async worker over `items` with a fixed concurrency cap. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

/**
 * "Order Interviews" bulk action — same network call as the per-row CTA,
 * looped (with a small concurrency cap) over the selected workers who
 * haven't yet completed an AI pre-screen interview. Designed to slot in
 * next to Bulk Email / Bulk SMS in user / group / smart-group tables.
 *
 * Hidden (returns null) when:
 *  - viewer security level is outside 5–7 (matches the per-row gating), or
 *  - no usable tenantId, or
 *  - 0 candidates in the selection are eligible.
 *
 * The server (`sendWorkerOrderInterviewSms`) re-validates every recipient,
 * so client-side filtering is a UX hint only — we still report
 * `failed-precondition` results back as "skipped" rather than errors.
 */
const BulkOrderInterviewButton: React.FC<BulkOrderInterviewButtonProps> = ({
  tenantId,
  selectedUsers,
  onComplete,
}) => {
  const { activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth() as any;

  const viewerCanUseTool = useMemo(() => {
    const level = Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
    return level >= 5 && level <= 7;
  }, [currentClaimsSecurityLevel, securityLevel]);

  const effectiveTenantId = tenantId || activeTenant?.id || '';

  /**
   * Eligible = selection minus rows that already have completion evidence,
   * minus internal/staff accounts (security >= 5), minus rows with no
   * usable phone. The "skipped" counts surfaced in the confirm dialog and
   * result snackbar are derived from this split.
   */
  const { eligible, skippedCompleted, skippedNoPhone, skippedInternal } = useMemo(() => {
    const eligibleAcc: BulkOrderInterviewCandidate[] = [];
    let completed = 0;
    let noPhone = 0;
    let internal = 0;
    for (const u of selectedUsers) {
      if (!u?.id) continue;
      if (isInternalAccount(u)) {
        internal += 1;
        continue;
      }
      const interviewDone = hasRecruiterInterviewCompletionEvidence(u.scoreSummary, {
        hasWorkerAiPrescreenInterview: u.hasWorkerAiPrescreenInterview,
        interviewStatus: u.interviewStatus,
        lastInterviewCompletedAt: u.lastInterviewCompletedAt,
      });
      if (interviewDone) {
        completed += 1;
        continue;
      }
      if (!hasUsableSmsPhone(u)) {
        noPhone += 1;
        continue;
      }
      eligibleAcc.push(u);
    }
    return {
      eligible: eligibleAcc,
      skippedCompleted: completed,
      skippedNoPhone: noPhone,
      skippedInternal: internal,
    };
  }, [selectedUsers]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [resultSnackbar, setResultSnackbar] = useState<
    | null
    | {
        sent: number;
        skipped: number;
        failed: number;
        firstError?: string;
      }
  >(null);

  if (!viewerCanUseTool) return null;
  if (!effectiveTenantId) return null;
  if (eligible.length === 0) return null;

  const totalSkippedPreflight = skippedCompleted + skippedNoPhone + skippedInternal;

  const buildSkippedSummaryLines = (): string[] => {
    const lines: string[] = [];
    if (skippedCompleted > 0) {
      lines.push(
        `${skippedCompleted} already completed an interview`,
      );
    }
    if (skippedNoPhone > 0) {
      lines.push(`${skippedNoPhone} have no usable phone number`);
    }
    if (skippedInternal > 0) {
      lines.push(`${skippedInternal} are internal/staff accounts`);
    }
    return lines;
  };

  const handleConfirm = async () => {
    if (running) return;
    setRunning(true);
    setProgress({ done: 0, total: eligible.length });
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let firstError: string | undefined;

    const fn = httpsCallable(functions, 'sendWorkerOrderInterviewSms');
    const cleanError = (err: any): string => {
      const raw = err?.message || err?.details?.message || (typeof err === 'string' ? err : '');
      return String(raw)
        .replace(/^Firebase:\s*/i, '')
        .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
        .trim();
    };

    await runWithConcurrency(eligible, 4, async (u) => {
      try {
        await fn({ uid: u.id, tenantId: effectiveTenantId });
        sent += 1;
      } catch (err: any) {
        // Server uses `failed-precondition` for "already completed",
        // "no phone", "outreach disabled", and the 24-hour cooldown.
        // Treat all of those as "skipped" rather than hard failures so
        // the recruiter sees a meaningful summary.
        const code = err?.code || err?.details?.code || '';
        const isPrecondition =
          typeof code === 'string' && code.includes('failed-precondition');
        const isCooldown =
          typeof code === 'string' && code.includes('resource-exhausted');
        if (isPrecondition || isCooldown) {
          skipped += 1;
        } else {
          failed += 1;
          if (!firstError) firstError = cleanError(err);
        }
      } finally {
        setProgress((prev) => ({ done: prev.done + 1, total: prev.total }));
      }
    });

    setRunning(false);
    setConfirmOpen(false);
    setResultSnackbar({ sent, skipped, failed, firstError });
    onComplete?.({ sent, skipped, failed });
  };

  const buttonLabel = `Order Interviews (${eligible.length})`;
  const tooltipTitle =
    totalSkippedPreflight > 0
      ? `${eligible.length} eligible · ${totalSkippedPreflight} will be skipped`
      : `${eligible.length} eligible`;

  return (
    <>
      <Tooltip title={tooltipTitle}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RecordVoiceOverIcon />}
            onClick={() => setConfirmOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            {buttonLabel}
          </Button>
        </span>
      </Tooltip>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!running) setConfirmOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Order Interviews</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            Send the AI pre-screen interview invite SMS to{' '}
            <Box component="span" sx={{ fontWeight: 700 }}>
              {eligible.length}
            </Box>{' '}
            selected worker{eligible.length === 1 ? '' : 's'}?
            {totalSkippedPreflight > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                  {totalSkippedPreflight} selected worker
                  {totalSkippedPreflight === 1 ? ' will be' : 's will be'} skipped:
                </Typography>
                <Box component="ul" sx={{ pl: 3, m: 0, mt: 0.5 }}>
                  {buildSkippedSummaryLines().map((line) => (
                    <li key={line}>
                      <Typography variant="body2" color="text.secondary">
                        {line}
                      </Typography>
                    </li>
                  ))}
                </Box>
              </Box>
            )}
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                Workers who received an invite from this tool in the last 24 hours
                are also skipped automatically by the server.
              </Typography>
            </Box>
          </DialogContentText>
          {running && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress
                variant="determinate"
                value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Sending… {progress.done} / {progress.total}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={running} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={running}
            startIcon={running ? <CircularProgress size={14} color="inherit" /> : <RecordVoiceOverIcon />}
            sx={{ textTransform: 'none' }}
          >
            {running ? 'Sending…' : `Send ${eligible.length} invite${eligible.length === 1 ? '' : 's'}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!resultSnackbar}
        autoHideDuration={resultSnackbar?.failed ? 8000 : 5000}
        onClose={() => setResultSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {resultSnackbar ? (
          <Alert
            severity={resultSnackbar.failed > 0 ? 'warning' : 'success'}
            onClose={() => setResultSnackbar(null)}
            sx={{ width: '100%' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Sent {resultSnackbar.sent} interview invite
              {resultSnackbar.sent === 1 ? '' : 's'}
              {resultSnackbar.skipped > 0 ? ` · ${resultSnackbar.skipped} skipped` : ''}
              {resultSnackbar.failed > 0 ? ` · ${resultSnackbar.failed} failed` : ''}
            </Typography>
            {resultSnackbar.firstError && (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
                First error: {resultSnackbar.firstError}
              </Typography>
            )}
          </Alert>
        ) : (
          // Snackbar requires a non-null child even when closed; this
          // branch is unreachable because `open` mirrors the same state.
          <span />
        )}
      </Snackbar>
    </>
  );
};

export default BulkOrderInterviewButton;

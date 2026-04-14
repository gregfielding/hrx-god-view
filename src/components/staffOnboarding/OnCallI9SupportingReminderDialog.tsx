import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';

export type OnCallI9SupportingReminderIncluded = {
  userId: string;
  pipelineId: string;
  entityId: string | null;
  displayName: string;
  warnings: string[];
  directUploadLink: string | null;
};

export type OnCallI9SupportingReminderExcluded = {
  userId: string;
  pipelineId: string | null;
  displayName: string;
  reason: string;
};

export type I9UploadReminderAudience = 'on_call_pool' | 'all_w2_onboarding';

export type OnCallI9SupportingReminderResult = {
  tenantId: string;
  mode: 'preview' | 'send';
  audience: I9UploadReminderAudience;
  cooldownHours: number;
  employmentDocsScanned: number;
  included: OnCallI9SupportingReminderIncluded[];
  excluded: OnCallI9SupportingReminderExcluded[];
  sendResults?: { userId: string; pipelineId: string; success: boolean; error?: string; duplicateSkipped?: boolean }[];
  auditId: string | null;
  note: string;
};

const fn = httpsCallable<
  { tenantId: string; mode: 'preview' | 'send'; cooldownHours?: number; audience?: I9UploadReminderAudience },
  OnCallI9SupportingReminderResult
>(getFunctions(app, 'us-central1'), 'onCallI9SupportingReminder');

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string | undefined;
  /** `on_call_pool` = default staff-onboarding tool; `all_w2_onboarding` = temporary bulk scan (Users layout). */
  audience?: I9UploadReminderAudience;
};

export const OnCallI9SupportingReminderDialog: React.FC<Props> = ({ open, onClose, tenantId, audience = 'on_call_pool' }) => {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnCallI9SupportingReminderResult | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [cooldownHours, setCooldownHours] = useState(72);

  const runPreview = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAuditId(null);
    try {
      const { data } = await fn({ tenantId, mode: 'preview', cooldownHours, audience });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [tenantId, cooldownHours, audience]);

  useEffect(() => {
    if (open && tenantId) {
      void runPreview();
    }
  }, [open, tenantId, runPreview]);

  const runSend = useCallback(async () => {
    if (!tenantId) return;
    setSending(true);
    setError(null);
    try {
      const { data } = await fn({ tenantId, mode: 'send', cooldownHours, audience });
      setResult(data);
      setAuditId(data.auditId ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [tenantId, cooldownHours, audience]);

  const handleClose = () => {
    setResult(null);
    setError(null);
    setAuditId(null);
    onClose();
  };

  const copyJson = () => {
    if (!result) return;
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  };

  const summary = useMemo(() => {
    if (!result) return null;
    return (
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="body2">
          On-call employments scanned: <strong>{result.employmentDocsScanned}</strong>
        </Typography>
        <Typography variant="body2" color="success.main">
          Included: <strong>{result.included.length}</strong>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Excluded: <strong>{result.excluded.length}</strong>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Cooldown: {result.cooldownHours}h
        </Typography>
      </Stack>
    );
  }, [result]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {audience === 'all_w2_onboarding'
          ? 'I-9 upload reminders (all W-2 onboarding)'
          : 'Remind incomplete I-9 uploads (on-call)'}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {audience === 'all_w2_onboarding' ? (
            <>
              <strong>Temporary bulk scope:</strong> W-2 employments still in onboarding (onboarding phase not complete), including
              assignment-based and on-call, where I-9 supporting docs need worker upload/reupload. Scans up to 2500 employment docs.
              Preview is safe; Send delivers SMS and logs audit + per-employment cooldown.
            </>
          ) : (
            <>
              Targets <strong>on-call pool</strong> W-2 employments still in onboarding where the worker must upload or replace I-9
              supporting documents (not stuck only in staff review). Preview is safe; Send delivers SMS (bilingual via{' '}
              <code>preferredLanguage</code>) and logs audit + per-employment cooldown.
            </>
          )}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems="flex-start">
          <TextField
            label="Cooldown (hours)"
            type="number"
            size="small"
            value={cooldownHours}
            onChange={(e) => setCooldownHours(Math.min(168, Math.max(1, Number(e.target.value) || 72)))}
            inputProps={{ min: 1, max: 168 }}
            helperText="Skip workers reminded within this window (entity_employments.i9SupportingUploadReminderLastSentAt)."
          />
          <Button variant="outlined" onClick={() => void runPreview()} disabled={!tenantId || loading}>
            Refresh preview
          </Button>
        </Stack>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {auditId || result?.auditId ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Audit: <code>{auditId ?? result?.auditId}</code> (tenants/…/onboarding_i9_reminder_audit)
          </Alert>
        ) : null}

        {result?.note ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {result.note}
          </Alert>
        ) : null}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : null}

        {!loading && result ? (
          <Stack spacing={2}>
            {summary}
            <Typography variant="subtitle2">Included (will receive SMS on Send)</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>User ID</TableCell>
                  <TableCell>Pipeline / employment id</TableCell>
                  <TableCell>Link</TableCell>
                  <TableCell>Warnings</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.included.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No eligible workers.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  result.included.map((r) => (
                    <TableRow key={r.pipelineId}>
                      <TableCell>{r.displayName}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{r.userId}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{r.pipelineId}</TableCell>
                      <TableCell sx={{ wordBreak: 'break-all', fontSize: 11 }}>{r.directUploadLink ?? '—'}</TableCell>
                      <TableCell>{r.warnings.join('; ') || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <Typography variant="subtitle2">Excluded</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>User ID</TableCell>
                  <TableCell>Pipeline</TableCell>
                  <TableCell>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.excluded.slice(0, 200).map((r, i) => (
                  <TableRow key={`${r.pipelineId ?? 'x'}-${r.userId}-${i}`}>
                    <TableCell>{r.displayName}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{r.userId || '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{r.pipelineId ?? '—'}</TableCell>
                    <TableCell>{r.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {result.excluded.length > 200 ? (
              <Typography variant="caption" color="text.secondary">
                Showing first 200 excluded rows; copy JSON for full list.
              </Typography>
            ) : null}

            {result.mode === 'send' && result.sendResults?.length ? (
              <>
                <Typography variant="subtitle2">Send results</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell>Pipeline</TableCell>
                      <TableCell>SMS sent</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.sendResults.map((s) => (
                      <TableRow key={`${s.pipelineId}-${s.userId}`}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{s.userId}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{s.pipelineId}</TableCell>
                        <TableCell>{s.duplicateSkipped ? 'no (deduped)' : s.success ? 'yes' : 'no'}</TableCell>
                        <TableCell>
                          {s.duplicateSkipped
                            ? 'Same user — SMS already sent for another employment in this run; cooldown applied.'
                            : s.error ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={copyJson} disabled={!result}>
          Copy JSON
        </Button>
        <Button onClick={handleClose}>Close</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!tenantId || loading || sending || !result || result.included.length === 0}
          onClick={() => void runSend()}
        >
          {sending ? <CircularProgress size={22} /> : 'Send SMS to included'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

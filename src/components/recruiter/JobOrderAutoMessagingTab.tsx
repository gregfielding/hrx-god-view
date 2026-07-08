import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { db, functions } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type { JobOrder } from '../../types/recruiter/jobOrder';

type UserGroupOption = {
  id: string;
  label: string;
  /**
   * AG.0 — true when this group was created by the auto-cascade (`type: 'auto'` or
   * an `autoCreatedFrom` audit object on the doc). Drives the "Auto-attached" chip
   * badge so recruiters see at a glance which rows came from automation vs were
   * added manually. Removable here even when auto-attached, but the next backfill
   * / posting sync will re-attach if the JO's `autoCreatedUserGroupId` is still set.
   */
  isAuto?: boolean;
};

export type AutoMessagingSendLogRow = {
  id: string;
  sentAt: Date | null;
  city?: string;
  shiftId?: string;
  jobPostId?: string | null;
  boardUrl?: string;
  smsDelivered?: number;
  pushDelivered?: number;
  skippedDueToCooldown?: number;
  skippedNoReachableChannel?: number;
  recipientPoolSize?: number;
  messageEnSample?: string;
  messageEsSample?: string;
  note?: string;
  source?: string;
  radiusMilesUsed?: number;
};

/** previewJobOrderWorkerReach response (ok:true shape). */
type WorkerReachPreview = {
  ok: boolean;
  reason?: string;
  radiusMiles?: number;
  withinRadius?: number;
  candidates?: number;
  smsReachable?: number;
  texted24h?: number;
  city?: string;
  boardUrl?: string;
  defaultMessage?: string;
};

interface JobOrderAutoMessagingTabProps {
  tenantId: string;
  jobOrderId: string;
  jobOrder: JobOrder;
  onJobOrderUpdated: () => void;
}

const JobOrderAutoMessagingTab: React.FC<JobOrderAutoMessagingTabProps> = ({
  tenantId,
  jobOrderId,
  jobOrder,
  onJobOrderUpdated,
}) => {
  const [userGroups, setUserGroups] = useState<UserGroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [selected, setSelected] = useState<UserGroupOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [logRows, setLogRows] = useState<AutoMessagingSendLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendLastSentAt, setResendLastSentAt] = useState<Date | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  // Worker Reach — manual radius blast
  const [reachRadius, setReachRadius] = useState<number>(30);
  const [reachPreview, setReachPreview] = useState<WorkerReachPreview | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [reachError, setReachError] = useState<string | null>(null);
  const [reachMessage, setReachMessage] = useState('');
  const [reachMessageTouched, setReachMessageTouched] = useState(false);
  const [blastConfirmOpen, setBlastConfirmOpen] = useState(false);
  const [blastSending, setBlastSending] = useState(false);
  const [blastResult, setBlastResult] = useState<string | null>(null);
  const [blastError, setBlastError] = useState<string | null>(null);

  const serverGroupIdsKey = useMemo(() => {
    const raw = (jobOrder as any).autoMessagingUserGroupIds as unknown;
    if (!Array.isArray(raw)) return '';
    return raw
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice()
      .sort()
      .join(',');
  }, [jobOrder]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId) return;
      setLoadingGroups(true);
      try {
        const ref = collection(db, 'tenants', tenantId, 'userGroups');
        const snap = await getDocs(ref);
        if (cancelled) return;
        const rows: UserGroupOption[] = snap.docs.map((d) => {
          const data = d.data() as {
            groupName?: string;
            name?: string;
            title?: string;
            type?: string;
            autoCreatedFrom?: unknown;
          };
          const label = data.groupName || data.title || data.name || d.id;
          // AG.0 — match `isAutoUserGroup` in `RecruiterUserGroups.tsx` (canonical:
          // `type === 'auto'` OR an `autoCreatedFrom` audit object exists).
          const isAuto =
            data.type === 'auto' ||
            (data.autoCreatedFrom != null && typeof data.autoCreatedFrom === 'object');
          return { id: d.id, label, isAuto };
        });
        rows.sort((a, b) => a.label.localeCompare(b.label));
        setUserGroups(rows);
      } catch (e) {
        console.error('Failed to load user groups', e);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!userGroups.length) {
      setSelected([]);
      return;
    }
    const ids =
      serverGroupIdsKey === ''
        ? []
        : serverGroupIdsKey.split(',').filter((x) => x.length > 0);
    const map = new Map(userGroups.map((g) => [g.id, g]));
    setSelected(ids.map((id) => map.get(id) || { id, label: id }));
  }, [serverGroupIdsKey, userGroups]);

  useEffect(() => {
    if (!tenantId || !jobOrderId) return;
    const logRef = collection(db, p.jobOrderAutoMessagingSendLog(tenantId, jobOrderId));
    const q = query(logRef, orderBy('sentAt', 'desc'), limit(50));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: AutoMessagingSendLogRow[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const sentAtRaw = data.sentAt as { toDate?: () => Date } | undefined;
          const sentAt = sentAtRaw?.toDate ? sentAtRaw.toDate() : null;
          return {
            id: d.id,
            sentAt,
            city: typeof data.city === 'string' ? data.city : undefined,
            shiftId: typeof data.shiftId === 'string' ? data.shiftId : undefined,
            jobPostId: (data.jobPostId as string | null) ?? null,
            boardUrl: typeof data.boardUrl === 'string' ? data.boardUrl : undefined,
            smsDelivered: typeof data.smsDelivered === 'number' ? data.smsDelivered : undefined,
            pushDelivered: typeof data.pushDelivered === 'number' ? data.pushDelivered : undefined,
            skippedDueToCooldown: typeof data.skippedDueToCooldown === 'number' ? data.skippedDueToCooldown : undefined,
            skippedNoReachableChannel:
              typeof data.skippedNoReachableChannel === 'number' ? data.skippedNoReachableChannel : undefined,
            recipientPoolSize: typeof data.recipientPoolSize === 'number' ? data.recipientPoolSize : undefined,
            messageEnSample: typeof data.messageEnSample === 'string' ? data.messageEnSample : undefined,
            messageEsSample: typeof data.messageEsSample === 'string' ? data.messageEsSample : undefined,
            note: typeof data.note === 'string' ? data.note : undefined,
            source: typeof data.source === 'string' ? data.source : undefined,
            radiusMilesUsed: typeof data.radiusMilesUsed === 'number' ? data.radiusMilesUsed : undefined,
          };
        });
        setLogRows(rows);
        setLogLoading(false);
      },
      (err) => {
        console.error('autoMessagingSendLog subscription error', err);
        setLogLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId, jobOrderId]);

  const handleResend = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    setResendLoading(true);
    setResendError(null);
    try {
      const fn = httpsCallable(functions, 'sendJobOrderShiftPostedResendCallable');
      const result = await fn({ tenantId, jobOrderId });
      const data = (result as { data?: { sentAt?: string } })?.data || {};
      setResendLastSentAt(data?.sentAt ? new Date(data.sentAt) : new Date());
    } catch (e: unknown) {
      const raw =
        (e as { message?: string })?.message ||
        (typeof e === 'string' ? e : '') ||
        'Resend failed';
      const cleaned = String(raw)
        .replace(/^Firebase:\s*/i, '')
        .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
        .trim();
      setResendError(cleaned || 'Resend failed');
    } finally {
      setResendLoading(false);
    }
  }, [tenantId, jobOrderId]);

  // Live Worker Reach preview — refetch on radius change. The default message
  // only seeds the field while the recruiter hasn't edited it.
  useEffect(() => {
    if (!tenantId || !jobOrderId) return;
    let cancelled = false;
    setReachLoading(true);
    setReachError(null);
    const fn = httpsCallable(functions, 'previewJobOrderWorkerReach');
    fn({ tenantId, jobOrderId, radiusMiles: reachRadius })
      .then((result) => {
        if (cancelled) return;
        const data = (result?.data ?? {}) as WorkerReachPreview;
        setReachPreview(data);
        if (data.ok && data.defaultMessage) {
          setReachMessage((prev) => (reachMessageTouched && prev.trim() ? prev : data.defaultMessage!));
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setReachError(e instanceof Error ? e.message.replace(/^Firebase:\s*/i, '') : 'Could not load worker reach');
      })
      .finally(() => {
        if (!cancelled) setReachLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reachMessageTouched intentionally omitted: touching the field must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, jobOrderId, reachRadius]);

  const reachMessageIsDefault =
    !reachMessageTouched ||
    reachMessage.trim() === (reachPreview?.defaultMessage ?? '').trim();

  const handleSendBlast = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    setBlastSending(true);
    setBlastError(null);
    setBlastResult(null);
    try {
      const fn = httpsCallable(functions, 'sendJobOrderWorkerReachBlast');
      const payload: Record<string, unknown> = { tenantId, jobOrderId, radiusMiles: reachRadius };
      // Leaving the default untouched lets the server send the Spanish version
      // to Spanish-preference workers; a custom message goes to everyone as-is.
      if (!reachMessageIsDefault && reachMessage.trim()) payload.message = reachMessage.trim();
      const result = await fn(payload);
      const data = (result?.data ?? {}) as {
        smsDelivered?: number;
        pushDelivered?: number;
        skippedSmsDailyCap?: number;
      };
      const parts = [
        `${data.smsDelivered ?? 0} SMS`,
        `${data.pushDelivered ?? 0} push`,
      ];
      if ((data.skippedSmsDailyCap ?? 0) > 0) parts.push(`${data.skippedSmsDailyCap} skipped by the 24h limit`);
      setBlastResult(`Blast sent — ${parts.join(' · ')}.`);
      setBlastConfirmOpen(false);
    } catch (e: unknown) {
      const raw = (e as { message?: string })?.message || 'Blast failed';
      setBlastError(String(raw).replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\s*$/i, '').trim());
    } finally {
      setBlastSending(false);
    }
  }, [tenantId, jobOrderId, reachRadius, reachMessage, reachMessageIsDefault]);

  const handleSave = useCallback(async () => {
    if (!tenantId || !jobOrderId) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const ref = doc(db, 'tenants', tenantId, 'job_orders', jobOrderId);
      await updateDoc(ref, {
        autoMessagingUserGroupIds: selected.map((s) => s.id),
        updatedAt: new Date(),
      });
      setSaveOk(true);
      onJobOrderUpdated();
      window.setTimeout(() => setSaveOk(false), 3000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [tenantId, jobOrderId, selected, onJobOrderUpdated]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Alert severity="info" sx={{ borderRadius: 1 }}>
        When new shifts are added to this job order, members of the selected user groups can receive an SMS and a push
        notification with the jobs board link. Messages are sent in English or Spanish based on each user&apos;s language
        preference. To avoid spam, each user can receive at most one of these messages per 15 minutes for this job order
        (for example, adding 10 shifts quickly will still only notify them once).
      </Alert>

      <Card variant="outlined">
        <CardContent sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
            Notify user groups
          </Typography>
          <Autocomplete
            multiple
            disableCloseOnSelect
            options={userGroups}
            loading={loadingGroups}
            value={selected}
            onChange={(_e, v) => setSelected(v)}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const tagProps = getTagProps({ index });
                if (option.isAuto) {
                  // AG.0 — show "Auto-attached" tooltip + success-tinted chip.
                  // Removable still works (delete icon stays from getTagProps), but
                  // recruiters see this row came from the automation and a future
                  // backfill / posting sync may re-attach it.
                  return (
                    <Tooltip
                      key={option.id}
                      title="Auto-attached: created automatically from the National Account's auto-group setting. Removable, but will be re-attached on the next posting sync if the JO's auto-group is still set."
                    >
                      <Chip
                        {...tagProps}
                        label={`${option.label} \u00b7 Auto`}
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    </Tooltip>
                  );
                }
                return <Chip label={option.label} {...tagProps} key={option.id} size="small" />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="User groups"
                placeholder={loadingGroups ? 'Loading…' : 'Select one or more groups'}
              />
            )}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
            <Button variant="contained" onClick={() => void handleSave()} disabled={saving || loadingGroups}>
              {saving ? <CircularProgress size={20} /> : 'Save'}
            </Button>
            {saveOk && (
              <Typography variant="body2" color="success.main">
                Saved
              </Typography>
            )}
            {saveError && (
              <Typography variant="body2" color="error">
                {saveError}
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent sx={{ p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
            Worker Reach
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Text every eligible worker near this worksite about the posting — nearest first, up to 200 people.
            Workers who opted out of texts are never included, and anyone already texted a shift invite in the
            last 24 hours is skipped automatically.
          </Typography>

          <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={reachRadius}
              onChange={(_e, v) => {
                if (v != null) setReachRadius(v);
              }}
            >
              <ToggleButton value={15}>15 mi</ToggleButton>
              <ToggleButton value={30}>30 mi</ToggleButton>
              <ToggleButton value={60}>60 mi</ToggleButton>
            </ToggleButtonGroup>
            {reachLoading ? (
              <Stack direction="row" alignItems="center" spacing={1}>
                <CircularProgress size={14} />
                <Typography variant="body2" color="text.secondary">
                  Counting workers…
                </Typography>
              </Stack>
            ) : reachPreview?.ok ? (
              <Typography variant="body2">
                <strong>{reachPreview.withinRadius ?? 0}</strong> workers within {reachRadius} miles
                {' · '}
                <strong>{reachPreview.smsReachable ?? 0}</strong> reachable by SMS
                {(reachPreview.texted24h ?? 0) > 0 && (
                  <>
                    {' · '}
                    <strong>{reachPreview.texted24h}</strong> texted in the last 24h (will be skipped)
                  </>
                )}
                {(reachPreview.withinRadius ?? 0) > 200 && (
                  <Typography component="span" variant="body2" color="text.secondary">
                    {' '}
                    — nearest 200 receive the blast
                  </Typography>
                )}
              </Typography>
            ) : reachPreview && !reachPreview.ok ? (
              <Typography variant="body2" color="text.secondary">
                This job order has no worksite coordinates, so a radius blast isn&apos;t available.
              </Typography>
            ) : reachError ? (
              <Typography variant="body2" color="error">
                {reachError}
              </Typography>
            ) : null}
          </Stack>

          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Message"
            value={reachMessage}
            onChange={(e) => {
              setReachMessage(e.target.value);
              setReachMessageTouched(true);
            }}
            disabled={!reachPreview?.ok}
            helperText={
              reachMessageIsDefault
                ? 'Default message — Spanish-speaking workers automatically get the Spanish version. Edit to customize.'
                : 'Custom message — sent to everyone as written. The jobs board link is added automatically if you remove it (use {link} to place it).'
            }
            inputProps={{ maxLength: 480 }}
            sx={{ mb: 1.5 }}
          />

          <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              onClick={() => {
                setBlastError(null);
                setBlastConfirmOpen(true);
              }}
              disabled={
                reachLoading || blastSending || !reachPreview?.ok || (reachPreview?.candidates ?? 0) === 0
              }
            >
              Send Blast
            </Button>
            {blastResult && (
              <Typography variant="body2" color="success.main">
                {blastResult}
              </Typography>
            )}
            {blastError && !blastConfirmOpen && (
              <Typography variant="body2" color="error">
                {blastError}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={blastConfirmOpen} onClose={() => !blastSending && setBlastConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Send blast to nearby workers?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            This will text up to <strong>{Math.min(reachPreview?.candidates ?? 0, 200)}</strong> workers within{' '}
            <strong>{reachRadius} miles</strong> of the worksite
            {reachPreview?.city ? ` (${reachPreview.city})` : ''}. Workers texted a shift invite in the last 24
            hours are skipped.
          </Typography>
          <Box
            sx={{
              p: 1.25,
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontSize: '0.85rem',
              wordBreak: 'break-word',
            }}
          >
            {reachMessage || reachPreview?.defaultMessage || ''}
          </Box>
          {reachMessageIsDefault && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              Spanish-speaking workers receive the Spanish version of this message.
            </Typography>
          )}
          {blastError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {blastError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBlastConfirmOpen(false)} disabled={blastSending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSendBlast()}
            disabled={blastSending}
            startIcon={blastSending ? <CircularProgress color="inherit" size={14} /> : undefined}
          >
            {blastSending ? 'Sending…' : 'Confirm & Send'}
          </Button>
        </DialogActions>
      </Dialog>

      <Card variant="outlined">
        <CardContent sx={{ p: 2 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            sx={{ mb: 1 }}
            flexWrap="wrap"
            gap={0.75}
          >
            <Typography variant="subtitle1" fontWeight={700}>
              Notification log
            </Typography>
            <Stack alignItems="flex-end" spacing={0.15} sx={{ maxWidth: 260 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={() => void handleResend()}
                disabled={resendLoading}
                startIcon={
                  resendLoading ? <CircularProgress color="inherit" size={12} /> : undefined
                }
                sx={{
                  borderColor: 'divider',
                  color: 'text.secondary',
                  px: 0.5,
                  py: 0.125,
                  lineHeight: 1.2,
                  fontWeight: 600,
                  fontSize: '0.68rem',
                  minHeight: 26,
                  textTransform: 'none',
                }}
              >
                Resend Notification
              </Button>
              {resendError ? (
                <Typography
                  sx={{
                    fontSize: '0.6rem',
                    lineHeight: 1.3,
                    color: 'error.main',
                    textAlign: 'right',
                  }}
                >
                  {resendError}
                </Typography>
              ) : resendLastSentAt ? (
                <Typography
                  sx={{
                    fontSize: '0.6rem',
                    lineHeight: 1.3,
                    color: 'text.secondary',
                    textAlign: 'right',
                  }}
                >
                  Sent {resendLastSentAt.toLocaleString()}
                </Typography>
              ) : null}
            </Stack>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Timestamps reflect when the system sent (or attempted) notifications after a shift was created.
          </Typography>
          {logLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          ) : logRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No sends yet. Notifications appear here after shifts are added while the groups above are saved.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Sent</TableCell>
                  <TableCell>City</TableCell>
                  <TableCell align="right">SMS</TableCell>
                  <TableCell align="right">Push</TableCell>
                  <TableCell align="right">Skipped (cooldown)</TableCell>
                  <TableCell>Message (EN)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {row.sentAt ? format(row.sentAt, 'MMM d, yyyy h:mm a') : '—'}
                      {row.source === 'manual_blast' && (
                        <Chip
                          label={row.radiusMilesUsed ? `Blast · ${row.radiusMilesUsed} mi` : 'Blast'}
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ ml: 0.75, height: 18, fontSize: '0.62rem' }}
                        />
                      )}
                      {row.source === 'manual_resend' && (
                        <Chip
                          label="Resend"
                          size="small"
                          variant="outlined"
                          sx={{ ml: 0.75, height: 18, fontSize: '0.62rem' }}
                        />
                      )}
                    </TableCell>
                    <TableCell>{row.city ?? '—'}</TableCell>
                    <TableCell align="right">{row.smsDelivered ?? '—'}</TableCell>
                    <TableCell align="right">{row.pushDelivered ?? '—'}</TableCell>
                    <TableCell align="right">{row.skippedDueToCooldown ?? '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 360, wordBreak: 'break-word' }}>
                      {row.note === 'no_members_in_groups' ? (
                        <Typography variant="caption" color="text.secondary">
                          No members in selected groups
                        </Typography>
                      ) : (
                        row.messageEnSample ?? '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default JobOrderAutoMessagingTab;

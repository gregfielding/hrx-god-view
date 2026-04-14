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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
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
import { format } from 'date-fns';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type { JobOrder } from '../../types/recruiter/jobOrder';

type UserGroupOption = { id: string; label: string };

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
          const data = d.data() as { groupName?: string; name?: string; title?: string };
          const label = data.groupName || data.title || data.name || d.id;
          return { id: d.id, label };
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
        When new shifts are added to this gig job order, members of the selected user groups can receive an SMS and a
        push notification with the jobs board link. Messages are sent in English or Spanish based on each user&apos;s
        language preference. To avoid spam, each user can receive at most one of these messages per 15 minutes for this
        job order (for example, adding 10 shifts quickly will still only notify them once).
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
              value.map((option, index) => (
                <Chip label={option.label} {...getTagProps({ index })} key={option.id} size="small" />
              ))
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
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Notification log
          </Typography>
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

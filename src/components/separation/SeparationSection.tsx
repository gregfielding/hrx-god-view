/**
 * Worker separation/termination — header section for the recruiter User
 * Details view (item 2, companion to DnrSection).
 *
 * Chips: `Separated — <Entity>` for each active separation, plus a red
 * `Not eligible for rehire` chip when the flag is set. "Separate…" opens
 * the dialog: entity (from the worker's entity_employments), type
 * (voluntary w/ notice, voluntary no-notice, involuntary), last day,
 * reason, notes, rehire-eligible toggle, and the CA final-pay gate — an
 * involuntary separation can't be submitted until the recruiter confirms
 * final wages are settled in Everee (Labor Code §201/§203; the callable
 * enforces and timestamps it). Upcoming assignments at the entity are
 * listed and WILL be auto-cancelled (Greg's decision) — the dialog says so
 * plainly. All writes go through the `separateWorker` callable.
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db } from '../../firebase';

interface SeparationRecord {
  entityId: string;
  entityName?: string | null;
  separationType: string;
  lastDay: string;
  reasonCategory?: string | null;
  rehireEligible: boolean;
  separatedByName?: string | null;
  separatedAt?: string;
  status: 'active' | 'reversed';
}

interface EmploymentOption {
  employmentId: string;
  entityId: string;
  entityName: string;
  status: string;
}

const SEPARATION_TYPES = [
  { value: 'voluntary_notice', label: 'Voluntary (with notice)' },
  { value: 'voluntary_no_notice', label: 'Voluntary (no notice)' },
  { value: 'involuntary', label: 'Involuntary (terminated by C1)' },
] as const;

const SeparationSection: React.FC<{ tenantId: string; userId: string }> = ({
  tenantId,
  userId,
}) => {
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [rehireEligible, setRehireEligible] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [employments, setEmployments] = useState<EmploymentOption[] | null>(null);
  const [entityId, setEntityId] = useState('');
  const [sepType, setSepType] = useState('involuntary');
  const [lastDay, setLastDay] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [rehireOk, setRehireOk] = useState(true);
  const [finalPayConfirmed, setFinalPayConfirmed] = useState(false);
  const [upcoming, setUpcoming] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', userId), (snap) => {
      const u = snap.data() || {};
      const seps = (Array.isArray(u.separations) ? u.separations : []) as SeparationRecord[];
      setSeparations(seps.filter((s) => s?.status === 'active'));
      setRehireEligible(typeof u.rehireEligible === 'boolean' ? u.rehireEligible : null);
    });
    return unsub;
  }, [userId]);

  // Load the worker's entity employments + entity names on dialog open.
  useEffect(() => {
    // Loaded on MOUNT (not dialog-open): the "Separate…" action itself only
    // renders when the worker has a live (onboarding/active) employment.
    if (employments !== null) return;
    (async () => {
      try {
        const [emSnap, entSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'tenants', tenantId, 'entity_employments'),
              where('userId', '==', userId),
            ),
          ),
          getDocs(collection(db, 'tenants', tenantId, 'entities')),
        ]);
        const nameById = new Map(
          entSnap.docs.map((d) => [d.id, String((d.data() as any).name || d.id)]),
        );
        const opts: EmploymentOption[] = emSnap.docs
          .map((d) => {
            const e = d.data() as Record<string, unknown>;
            const eid = String(e.entityId || e.hiringEntityId || e.entityKey || '');
            return {
              employmentId: d.id,
              entityId: eid,
              entityName: nameById.get(eid) || eid,
              status: String(e.status || ''),
            };
          })
          // Separation only makes sense for a live employment — Greg's rule
          // (2026-07-11): currently onboarding or active. Inactive/terminated
          // rows never surface here.
          .filter((o) => o.entityId && ['onboarding', 'active'].includes(o.status));
        setEmployments(opts);
        if (opts.length === 1) setEntityId(opts[0].entityId);
      } catch {
        setEmployments([]);
        setError('Could not load employment records.');
      }
    })();
  }, [employments, tenantId, userId]);

  const hasLiveEmployment = (employments ?? []).length > 0;

  // Count live assignments at the chosen entity — they will be auto-cancelled.
  useEffect(() => {
    setUpcoming(0);
    if (!entityId) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'tenants', tenantId, 'assignments'), where('userId', '==', userId)),
        );
        const live = snap.docs
          .map((d) => d.data() as Record<string, unknown>)
          .filter(
            (a) =>
              !['canceled', 'cancelled', 'completed', 'ended'].includes(
                String(a.status || '').toLowerCase(),
              ) && String(a.hiringEntityId || '') === entityId,
          );
        setUpcoming(live.length);
      } catch {
        /* best-effort count */
      }
    })();
  }, [entityId, tenantId, userId]);

  const close = () => {
    setOpen(false);
    setEntityId('');
    setReason('');
    setNotes('');
    setRehireOk(true);
    setFinalPayConfirmed(false);
    setError(null);
  };

  const submit = async () => {
    const emp = (employments || []).find((e) => e.entityId === entityId);
    if (!emp) return;
    setSaving(true);
    setError(null);
    try {
      await httpsCallable(getFunctions(), 'separateWorker')({
        tenantId,
        userId,
        entityId: emp.entityId,
        entityName: emp.entityName,
        separationType: sepType,
        lastDay,
        reasonCategory: reason.trim() || null,
        notes: notes.trim() || null,
        rehireEligible: rehireOk,
        finalPayConfirmed,
      });
      close();
    } catch (e: any) {
      setError(String(e?.message || 'Separation failed.'));
    } finally {
      setSaving(false);
    }
  };

  const involuntary = sepType === 'involuntary';
  const canSubmit = !!entityId && !!lastDay && (!involuntary || finalPayConfirmed) && !saving;

  return (
    <Box sx={{ mt: 0.6 }}>
      <Stack direction="row" flexWrap="wrap" gap={0.5} alignItems="center">
        {separations.map((s) => (
          <Chip
            key={s.entityId}
            size="small"
            icon={<PersonOffIcon sx={{ fontSize: 14 }} />}
            label={`Separated — ${s.entityName || s.entityId}`}
            color="warning"
            title={[
              SEPARATION_TYPES.find((t) => t.value === s.separationType)?.label,
              `Last day ${s.lastDay}`,
              s.separatedByName ? `by ${s.separatedByName}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            sx={{ height: 24, '& .MuiChip-label': { px: 0.75, fontSize: '0.74rem' } }}
          />
        ))}
        {rehireEligible === false && (
          <Chip
            size="small"
            label="Not eligible for rehire"
            color="error"
            sx={{ height: 24, '& .MuiChip-label': { px: 0.75, fontSize: '0.74rem' } }}
          />
        )}
        {hasLiveEmployment && (
          <Button
            size="small"
            onClick={() => setOpen(true)}
            sx={{ minWidth: 0, px: 0.75, fontSize: '0.72rem', color: 'text.secondary' }}
          >
            Separate…
          </Button>
        )}
      </Stack>

      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>Separate worker</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Ends this worker's employment at the selected entity. They stop seeing that
            entity's job postings, can't be assigned its shifts, and stop receiving its job
            messages. Upcoming assignments at the entity are cancelled automatically.
          </Typography>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel id="sep-entity-label">Entity</InputLabel>
              <Select
                labelId="sep-entity-label"
                label="Entity"
                value={entityId}
                onChange={(e) => setEntityId(String(e.target.value))}
              >
                {(employments || []).map((e) => (
                  <MenuItem key={e.entityId} value={e.entityId}>
                    {e.entityName} ({e.status})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="sep-type-label">Separation type</InputLabel>
              <Select
                labelId="sep-type-label"
                label="Separation type"
                value={sepType}
                onChange={(e) => setSepType(String(e.target.value))}
              >
                {SEPARATION_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label="Last day of employment"
              value={lastDay}
              onChange={(e) => setLastDay(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <TextField
              size="small"
              multiline
              minRows={2}
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <FormControlLabel
              control={
                <Checkbox checked={rehireOk} onChange={(e) => setRehireOk(e.target.checked)} />
              }
              label="Eligible for rehire"
            />
            {upcoming > 0 && (
              <Alert severity="warning">
                {upcoming} upcoming assignment{upcoming === 1 ? '' : 's'} at this entity will be
                cancelled automatically when you submit.
              </Alert>
            )}
            {involuntary && (
              <Alert severity={finalPayConfirmed ? 'success' : 'error'}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  California requires final wages the <strong>same day</strong> for involuntary
                  terminations (Labor Code §201; §203 adds a day of wages per day late, up to 30
                  days). Settle the final payment in{' '}
                  <Link href="https://app.everee.com" target="_blank" rel="noopener noreferrer">
                    Everee
                  </Link>{' '}
                  first, then confirm:
                </Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={finalPayConfirmed}
                      onChange={(e) => setFinalPayConfirmed(e.target.checked)}
                    />
                  }
                  label="Final pay is settled in Everee (all hours, premiums, and PTO owed)"
                />
              </Alert>
            )}
            <Alert severity="info">
              Remember to also end the worker's employment in the Everee dashboard — Everee has
              no termination API, so that step is manual.
            </Alert>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" color="error" disabled={!canSubmit} onClick={submit}>
            {saving ? 'Separating…' : 'Separate worker'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SeparationSection;

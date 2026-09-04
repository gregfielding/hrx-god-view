/**
 * Entity onboarding status card (Greg 2026-09-04 "one point of truth"):
 * the SAME four items the record-header chip is driven by, read live from
 * `everee_workers/{entityId}__{uid}` (readiness mirror + everifyCaseStatus).
 * Select = Tax forms · Direct deposit · SSN · E-Verify; Events (1099) =
 * Tax form (W-9) · Direct deposit. Webhooks update the doc within seconds,
 * and the onSnapshot here means the card flips green with no reload.
 *
 * Replaces the legacy manual radio checklist for recruiters on
 * Everee-enabled entities — the one manual escape hatch kept is the
 * employer I-9 Section-2 attestation (Everee never reports that
 * signature), same callable as the record header's "Mark signed".
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../../firebase';
import { normalizeLast4SsnDigits } from '../../../../utils/last4Ssn';
import type { EmploymentEntityKey } from './employmentV2Types';

interface EmploymentEvereeStatusCardProps {
  tenantId: string;
  userId: string;
  entityKey: EmploymentEntityKey;
  /** Entities doc id, e.g. `c1_select_llc` — the everee_workers doc prefix. */
  entityId: string;
  /** Deep link to the worker's Everee record (Documents tab preferred). */
  evereeUrl?: string | null;
  viewerKind?: 'worker' | 'recruiter';
}

type RowState = 'done' | 'open' | 'error';

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    try {
      return maybe.toDate();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function fmt(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const EmploymentEvereeStatusCard: React.FC<EmploymentEvereeStatusCardProps> = ({
  tenantId,
  userId,
  entityKey,
  entityId,
  evereeUrl = null,
  viewerKind = 'recruiter',
}) => {
  const [mirror, setMirror] = useState<Record<string, unknown> | null>(null);
  const [everifyCaseStatus, setEverifyCaseStatus] = useState<string>('');
  const [everifyUpdatedAt, setEverifyUpdatedAt] = useState<Date | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ssnLast4, setSsnLast4] = useState<string>('');
  const [markingI9, setMarkingI9] = useState(false);

  useEffect(() => {
    if (!tenantId || !userId || !entityId) return;
    const ref = doc(db, 'tenants', tenantId, 'everee_workers', `${entityId}__${userId}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.data() ?? {}) as Record<string, unknown>;
        setMirror((data.readinessMirror ?? null) as Record<string, unknown> | null);
        setEverifyCaseStatus(String(data.everifyCaseStatus ?? ''));
        setEverifyUpdatedAt(toDate(data.everifyCaseStatusUpdatedAt));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    return () => unsub();
  }, [tenantId, userId, entityId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getDoc(doc(db, 'users', userId)).then((snap) => {
      if (cancelled) return;
      const raw = (snap.data() ?? {}) as Record<string, unknown>;
      setSsnLast4(normalizeLast4SsnDigits(String(raw.last4SSN ?? raw.ssnLast4 ?? '')));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const m = mirror ?? {};
  const taxAt = toDate(m.w4SignedAt) ?? toDate(m.w9SignedAt);
  const ddAt = toDate(m.directDepositVerifiedAt);
  const ddReady = Boolean(ddAt) || m.directDepositReady === true;
  const completedAt = toDate(m.completedOnboardingAt);
  const i9At = toDate(m.i9SignedAt);
  const employerI9At = toDate(m.employerI9SignedAt);

  const cs = everifyCaseStatus.toLowerCase();
  const everify: 'authorized' | 'pending' | 'error' | 'none' = /authorized/.test(cs)
    ? 'authorized'
    : /submission_error|final|fnc/.test(cs)
      ? 'error'
      : cs
        ? 'pending'
        : 'none';

  const ssnComplete = Boolean(ssnLast4) || Boolean(completedAt);

  const rows = useMemo(() => {
    const out: Array<{
      label: string;
      state: RowState;
      detail: string | null;
    }> = [];
    if (entityKey === 'events') {
      out.push({
        label: 'Tax form (1099)',
        state: taxAt ? 'done' : 'open',
        detail: fmt(taxAt),
      });
      out.push({
        label: 'Direct deposit',
        state: ddReady ? 'done' : 'open',
        detail: fmt(ddAt),
      });
      return out;
    }
    out.push({ label: 'Tax forms', state: taxAt ? 'done' : 'open', detail: fmt(taxAt) });
    out.push({
      label: 'Direct deposit',
      state: ddReady ? 'done' : 'open',
      detail: fmt(ddAt),
    });
    out.push({ label: 'SSN', state: ssnComplete ? 'done' : 'open', detail: null });
    out.push({
      label:
        everify === 'pending'
          ? 'E-Verify (in progress)'
          : everify === 'error'
            ? 'E-Verify (needs attention)'
            : 'E-Verify',
      state: everify === 'authorized' ? 'done' : everify === 'error' ? 'error' : 'open',
      detail: fmt(everifyUpdatedAt),
    });
    return out;
  }, [entityKey, taxAt, ddAt, ddReady, ssnComplete, everify, everifyUpdatedAt]);

  const allComplete = rows.every((r) => r.state === 'done');

  // Everee reports the worker's Section 1 but never the employer's Section 2
  // e-signature — recruiters attest it here (same E.7 callable as the record
  // header's "Mark signed").
  const showEmployerI9Attestation =
    viewerKind === 'recruiter' && entityKey === 'select' && Boolean(i9At) && !employerI9At;

  const handleMarkI9Signed = async () => {
    const ok = window.confirm(
      'Confirm the employer I-9 (Section 2) is SIGNED in Everee for this worker?\n\n' +
        'This records the completion in HRX under your name — Everee does not report the signature to us.',
    );
    if (!ok) return;
    setMarkingI9(true);
    try {
      await httpsCallable(getFunctions(), 'csaMarkI9Section2Complete')({
        tenantId,
        entityId,
        userId,
        documentTypes: ['completed_in_everee_esignature'],
        notes:
          'Employer signature completed in Everee (Documents tab); confirmed from the Employment tab status card.',
      });
      // The mirror/readiness cascade updates the snapshot; onSnapshot re-renders.
    } catch (e) {
      window.alert(`Could not mark the I-9 signed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMarkingI9(false);
    }
  };

  if (!loaded) return null;
  if (!mirror && !everifyCaseStatus) return null; // not provisioned yet — sync card handles that state

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardHeader
        title="Onboarding status"
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        subheader="Live from the Everee mirror — updates within seconds of the worker finishing a step."
        subheaderTypographyProps={{ variant: 'caption' }}
        action={
          <Chip
            size="small"
            color={allComplete ? 'success' : 'warning'}
            label={allComplete ? 'Complete' : 'Onboarding'}
            sx={{ mt: 0.5, mr: 0.5 }}
          />
        }
        sx={{ pb: 0.5 }}
      />
      <CardContent sx={{ pt: 1, '&:last-child': { pb: 2 } }}>
        <Stack spacing={0.75}>
          {rows.map((row) => (
            <Stack key={row.label} direction="row" spacing={1} alignItems="center">
              {row.state === 'done' ? (
                <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
              ) : row.state === 'error' ? (
                <WarningAmberIcon sx={{ fontSize: 18, color: 'error.main' }} />
              ) : (
                <HourglassEmptyIcon sx={{ fontSize: 18, color: 'warning.main' }} />
              )}
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {row.label}
              </Typography>
              {row.detail ? (
                <Typography variant="caption" color="text.secondary">
                  {row.detail}
                </Typography>
              ) : null}
              {row.state === 'error' && evereeUrl ? (
                <Link
                  href={evereeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                  underline="hover"
                >
                  Fix in Everee
                </Link>
              ) : null}
            </Stack>
          ))}
          {showEmployerI9Attestation ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 3.2 }}>
              <Typography variant="caption" color="text.secondary">
                Employer I-9 (Section 2) signature not yet recorded.
              </Typography>
              <Tooltip title="Everee never reports the employer e-signature — after signing in Everee, record it here under your name.">
                <span>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => void handleMarkI9Signed()}
                    disabled={markingI9}
                    sx={{ fontSize: '0.72rem', py: 0, minHeight: 24 }}
                  >
                    {markingI9 ? 'Recording…' : 'Mark signed (done in Everee)'}
                  </Button>
                </span>
              </Tooltip>
              {evereeUrl ? (
                <Link
                  href={evereeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="caption"
                  underline="hover"
                >
                  Open Everee documents
                </Link>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            This card and the record-header chip read the same mirror — they can never disagree.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
};

export default EmploymentEvereeStatusCard;

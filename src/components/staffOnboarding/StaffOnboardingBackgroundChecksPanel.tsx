/**
 * Tenant-scoped table of AccuSource background checks + read-only detail dialog.
 * Shows service-level status, webhook events, and PDFs via server callable (no API key in client).
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
  Typography,
} from '@mui/material';
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { db, functions } from '../../firebase';
import type {
  BackgroundCheckEventRow,
  BackgroundCheckRecord,
  ServiceOrderStatusEntry,
} from '../../types/backgroundCheck';

const PAGE_LIMIT = 200;
const EVENTS_LIMIT = 40;

const getAccusourcePdf = httpsCallable(functions, 'getAccusourceBackgroundCheckPdf');

function formatFirestoreTime(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) {
    return format(value.toDate(), 'MMM d, yyyy p');
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return format((value as Timestamp).toDate(), 'MMM d, yyyy p');
    } catch {
      return '—';
    }
  }
  return '—';
}

function statusColor(status: string | undefined): 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' {
  const s = String(status || '').toLowerCase();
  if (s === 'report_ready' || s === 'completed' || s === 'drug_report_ready') return 'success';
  if (s === 'error' || s === 'canceled') return 'error';
  if (s === 'draft' || s === 'queued') return 'default';
  if (s === 'awaiting_applicant') return 'warning';
  return 'info';
}

function docToRow(id: string, data: Record<string, unknown>): BackgroundCheckRecord {
  return { id, ...data } as BackgroundCheckRecord;
}

function lastServiceSummary(r: BackgroundCheckRecord): string {
  const c = r.lastServiceComponent;
  if (c?.serviceName && c?.status) return `${c.serviceName}: ${c.status}`;
  if (c?.status) return c.status;
  if (r.providerStatus && r.lastWebhookType?.toLowerCase().includes('service')) return r.providerStatus;
  return '—';
}

const DETAIL_FIELDS: { key: keyof BackgroundCheckRecord; label: string }[] = [
  { key: 'id', label: 'Document ID' },
  { key: 'hrxStatus', label: 'HRX status' },
  { key: 'providerStatus', label: 'Provider status' },
  { key: 'orderMode', label: 'Order mode' },
  { key: 'requestedPackageName', label: 'Package' },
  { key: 'requestedPackageId', label: 'Package ID' },
  { key: 'candidateName', label: 'Candidate' },
  { key: 'candidateId', label: 'Candidate user ID' },
  { key: 'accountName', label: 'Account' },
  { key: 'jobOrderId', label: 'Job order ID' },
  { key: 'worksiteId', label: 'Worksite ID' },
  { key: 'clientId', label: 'Client ID (HRX)' },
  { key: 'providerProfileId', label: 'Provider profile ID' },
  { key: 'providerProfileNumber', label: 'Provider profile # (SD)' },
  { key: 'providerSubjectId', label: 'Provider subject ID' },
  { key: 'providerEnvironment', label: 'Environment' },
  { key: 'applicantPortalLink', label: 'Applicant portal' },
  { key: 'lastWebhookType', label: 'Last webhook' },
  { key: 'syncError', label: 'Sync error' },
  { key: 'createdBy', label: 'Created by (uid)' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'lastWebhookAt', label: 'Last webhook at' },
];

export interface StaffOnboardingBackgroundChecksPanelProps {
  tenantId: string | undefined;
}

const StaffOnboardingBackgroundChecksPanel: React.FC<StaffOnboardingBackgroundChecksPanelProps> = ({
  tenantId,
}) => {
  const [rows, setRows] = useState<BackgroundCheckRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BackgroundCheckRecord | null>(null);
  const [eventRows, setEventRows] = useState<BackgroundCheckEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<'final' | 'drug' | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'backgroundChecks'),
      where('tenantId', '==', tenantId),
      orderBy('updatedAt', 'desc'),
      limit(PAGE_LIMIT),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => docToRow(d.id, d.data() as Record<string, unknown>)));
        setLoading(false);
      },
      (err) => {
        console.error('[BackgroundChecks]', err);
        setError(err.message || 'Failed to load background checks.');
        setLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId]);

  useEffect(() => {
    if (!selected?.id) {
      setEventRows([]);
      return;
    }

    setEventsLoading(true);
    const eventsRef = collection(doc(db, 'backgroundChecks', selected.id), 'events');
    const q = query(eventsRef, orderBy('receivedAt', 'desc'), limit(EVENTS_LIMIT));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setEventRows(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              type: typeof x.type === 'string' ? x.type : undefined,
              processingStatus: typeof x.processingStatus === 'string' ? x.processingStatus : undefined,
              receivedAt: (x.receivedAt as Timestamp | undefined) ?? null,
              processedAt: (x.processedAt as Timestamp | undefined) ?? null,
            };
          }),
        );
        setEventsLoading(false);
      },
      (err) => {
        console.error('[BackgroundChecks events]', err);
        setEventRows([]);
        setEventsLoading(false);
      },
    );

    return () => unsub();
  }, [selected?.id]);

  const detailValue = useMemo(() => {
    if (!selected) return null;
    return (key: keyof BackgroundCheckRecord) => {
      const v = selected[key];
      if (key === 'createdAt' || key === 'updatedAt' || key === 'lastWebhookAt') {
        return formatFirestoreTime(v);
      }
      if (v === null || v === undefined || v === '') return '—';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'object') return '—';
      return String(v);
    };
  }, [selected]);

  const openPdf = useCallback(async (kind: 'final' | 'drug') => {
    if (!selected?.id) return;
    setPdfError(null);
    setPdfLoading(kind);
    try {
      const result = await getAccusourcePdf({ backgroundCheckId: selected.id, kind });
      const data = result.data as { pdfBase64?: string; mimeType?: string };
      const b64 = data.pdfBase64;
      if (!b64) {
        setPdfError('Empty PDF response.');
        return;
      }
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: data.mimeType || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Failed to load PDF.';
      setPdfError(msg);
    } finally {
      setPdfLoading(null);
    }
  }, [selected?.id]);

  const serviceEntries = useMemo((): [string, ServiceOrderStatusEntry][] => {
    const m = selected?.providerServiceOrderStatus;
    if (!m || typeof m !== 'object') return [];
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [selected?.providerServiceOrderStatus]);

  if (!tenantId) {
    return <Alert severity="warning">Select an active tenant to view background checks.</Alert>;
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2" component="span" display="block" gutterBottom>
            {error}
          </Typography>
          {String(error).includes('Missing or insufficient permissions') ? (
            <Typography variant="caption" color="text.secondary" component="div">
              Firestore rules require your <strong>user document</strong> (<code>users/&lt;your uid&gt;</code>) to show
              assignment to this tenant and security level ≥ 5 for that tenant (or HRX). The app route may use
              claims/session while rules only read the Firestore profile—ask an admin to align tenant assignment and{' '}
              <code>tenantIds.&lt;tenantId&gt;.securityLevel</code> (or root <code>securityLevel</code>) with access
              you expect.
            </Typography>
          ) : null}
        </Alert>
      ) : null}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Updated</TableCell>
                <TableCell>Candidate</TableCell>
                <TableCell>Package</TableCell>
                <TableCell>HRX status</TableCell>
                <TableCell>Last service</TableCell>
                <TableCell>Provider ID</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      No screening orders for this tenant yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setSelected(r)}
                  >
                    <TableCell>{formatFirestoreTime(r.updatedAt)}</TableCell>
                    <TableCell>{r.candidateName || r.candidateId || '—'}</TableCell>
                    <TableCell>{r.requestedPackageName || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.hrxStatus || '—'}
                        color={statusColor(r.hrxStatus as string | undefined)}
                        variant={r.hrxStatus ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap title={lastServiceSummary(r)}>
                        {lastServiceSummary(r)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.providerProfileId || '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                      >
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth scroll="paper">
        <DialogTitle>Background check</DialogTitle>
        <DialogContent dividers>
          {selected && detailValue ? (
            <Stack spacing={2}>
              {pdfError ? (
                <Alert severity="error" onClose={() => setPdfError(null)}>
                  {pdfError}
                </Alert>
              ) : null}

              <Box sx={{ display: 'grid', rowGap: 1.5 }}>
                {DETAIL_FIELDS.map(({ key, label }) => {
                  const raw = selected[key];
                  if (key === 'applicantPortalLink' && typeof raw === 'string' && raw.startsWith('http')) {
                    return (
                      <Box key={key}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {label}
                        </Typography>
                        <Link href={raw} target="_blank" rel="noopener noreferrer">
                          Open applicant portal
                        </Link>
                      </Box>
                    );
                  }
                  return (
                    <Box key={String(key)}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {label}
                      </Typography>
                      <Typography variant="body2">{detailValue(key)}</Typography>
                    </Box>
                  );
                })}
              </Box>

              {serviceEntries.length > 0 ? (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Service components
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" gap={0.75}>
                      {serviceEntries.map(([sid, entry]) => (
                        <Chip
                          key={sid}
                          size="small"
                          variant="outlined"
                          label={`${entry.serviceName || sid}: ${entry.status || '—'}`}
                        />
                      ))}
                    </Stack>
                  </Box>
                </>
              ) : null}

              <Divider />
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Webhook / sync events
                </Typography>
                {eventsLoading ? (
                  <CircularProgress size={24} />
                ) : eventRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No events stored for this check.
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Received</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {eventRows.map((ev) => (
                          <TableRow key={ev.id}>
                            <TableCell>{formatFirestoreTime(ev.receivedAt)}</TableCell>
                            <TableCell>{ev.type || '—'}</TableCell>
                            <TableCell>{ev.processingStatus || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>

              {selected.candidateId ? (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Candidate profile
                  </Typography>
                  <Link href={`/users/${selected.candidateId}`}>Open user profile</Link>
                </Box>
              ) : null}
              {selected.jobOrderId ? (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Job order
                  </Typography>
                  <Link href={`/jobs/job-orders/${selected.jobOrderId}`}>Open job order</Link>
                </Box>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            disabled={!selected?.providerProfileId || pdfLoading !== null}
            onClick={() => openPdf('final')}
          >
            {pdfLoading === 'final' ? <CircularProgress size={18} /> : 'Final report PDF'}
          </Button>
          <Button
            variant="outlined"
            disabled={!selected?.providerProfileId || pdfLoading !== null}
            onClick={() => openPdf('drug')}
          >
            {pdfLoading === 'drug' ? <CircularProgress size={18} /> : 'Drug report PDF'}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default StaffOnboardingBackgroundChecksPanel;

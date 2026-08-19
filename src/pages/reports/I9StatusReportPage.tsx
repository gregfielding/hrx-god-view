/**
 * /reports/i9-status — I-9 / Onboarding Completion Status (Compliance,
 * Greg 2026-08-19). Source: the Everee readiness mirror on
 * everee_workers linkage docs (WorkBright I-9 pipeline). E-Verify case
 * status is NOT yet available (processing disabled 2026-06-30; vendor
 * web-services connection pending) — the report says so.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, FormControl, IconButton, InputLabel,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

interface I9Row {
  uid: string;
  entityId: string;
  workerName: string | null;
  hasWorkbrightDocs: boolean;
  i9SignedAt: string | null;
  employerI9SignedAt: string | null;
  documentsVerifiedByCompany: boolean;
  onboardingStatus: string | null;
  status: 'complete' | 'pending_employer' | 'pending_worker' | 'not_started';
}

interface I9Data {
  totals: { workers: number; complete: number; pendingEmployer: number; pendingWorker: number; notStarted: number };
  everifyNote: string;
  rows: I9Row[];
}

const STATUS_LABEL: Record<I9Row['status'], { label: string; color: 'success' | 'warning' | 'info' | 'default' }> = {
  complete: { label: 'Complete', color: 'success' },
  pending_employer: { label: 'Pending employer (Sec. 2)', color: 'warning' },
  pending_worker: { label: 'Pending worker (Sec. 1)', color: 'info' },
  not_started: { label: 'Not started', color: 'default' },
};

const I9StatusReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<I9Data | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) => setEntities(snap.docs.map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) })).filter((e) => !/sandbox/i.test(e.id) && !/sandbox/i.test(e.name))))
      .catch(() => setEntities([]));
  }, [tenantId]);

  const load = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'getPayrollCostReport', { timeout: 300000 });
      const today = todayIso();
      const res = await fn({
        tenantId,
        startDate: today,
        endDate: today,
        includeI9Status: true,
        ...(entityId ? { hiringEntityId: entityId } : {}),
      });
      const d = res.data as { i9Status: I9Data | null; i9StatusError: string | null };
      if (!d.i9Status) {
        setError(d.i9StatusError || 'I-9 status unavailable.');
        setData(null);
      } else setData(d.i9Status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = (): void => {
    if (!data) return;
    const lines = ['Worker,Entity,Status,WorkBright docs,Section 1 signed,Section 2 signed,Verified by company,Onboarding status'];
    for (const r of data.rows) {
      lines.push([r.workerName ?? r.uid, r.entityId, STATUS_LABEL[r.status].label, r.hasWorkbrightDocs ? 'yes' : '', r.i9SignedAt ?? '', r.employerI9SignedAt ?? '', r.documentsVerifiedByCompany ? 'yes' : '', r.onboardingStatus ?? ''].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `i9-status-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <BadgeOutlinedIcon fontSize="small" />
            <span>I-9 / Onboarding Status</span>
          </Box>
        }
      />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Hiring entity</InputLabel>
              <Select value={entityId} label="Hiring entity" onChange={(e) => setEntityId(e.target.value)}>
                <MenuItem value="">All entities</MenuItem>
                {entities.map((e) => (
                  <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="contained" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Load'}
            </Button>
            <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Every I-9-applicable worker&apos;s WorkBright/Everee onboarding state — Section 1 (worker),
            Section 2 (employer), and company verification. Contractors (no I-9) are excluded.
          </Typography>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
            {[
              { label: 'Workers', value: data.totals.workers },
              { label: 'Complete', value: data.totals.complete },
              { label: 'Pending employer', value: data.totals.pendingEmployer },
              { label: 'Pending worker', value: data.totals.pendingWorker },
              { label: 'Not started', value: data.totals.notStarted },
            ].map((t) => (
              <Paper key={t.label} variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 120 }}>
                <Typography variant="caption" color="text.secondary">{t.label}</Typography>
                <Typography variant="h6" fontWeight={600}>{t.value}</Typography>
              </Paper>
            ))}
          </Box>
          <Alert severity="info" sx={{ mb: 2 }}>{data.everifyNote}</Alert>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sec. 1 signed</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sec. 2 signed</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Docs verified</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Onboarding</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={`${r.entityId}|${r.uid}`} hover>
                    <TableCell>{r.workerName ?? r.uid}</TableCell>
                    <TableCell>{r.entityId}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" color={STATUS_LABEL[r.status].color} label={STATUS_LABEL[r.status].label} />
                    </TableCell>
                    <TableCell>{r.i9SignedAt ?? (r.hasWorkbrightDocs ? 'docs ✓' : '—')}</TableCell>
                    <TableCell>{r.employerI9SignedAt ?? '—'}</TableCell>
                    <TableCell>{r.documentsVerifiedByCompany ? 'yes' : '—'}</TableCell>
                    <TableCell>{r.onboardingStatus ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {!data && !loading && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
          Hit Load to pull the current I-9 status of every worker.
        </Typography>
      )}
    </Box>
  );
};

export default I9StatusReportPage;

/**
 * /reports/i9-status — I-9 / Onboarding Completion Status (Compliance,
 * Greg 2026-08-19) + OnTrac attestation generator (2026-08-20).
 *
 * Source: the Everee readiness mirror on everee_workers linkage docs
 * (WorkBright I-9 pipeline). E-Verify case data never leaves WorkBright
 * (vendor integration declined for now), so the per-worker E-Verify
 * completion date is entered here ONCE per new hire (from WorkBright's
 * E-Verify case list) and stored on users/{uid}.everifyCompletedAt —
 * after that, Schedule 5 attestations auto-fill completely.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
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
  everifyCompletedAt: string | null;
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

/** Opens a print-ready Schedule 5 attestation in a new window. */
function openAttestation(input: {
  workerName: string;
  venue: string;
  i9Date: string;
  everifyDate: string;
  drugScreen: 'none' | '8panel' | '9panel';
  drugScreenDate: string;
  bgcDate: string;
}): void {
  const esc = (s: string) => s.replace(/</g, '&lt;');
  const check = (on: boolean) => (on ? '☒' : '☐');
  const html = `
<title>OnTrac Attestation — ${esc(input.workerName)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; color: #000; max-width: 720px; margin: 40px auto; line-height: 1.45; }
  h1 { font-size: 14px; text-align: center; margin-bottom: 4px; }
  h2 { font-size: 12.5px; text-decoration: underline; margin: 18px 0 6px; }
  .row { margin: 10px 0; }
  .field { display: inline-block; border-bottom: 1px solid #000; min-width: 220px; padding: 0 6px; font-weight: bold; }
  .sig { margin-top: 44px; display: flex; justify-content: space-between; gap: 40px; }
  .sigline { border-top: 1px solid #000; width: 45%; padding-top: 4px; font-size: 11px; }
  .indent { margin-left: 26px; }
  @media print { body { margin: 24px; } }
</style>
<h1>SCHEDULE 5<br/>INDEED FLEX AGENCY ATTESTATION OF COMPLIANCE REQUIREMENTS ADHERENCE</h1>
<p>This document is to be completed and submitted to Indeed Flex upon booking of an Agency worker to any OnTrac Shift/Assignment.</p>
<div class="row">Agency Worker Name: <span class="field">${esc(input.workerName)}</span>
  &nbsp;&nbsp;Agency: <span class="field">C1 Staffing, LLC</span></div>
<div class="row">Venue of Assignment: <span class="field">${esc(input.venue)}</span></div>
<h2>Form I-9 Compliance</h2>
<p class="indent">The above-named worker has properly completed, in its entirety, the Form I-9. An employee of the
Agency has examined the documentation presented by the above-named employee, (2) the above-listed documentation
appears to be genuine and to relate to the employee named, and (3) to the best of my knowledge, the employee is
authorized to work in the United States.</p>
<div class="row">Date of Form I-9 Completion: <span class="field">${esc(input.i9Date)}</span>
  &nbsp;&nbsp;Date Everify Completed: <span class="field">${esc(input.everifyDate)}</span></div>
<h2>Drug Screening Compliance</h2>
<p class="indent">${check(input.drugScreen === 'none')} The above-named worker is not being placed at a location with a drug screening requirement.<br/>
${check(input.drugScreen !== 'none')} The above-named worker has successfully completed and met the drug screening requirement for
the location assigned. Date of Drug Screen: <span class="field">${esc(input.drugScreen === 'none' ? 'N/A' : input.drugScreenDate)}</span><br/>
<span class="indent">${check(input.drugScreen === '9panel')} 9 panel with reflex confirmation (includes ETOH, AMP, BAR, BZO, COC, PCP, THC, OPI, OXY)</span><br/>
<span class="indent">${check(input.drugScreen === '8panel')} 8 panel with reflex confirmation (includes AMP, BAR, BZO, COC, PCP, THC, OPI, OXY)</span></p>
<h2>Background Screening Compliance</h2>
<p class="indent">The above-named worker has successfully completed and met the background screening requirements.
The background screening included a Social Security Number Verification, a National Sex Offender Registry Search,
a 7 Year National Criminal database search and a 7 year county felony and misdemeanor search. The results have been
adjudicated according to the OnTrac matrix. Date of Background Screen Completion:
<span class="field">${esc(input.bgcDate)}</span></p>
<p style="margin-top:28px">By affixing my signature below, I hereby attest that this information is true, complete, and accurate.</p>
<div class="sig"><div class="sigline">Authorized Signature</div><div class="sigline">Title</div></div>
<div class="sig"><div class="sigline">Print Name</div><div class="sigline">Date</div></div>
<script>window.print();</script>`;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

const I9StatusReportPage: React.FC = () => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<I9Data | null>(null);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [attestFor, setAttestFor] = useState<I9Row | null>(null);
  const [venue, setVenue] = useState(() => localStorage.getItem('ontrac_attest_venue') ?? '');
  const [drugScreen, setDrugScreen] = useState<'none' | '8panel' | '9panel'>('none');
  const [drugScreenDate, setDrugScreenDate] = useState('');
  const [bgcDate, setBgcDate] = useState('');

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

  const saveEverifyDate = async (row: I9Row, date: string): Promise<void> => {
    if (!tenantId || date === (row.everifyCompletedAt ?? '')) return;
    setSavingUid(row.uid);
    try {
      const fn = httpsCallable(functions, 'savePayrollVenueMapping');
      await fn({ tenantId, action: 'setEverifyDate', workerId: row.uid, date });
      setData((cur) =>
        cur
          ? { ...cur, rows: cur.rows.map((r) => (r.uid === row.uid ? { ...r, everifyCompletedAt: date || null } : r)) }
          : cur,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingUid(null);
    }
  };

  const exportCsv = (): void => {
    if (!data) return;
    const lines = ['Worker,Entity,Status,WorkBright docs,Section 1 signed,Section 2 signed,Verified by company,E-Verify completed,Onboarding status'];
    for (const r of data.rows) {
      lines.push([r.workerName ?? r.uid, r.entityId, STATUS_LABEL[r.status].label, r.hasWorkbrightDocs ? 'yes' : '', r.i9SignedAt ?? '', r.employerI9SignedAt ?? '', r.documentsVerifiedByCompany ? 'yes' : '', r.everifyCompletedAt ?? '', r.onboardingStatus ?? ''].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','));
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
            Every I-9-applicable worker&apos;s WorkBright/Everee onboarding state. The E-Verify date is
            entered once per new hire from WorkBright&apos;s E-Verify case list — after that, OnTrac
            attestations (the printer icon) auto-fill completely.
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
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Entity</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sec. 1</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Sec. 2</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>E-Verify completed</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Attestation</TableCell>
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
                    <TableCell>{r.employerI9SignedAt ?? (r.documentsVerifiedByCompany ? 'verified ✓' : '—')}</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="date"
                        defaultValue={r.everifyCompletedAt ?? ''}
                        disabled={savingUid === r.uid}
                        onBlur={(e) => void saveEverifyDate(r, e.target.value)}
                        sx={{ width: 160 }}
                        InputLabelProps={{ shrink: true }}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        title="Generate OnTrac attestation (Schedule 5)"
                        onClick={() => {
                          setAttestFor(r);
                          setDrugScreen('none');
                          setDrugScreenDate('');
                          setBgcDate('');
                        }}
                      >
                        <PrintOutlinedIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
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

      {/* Attestation dialog */}
      <Dialog open={Boolean(attestFor)} onClose={() => setAttestFor(null)} maxWidth="sm" fullWidth>
        <DialogTitle>OnTrac attestation — {attestFor?.workerName}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Venue of assignment (OnTrac facility)"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Chicago Sort Center (Hub) — Romeoville, IL"
            />
            <Stack direction="row" spacing={2}>
              <TextField size="small" label="I-9 completion" value={attestFor?.i9SignedAt ?? '(missing)'} disabled sx={{ flex: 1 }} />
              <TextField size="small" label="E-Verify completed" value={attestFor?.everifyCompletedAt ?? '(missing — enter on the row first)'} disabled sx={{ flex: 1 }} />
            </Stack>
            <FormControl size="small">
              <InputLabel>Drug screen</InputLabel>
              <Select value={drugScreen} label="Drug screen" onChange={(e) => setDrugScreen(e.target.value as never)}>
                <MenuItem value="none">No drug-screen requirement at this location</MenuItem>
                <MenuItem value="8panel">8 panel with reflex confirmation</MenuItem>
                <MenuItem value="9panel">9 panel with reflex confirmation</MenuItem>
              </Select>
            </FormControl>
            {drugScreen !== 'none' && (
              <TextField size="small" type="date" label="Drug screen date" value={drugScreenDate} onChange={(e) => setDrugScreenDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            )}
            <TextField size="small" type="date" label="Background screen completion date" value={bgcDate} onChange={(e) => setBgcDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttestFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!venue.trim() || !attestFor?.i9SignedAt || !attestFor?.everifyCompletedAt || !bgcDate || (drugScreen !== 'none' && !drugScreenDate)}
            onClick={() => {
              if (!attestFor) return;
              localStorage.setItem('ontrac_attest_venue', venue);
              openAttestation({
                workerName: attestFor.workerName ?? attestFor.uid,
                venue: venue.trim(),
                i9Date: attestFor.i9SignedAt ?? '',
                everifyDate: attestFor.everifyCompletedAt ?? '',
                drugScreen,
                drugScreenDate,
                bgcDate,
              });
              setAttestFor(null);
            }}
          >
            Generate & print
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default I9StatusReportPage;

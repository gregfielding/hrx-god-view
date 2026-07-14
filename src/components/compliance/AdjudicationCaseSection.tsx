/**
 * Adjudication case section (Migration Plan P2) — rendered under each
 * background-check order in the Backgrounds & Compliance tab. Shows the
 * tier chip + "Open compliance case" entry point when a report needs
 * review, and the full case panel (status, response deadline, 11-factor
 * worksheet, notices, §6 approvals, close) once a case exists.
 *
 * All writes go through the adjudicationCases callables — Firestore rules
 * deny client writes — so every action here lands in the case's
 * append-only event trail with server timestamps.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GavelIcon from '@mui/icons-material/Gavel';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';

const openAdjudicationCase = httpsCallable(functions, 'openAdjudicationCase');
const updateAdjudicationWorksheet = httpsCallable(functions, 'updateAdjudicationWorksheet');
const recordAdjudicationNotice = httpsCallable(functions, 'recordAdjudicationNotice');
const setAdjudicationCaseStatus = httpsCallable(functions, 'setAdjudicationCaseStatus');
const recordAdjudicationApproval = httpsCallable(functions, 'recordAdjudicationApproval');
const closeAdjudicationCase = httpsCallable(functions, 'closeAdjudicationCase');

const FACTOR_LABELS: Array<{ key: string; label: string }> = [
  { key: 'f1', label: '1. Nature and gravity of the offense' },
  { key: 'f2', label: '2. Time elapsed since offense / sentence completion' },
  { key: 'f3', label: '3. Nature of the job (duties, environment, access)' },
  { key: 'f4', label: '4. Nexus between offense and duties' },
  { key: 'f5', label: '5. Facts and circumstances offered by the candidate' },
  { key: 'f6', label: '6. Number and pattern of convictions' },
  { key: 'f7', label: '7. Age at conviction and at release' },
  { key: 'f8', label: '8. Employment history before and after the offense' },
  { key: 'f9', label: '9. Rehabilitation evidence' },
  { key: 'f10', label: '10. Character references / bonding eligibility' },
  { key: 'f11', label: '11. Concrete, articulable risk assessment' },
];

const STATUS_LABEL: Record<string, string> = {
  open: 'Open — pre-adverse not yet sent',
  awaiting_candidate: 'Awaiting candidate response',
  candidate_responded: 'Candidate responded',
  disputed: 'Disputed — clock stopped',
  window_expired: 'Response window expired',
  closed: 'Closed',
};
const STATUS_COLOR: Record<string, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  open: 'info',
  awaiting_candidate: 'warning',
  candidate_responded: 'info',
  disputed: 'error',
  window_expired: 'warning',
  closed: 'default',
};

const TIER_STYLE: Record<string, { label: string; color: 'warning' | 'error' }> = {
  yellow: { label: 'YELLOW — compliance review', color: 'warning' },
  red: { label: 'RED — presumptive DQ', color: 'error' },
};

interface Props {
  /** The backgroundChecks doc (must include id, tenantId, tier?, adjudicationCaseId?). */
  record: Record<string, any> & { id: string };
  canAccusourceAdmin: boolean;
  /** Package rollup for the order — drives the suggested tier. */
  rollup: string;
}

export default function AdjudicationCaseSection({ record, canAccusourceAdmin, rollup }: Props) {
  const tenantId: string = String(record.tenantId || '');
  const caseId: string = String(record.adjudicationCaseId || '');
  const [caseDoc, setCaseDoc] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTier, setOpenTier] = useState<'yellow' | 'red'>(rollup === 'FAILED' ? 'red' : 'yellow');
  const [worksheetDraft, setWorksheetDraft] = useState<Record<string, string>>({});
  const [responseSummary, setResponseSummary] = useState('');
  const [approvalRationale, setApprovalRationale] = useState('');

  useEffect(() => {
    if (!tenantId || !caseId) {
      setCaseDoc(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'tenants', tenantId, 'adjudication_cases', caseId),
      (snap) => setCaseDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setCaseDoc(null),
    );
    return unsub;
  }, [tenantId, caseId]);

  const relevant = rollup === 'ACTION_NEEDED' || rollup === 'FAILED' || Boolean(caseId);
  const factors = (caseDoc?.factors as Record<string, any>) ?? {};

  const deadline = useMemo(() => {
    const ts = caseDoc?.responseDeadlineAt;
    if (!ts?.toMillis) return null;
    const ms = ts.toMillis() - Date.now();
    const days = Math.ceil(ms / 86400000);
    return { overdue: ms < 0, days: Math.abs(days), date: new Date(ts.toMillis()) };
  }, [caseDoc?.responseDeadlineAt]);

  if (!relevant || !canAccusourceAdmin) return null;

  const call = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  // ── No case yet: tier chip + open button
  if (!caseId || !caseDoc) {
    return (
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ py: 0.5 }}>
        <GavelIcon fontSize="small" color="action" />
        <Typography variant="body2" color="text.secondary">
          This report needs compliance review (policy §4).
        </Typography>
        <TextField
          select
          size="small"
          value={openTier}
          onChange={(e) => setOpenTier(e.target.value as 'yellow' | 'red')}
          sx={{ width: 200 }}
        >
          <MenuItem value="yellow">YELLOW — review</MenuItem>
          <MenuItem value="red">RED — presumptive DQ</MenuItem>
        </TextField>
        <Button
          size="small"
          variant="outlined"
          disabled={busy !== null}
          onClick={() =>
            void call('open', async () => {
              await openAdjudicationCase({
                tenantId,
                backgroundCheckId: record.id,
                tier: openTier,
              });
            })
          }
        >
          {busy === 'open' ? <CircularProgress size={16} /> : 'Open compliance case'}
        </Button>
        {error ? <Alert severity="error" sx={{ py: 0 }}>{error}</Alert> : null}
      </Stack>
    );
  }

  // ── Case panel
  const status = String(caseDoc.status || 'open');
  const tier = String(caseDoc.tier || 'yellow');
  const decision = caseDoc.decision as string | null;
  const closed = status === 'closed';
  const approvals = Array.isArray(caseDoc.approvals) ? caseDoc.approvals : [];
  const notices = Array.isArray(caseDoc.notices) ? caseDoc.notices : [];
  const hasPreAdverse = notices.some((n: any) => n.kind === 'pre_adverse');

  return (
    <Accordion disableGutters sx={{ bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <GavelIcon fontSize="small" color="action" />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Compliance case
          </Typography>
          <Chip size="small" color={TIER_STYLE[tier]?.color ?? 'warning'} label={TIER_STYLE[tier]?.label ?? tier} sx={{ height: 20, fontSize: '0.7rem' }} />
          <Chip size="small" color={STATUS_COLOR[status] ?? 'default'} label={closed ? `Closed — ${decision === 'deny' ? 'DENIED' : 'APPROVED'}` : STATUS_LABEL[status] ?? status} sx={{ height: 20, fontSize: '0.7rem' }} />
          {deadline && !closed && status === 'awaiting_candidate' ? (
            <Chip
              size="small"
              variant="outlined"
              color={deadline.overdue ? 'error' : 'default'}
              label={deadline.overdue ? `Window closed ${deadline.days}d ago` : `${deadline.days}d left to respond (${deadline.date.toLocaleDateString()})`}
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          ) : null}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        {error ? <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert> : null}

        {/* ── Process actions */}
        {!closed && (
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
            {!hasPreAdverse && (
              <Button size="small" variant="outlined" disabled={busy !== null}
                onClick={() => void call('pre_adverse', () => recordAdjudicationNotice({ tenantId, caseId, kind: 'pre_adverse', channel: 'email', stateVariant: String(caseDoc.worksiteState || 'default') }))}>
                Record pre-adverse sent
              </Button>
            )}
            {status === 'awaiting_candidate' && (
              <>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('responded', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'candidate_responded' }))}>
                  Candidate responded
                </Button>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('expired', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'window_expired' }))}>
                  Window expired
                </Button>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('extend', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'extend_window', businessDays: 5 }))}>
                  Extend +5 business days
                </Button>
              </>
            )}
            {status !== 'disputed' && (
              <Button size="small" color="error" disabled={busy !== null}
                onClick={() => void call('dispute', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'dispute_opened' }))}>
                Candidate disputes report
              </Button>
            )}
            {status === 'disputed' && (
              <>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('dispute_ack', () => recordAdjudicationNotice({ tenantId, caseId, kind: 'dispute_ack', channel: 'email' }))}>
                  Record dispute-ack sent
                </Button>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('resolved_corrected', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'dispute_resolved', reportCorrected: true }))}>
                  Resolved — report corrected
                </Button>
                <Button size="small" disabled={busy !== null}
                  onClick={() => void call('resolved_confirmed', () => setAdjudicationCaseStatus({ tenantId, caseId, action: 'dispute_resolved', reportCorrected: false }))}>
                  Resolved — report confirmed
                </Button>
              </>
            )}
          </Stack>
        )}
        {closed && decision === 'deny' && !notices.some((n: any) => n.kind === 'final_adverse') && (
          <Button size="small" variant="outlined" color="error" sx={{ mb: 1.5 }} disabled={busy !== null}
            onClick={() => void call('final_adverse', () => recordAdjudicationNotice({ tenantId, caseId, kind: 'final_adverse', channel: 'email', stateVariant: String(caseDoc.worksiteState || 'default') }))}>
            Record final adverse notice sent
          </Button>
        )}

        {/* ── Candidate response quick-record */}
        {!closed && ['awaiting_candidate', 'candidate_responded', 'window_expired'].includes(status) && (
          <Stack direction="row" gap={1} sx={{ mb: 1.5 }} alignItems="flex-start">
            <TextField
              size="small" fullWidth multiline minRows={1} label="Candidate response summary"
              value={responseSummary} onChange={(e) => setResponseSummary(e.target.value)}
            />
            <Button size="small" disabled={busy !== null || !responseSummary.trim()}
              onClick={() => void call('resp', async () => {
                await updateAdjudicationWorksheet({ tenantId, caseId, candidateResponse: { summary: responseSummary, channel: 'email' } });
                await setAdjudicationCaseStatus({ tenantId, caseId, action: 'candidate_responded' }).catch(() => undefined);
                setResponseSummary('');
              })}>
              Save
            </Button>
          </Stack>
        )}

        {/* ── Worksheet */}
        <Accordion disableGutters sx={{ boxShadow: 'none', border: 1, borderColor: 'divider', mb: 1.5 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Individualized assessment worksheet (§5.1) —{' '}
              {FACTOR_LABELS.filter((f) => (factors[f.key]?.finding ?? '').trim() !== '').length}/11 complete
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TextField
              size="small" fullWidth multiline minRows={2} sx={{ mb: 1.5 }}
              label="Conviction(s) at issue — offense, jurisdiction, date, disposition, sentence completed"
              defaultValue={String(caseDoc.convictionsSummary || '')}
              onChange={(e) => setWorksheetDraft((d) => ({ ...d, convictionsSummary: e.target.value }))}
              disabled={closed}
            />
            <Stack gap={1.25}>
              {FACTOR_LABELS.map((f) => (
                <TextField
                  key={f.key} size="small" fullWidth multiline label={f.label}
                  placeholder='Write "N/A" if the factor does not apply — never leave blank before a denial.'
                  defaultValue={String(factors[f.key]?.finding ?? '')}
                  onChange={(e) => setWorksheetDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  disabled={closed}
                />
              ))}
            </Stack>
            {!closed && (
              <Button size="small" variant="contained" sx={{ mt: 1.5 }}
                disabled={busy !== null || Object.keys(worksheetDraft).length === 0}
                onClick={() => void call('worksheet', async () => {
                  const { convictionsSummary, ...factorDraft } = worksheetDraft;
                  await updateAdjudicationWorksheet({
                    tenantId, caseId,
                    ...(convictionsSummary != null ? { convictionsSummary } : {}),
                    ...(Object.keys(factorDraft).length ? { factors: factorDraft } : {}),
                  });
                  setWorksheetDraft({});
                })}>
                {busy === 'worksheet' ? <CircularProgress size={16} /> : 'Save worksheet'}
              </Button>
            )}
          </AccordionDetails>
        </Accordion>

        {/* ── Approvals + close */}
        <Divider sx={{ mb: 1 }} />
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
          Approvals (§6)
        </Typography>
        {approvals.length > 0 && (
          <Stack gap={0.25} sx={{ mb: 1 }}>
            {approvals.map((a: any, i: number) => (
              <Typography key={i} variant="caption" color="text.secondary">
                ✓ {a.role} — {a.decision} — {a.name} ({a.at?.toDate ? a.at.toDate().toLocaleDateString() : ''})
                {a.rationale ? ` — ${a.rationale}` : ''}
              </Typography>
            ))}
          </Stack>
        )}
        {!closed && (
          <>
            <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ mb: 1 }}>
              {(['approve', 'deny'] as const).map((d) => (
                <Button key={`c-${d}`} size="small" variant="outlined" disabled={busy !== null}
                  onClick={() => void call(`appr-c-${d}`, () => recordAdjudicationApproval({ tenantId, caseId, role: 'compliance', decision: d }))}>
                  Sign compliance: {d}
                </Button>
              ))}
              {tier === 'yellow' && (
                <Button size="small" variant="outlined" disabled={busy !== null}
                  onClick={() => void call('appr-ops', () => recordAdjudicationApproval({ tenantId, caseId, role: 'ops_manager', decision: 'deny' }))}>
                  Sign ops manager: deny
                </Button>
              )}
              {tier === 'red' && (
                <>
                  <TextField size="small" sx={{ minWidth: 260 }} label="Executive rationale (required)"
                    value={approvalRationale} onChange={(e) => setApprovalRationale(e.target.value)} />
                  <Button size="small" variant="outlined" disabled={busy !== null || !approvalRationale.trim()}
                    onClick={() => void call('appr-exec', () => recordAdjudicationApproval({ tenantId, caseId, role: 'executive', decision: 'approve', rationale: approvalRationale }))}>
                    Sign executive: approve override
                  </Button>
                </>
              )}
            </Stack>
            <Stack direction="row" gap={1}>
              <Button size="small" variant="contained" color="success" disabled={busy !== null}
                onClick={() => void call('close-approve', () => closeAdjudicationCase({ tenantId, caseId, decision: 'approve' }))}>
                Close case — approve (place worker)
              </Button>
              <Button size="small" variant="contained" color="error" disabled={busy !== null}
                onClick={() => void call('close-deny', () => closeAdjudicationCase({ tenantId, caseId, decision: 'deny' }))}>
                Close case — deny (adverse action)
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Closing validates the §5.2 process (pre-adverse sent, window elapsed or answered, no open
              dispute, worksheet complete on denial) and the §6 signatures — it will refuse with the
              specific missing item. After a deny, set the line verdicts to FAILED and record the final
              adverse notice here.
            </Typography>
          </>
        )}
        {closed && (
          <Typography variant="caption" color="text.secondary">
            Closed {caseDoc.closedAt?.toDate ? caseDoc.closedAt.toDate().toLocaleString() : ''} — retain all
            case records 7 years (policy §8).
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

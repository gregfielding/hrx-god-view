/**
 * Payroll Help Desk — /payroll-tickets (staff, level 5+).
 *
 * Staff console for the worker payroll help desk (Slice 1, Greg 2026-08-24).
 * Queue of `payroll_tickets` with the AI diagnosis (category, severity,
 * root-cause summary, suggested EN/ES replies) computed at ticket creation
 * by the workerSupportAssistant callable. Replies and status changes go
 * through the same callable (`payroll_reply` / `payroll_set_status`) — the
 * collection is client-read-only. The list query filters by tenantId so the
 * level-5 rules branch is provable; live via onSnapshot.
 */
import React, { useEffect, useMemo, useState } from 'react';
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
  Drawer,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

type TicketStatus = 'open' | 'waiting_worker' | 'resolved';

interface Ticket {
  id: string;
  uid: string;
  subject: string;
  status: TicketStatus;
  channel: string;
  workerName: string;
  workerEmail: string | null;
  workerPhone: string | null;
  preferredLanguage: string;
  lane: 'fix_it' | 'money';
  resolutionNote: string | null;
  lastMessageAt: Date | null;
  lastMessageBy: string;
  createdAt: Date | null;
  diagnosis?: {
    category?: string;
    severity?: string;
    summary?: string;
    suggestedReplyEn?: string;
    suggestedReplyEs?: string;
    confidence?: number;
  } | null;
}

interface Message {
  id: string;
  by: 'worker' | 'staff' | 'ai';
  authorName?: string | null;
  text: string;
  at: Date | null;
}

function tsToDate(v: unknown): Date | null {
  const o = v as { toDate?: () => Date } | null;
  try {
    return o && typeof o.toDate === 'function' ? o.toDate() : null;
  } catch {
    return null;
  }
}

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'default'> = {
  urgent: 'error',
  normal: 'warning',
  low: 'default',
};

const CATEGORY_LABEL: Record<string, string> = {
  missing_pay: 'Missing pay',
  wrong_amount: 'Wrong amount',
  onboarding_stuck: 'Onboarding stuck',
  direct_deposit: 'Direct deposit',
  tax_docs: 'Tax docs',
  other: 'Other',
};

interface PrivateDiagnosis {
  summary?: string;
  suggestedReplyEn?: string;
  suggestedReplyEs?: string;
}

/** private/investigation — the money-lane hours-vs-paid research (Slice 3). */
interface InvestigationDoc {
  generatedBy?: string;
  entries?: Array<{
    workDate?: string;
    status?: string;
    source?: string | null;
    hiringEntityId?: string | null;
    payRate?: number | null;
    regHours?: number;
    otHours?: number;
    dtHours?: number;
    expectedTotal?: number;
  }>;
  payments?: Array<{
    entityId?: string;
    payDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    gross?: number | null;
    status?: string | null;
  }>;
  totals?: { submittedExpected?: number; unsubmittedExpected?: number; paidGross?: number };
  defaultEntityId?: string | null;
  ai?: {
    summary?: string;
    recommendation?: string;
    proposedAmount?: number | null;
    proposedWorkDate?: string | null;
    proposedHours?: number | null;
    proposedHourlyRate?: number | null;
    workerReplyEn?: string;
    workerReplyEs?: string;
    rationale?: string;
    confidence?: number;
  };
}

const fmtUsd = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(2)}`;

const RECOMMENDATION_CHIP: Record<string, { label: string; color: 'error' | 'success' | 'warning' }> = {
  pay_correction: { label: 'Correction owed', color: 'error' },
  paid_correctly: { label: 'Paid correctly', color: 'success' },
  needs_review: { label: 'Needs review', color: 'warning' },
};

const PayrollTicketsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<0 | 1 | 2>(0);
  const [laneFilter, setLaneFilter] = useState<'all' | 'fix_it' | 'money'>('all');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [privateDiagnosis, setPrivateDiagnosis] = useState<PrivateDiagnosis | null>(null);
  const [auditEntries, setAuditEntries] = useState<Array<Record<string, unknown>>>([]);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Money-lane investigation panel + one-click correction (Slice 3).
  const [investigation, setInvestigation] = useState<InvestigationDoc | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [corrAmount, setCorrAmount] = useState('');
  const [corrWorkDate, setCorrWorkDate] = useState('');
  const [corrHours, setCorrHours] = useState('');
  const [corrRate, setCorrRate] = useState('');
  const [corrEntity, setCorrEntity] = useState('');
  const [corrWarning, setCorrWarning] = useState<string | null>(null);
  const [paidCorrectlyOpen, setPaidCorrectlyOpen] = useState(false);
  const [paidCorrectlyText, setPaidCorrectlyText] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    const q1 = query(collection(db, 'payroll_tickets'), where('tenantId', '==', tenantId));
    return onSnapshot(
      q1,
      (snap) => {
        setTickets(
          snap.docs
            .map((d) => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                uid: String(x.uid || ''),
                subject: String(x.subject || ''),
                status: (x.status as TicketStatus) || 'open',
                channel: String(x.channel || 'app'),
                workerName: String(x.workerName || ''),
                workerEmail: (x.workerEmail as string) ?? null,
                workerPhone: (x.workerPhone as string) ?? null,
                preferredLanguage: String(x.preferredLanguage || 'en'),
                lane: (x.lane as 'fix_it' | 'money') || 'fix_it',
                resolutionNote: (x.resolutionNote as string) ?? null,
                lastMessageAt: tsToDate(x.lastMessageAt),
                lastMessageBy: String(x.lastMessageBy || ''),
                createdAt: tsToDate(x.createdAt),
                diagnosis: (x.diagnosis as Ticket['diagnosis']) ?? null,
              };
            })
            .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)),
        );
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [tenantId]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    const q2 = query(
      collection(db, 'payroll_tickets', selected.id, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q2, (snap) => {
      setMessages(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            by: (x.by as Message['by']) || 'worker',
            authorName: (x.authorName as string) ?? null,
            text: String(x.text || ''),
            at: tsToDate(x.at),
          };
        }),
      );
    });
  }, [selected]);

  // Staff-only diagnosis detail lives in private/diagnosis (workers can read
  // their ticket doc, so internal notes are kept out of it). Legacy tickets
  // (pre-hardening) still carry the detail on the main doc — fall back.
  useEffect(() => {
    if (!selected) {
      setPrivateDiagnosis(null);
      return;
    }
    const legacy = selected.diagnosis as PrivateDiagnosis | null;
    return onSnapshot(
      doc(db, 'payroll_tickets', selected.id, 'private', 'diagnosis'),
      (snap) => {
        if (snap.exists()) setPrivateDiagnosis(snap.data() as PrivateDiagnosis);
        else if (legacy?.summary) setPrivateDiagnosis(legacy);
        else setPrivateDiagnosis(null);
      },
      () => setPrivateDiagnosis(legacy?.summary ? legacy : null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Money-lane investigation (staff-only subcollection, written at ticket
  // creation for money tickets and by the "Re-run investigation" action).
  useEffect(() => {
    if (!selected) {
      setInvestigation(null);
      return;
    }
    return onSnapshot(
      doc(db, 'payroll_tickets', selected.id, 'private', 'investigation'),
      (snap) => setInvestigation(snap.exists() ? (snap.data() as InvestigationDoc) : null),
      () => setInvestigation(null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Action audit trail (staff-only subcollection).
  useEffect(() => {
    if (!selected) {
      setAuditEntries([]);
      return;
    }
    return onSnapshot(
      doc(db, 'payroll_tickets', selected.id, 'private', 'audit'),
      (snap) => {
        const entries = (snap.get('entries') as Array<Record<string, unknown>> | undefined) ?? [];
        setAuditEntries(entries.slice(-5).reverse());
      },
      () => setAuditEntries([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Keep the drawer's ticket fresh as snapshots arrive (status chips etc.).
  useEffect(() => {
    if (!selected) return;
    const fresh = tickets.find((x) => x.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  const filtered = useMemo(() => {
    const wanted: TicketStatus[] = statusTab === 0 ? ['open'] : statusTab === 1 ? ['waiting_worker'] : ['resolved'];
    return tickets.filter(
      (x) => wanted.includes(x.status) && (laneFilter === 'all' || x.lane === laneFilter),
    );
  }, [tickets, statusTab, laneFilter]);

  const counts = useMemo(
    () => ({
      open: tickets.filter((x) => x.status === 'open').length,
      waiting: tickets.filter((x) => x.status === 'waiting_worker').length,
      resolved: tickets.filter((x) => x.status === 'resolved').length,
    }),
    [tickets],
  );

  const callAction = async (payload: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'workerSupportAssistant');
      const res = await fn(payload);
      return (res.data ?? {}) as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runTicketAction = async (payload: Record<string, unknown>, doneNote: string) => {
    setActionNote(null);
    await callAction(payload);
    setActionNote(doneNote);
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    await callAction({ action: 'payroll_reply', ticketId: selected.id, text: replyText.trim() });
    setReplyText('');
  };

  const setStatus = async (status: TicketStatus, note?: string) => {
    if (!selected) return;
    await callAction({ action: 'payroll_set_status', ticketId: selected.id, status, note });
  };

  const setLane = async (lane: 'fix_it' | 'money') => {
    if (!selected) return;
    await callAction({ action: 'payroll_set_lane', ticketId: selected.id, lane });
  };

  const openCorrectionDialog = () => {
    const ai = investigation?.ai;
    setCorrAmount(ai?.proposedAmount != null ? String(ai.proposedAmount) : '');
    setCorrWorkDate(ai?.proposedWorkDate ?? '');
    setCorrHours(ai?.proposedHours != null ? String(ai.proposedHours) : '');
    setCorrRate(ai?.proposedHourlyRate != null ? String(ai.proposedHourlyRate) : '');
    setCorrEntity(investigation?.defaultEntityId ?? '');
    setCorrWarning(null);
    setCorrectionOpen(true);
  };

  const submitCorrection = async (override: boolean) => {
    if (!selected) return;
    const data = await callAction({
      action: 'payroll_authorize_correction',
      ticketId: selected.id,
      amount: Number(corrAmount) || 0,
      workDate: corrWorkDate.trim(),
      hours: Number(corrHours) || 0,
      hourlyRate: Number(corrRate) || 0,
      entityId: corrEntity.trim(),
      overrideDuplicateWarning: override,
    });
    if (!data) return; // error already surfaced
    if (data.status === 'duplicate_warning') {
      const w = data.duplicateWarning as { message?: string } | undefined;
      setCorrWarning(String(w?.message || 'This worker may already have been paid for this date.'));
      return;
    }
    setCorrectionOpen(false);
    setActionNote(`Correction of ${fmtUsd(Number(corrAmount))} sent — worker notified, ticket resolved.`);
  };

  const openPaidCorrectlyDialog = () => {
    const ai = investigation?.ai;
    const es = (selected?.preferredLanguage ?? 'en') === 'es';
    setPaidCorrectlyText((es ? ai?.workerReplyEs || ai?.workerReplyEn : ai?.workerReplyEn) || '');
    setPaidCorrectlyOpen(true);
  };

  const submitPaidCorrectly = async () => {
    if (!selected || !paidCorrectlyText.trim()) return;
    const data = await callAction({
      action: 'payroll_resolve_paid_correctly',
      ticketId: selected.id,
      text: paidCorrectlyText.trim(),
    });
    if (!data) return;
    setPaidCorrectlyOpen(false);
    setActionNote('Explanation sent to the worker — ticket resolved.');
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
        Payroll Help Desk
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Worker payroll tickets with an AI diagnosis of each worker's Everee/timesheet state.
        Replies notify the worker in the app.
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Tabs value={statusTab} onChange={(_, v) => setStatusTab(v)} sx={{ mb: 1 }}>
        <Tab label={`Open (${counts.open})`} />
        <Tab label={`Waiting on worker (${counts.waiting})`} />
        <Tab label={`Resolved (${counts.resolved})`} />
      </Tabs>
      {/* Lane filter (Greg 2026-08-25): fix-it = AI/support can resolve;
          money = the payroll team owes dollars. */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {(
          [
            ['all', 'All lanes'],
            ['fix_it', 'Fix-it lane'],
            ['money', 'Money lane'],
          ] as const
        ).map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            size="small"
            color={laneFilter === value ? 'primary' : 'default'}
            variant={laneFilter === value ? 'filled' : 'outlined'}
            onClick={() => setLaneFilter(value)}
          />
        ))}
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : filtered.length === 0 ? (
        <Alert severity="info">No tickets here.</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Issue</TableCell>
                <TableCell>AI diagnosis</TableCell>
                <TableCell>Lane</TableCell>
                <TableCell>Last activity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setSelected(row)}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.workerName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[row.workerEmail, row.workerPhone].filter(Boolean).join(' · ')}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Typography variant="body2" noWrap title={row.subject}>
                      {row.subject}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {row.diagnosis ? (
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Chip
                          size="small"
                          label={CATEGORY_LABEL[row.diagnosis.category ?? 'other'] ?? 'Other'}
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          label={row.diagnosis.severity ?? 'normal'}
                          color={SEVERITY_COLOR[row.diagnosis.severity ?? 'normal'] ?? 'default'}
                        />
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={row.lane === 'money' ? 'error' : 'default'}
                      label={row.lane === 'money' ? 'Money' : 'Fix-it'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {row.lastMessageAt ? row.lastMessageAt.toLocaleString() : '—'}
                      {row.lastMessageBy === 'worker' && row.status === 'open' ? ' · worker waiting' : ''}
                    </Typography>
                    {row.status === 'resolved' && row.resolutionNote ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
                        {row.resolutionNote}
                      </Typography>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, p: 2.5 } }}
      >
        {selected && (
          <Stack spacing={2}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {selected.workerName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[selected.workerEmail, selected.workerPhone, `prefers ${selected.preferredLanguage.toUpperCase()}`]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                onClick={() => navigate(`/users/${selected.uid}`)}
                sx={{ flexShrink: 0 }}
              >
                Open profile
              </Button>
            </Stack>

            {selected.diagnosis && (
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(255, 199, 0, 0.06)' }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    AI DIAGNOSIS
                  </Typography>
                  <Chip
                    size="small"
                    label={CATEGORY_LABEL[selected.diagnosis.category ?? 'other'] ?? 'Other'}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={selected.diagnosis.severity ?? 'normal'}
                    color={SEVERITY_COLOR[selected.diagnosis.severity ?? 'normal'] ?? 'default'}
                  />
                </Stack>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {privateDiagnosis?.summary ?? 'Loading diagnosis detail…'}
                </Typography>
                {(['suggestedReplyEn', 'suggestedReplyEs'] as const).map((key) => {
                  const value = privateDiagnosis?.[key];
                  if (!value) return null;
                  return (
                    <Box key={key} sx={{ mb: 0.75 }}>
                      <Typography variant="caption" color="text.secondary">
                        Suggested reply ({key === 'suggestedReplyEn' ? 'EN' : 'ES'}):
                      </Typography>
                      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                        {value}
                      </Typography>
                      <Button size="small" variant="text" onClick={() => setReplyText(value)}>
                        Use this reply
                      </Button>
                    </Box>
                  );
                })}
              </Paper>
            )}

            {/* Slice 3 — money-lane investigation: deterministic hours-vs-paid
                comparison + AI recommendation, with one-click authorize/resolve. */}
            {(selected.lane === 'money' || investigation) && (
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(211, 47, 47, 0.04)' }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    INVESTIGATION — HOURS VS. PAID
                  </Typography>
                  {investigation?.ai?.recommendation && RECOMMENDATION_CHIP[investigation.ai.recommendation] && (
                    <Chip
                      size="small"
                      label={RECOMMENDATION_CHIP[investigation.ai.recommendation].label}
                      color={RECOMMENDATION_CHIP[investigation.ai.recommendation].color}
                    />
                  )}
                </Stack>
                {!investigation ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No investigation yet — run one to compare recorded hours against Everee payments.
                  </Typography>
                ) : (
                  <>
                    {investigation.ai?.summary && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {investigation.ai.summary}
                      </Typography>
                    )}
                    {(investigation.entries?.length ?? 0) > 0 && (
                      <TableContainer sx={{ maxHeight: 180, mb: 1 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ py: 0.25 }}>Work date</TableCell>
                              <TableCell sx={{ py: 0.25 }}>Status</TableCell>
                              <TableCell sx={{ py: 0.25 }} align="right">Hours</TableCell>
                              <TableCell sx={{ py: 0.25 }} align="right">Rate</TableCell>
                              <TableCell sx={{ py: 0.25 }} align="right">Expected</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(investigation.entries ?? []).map((e, i) => (
                              <TableRow key={i}>
                                <TableCell sx={{ py: 0.25 }}>{e.workDate || '—'}</TableCell>
                                <TableCell sx={{ py: 0.25 }}>
                                  <Typography
                                    variant="caption"
                                    color={
                                      e.status === 'paid' || e.status === 'sent_to_everee'
                                        ? 'success.main'
                                        : 'warning.main'
                                    }
                                  >
                                    {e.status}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 0.25 }} align="right">
                                  {((e.regHours ?? 0) + (e.otHours ?? 0) + (e.dtHours ?? 0)).toFixed(2)}
                                </TableCell>
                                <TableCell sx={{ py: 0.25 }} align="right">{fmtUsd(e.payRate)}</TableCell>
                                <TableCell sx={{ py: 0.25 }} align="right">{fmtUsd(e.expectedTotal)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                    {(investigation.payments?.length ?? 0) > 0 && (
                      <TableContainer sx={{ maxHeight: 140, mb: 1 }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ py: 0.25 }}>Paid</TableCell>
                              <TableCell sx={{ py: 0.25 }}>Period</TableCell>
                              <TableCell sx={{ py: 0.25 }} align="right">Gross</TableCell>
                              <TableCell sx={{ py: 0.25 }}>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(investigation.payments ?? []).map((p, i) => (
                              <TableRow key={i}>
                                <TableCell sx={{ py: 0.25 }}>{p.payDate || 'pending'}</TableCell>
                                <TableCell sx={{ py: 0.25 }}>
                                  <Typography variant="caption">
                                    {p.periodStart || '?'} – {p.periodEnd || '?'}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 0.25 }} align="right">{fmtUsd(p.gross)}</TableCell>
                                <TableCell sx={{ py: 0.25 }}>
                                  <Typography variant="caption">{p.status || '—'}</Typography>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Submitted for pay: {fmtUsd(investigation.totals?.submittedExpected)} · Not yet
                      submitted: {fmtUsd(investigation.totals?.unsubmittedExpected)} · Everee paid:{' '}
                      {fmtUsd(investigation.totals?.paidGross)}
                    </Typography>
                    {investigation.ai?.rationale && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontStyle: 'italic' }}>
                        {investigation.ai.rationale}
                      </Typography>
                    )}
                  </>
                )}
                {selected.status !== 'resolved' && (
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      size="small"
                      variant={investigation?.ai?.recommendation === 'pay_correction' ? 'contained' : 'outlined'}
                      color="success"
                      disabled={busy}
                      onClick={openCorrectionDialog}
                      sx={{ fontWeight: 700 }}
                    >
                      {investigation?.ai?.proposedAmount != null
                        ? `Authorize correction — pay ${fmtUsd(investigation.ai.proposedAmount)}`
                        : 'Authorize a correction…'}
                    </Button>
                    <Button size="small" variant="outlined" disabled={busy} onClick={openPaidCorrectlyDialog}>
                      Paid correctly — send &amp; resolve
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      disabled={busy}
                      onClick={() =>
                        void runTicketAction(
                          { action: 'payroll_investigate', ticketId: selected.id },
                          'Investigation updated below.',
                        )
                      }
                    >
                      {investigation ? 'Re-run investigation' : 'Run investigation'}
                    </Button>
                  </Stack>
                )}
              </Paper>
            )}

            {/* Slice 2 — one-click approved actions (safe, non-money-moving). */}
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                ACTIONS
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() =>
                    void runTicketAction(
                      { action: 'payroll_action_send_link', ticketId: selected.id, kind: 'onboarding' },
                      'Onboarding link sent (SMS + in-app).',
                    )
                  }
                >
                  Send onboarding link
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() =>
                    void runTicketAction(
                      { action: 'payroll_action_send_link', ticketId: selected.id, kind: 'bank_update' },
                      'Bank-update link sent (SMS + in-app).',
                    )
                  }
                >
                  Send bank-update link
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() =>
                    void runTicketAction(
                      { action: 'payroll_action_refresh_everee', ticketId: selected.id },
                      'Everee refreshed — diagnosis updated below.',
                    )
                  }
                >
                  Refresh Everee + re-diagnose
                </Button>
              </Stack>
              {actionNote && (
                <Alert severity="success" sx={{ mt: 1 }} onClose={() => setActionNote(null)}>
                  {actionNote}
                </Alert>
              )}
              {auditEntries.length > 0 && (
                <Stack spacing={0.25} sx={{ mt: 1 }}>
                  {auditEntries.map((e, i) => (
                    <Typography key={i} variant="caption" color="text.secondary">
                      {String(e.action)} — {String(e.byName || e.byUid || '')}
                      {(() => {
                        const at = e.at as { toDate?: () => Date } | undefined;
                        try {
                          return at?.toDate ? ` · ${at.toDate().toLocaleString()}` : '';
                        } catch {
                          return '';
                        }
                      })()}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Paper>

            <Divider />

            <Stack spacing={1.5} sx={{ maxHeight: 320, overflowY: 'auto' }}>
              {messages.map((m) => (
                <Box key={m.id}>
                  <Typography variant="caption" color="text.secondary">
                    {m.by === 'worker' ? selected.workerName : m.authorName || 'Staff'}
                    {m.at ? ` · ${m.at.toLocaleString()}` : ''}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              placeholder="Reply to the worker…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              disabled={busy}
            />
            <Stack direction="row" spacing={1} justifyContent="space-between">
              <Stack direction="row" spacing={1}>
                {selected.status !== 'resolved' ? (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      setResolveNote('');
                      setResolveOpen(true);
                    }}
                  >
                    Resolve
                  </Button>
                ) : (
                  <Button size="small" variant="outlined" disabled={busy} onClick={() => void setStatus('open')}>
                    Reopen
                  </Button>
                )}
                <Button
                  size="small"
                  variant="text"
                  disabled={busy}
                  onClick={() => void setLane(selected.lane === 'money' ? 'fix_it' : 'money')}
                >
                  {selected.lane === 'money' ? 'Move to Fix-it lane' : 'Move to Money lane'}
                </Button>
              </Stack>
              <Button
                variant="contained"
                disabled={busy || !replyText.trim()}
                onClick={() => void sendReply()}
              >
                {busy ? 'Sending…' : 'Send reply'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Drawer>

      {/* Authorize correction — the one-click money action. The amount rides
          the standard off-cycle path (duplicate guard, caps); a duplicate-pay
          warning comes back for an explicit second confirm. */}
      <Dialog open={correctionOpen} onClose={() => setCorrectionOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Authorize pay correction</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Sends an off-cycle payment through Everee now, notifies the worker, and resolves the
            ticket. It appears in the Payroll Costs report like any other off-cycle payment.
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label="Gross amount (USD)"
              value={corrAmount}
              onChange={(e) => setCorrAmount(e.target.value)}
              inputProps={{ inputMode: 'decimal' }}
            />
            <TextField
              size="small"
              label="Work date (YYYY-MM-DD)"
              value={corrWorkDate}
              onChange={(e) => setCorrWorkDate(e.target.value)}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField
                size="small"
                label="Hours (optional)"
                value={corrHours}
                onChange={(e) => setCorrHours(e.target.value)}
                inputProps={{ inputMode: 'decimal' }}
              />
              <TextField
                size="small"
                label="Hourly rate (optional)"
                value={corrRate}
                onChange={(e) => setCorrRate(e.target.value)}
                inputProps={{ inputMode: 'decimal' }}
              />
            </Stack>
            <TextField
              size="small"
              label="Hiring entity"
              value={corrEntity}
              onChange={(e) => setCorrEntity(e.target.value)}
            />
          </Stack>
          {corrWarning && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {corrWarning}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCorrectionOpen(false)}>Cancel</Button>
          {corrWarning ? (
            <Button variant="contained" color="warning" disabled={busy} onClick={() => void submitCorrection(true)}>
              Pay anyway
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              disabled={busy || !(Number(corrAmount) > 0) || !corrWorkDate.trim() || !corrEntity.trim()}
              onClick={() => void submitCorrection(false)}
              sx={{ fontWeight: 700 }}
            >
              {busy ? 'Sending…' : `Pay ${fmtUsd(Number(corrAmount) || 0)}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Paid correctly — send the (editable) explanation and resolve. */}
      <Dialog open={paidCorrectlyOpen} onClose={() => setPaidCorrectlyOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Paid correctly — notify &amp; resolve</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This message goes to the worker, then the ticket resolves.
          </Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={4}
            label="Message to worker"
            value={paidCorrectlyText}
            onChange={(e) => setPaidCorrectlyText(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPaidCorrectlyOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !paidCorrectlyText.trim()}
            onClick={() => void submitPaidCorrectly()}
          >
            {busy ? 'Sending…' : 'Send & resolve'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Resolution note — the "resolutions" half of the queue table; also
          posted to the payroll Slack channel. */}
      <Dialog open={resolveOpen} onClose={() => setResolveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Resolve ticket</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            What fixed it? One line for the queue history (e.g. "sent bank-update link, worker
            confirmed" or "ad-hoc payment $312 submitted").
          </Typography>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            label="Resolution (optional)"
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setResolveOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              await setStatus('resolved', resolveNote.trim() || undefined);
              setResolveOpen(false);
            }}
          >
            Resolve
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PayrollTicketsPage;

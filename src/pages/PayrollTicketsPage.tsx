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

const PayrollTicketsPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<0 | 1 | 2>(0);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [privateDiagnosis, setPrivateDiagnosis] = useState<PrivateDiagnosis | null>(null);
  const [auditEntries, setAuditEntries] = useState<Array<Record<string, unknown>>>([]);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    return tickets.filter((x) => wanted.includes(x.status));
  }, [tickets, statusTab]);

  const counts = useMemo(
    () => ({
      open: tickets.filter((x) => x.status === 'open').length,
      waiting: tickets.filter((x) => x.status === 'waiting_worker').length,
      resolved: tickets.filter((x) => x.status === 'resolved').length,
    }),
    [tickets],
  );

  const callAction = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'workerSupportAssistant');
      await fn(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const setStatus = async (status: TicketStatus) => {
    if (!selected) return;
    await callAction({ action: 'payroll_set_status', ticketId: selected.id, status });
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

      <Tabs value={statusTab} onChange={(_, v) => setStatusTab(v)} sx={{ mb: 2 }}>
        <Tab label={`Open (${counts.open})`} />
        <Tab label={`Waiting on worker (${counts.waiting})`} />
        <Tab label={`Resolved (${counts.resolved})`} />
      </Tabs>

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
                    <Typography variant="caption">
                      {row.lastMessageAt ? row.lastMessageAt.toLocaleString() : '—'}
                      {row.lastMessageBy === 'worker' && row.status === 'open' ? ' · worker waiting' : ''}
                    </Typography>
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
                  <Button size="small" variant="outlined" disabled={busy} onClick={() => void setStatus('resolved')}>
                    Resolve
                  </Button>
                ) : (
                  <Button size="small" variant="outlined" disabled={busy} onClick={() => void setStatus('open')}>
                    Reopen
                  </Button>
                )}
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
    </Box>
  );
};

export default PayrollTicketsPage;

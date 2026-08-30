/**
 * Payroll help — /c1/workers/payroll-help (+ /:ticketId thread view).
 *
 * Worker side of the payroll help desk (Slice 1, Greg 2026-08-24). Tickets
 * are created and replied to through the `workerSupportAssistant` callable
 * (`action: 'payroll_create_ticket' | 'payroll_reply'`) — the collection is
 * client-read-only. Reads are live (onSnapshot) so staff replies appear
 * without a refresh. Entry points: Help & Support card + Earnings row.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import WorkerPageHeader from '../../../components/worker/WorkerPageHeader';
import GetHelpPanel, { type SupportTopic } from '../../../components/worker/support/GetHelpPanel';

interface TicketRow {
  id: string;
  subject: string;
  status: 'open' | 'waiting_worker' | 'resolved';
  lastMessageAt: Date | null;
}

interface MessageRow {
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

const PayrollHelp: React.FC = () => {
  const navigate = useNavigate();
  const { ticketId } = useParams<{ ticketId?: string }>();
  const { user, activeTenant } = useAuth();
  const t = useT();
  const uid = user?.uid ?? '';
  const tenantId = activeTenant?.id ?? '';

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Contextual entry (?topic=shifts_jobs from an assignment page, etc.)
  // presets the chip — same idea as the app's initialTopic.
  const initialTopic = ((): SupportTopic => {
    const raw = new URLSearchParams(window.location.search).get('topic') ?? '';
    return (['payroll', 'shifts_jobs', 'app_issue', 'other'] as const).includes(
      raw as SupportTopic,
    )
      ? (raw as SupportTopic)
      : 'payroll';
  })();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // My tickets (list view).
  useEffect(() => {
    if (!uid) return;
    // No orderBy — where+orderBy on different fields needs a composite
    // index; the list is small, so sort client-side.
    const q1 = query(collection(db, 'payroll_tickets'), where('uid', '==', uid));
    const unsub = onSnapshot(
      q1,
      (snap) => {
        setTickets(
          snap.docs
            .map((d) => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                subject: String(x.subject || ''),
                status: (x.status as TicketRow['status']) || 'open',
                lastMessageAt: tsToDate(x.lastMessageAt),
              };
            })
            .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid]);

  // Thread messages (detail view).
  useEffect(() => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    const q2 = query(
      collection(db, 'payroll_tickets', ticketId, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q2, (snap) => {
      setMessages(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            by: (x.by as MessageRow['by']) || 'worker',
            authorName: (x.authorName as string) ?? null,
            text: String(x.text || ''),
            at: tsToDate(x.at),
          };
        }),
      );
    });
  }, [ticketId]);

  const activeTicket = useMemo(
    () => tickets.find((x) => x.id === ticketId) ?? null,
    [tickets, ticketId],
  );

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || !tenantId) return;
    setSending(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'workerSupportAssistant');
      if (ticketId) {
        await fn({ action: 'payroll_reply', ticketId, text: trimmed });
      } else {
        const res = await fn({ action: 'payroll_create_ticket', tenantId, text: trimmed });
        const newId = (res.data as { ticketId?: string })?.ticketId;
        if (newId) navigate(`/c1/workers/payroll-help/${newId}`, { replace: true });
      }
      setText('');
    } catch {
      setError(t('payrollHelp.sendError'));
    } finally {
      setSending(false);
    }
  };

  const statusChip = (status: TicketRow['status']) =>
    status === 'resolved' ? (
      <Chip size="small" color="success" label={t('payrollHelp.statusResolved')} />
    ) : status === 'waiting_worker' ? (
      <Chip size="small" color="secondary" label={t('payrollHelp.statusReplied')} />
    ) : (
      <Chip size="small" variant="outlined" label={t('payrollHelp.statusOpen')} />
    );

  // ——— Thread view ———
  if (ticketId) {
    return (
      <Box>
        <WorkerPageHeader title={t('payrollHelp.title')} backTo="/c1/workers/payroll-help" />
        {activeTicket && <Box sx={{ mb: 2 }}>{statusChip(activeTicket.status)}</Box>}
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              {messages.map((m) => (
                <Box key={m.id}>
                  <Typography variant="caption" color="text.secondary">
                    {m.by === 'worker'
                      ? t('payrollHelp.you')
                      : m.authorName || t('payrollHelp.supportTeam')}
                    {m.at ? ` · ${m.at.toLocaleDateString()}` : ''}
                  </Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {m.text}
                  </Typography>
                </Box>
              ))}
              {messages.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('payrollHelp.loadingThread')}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={1.5}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            placeholder={t('payrollHelp.replyPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={sending}
          />
          <Button
            variant="contained"
            disabled={sending || !text.trim()}
            onClick={() => void send()}
            sx={{ alignSelf: 'flex-end', px: 4 }}
          >
            {sending ? t('payrollHelp.sending') : t('payrollHelp.send')}
          </Button>
        </Stack>
      </Box>
    );
  }

  // ——— List + new-ticket view ———
  return (
    <Box>
      <WorkerPageHeader
        title={t('payrollHelp.title')}
        backTo="/c1/workers/profile"
        description={t('payrollHelp.subtitle')}
      />

      {/* Pay-schedule facts (Greg 2026-08-26) — answer the #1 question
          before a ticket gets written. */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ pb: '16px !important' }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            {t('payrollHelp.scheduleTitle')}
          </Typography>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {t('payrollHelp.scheduleSelect')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('payrollHelp.scheduleEvents')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('payrollHelp.scheduleDirectDeposit')}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {/* ONE help door: the grounded assistant answers first; anything it
          can't resolve files a ticket into this same queue. */}
      {tenantId && (
        <GetHelpPanel
          tenantId={tenantId}
          initialTopic={initialTopic}
          onTicketCreated={(newId) => navigate(`/c1/workers/payroll-help/${newId}`)}
        />
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : tickets.length > 0 ? (
        <>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            {t('payrollHelp.myRequests')}
          </Typography>
          <Card variant="outlined">
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <List disablePadding>
                {tickets.map((row, i) => (
                  <React.Fragment key={row.id}>
                    {i > 0 && <Divider component="li" />}
                    <ListItemButton onClick={() => navigate(`/c1/workers/payroll-help/${row.id}`)}>
                      <ListItemText
                        primary={row.subject}
                        secondary={row.lastMessageAt ? row.lastMessageAt.toLocaleDateString() : null}
                        primaryTypographyProps={{ noWrap: true }}
                      />
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, ml: 1 }}>
                        {statusChip(row.status)}
                        <ChevronRightIcon color="action" />
                      </Stack>
                    </ListItemButton>
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </Card>
        </>
      ) : null}
    </Box>
  );
};

export default PayrollHelp;

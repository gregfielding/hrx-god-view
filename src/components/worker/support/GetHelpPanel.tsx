/**
 * ONE help door for workers (Greg 2026-08-30, after the Instawork / Qwick /
 * Wonolo scan): pick a topic, describe the issue, get a grounded answer
 * first — and if it didn't resolve, one click files a ticket into the SAME
 * queue with the exchange attached.
 *
 * Mirrors the Flutter `showGetHelpSheet` exactly so the two surfaces stay
 * one product (CLAUDE.md worker-view parity rule).
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useT } from '../../../i18n';

export const SUPPORT_TOPICS = ['payroll', 'shifts_jobs', 'app_issue', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

type AssistantAnswer = {
  answer: string;
  escalate: boolean;
  confidence: number;
};

interface GetHelpPanelProps {
  tenantId: string;
  /** Contextual entry (payroll hub, assignment page) presets the topic. */
  initialTopic?: SupportTopic;
  /** Called with the new ticket id when the worker escalates. */
  onTicketCreated: (ticketId: string) => void;
}

const GetHelpPanel: React.FC<GetHelpPanelProps> = ({
  tenantId,
  initialTopic = 'payroll',
  onTicketCreated,
}) => {
  const t = useT();
  const [topic, setTopic] = useState<SupportTopic>(initialTopic);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [filing, setFiling] = useState(false);
  const [askedQuestion, setAskedQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [answered, setAnswered] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topicLabel = (value: SupportTopic): string => {
    switch (value) {
      case 'payroll':
        return t('payrollHelp.topicPayroll');
      case 'shifts_jobs':
        return t('payrollHelp.topicShifts');
      case 'app_issue':
        return t('payrollHelp.topicApp');
      default:
        return t('payrollHelp.topicOther');
    }
  };

  const ask = async () => {
    const trimmed = text.trim();
    if (!trimmed || !tenantId) return;
    setAsking(true);
    setError(null);
    setAskedQuestion(trimmed);
    try {
      const fn = httpsCallable(getFunctions(), 'workerSupportAssistant');
      const res = await fn({ question: trimmed, tenantId });
      const data = res.data as Partial<AssistantAnswer> | undefined;
      setAnswer({
        answer: String(data?.answer ?? '').trim(),
        escalate: Boolean(data?.escalate),
        confidence: Number(data?.confidence ?? 0),
      });
    } catch {
      // Assistant unreachable must never block the worker — fall through to
      // filing so the request still reaches the queue.
      setAnswer(null);
    } finally {
      setAnswered(true);
      setAsking(false);
    }
  };

  const fileTicket = async () => {
    if (!tenantId) return;
    setFiling(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'workerSupportAssistant');
      const res = await fn({
        action: 'payroll_create_ticket',
        tenantId,
        text: askedQuestion || text.trim(),
        topic,
        priorQuestion: askedQuestion || undefined,
        priorAnswer: answer?.answer || undefined,
      });
      const newId = (res.data as { ticketId?: string })?.ticketId;
      if (newId) {
        onTicketCreated(newId);
        setText('');
        setAnswered(false);
        setAnswer(null);
      }
    } catch {
      setError(t('payrollHelp.sendError'));
    } finally {
      setFiling(false);
    }
  };

  if (resolved) {
    return (
      <Alert severity="success" sx={{ mb: 3 }} onClose={() => setResolved(false)}>
        {t('payrollHelp.resolvedThanks')}
      </Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <SupportAgentIcon fontSize="small" />
          <Typography variant="subtitle1">{t('payrollHelp.helpTitle')}</Typography>
        </Stack>

        {!answered ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {t('payrollHelp.topicLabel')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {SUPPORT_TOPICS.map((value) => (
                <Chip
                  key={value}
                  label={topicLabel(value)}
                  onClick={() => setTopic(value)}
                  color={topic === value ? 'primary' : 'default'}
                  variant={topic === value ? 'filled' : 'outlined'}
                />
              ))}
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={3}
              placeholder={t('payrollHelp.newTicketPlaceholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={asking}
              inputProps={{ maxLength: 2000 }}
            />
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <Button
              variant="contained"
              disabled={asking || !text.trim()}
              onClick={() => void ask()}
              sx={{ alignSelf: 'flex-end', px: 4 }}
            >
              {asking ? t('payrollHelp.thinking') : t('payrollHelp.ask')}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t('payrollHelp.assistant')}
                </Typography>
                <Typography variant="body1" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {answer?.answer || t('payrollHelp.escalateNote')}
                </Typography>
              </CardContent>
            </Card>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {/* An escalate verdict means an ANSWER can't resolve it — someone
                has to act — so lead with filing rather than asking. */}
            {answer?.escalate !== false ? (
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {t('payrollHelp.escalateNote')}
                </Typography>
                <Button
                  variant="contained"
                  disabled={filing}
                  onClick={() => void fileTicket()}
                  startIcon={filing ? <CircularProgress size={16} /> : undefined}
                >
                  {filing ? t('payrollHelp.filing') : t('payrollHelp.stillNeedHelp')}
                </Button>
              </Stack>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="contained"
                  onClick={() => {
                    setResolved(true);
                    setText('');
                    setAnswered(false);
                    setAnswer(null);
                  }}
                >
                  {t('payrollHelp.thatHelped')}
                </Button>
                <Button
                  variant="outlined"
                  disabled={filing}
                  onClick={() => void fileTicket()}
                  startIcon={filing ? <CircularProgress size={16} /> : undefined}
                >
                  {filing ? t('payrollHelp.filing') : t('payrollHelp.stillNeedHelp')}
                </Button>
              </Stack>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default GetHelpPanel;

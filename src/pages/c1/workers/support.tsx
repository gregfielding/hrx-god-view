/**
 * Help & Support — /c1/workers/support
 * AI support entry, common questions, and escalation to recruiter (inbox).
 */

import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  InputAdornment,
  List,
  ListItemButton,
  TextField,
  Typography,
  CircularProgress,
  Alert,
  Stack,
  Chip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';

const COMMON_QUESTION_KEYS = [
  'support.questionCancelShift',
  'support.questionWhenPaid',
  'support.questionWhatToWear',
  'support.questionUpdateCerts',
] as const;

interface WorkerSupportAssistantResult {
  answer: string;
  confidence: number;
  suggestedActions: string[];
  followUps: string[];
  escalate: boolean;
  sourceTopics: string[];
}

const C1WorkerSupport: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const userId = user?.uid ?? '';

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<WorkerSupportAssistantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSuggestedAction = useCallback((action: string) => {
    const normalized = action.toLowerCase();
    if (normalized.includes('inbox') || normalized.includes('recruiter') || normalized.includes('contact')) {
      navigate('/c1/workers/inbox');
      return;
    }
    if (normalized.includes('assignment')) {
      navigate('/c1/workers/assignments');
      return;
    }
    if (normalized.includes('profile')) {
      navigate('/c1/workers/profile');
    }
  }, [navigate]);

  const sendQuestion = useCallback(
    async (text: string) => {
      const trimmed = text?.trim();
      if (!trimmed || !tenantId || !userId) return;

      setLoading(true);
      setError(null);
      setReply(null);

      try {
        const functions = getFunctions();
        const askWorkerSupport = httpsCallable<
          { question: string; tenantId: string },
          WorkerSupportAssistantResult
        >(functions, 'workerSupportAssistant');
        const response = await askWorkerSupport({
          question: trimmed,
          tenantId,
        });

        const data = response.data;
        setReply({
          answer: data?.answer || '',
          confidence: Number(data?.confidence || 0),
          suggestedActions: Array.isArray(data?.suggestedActions) ? data.suggestedActions : [],
          followUps: Array.isArray(data?.followUps) ? data.followUps : [],
          escalate: Boolean(data?.escalate),
          sourceTopics: Array.isArray(data?.sourceTopics) ? data.sourceTopics : [],
        });
        setQuestion('');
      } catch (err) {
        setError(t('support.errorSending'));
      } finally {
        setLoading(false);
      }
    },
    [tenantId, userId, t]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(question);
  };

  const handleCommonQuestion = (key: (typeof COMMON_QUESTION_KEYS)[number]) => {
    const q = t(key);
    setQuestion(q);
    sendQuestion(q);
  };

  const goToInbox = () => {
    navigate('/c1/workers/inbox');
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select your organization to use Help & Support.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', px: 1.5, py: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        {t('support.title')}
      </Typography>

      {/* 1. Ask a question — AI support */}
      <Card variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
        <CardContent sx={{ pt: 2, pb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
            {t('support.askQuestion')}
          </Typography>
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              size="medium"
              placeholder={t('support.askPlaceholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={loading}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      type="submit"
                      disabled={!question.trim() || loading}
                      startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
                      sx={{ minWidth: 0, px: 1.5 }}
                      aria-label={loading ? t('support.sending') : undefined}
                    >
                      {loading ? t('support.sending') : null}
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </form>
          {reply && (
            <Box
              sx={{
                mt: 2,
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
                {reply.answer}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 0.75 }}>
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                  Confidence: {Math.round(Math.max(0, Math.min(1, reply.confidence)) * 100)}%
                </Typography>
                {reply.escalate && (
                  <Chip size="small" color="warning" variant="outlined" label="Escalation recommended" />
                )}
              </Stack>
              {reply.suggestedActions.length > 0 && (
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  {reply.suggestedActions.slice(0, 3).map((action) => (
                    <Button
                      key={action}
                      size="small"
                      variant="outlined"
                      onClick={() => handleSuggestedAction(action)}
                    >
                      {action}
                    </Button>
                  ))}
                </Stack>
              )}
              {reply.followUps.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1.25 }}>
                  {reply.followUps.slice(0, 2).map((followUp) => (
                    <Button
                      key={followUp}
                      size="small"
                      variant="text"
                      sx={{ justifyContent: 'flex-start' }}
                      onClick={() => sendQuestion(followUp)}
                    >
                      {followUp}
                    </Button>
                  ))}
                </Stack>
              )}
            </Box>
          )}
          {reply?.escalate && (
            <Alert
              severity="warning"
              sx={{ mt: 1.5 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={goToInbox}
                  startIcon={<SupportAgentIcon />}
                >
                  {t('support.contactRecruiter')}
                </Button>
              }
            >
              This question may need recruiter support for a complete answer.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 2. Common questions */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {t('support.commonQuestions')}
      </Typography>
      <List disablePadding sx={{ mb: 2 }}>
        {COMMON_QUESTION_KEYS.map((key) => (
          <ListItemButton
            key={key}
            onClick={() => handleCommonQuestion(key)}
            disabled={loading}
            sx={{
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              mb: 0.75,
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="body2">{t(key)}</Typography>
          </ListItemButton>
        ))}
      </List>

      {/* 3. Escalation — Contact recruiter */}
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'primary.main' }}>
        <CardContent sx={{ pt: 2, pb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Typography variant="body2" color="text.secondary">
              Can’t resolve your issue? Your recruiter can help.
            </Typography>
            <Button
              variant="contained"
              startIcon={<SupportAgentIcon />}
              onClick={goToInbox}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              {t('support.contactRecruiter')}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default C1WorkerSupport;

/**
 * Help & Support — /c1/workers/support
 * AI support entry, common questions, and escalation to recruiter (inbox).
 */

import React, { useCallback, useRef, useState } from 'react';
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
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';

const ENHANCED_CHAT_URL = 'https://us-central1-hrx1-d3beb.cloudfunctions.net/enhancedChatWithGPT';

const COMMON_QUESTION_KEYS = [
  'support.questionCancelShift',
  'support.questionWhenPaid',
  'support.questionWhatToWear',
  'support.questionUpdateCerts',
] as const;

const C1WorkerSupport: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const { user, activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const userId = user?.uid ?? '';

  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const messagesRef = useRef<{ role: string; content: string }[]>([]);

  const ensureThread = useCallback(async (): Promise<string> => {
    if (threadIdRef.current) return threadIdRef.current;
    const functions = getFunctions();
    const startAIThread = httpsCallable(functions, 'startAIThread');
    const res = await startAIThread({ tenantId, context: 'worker_support' });
    const id = (res.data as { threadId?: string })?.threadId;
    if (id) {
      threadIdRef.current = id;
      return id;
    }
    throw new Error('No threadId');
  }, [tenantId]);

  const sendQuestion = useCallback(
    async (text: string) => {
      const trimmed = text?.trim();
      if (!trimmed || !tenantId || !userId) return;

      setLoading(true);
      setError(null);
      setReply(null);

      try {
        const tid = await ensureThread();
        const userMsg = { role: 'user' as const, content: trimmed };
        messagesRef.current = [...messagesRef.current, userMsg];
        const messages = messagesRef.current.slice(-10);

        const response = await fetch(ENHANCED_CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, userId, threadId: tid, messages }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const assistantContent = data?.reply ?? '';
        messagesRef.current = [...messagesRef.current, { role: 'assistant', content: assistantContent }];
        setReply(assistantContent);
        setQuestion('');
      } catch (err) {
        setError(t('support.errorSending'));
      } finally {
        setLoading(false);
      }
    },
    [ensureThread, tenantId, userId, t]
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
              <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap' }}>
                {reply}
              </Typography>
            </Box>
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

import React, { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import type { RecruiterReviewRequestKind } from '../../../shared/illinoisAiHiring';

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  jobId?: string | null;
  jobOrderId?: string | null;
  applicationId?: string | null;
  postingTitle?: string | null;
};

/**
 * "Ask a recruiter" (Illinois AI-in-hiring, Greg 2026-09-10): the worker asks for
 * a person to review their application or requests an accommodation. Writes
 * tenants/{t}/recruiter_review_requests; the hourly orchestrator alerts the job
 * order's recruiters. Flutter parity: showRecruiterReviewRequestSheet.
 */
const RecruiterReviewRequestDialog: React.FC<Props> = ({
  open,
  onClose,
  tenantId,
  jobId,
  jobOrderId,
  applicationId,
  postingTitle,
}) => {
  const t = useT();
  const { user } = useAuth();
  const [kind, setKind] = useState<RecruiterReviewRequestKind>('review');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (sending) return;
    setKind('review');
    setDetails('');
    setSent(false);
    setError(null);
    onClose();
  };

  const send = async () => {
    if (!user?.uid) return;
    setSending(true);
    setError(null);
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'recruiter_review_requests'), {
        tenantId,
        userId: user.uid,
        kind,
        details: details.trim().slice(0, 2000),
        applicationId: applicationId ?? null,
        jobId: jobId ?? null,
        jobOrderId: jobOrderId ?? null,
        postingTitle: postingTitle ?? null,
        stateCode: 'IL',
        status: 'open',
        source: 'web',
        notifiedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSent(true);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'unknown';
      setError(t('aiHiring.requestFailed', { code }));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{t('aiHiring.askRecruiter')}</DialogTitle>
      <DialogContent>
        {sent ? (
          <Alert severity="success">{t('aiHiring.requestSent')}</Alert>
        ) : !user?.uid ? (
          <Alert severity="info">{t('aiHiring.signInToRequest')}</Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                label={t('aiHiring.kindReview')}
                color={kind === 'review' ? 'primary' : 'default'}
                variant={kind === 'review' ? 'filled' : 'outlined'}
                onClick={() => setKind('review')}
                disabled={sending}
              />
              <Chip
                label={t('aiHiring.kindAccommodation')}
                color={kind === 'accommodation' ? 'primary' : 'default'}
                variant={kind === 'accommodation' ? 'filled' : 'outlined'}
                onClick={() => setKind('accommodation')}
                disabled={sending}
              />
            </Stack>
            <Typography variant="body2">
              {kind === 'accommodation' ? t('aiHiring.accommodationHelp') : t('aiHiring.reviewHelp')}
            </Typography>
            <TextField
              label={t('aiHiring.detailsLabel')}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              multiline
              minRows={3}
              inputProps={{ maxLength: 2000 }}
              disabled={sending}
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={sending}>
          {sent ? t('aiHiring.done') : t('aiHiring.cancel')}
        </Button>
        {!sent && user?.uid ? (
          <Button variant="contained" onClick={() => void send()} disabled={sending}>
            {t('aiHiring.sendRequest')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
};

export default RecruiterReviewRequestDialog;

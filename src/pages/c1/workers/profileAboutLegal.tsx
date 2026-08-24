/**
 * About & Legal — /c1/workers/profile/about
 *
 * Terms, privacy, SMS policy, and the account-deletion request (worker-app
 * redesign, Greg 2026-08-23). Deletion is a REQUEST, not a hard delete:
 * payroll/tax records carry retention obligations, so the row writes
 * `account_deletion_requests/{uid}` and support completes the review. This
 * flow is also an Apple App Store requirement for the future native app.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';

const ProfileAboutLegal: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [requestState, setRequestState] = useState<'idle' | 'saving' | 'done' | 'already'>('idle');

  const submitDeletionRequest = async () => {
    if (!user?.uid) return;
    setRequestState('saving');
    try {
      const ref = doc(db, 'account_deletion_requests', user.uid);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        setRequestState('already');
        return;
      }
      await setDoc(ref, {
        uid: user.uid,
        email: user.email ?? null,
        requestedAt: serverTimestamp(),
        status: 'pending',
        source: 'worker_profile_about',
      });
      setRequestState('done');
    } catch {
      setRequestState('idle');
    }
  };

  return (
    <Box>
      <Stack spacing={3}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ArrowBackIcon
            sx={{ cursor: 'pointer', color: 'text.secondary' }}
            onClick={() => navigate('/c1/workers/profile')}
          />
          <Typography variant="h5" component="h1">
            {t('profile.sectionAboutTitle')}
          </Typography>
        </Stack>

        <Card variant="outlined" sx={{ borderColor: 'divider' }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <List disablePadding>
              <ListItemButton onClick={() => window.open('/terms', '_blank')}>
                <ListItemText primary={t('profile.aboutTerms')} />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <Divider component="li" />
              <ListItemButton onClick={() => window.open('/privacy', '_blank')}>
                <ListItemText primary={t('profile.aboutPrivacy')} />
                <ChevronRightIcon color="action" />
              </ListItemButton>
              <Divider component="li" />
              <ListItemButton onClick={() => window.open('/sms-privacy', '_blank')}>
                <ListItemText primary={t('profile.aboutSmsPolicy')} />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderColor: 'divider' }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <List disablePadding>
              <ListItemButton onClick={() => setConfirmOpen(true)} disabled={requestState !== 'idle'}>
                <ListItemText
                  primary={t('profile.aboutDeleteTitle')}
                  secondary={
                    requestState === 'done' || requestState === 'already'
                      ? t('profile.aboutDeleteRequested')
                      : t('profile.aboutDeleteSecondary')
                  }
                />
                <ChevronRightIcon color="action" />
              </ListItemButton>
            </List>
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('profile.aboutDeleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('profile.aboutDeleteExplainer')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            disabled={requestState === 'saving'}
            onClick={async () => {
              await submitDeletionRequest();
              setConfirmOpen(false);
            }}
          >
            {t('profile.aboutDeleteConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProfileAboutLegal;

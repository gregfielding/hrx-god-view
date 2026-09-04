/**
 * Slim worker top bar (P0 of the worker-app redesign, Greg approved
 * 2026-08-23): the C1 mark on the left, the notification bell on the right.
 * Everything else moved out — navigation lives in WorkerBottomTabs, language
 * and log-out live on the Profile page. The bell no longer opens a popover
 * (it overlapped content and its "(50 unread)" was the query cap, not a
 * count) — it goes straight to the notifications list, badge capped at 9+.
 * The one dialog kept: the first-login language picker (EN/ES) for accounts
 * that never chose — every SMS and screen depends on that answer.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  IconButton,
  Badge,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkerNotifications } from '../../hooks/useWorkerNotifications';
import { setLanguage, t } from '../../i18n';
import { useGuestLanguage } from '../../hooks/useGuestLanguage';

const WorkerAppBar: React.FC = () => {
  const navigate = useNavigate();
  const { user, activeTenant } = useAuth();
  const uid = user?.uid;
  const { unreadCount } = useWorkerNotifications(uid, { max: 50 });
  const [, setGuestLanguage] = useGuestLanguage();
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>('en');
  const [preferredLanguageLoaded, setPreferredLanguageLoaded] = useState(false);
  const [showFirstLoginLanguageModal, setShowFirstLoginLanguageModal] = useState(false);

  const tenantSlug = activeTenant?.slug ?? 'c1';

  useEffect(() => {
    const load = async () => {
      if (!uid) return;
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const lang = snap.data().preferredLanguage;
        if (lang === 'es' || lang === 'en') {
          setPreferredLanguage(lang);
          setShowFirstLoginLanguageModal(false);
        } else {
          setPreferredLanguage('en');
          setShowFirstLoginLanguageModal(true);
        }
      }
      setPreferredLanguageLoaded(true);
    };
    void load();
  }, [uid]);

  const savePreferredLanguage = async (lang: 'en' | 'es') => {
    setPreferredLanguage(lang);
    setLanguage(lang);
    setGuestLanguage(lang);
    setShowFirstLoginLanguageModal(false);
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { preferredLanguage: lang, updatedAt: new Date() });
      } catch (err) {
        console.error('Failed to save preferred language:', err);
      }
    }
  };

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: '#fff',
          borderBottom: '1px solid #e6e6e3',
          color: 'text.primary',
        }}
      >
        <Toolbar variant="dense" sx={{ justifyContent: 'space-between', minHeight: { xs: 48, sm: 52 } }}>
          <Box
            component="img"
            src="/C1.png"
            alt="C1 Staffing"
            onClick={() => navigate(`/${tenantSlug}/workers/dashboard`)}
            sx={{ height: 26, width: 'auto', cursor: 'pointer' }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {/* EN | ES quick toggle (Greg 2026-09-03) — same write path as
                the first-login modal; the app shell mirrors this control. */}
            {(['en', 'es'] as const).map((lang, i) => (
              <React.Fragment key={lang}>
                {i > 0 && (
                  <Typography variant="body2" sx={{ color: 'divider', userSelect: 'none' }}>
                    |
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  onClick={() => { if (preferredLanguage !== lang) void savePreferredLanguage(lang); }}
                  sx={{
                    cursor: preferredLanguage === lang ? 'default' : 'pointer',
                    fontWeight: preferredLanguage === lang ? 700 : 500,
                    color: preferredLanguage === lang ? 'text.primary' : 'text.disabled',
                    px: 0.25,
                    userSelect: 'none',
                  }}
                >
                  {lang.toUpperCase()}
                </Typography>
              </React.Fragment>
            ))}
          <IconButton
            color="inherit"
            onClick={() => navigate(`/${tenantSlug}/workers/notifications`)}
            aria-label={t('nav.notifications')}
            sx={{ color: 'text.secondary' }}
          >
            {/* C1 gold badge with ink count (accent decision 2026-08-23). */}
            <Badge badgeContent={unreadCount > 0 ? unreadCount : 0} color="secondary" max={9}>
              {unreadCount > 0 ? <NotificationsIcon sx={{ fontSize: 24 }} /> : <NotificationsNoneIcon sx={{ fontSize: 24 }} />}
            </Badge>
          </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      {/* First-login language selection modal */}
      <Dialog
        open={Boolean(uid && preferredLanguageLoaded && showFirstLoginLanguageModal)}
        onClose={() => {}}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { } }}
      >
        <DialogTitle sx={{ textAlign: 'center', pb: 0 }}>{t('nav.selectYourLanguage')}</DialogTitle>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pt: 0.5, px: 3 }}>
          {t('nav.selectYourLanguageSubtitle')}
        </Typography>
        <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Button
            variant={preferredLanguage === 'en' ? 'contained' : 'outlined'}
            size="large"
            onClick={() => savePreferredLanguage('en')}
            sx={{ py: 1.5 }}
          >
            {t('nav.english')}
          </Button>
          <Button
            variant={preferredLanguage === 'es' ? 'contained' : 'outlined'}
            size="large"
            onClick={() => savePreferredLanguage('es')}
            sx={{ py: 1.5 }}
          >
            {t('nav.espanol')}
          </Button>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2 }} />
      </Dialog>
    </>
  );
};

export default WorkerAppBar;

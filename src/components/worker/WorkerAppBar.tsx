/**
 * Worker layout top bar: notification icon with badge and dropdown,
 * language selector, and avatar with account menu.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import {
  AppBar,
  Toolbar,
  IconButton,
  Badge,
  Menu,
  MenuItem,
  Typography,
  Box,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Button,
  Tooltip,
  Avatar,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import LanguageIcon from '@mui/icons-material/Language';
import LogoutIcon from '@mui/icons-material/Logout';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkerNotifications, getNotificationUrlAsync } from '../../hooks/useWorkerNotifications';
import { setLanguage, t } from '../../i18n';
import { useGuestLanguage } from '../../hooks/useGuestLanguage';
import { markNotificationReadCallable } from '../../api/workerNotificationsApi';
import type { WorkerNotification } from '../../types/unifiedWorkerNotifications';

const PREVIEW_LIMIT = 8;

function formatTime(ts: { toDate?: () => Date } | null): string {
  if (!ts) return '';
  const d = typeof (ts as any).toDate === 'function' ? (ts as any).toDate() : new Date((ts as any).seconds * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return t('dashboard.timeAgo.justNow');
  if (diff < 3600000) return t('dashboard.timeAgo.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
}

const WorkerAppBar: React.FC = () => {
  const { user, logout, avatarUrl, activeTenant } = useAuth();
  const uid = user?.uid ?? undefined;
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [avatarMenuAnchorEl, setAvatarMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [languageMenuAnchorEl, setLanguageMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [lastName, setLastName] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState<'en' | 'es'>('en');
  const [preferredLanguageLoaded, setPreferredLanguageLoaded] = useState(false);
  const [showFirstLoginLanguageModal, setShowFirstLoginLanguageModal] = useState(false);
  const [, setGuestLanguage] = useGuestLanguage();
  const { notifications, unreadCount, loading } = useWorkerNotifications(uid, { max: 50 });
  const [markingId, setMarkingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user?.uid) return;
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        setFirstName(data.firstName ?? null);
        setLastName(data.lastName ?? null);
        const lang = data.preferredLanguage;
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
    load();
  }, [user?.uid]);

  const initials = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?';
  const open = Boolean(anchorEl);
  const preview = notifications.slice(0, PREVIEW_LIMIT);
  const tenantSlug = activeTenant?.slug ?? 'c1';
  const profilePath = `/${tenantSlug}/workers/profile`;

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const handleMarkRead = async (id: string) => {
    if (!uid) return;
    setMarkingId(id);
    try {
      await markNotificationReadCallable(uid, id);
    } finally {
      setMarkingId(null);
    }
  };

  const handleNotificationClick = async (n: WorkerNotification & { id: string }) => {
    if (!n.readAt) await handleMarkRead(n.id);
    handleClose();
    const url = n.deepLink?.trim() ? n.deepLink.trim() : await getNotificationUrlAsync(n, uid);
    if (url?.startsWith('/')) navigate(url);
    else if (url) window.location.href = url;
    else navigate(`/${tenantSlug}/workers/notifications`);
  };

  const savePreferredLanguage = async (lang: 'en' | 'es') => {
    setPreferredLanguage(lang);
    setLanguage(lang);
    setGuestLanguage(lang); // Keep localStorage in sync so guest/other tabs see same choice
    setShowFirstLoginLanguageModal(false);
    if (user?.uid) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { preferredLanguage: lang, updatedAt: new Date() });
      } catch (err) {
        console.error('Failed to save preferred language:', err);
      }
    }
  };

  const languageLabel = t('nav.language');
  const languageBadge = preferredLanguage === 'es' ? 'ES' : 'EN';

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          color: 'text.primary',
        }}
      >
        <Toolbar variant="dense" sx={{ justifyContent: 'flex-end', gap: 1.5, minHeight: { xs: 40, sm: 48 } }}>
          <Tooltip title={unreadCount > 0 ? `${unreadCount} ${t('nav.unread')}` : t('nav.notifications')}>
            <IconButton
              color="inherit"
              onClick={handleOpen}
              aria-label={t('nav.notifications')}
              sx={{ color: 'text.secondary' }}
            >
              <Badge badgeContent={unreadCount > 0 ? unreadCount : 0} color="primary" max={99}>
                {unreadCount > 0 ? (
                  <NotificationsIcon sx={{ fontSize: 24 }} />
                ) : (
                  <NotificationsNoneIcon sx={{ fontSize: 24 }} />
                )}
              </Badge>
            </IconButton>
          </Tooltip>
          {user && (
            <Tooltip title={preferredLanguage === 'es' ? t('nav.messageLanguageEs') : t('nav.messageLanguageEn')}>
              <Box
                component="button"
                onClick={(e) => setLanguageMenuAnchorEl(e.currentTarget)}
                aria-label={`${languageLabel}: ${languageBadge}`}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'text.secondary',
                  px: 0.75,
                  py: 0.5,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                }}
              >
                <LanguageIcon sx={{ fontSize: 22 }} />
                <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1 }}>
                  {languageBadge}
                </Typography>
                <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' }, color: 'text.secondary' }}>
                  {languageLabel}
                </Typography>
              </Box>
            </Tooltip>
          )}
          {user && (
            <Tooltip title={t('nav.accountMenu')}>
              <IconButton
                onClick={(e) => setAvatarMenuAnchorEl(e.currentTarget)}
                sx={{ color: 'text.secondary', p: 0.5 }}
                aria-label={t('nav.accountMenu')}
              >
                <Avatar
                  alt={`${firstName ?? ''} ${lastName ?? ''}`.trim() || 'User'}
                  src={avatarUrl || undefined}
                  sx={{ width: 32, height: 32 }}
                >
                  {!avatarUrl && initials}
                </Avatar>
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { minWidth: 320, maxWidth: 400, maxHeight: 400 } }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            {t('nav.notifications')}
            {unreadCount > 0 && (
              <Typography component="span" variant="caption" color="primary" sx={{ ml: 1 }}>
                ({unreadCount} {t('nav.unread')})
              </Typography>
            )}
          </Typography>
        </Box>
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : preview.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3 }}>
              {t('nav.noNotifications')}
            </Typography>
          ) : (
            preview.map((n) => (
              <MenuItem
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                disabled={markingId === n.id}
                sx={{ alignItems: 'flex-start', py: 1.5, whiteSpace: 'normal' }}
              >
                <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                  {!n.readAt && (
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={n.title}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: n.readAt ? 400 : 600 }}
                  secondary={
                    <>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {formatTime(n.createdAt)}
                      </Typography>
                      {n.body && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} noWrap>
                          {n.body}
                        </Typography>
                      )}
                    </>
                  }
                />
              </MenuItem>
            ))
          )}
        </Box>
        <Box sx={{ borderTop: 1, borderColor: 'divider', p: 1 }}>
          <Button
            fullWidth
            size="small"
            onClick={() => {
              handleClose();
              navigate(`/${tenantSlug}/workers/notifications`);
            }}
          >
            {t('nav.viewAllNotifications')}
          </Button>
        </Box>
      </Menu>

      {/* Avatar dropdown: My Profile, Log Out */}
      <Menu
        anchorEl={avatarMenuAnchorEl}
        open={Boolean(avatarMenuAnchorEl)}
        onClose={() => setAvatarMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {firstName ?? ''} {lastName ?? ''}
          </Typography>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAvatarMenuAnchorEl(null);
            navigate(profilePath);
          }}
        >
          {t('nav.myProfile')}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={async () => {
            setAvatarMenuAnchorEl(null);
            await logout();
          }}
        >
          <ListItemIcon>
            <LogoutIcon sx={{ fontSize: 20 }} />
          </ListItemIcon>
          {t('nav.logOut')}
        </MenuItem>
      </Menu>

      {/* Language dropdown */}
      <Menu
        anchorEl={languageMenuAnchorEl}
        open={Boolean(languageMenuAnchorEl)}
        onClose={() => setLanguageMenuAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          selected={preferredLanguage === 'en'}
          onClick={async () => {
            setLanguageMenuAnchorEl(null);
            if (preferredLanguage === 'en') return;
            setPreferredLanguage('en');
            setLanguage('en');
            setGuestLanguage('en');
            if (user?.uid) {
              try {
                await updateDoc(doc(db, 'users', user.uid), { preferredLanguage: 'en', updatedAt: new Date() });
              } catch (err) {
                console.error('Failed to update preferred language:', err);
                setPreferredLanguage(preferredLanguage);
                setGuestLanguage(preferredLanguage);
              }
            }
          }}
        >
          {t('nav.englishEn')}
        </MenuItem>
        <MenuItem
          selected={preferredLanguage === 'es'}
          onClick={async () => {
            setLanguageMenuAnchorEl(null);
            if (preferredLanguage === 'es') return;
            setPreferredLanguage('es');
            setLanguage('es');
            setGuestLanguage('es');
            if (user?.uid) {
              try {
                await updateDoc(doc(db, 'users', user.uid), { preferredLanguage: 'es', updatedAt: new Date() });
              } catch (err) {
                console.error('Failed to update preferred language:', err);
                setPreferredLanguage(preferredLanguage);
                setGuestLanguage(preferredLanguage);
              }
            }
          }}
        >
          {t('nav.espanolEs')}
        </MenuItem>
      </Menu>

      {/* First-login language selection modal */}
      <Dialog
        open={Boolean(user?.uid && preferredLanguageLoaded && showFirstLoginLanguageModal)}
        onClose={() => {}}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle sx={{ textAlign: 'center', pb: 0 }}>
          {t('nav.selectYourLanguage')}
        </DialogTitle>
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

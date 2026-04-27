import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  MenuItem,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
  Button,
  Stack,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import { Security as SecurityIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { doc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { sendPasswordResetEmail, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import EmailSignatureTab from './EmailSignatureTab';
import {
  buildWorkerPreferenceUpdatePayload,
  fetchPushTokenPresence,
  fetchTenantNotificationOverrideSummary,
  getEditableWorkerPreferencesFromUserDoc,
  getEffectiveEmailDeliveryState,
  getEffectivePushDeliveryState,
  getEffectiveSmsDeliveryState,
  getLegacyPushTokensArrayPresence,
  getPhoneVerificationStatus,
  warnAdminSettingsDriftInDev,
  type EditableWorkerPreferences,
  type PhoneVerificationLabel,
  type TenantOverrideSummary,
} from '../../../utils/userSettings/userSettingsAdminAdapter';

type Props = {
  uid: string;
};

function phoneVerificationText(v: PhoneVerificationLabel): string {
  if (v === 'verified') return 'Verified';
  if (v === 'unverified') return 'Unverified';
  return 'Unknown';
}

const SystemAccessTab: React.FC<Props> = ({ uid }) => {
  const { tenantId, activeTenant, user, securityLevel } = useAuth();
  const navigate = useNavigate();
  const effectiveTenantId = activeTenant?.id || tenantId;

  const [systemAccess, setSystemAccess] = useState({
    uid: uid,
    securityLevel: '2',
    recruiter: false,
    crm_sales: false,
  });
  const [originalAccess, setOriginalAccess] = useState(systemAccess);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const [workerPrefs, setWorkerPrefs] = useState<EditableWorkerPreferences>(() =>
    getEditableWorkerPreferencesFromUserDoc({}),
  );
  const [originalWorkerPrefs, setOriginalWorkerPrefs] = useState<EditableWorkerPreferences>(workerPrefs);
  const [lastUserDoc, setLastUserDoc] = useState<Record<string, unknown> | null>(null);
  const [pushPresence, setPushPresence] = useState<'present' | 'none' | 'unknown'>('unknown');
  /** `undefined` until first async tenant summary fetch completes (avoids misleading email/push copy). */
  const [tenantOverrideSummary, setTenantOverrideSummary] = useState<TenantOverrideSummary | undefined>(undefined);
  const [legacyPushArray, setLegacyPushArray] = useState(false);

  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [workerSaving, setWorkerSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (effectiveTenantId) {
      loadSystemAccess();
    }
  }, [uid, effectiveTenantId]);

  const refreshAsyncDiagnostics = useCallback(async () => {
    if (!uid) return;
    const [push, tenantSum] = await Promise.all([
      fetchPushTokenPresence(db, uid),
      fetchTenantNotificationOverrideSummary(db, effectiveTenantId, uid),
    ]);
    setPushPresence(push);
    setTenantOverrideSummary(tenantSum);
  }, [uid, effectiveTenantId]);

  useEffect(() => {
    void refreshAsyncDiagnostics();
  }, [refreshAsyncDiagnostics]);

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as Record<string, unknown>;
      setLastUserDoc(data);
      const prefs = getEditableWorkerPreferencesFromUserDoc(data);
      setWorkerPrefs(prefs);
      setOriginalWorkerPrefs(prefs);
      setLegacyPushArray(getLegacyPushTokensArrayPresence(data));
    });
    return () => unsubscribe();
  }, [uid]);

  const smsEffective = useMemo(() => (lastUserDoc ? getEffectiveSmsDeliveryState(lastUserDoc) : null), [lastUserDoc]);

  const emailEffective = useMemo(() => {
    if (!lastUserDoc) return null;
    if (effectiveTenantId && tenantOverrideSummary === undefined) return null;
    return getEffectiveEmailDeliveryState(lastUserDoc, tenantOverrideSummary?.rawData ?? null);
  }, [lastUserDoc, tenantOverrideSummary, effectiveTenantId]);

  const pushEffective = useMemo(() => {
    if (!lastUserDoc) return null;
    if (effectiveTenantId && tenantOverrideSummary === undefined) return null;
    return getEffectivePushDeliveryState(
      lastUserDoc,
      { subcollectionState: pushPresence, legacyUserDocArray: legacyPushArray },
      tenantOverrideSummary?.rawData ?? null,
    );
  }, [lastUserDoc, tenantOverrideSummary, effectiveTenantId, pushPresence, legacyPushArray]);

  useEffect(() => {
    if (!lastUserDoc || tenantOverrideSummary === undefined) return;
    warnAdminSettingsDriftInDev({
      userDoc: lastUserDoc,
      tenantSummary: tenantOverrideSummary,
      pushSubcollection: pushPresence,
      legacyPushArray,
    });
  }, [lastUserDoc, tenantOverrideSummary, pushPresence, legacyPushArray]);

  const loadSystemAccess = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};

        const access = {
          uid: uid,
          securityLevel: (() => {
            const level = tenantData.securityLevel ?? data.securityLevel ?? '2';
            const levelNum = typeof level === 'number' ? level : parseInt(String(level), 10);
            if (isNaN(levelNum) || levelNum < 0) return '0';
            if (levelNum > 7) return '7';
            return String(levelNum);
          })(),
          recruiter: tenantData.recruiter ?? data.recruiter ?? false,
          crm_sales: tenantData.crm_sales ?? data.crm_sales ?? false,
        };

        setSystemAccess(access);
        setOriginalAccess(access);
      }
    } catch (error) {
      console.error('Error loading system access:', error);
    }
  };

  const handleSave = async () => {
    if (!effectiveTenantId) {
      alert('No tenant ID available. Cannot save system access.');
      return;
    }

    try {
      const userRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();

      if (!userData?.tenantIds) {
        await updateDoc(userRef, { tenantIds: {} });
      }

      const updateData: Record<string, unknown> = {
        [`tenantIds.${effectiveTenantId}.securityLevel`]: systemAccess.securityLevel,
        [`tenantIds.${effectiveTenantId}.recruiter`]: systemAccess.recruiter,
        [`tenantIds.${effectiveTenantId}.crm_sales`]: systemAccess.crm_sales,
        [`tenantIds.${effectiveTenantId}.updatedAt`]: new Date(),
      };

      await updateDoc(userRef, updateData);

      setOriginalAccess(systemAccess);
      alert('System access updated successfully');
      await loadSystemAccess();
    } catch (error) {
      console.error('Error updating system access:', error);
      alert('Failed to update system access');
    }
  };

  const handlePasswordReset = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const email = userSnap.data().email;
        if (email) {
          await sendPasswordResetEmail(auth, email);
          setResetEmailSent(true);
          setTimeout(() => setResetEmailSent(false), 5000);
        } else {
          setToastMessage('No email on file for this user. Add an email in the Overview tab to send a password reset.');
          setShowToast(true);
        }
      } else {
        setToastMessage('User not found.');
        setShowToast(true);
      }
    } catch (error) {
      console.error('Error sending password reset:', error);
      setToastMessage('Failed to send password reset email. Please try again.');
      setShowToast(true);
    }
  };

  const canEditWorkerPrefs = () => {
    if (user?.uid === uid) return true;
    const userLevel = parseInt(securityLevel || '0', 10);
    return userLevel >= 5;
  };

  const canDeleteUser = () => {
    if (user?.uid === uid) return true;
    const userLevel = parseInt(securityLevel || '0', 10);
    return userLevel >= 6;
  };

  const handleSaveWorkerPreferences = async () => {
    if (!canEditWorkerPrefs()) return;
    setWorkerSaving(true);
    try {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        setToastMessage('User document not found.');
        setShowToast(true);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      await updateDoc(userRef, buildWorkerPreferenceUpdatePayload(data, workerPrefs));
      setOriginalWorkerPrefs(workerPrefs);
      setToastMessage('Worker preferences saved');
      setShowToast(true);
      void refreshAsyncDiagnostics();
    } catch (error) {
      console.error('Error saving worker preferences:', error);
      setToastMessage('Failed to save worker preferences');
      setShowToast(true);
    } finally {
      setWorkerSaving(false);
    }
  };

  const hasWorkerChanges = JSON.stringify(workerPrefs) !== JSON.stringify(originalWorkerPrefs);
  const hasSystemAccessChanges = JSON.stringify(systemAccess) !== JSON.stringify(originalAccess);

  const handleDeleteUser = async () => {
    if (!canDeleteUser()) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;

    setDeleteLoading(true);
    try {
      const fn = httpsCallable(functions, 'deleteUserCompletely');
      await fn({ uid });
      setDeleteDialogOpen(false);
      if (user?.uid === uid) {
        await signOut(auth);
        navigate('/login', { replace: true });
      } else {
        navigate('/users', { replace: true });
      }
    } catch (error) {
      console.error('Error deleting user completely:', error);
      setToastMessage('Failed to delete user. Please try again.');
      setShowToast(true);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 1. Worker preferences — same fields as worker app-language / privacy notifications */}
      {canEditWorkerPrefs() && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1.5, px: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
              Worker preferences
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Mirrors worker-facing settings (`preferredLanguage`, `notificationSettings`, SMS compliance fields). Saving
              merges with existing `notificationSettings` keys.
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small">
                  <InputLabel id="admin-pref-lang-label">Preferred language</InputLabel>
                  <Select
                    labelId="admin-pref-lang-label"
                    label="Preferred language"
                    value={workerPrefs.preferredLanguage}
                    onChange={(e) =>
                      setWorkerPrefs((p) => ({
                        ...p,
                        preferredLanguage: e.target.value as 'en' | 'es',
                      }))
                    }
                  >
                    <MenuItem value="en">English</MenuItem>
                    <MenuItem value="es">Español</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Stack spacing={0.5}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={workerPrefs.emailNotifications}
                        onChange={(e) => setWorkerPrefs((p) => ({ ...p, emailNotifications: e.target.checked }))}
                      />
                    }
                    label="Email notifications"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={workerPrefs.pushNotifications}
                        onChange={(e) => setWorkerPrefs((p) => ({ ...p, pushNotifications: e.target.checked }))}
                      />
                    }
                    label="Push notifications"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={workerPrefs.smsNotifications}
                        onChange={(e) => setWorkerPrefs((p) => ({ ...p, smsNotifications: e.target.checked }))}
                      />
                    }
                    label="SMS notifications"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={workerPrefs.marketingEmails}
                        onChange={(e) => setWorkerPrefs((p) => ({ ...p, marketingEmails: e.target.checked }))}
                      />
                    }
                    label="Marketing emails"
                  />
                </Stack>
              </Grid>
            </Grid>

            {hasWorkerChanges && (
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                <Button variant="contained" onClick={handleSaveWorkerPreferences} disabled={workerSaving} size="small">
                  {workerSaving ? 'Saving…' : 'Save worker preferences'}
                </Button>
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2. Delivery & verification (read-only diagnostics) */}
      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, px: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Delivery &amp; verification status
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Read-only. Effective SMS reflects preference, opt-in, and system block — not a single toggle. Email and push
            preferences may still be shaped by tenant rules and server routing.
          </Typography>
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Phone
              </Typography>
              <Typography variant="body2">
                {lastUserDoc ? phoneVerificationText(getPhoneVerificationStatus(lastUserDoc)) : 'Loading…'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                SMS
              </Typography>
              {smsEffective ? (
                <>
                  <Typography variant="body2">
                    Effective state: {smsEffective.headline}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {smsEffective.reason}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2">Loading…</Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Push
              </Typography>
              {pushEffective ? (
                <>
                  <Typography variant="body2">
                    Effective state: {pushEffective.headline}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {pushEffective.reason}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2">Loading…</Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Email
              </Typography>
              {emailEffective ? (
                <>
                  <Typography variant="body2">
                    Effective state: {emailEffective.headline}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {emailEffective.reason}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2">Loading…</Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Tenant override
              </Typography>
              <Typography variant="body2">
                {tenantOverrideSummary === undefined
                  ? 'Loading…'
                  : tenantOverrideSummary.summaryLine}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* 3. Admin account controls */}
      <Card variant="outlined">
        <CardContent sx={{ px: 1, py: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SecurityIcon sx={{ mr: 1 }} color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Admin account controls
            </Typography>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary">
              User ID
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {systemAccess.uid}
            </Typography>
          </Box>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                select
                label="Security level"
                value={systemAccess.securityLevel}
                onChange={(e) => setSystemAccess({ ...systemAccess, securityLevel: e.target.value })}
              >
                <MenuItem value="7">7 - Admin</MenuItem>
                <MenuItem value="6">6 - Manager</MenuItem>
                <MenuItem value="5">5 - Worker</MenuItem>
                <MenuItem value="4">4 - Hired Staff</MenuItem>
                <MenuItem value="3">3 - Flex</MenuItem>
                <MenuItem value="2">2 - Applicant</MenuItem>
                <MenuItem value="1">1 - Dismissed</MenuItem>
                <MenuItem value="0">0 - Suspended</MenuItem>
              </TextField>
            </Grid>

            {parseInt(systemAccess.securityLevel, 10) >= 5 && parseInt(systemAccess.securityLevel, 10) <= 7 && (
              <>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Module access
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                    Jobs Board access is included with Recruiter access
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={systemAccess.recruiter}
                        onChange={(e) => setSystemAccess({ ...systemAccess, recruiter: e.target.checked })}
                      />
                    }
                    label="Recruiter access"
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={systemAccess.crm_sales}
                        onChange={(e) => setSystemAccess({ ...systemAccess, crm_sales: e.target.checked })}
                      />
                    }
                    label="CRM/Sales access"
                  />
                </Grid>
              </>
            )}

            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 1 }}>
                Account management
              </Typography>
              <Button variant="outlined" onClick={handlePasswordReset} disabled={resetEmailSent} size="small">
                {resetEmailSent ? 'Password reset email sent' : 'Send password reset email'}
              </Button>
            </Grid>
          </Grid>

          {hasSystemAccessChanges && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button variant="contained" onClick={handleSave}>
                Save admin access
              </Button>
            </Stack>
          )}
          {canDeleteUser() && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => setDeleteDialogOpen(true)}
                sx={{ textTransform: 'none' }}
              >
                Delete user
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {(() => {
        const targetUserLevel = parseInt(systemAccess.securityLevel || '0', 10);
        return targetUserLevel >= 5 && targetUserLevel <= 7;
      })() && <EmailSignatureTab uid={uid} />}

      <Snackbar open={showToast} autoHideDuration={4000} onClose={() => setShowToast(false)}>
        <Alert
          onClose={() => setShowToast(false)}
          severity={
            toastMessage.includes('saved')
              ? 'success'
              : /failed|not found/i.test(toastMessage)
                ? 'error'
                : 'info'
          }
          sx={{ width: '100%' }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>

      <Dialog open={deleteDialogOpen} onClose={() => !deleteLoading && setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete user</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will permanently delete this user from Firestore and Firebase Auth.
          </Alert>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Type <strong>DELETE</strong> to confirm.
          </Typography>
          <TextField
            fullWidth
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            disabled={deleteLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            startIcon={<DeleteIcon />}
            disabled={deleteLoading || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
            onClick={handleDeleteUser}
          >
            {deleteLoading ? 'Deleting…' : 'Delete user'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SystemAccessTab;


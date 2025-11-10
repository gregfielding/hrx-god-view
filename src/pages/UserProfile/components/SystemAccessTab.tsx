import React, { useEffect, useState } from 'react';
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
} from '@mui/material';
import { Security as SecurityIcon } from '@mui/icons-material';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

type Props = {
  uid: string;
};

const SystemAccessTab: React.FC<Props> = ({ uid }) => {
  const { tenantId, activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [systemAccess, setSystemAccess] = useState({
    uid: uid,
    securityLevel: '5',
    recruiter: false,
    crm_sales: false,
  });
  const [originalAccess, setOriginalAccess] = useState(systemAccess);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  useEffect(() => {
    if (effectiveTenantId) {
      loadSystemAccess();
    }
  }, [uid, effectiveTenantId]);

  const loadSystemAccess = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        
        // Get tenant-specific data first, then fallback to top-level
        const tenantData = effectiveTenantId && data.tenantIds?.[effectiveTenantId] ? data.tenantIds[effectiveTenantId] : {};
        
        const access = {
          uid: uid,
          securityLevel: (() => {
            // Read from tenant-specific field first, then fallback to top-level
            const level = tenantData.securityLevel || data.securityLevel || '5';
            // Ensure security level is between 5-7 for System Access tab
            const levelNum = parseInt(String(level), 10);
            if (levelNum < 5) return '5';
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
      
      // Get current user document to check tenantIds structure
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      
      // Ensure tenantIds object exists
      if (!userData?.tenantIds) {
        // Initialize tenantIds if it doesn't exist
        await updateDoc(userRef, {
          tenantIds: {},
        });
      }
      
      // Update tenant-specific fields using nested path syntax
      // Firestore will automatically create nested structure if needed
      const updateData: any = {
        [`tenantIds.${effectiveTenantId}.securityLevel`]: systemAccess.securityLevel,
        [`tenantIds.${effectiveTenantId}.recruiter`]: systemAccess.recruiter,
        [`tenantIds.${effectiveTenantId}.crm_sales`]: systemAccess.crm_sales,
        [`tenantIds.${effectiveTenantId}.updatedAt`]: new Date(),
      };
      
      await updateDoc(userRef, updateData);

      setOriginalAccess(systemAccess);
      alert('System access updated successfully');
      
      // Reload to reflect changes
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
          setTimeout(() => setResetEmailSent(false), 3000);
        }
      }
    } catch (error) {
      console.error('Error sending password reset:', error);
      alert('Failed to send password reset email');
    }
  };

  const hasChanges = JSON.stringify(systemAccess) !== JSON.stringify(originalAccess);

  return (
    <Box sx={{ p: 0 }}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent sx={{ px: 3, py: 4 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <SecurityIcon sx={{ mr: 1 }} color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>System Access</Typography>
              </Box>
              
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary">User ID</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{systemAccess.uid}</Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    select
                    label="Security Level"
                    value={systemAccess.securityLevel}
                    onChange={(e) => setSystemAccess({ ...systemAccess, securityLevel: e.target.value })}
                  >
                    <MenuItem value="5">5 - Worker</MenuItem>
                    <MenuItem value="6">6 - Manager</MenuItem>
                    <MenuItem value="7">7 - Admin</MenuItem>
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Module Access
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                    Note: Jobs Board access is included with Recruiter access
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
                    label="Recruiter Access"
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
                    label="CRM/Sales Access"
                  />
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 2 }}>
                    Account Management
                  </Typography>
                </Grid>

                <Grid item xs={12}>
                  <Button
                    variant="outlined"
                    onClick={handlePasswordReset}
                    disabled={resetEmailSent}
                  >
                    {resetEmailSent ? 'Password Reset Email Sent' : 'Send Password Reset Email'}
                  </Button>
                </Grid>
              </Grid>

              {hasChanges && (
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
                  <Button variant="contained" onClick={handleSave}>
                    Save Changes
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SystemAccessTab;


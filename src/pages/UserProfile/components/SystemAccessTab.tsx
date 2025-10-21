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

type Props = {
  uid: string;
};

const SystemAccessTab: React.FC<Props> = ({ uid }) => {
  const [systemAccess, setSystemAccess] = useState({
    uid: uid,
    securityLevel: '5',
    role: 'Worker',
    jobsBoard: false,
    recruiter: false,
    crm_sales: false,
  });
  const [originalAccess, setOriginalAccess] = useState(systemAccess);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  useEffect(() => {
    loadSystemAccess();
  }, [uid]);

  const loadSystemAccess = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        const access = {
          uid: uid,
          securityLevel: data.securityLevel || '5',
          role: data.role || 'Worker',
          jobsBoard: data.jobsBoard || false,
          recruiter: data.recruiter || false,
          crm_sales: data.crm_sales || false,
        };
        setSystemAccess(access);
        setOriginalAccess(access);
      }
    } catch (error) {
      console.error('Error loading system access:', error);
    }
  };

  const handleSave = async () => {
    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        securityLevel: systemAccess.securityLevel,
        role: systemAccess.role,
        jobsBoard: systemAccess.jobsBoard,
        recruiter: systemAccess.recruiter,
        crm_sales: systemAccess.crm_sales,
      });

      setOriginalAccess(systemAccess);
      alert('System access updated successfully');
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
                    <MenuItem value="1">1 - Applicant</MenuItem>
                    <MenuItem value="2">2 - Applicant (Verified)</MenuItem>
                    <MenuItem value="3">3 - Candidate</MenuItem>
                    <MenuItem value="4">4 - Hired Staff</MenuItem>
                    <MenuItem value="5">5 - Staff Manager</MenuItem>
                    <MenuItem value="6">6 - Manager</MenuItem>
                    <MenuItem value="7">7 - Admin</MenuItem>
                  </TextField>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    select
                    label="Role"
                    value={systemAccess.role}
                    onChange={(e) => setSystemAccess({ ...systemAccess, role: e.target.value })}
                  >
                    <MenuItem value="Tenant">Tenant</MenuItem>
                    <MenuItem value="Worker">Worker</MenuItem>
                    <MenuItem value="Staff">Staff</MenuItem>
                    <MenuItem value="Manager">Manager</MenuItem>
                    <MenuItem value="Admin">Admin</MenuItem>
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Module Access
                  </Typography>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={systemAccess.jobsBoard}
                        onChange={(e) => setSystemAccess({ ...systemAccess, jobsBoard: e.target.checked })}
                      />
                    }
                    label="Jobs Board Access"
                  />
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


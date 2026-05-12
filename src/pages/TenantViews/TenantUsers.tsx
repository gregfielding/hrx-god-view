import React from 'react';
import { Box, Stack, Typography, Button, Tooltip } from '@mui/material';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';

import { useAuth } from '../../contexts/AuthContext';
import ContactsTab from '../AgencyProfile/components/ContactsTab';
import AddWorkerManuallyWizard from '../../components/users/AddWorkerManuallyWizard';

/**
 * Recruiter / admin landing tab for the tenant's user list.
 *
 * Two distinct creation paths live here:
 *   1. **Add New User** (existing) — `inviteUserV2` flow. Sends the
 *      worker an email with a setup-password link; they finish their
 *      own signup. Right path when the worker has email + can complete
 *      signup themselves.
 *   2. **Create Worker on Behalf** (May 2026) — `adminCreateWorker`
 *      flow. Recruiter sets the password directly + provisions HRX
 *      account + (optionally) hires to entity + walks through Everee
 *      payroll embed alongside the worker. Right path when the worker
 *      can't navigate signup themselves (no phone, language barrier,
 *      tech-unfamiliar).
 *
 * Permission for "Create Worker on Behalf" is enforced server-side
 * (`canManageEveree` gate). We mirror the same gate client-side just
 * to hide the button for users who can't use it.
 */
const TenantUsers: React.FC = () => {
  const { tenantId, isHRX, currentClaimsRole, securityLevel } = useAuth();
  const [showInviteForm, setShowInviteForm] = React.useState(false);
  const [showManualWizard, setShowManualWizard] = React.useState(false);

  const numericSecurityLevel = (() => {
    const sl = String(securityLevel ?? '0').trim();
    const n = parseInt(sl, 10);
    return Number.isFinite(n) ? n : 0;
  })();
  const canCreateWorkerOnBehalf =
    isHRX ||
    currentClaimsRole === 'Admin' ||
    currentClaimsRole === 'Manager' ||
    currentClaimsRole === 'Recruiter' ||
    numericSecurityLevel >= 5;

  if (!tenantId) return null;
  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} mt={0}>
        <Typography variant="h3" component="h1">
          Dashboard Access
        </Typography>
        <Stack direction="row" spacing={1}>
          {canCreateWorkerOnBehalf ? (
            <Tooltip title="Create the worker's HRX account directly (no email link). Use when the worker can't sign up themselves.">
              <Button
                variant="outlined"
                color="primary"
                startIcon={<PersonAddAlt1OutlinedIcon />}
                onClick={() => setShowManualWizard(true)}
              >
                Create Worker on Behalf
              </Button>
            </Tooltip>
          ) : null}
          <Button variant="contained" color="primary" onClick={() => setShowInviteForm(true)}>
            Add New User
          </Button>
        </Stack>
      </Box>
      <ContactsTab tenantId={tenantId} showForm={showInviteForm} setShowForm={setShowInviteForm} />
      <AddWorkerManuallyWizard
        open={showManualWizard}
        onClose={() => setShowManualWizard(false)}
        tenantId={tenantId}
      />
    </Box>
  );
};

export default TenantUsers;

import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Button, Grid, Alert, Snackbar } from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';

const AssociationsAdmin: React.FC = () => {
  const [tenantId, setTenantId] = useState('');
  const [dealId, setDealId] = useState('');
  const [entityType, setEntityType] = useState('company');
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runIntegrity = async () => {
    try {
      setLoading(true);
      const fn = httpsCallable(getFunctions(), 'associationsIntegrityReport');
      const res: any = await fn({ tenantId });
      setMessage(`Integrity report: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      setError(e?.message || 'Integrity failed');
    } finally { setLoading(false); }
  };

  const rebuildDeal = async () => {
    try {
      setLoading(true);
      const fn = httpsCallable(getFunctions(), 'rebuildDealAssociations');
      const res: any = await fn({ tenantId, dealId });
      setMessage(`Rebuilt deal: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      setError(e?.message || 'Rebuild deal failed');
    } finally { setLoading(false); }
  };

  const rebuildEntity = async () => {
    try {
      setLoading(true);
      const fn = httpsCallable(getFunctions(), 'rebuildEntityReverseIndex');
      const res: any = await fn({ tenantId, entityType, entityId });
      setMessage(`Rebuilt entity reverse index: ${JSON.stringify(res.data)}`);
    } catch (e: any) {
      setError(e?.message || 'Rebuild entity failed');
    } finally { setLoading(false); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Associations Admin
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Tenant ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <Button variant="outlined" onClick={runIntegrity} disabled={loading || !tenantId}>Run Integrity Report</Button>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth label="Deal ID" value={dealId} onChange={(e) => setDealId(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={6}>
            <Button variant="contained" onClick={rebuildDeal} disabled={loading || !tenantId || !dealId}>Rebuild Deal Associations</Button>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Entity Type (company/contact/salesperson/location/user)" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField fullWidth label="Entity ID" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Button variant="contained" onClick={rebuildEntity} disabled={loading || !tenantId || !entityType || !entityId}>Rebuild Entity Reverse Index</Button>
          </Grid>
        </Grid>
      </Paper>
      <Snackbar open={!!message} autoHideDuration={4000} onClose={() => setMessage(null)}>
        <Alert severity="success" onClose={() => setMessage(null)} sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AssociationsAdmin;



/**
 * Entity Workers Comp Tab — Phase 1B Extension
 * CRUD for workers_comp policies.
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Grid,
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';

const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

export interface WorkersCompPolicy {
  id: string;
  entityId: string;
  state?: string | null;
  carrierName: string;
  policyNumberMasked?: string;
  effectiveDate?: string;
  expirationDate?: string;
  claimsPhone?: string;
  brokerName?: string;
  brokerPhone?: string;
  documentIds?: string[];
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface EntityWorkersCompTabProps {
  tenantId: string;
  entityId: string | null;
}

const EntityWorkersCompTab: React.FC<EntityWorkersCompTabProps> = ({
  tenantId,
  entityId,
}) => {
  const [items, setItems] = useState<WorkersCompPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkersCompPolicy | null>(null);
  const [form, setForm] = useState<Partial<WorkersCompPolicy>>({});
  const [saving, setSaving] = useState(false);

  const fetchItems = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'workers_comp'));
      const list: WorkersCompPolicy[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as WorkersCompPolicy[];
      setItems(list.filter((i) => i.entityId === entityId));
    } catch (err: any) {
      setError(err?.message || 'Failed to load workers comp policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [tenantId, entityId]);

  const handleOpenCreate = () => {
    setEditingItem(null);
    setForm({
      entityId: entityId!,
      state: null,
      carrierName: '',
      policyNumberMasked: '',
      effectiveDate: '',
      expirationDate: '',
      claimsPhone: '',
      brokerName: '',
      brokerPhone: '',
      active: true,
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: WorkersCompPolicy) => {
    setEditingItem(item);
    setForm({
      ...item,
      state: item.state ?? null,
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
  };

  const handleSave = async () => {
    if (!tenantId || !entityId) return;
    const carrierName = (form.carrierName || '').trim();
    if (!carrierName) {
      setError('Carrier name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        entityId,
        state: form.state || null,
        carrierName,
        policyNumberMasked: (form.policyNumberMasked || '').trim() || undefined,
        effectiveDate: (form.effectiveDate || '').trim() || undefined,
        expirationDate: (form.expirationDate || '').trim() || undefined,
        claimsPhone: (form.claimsPhone || '').trim() || undefined,
        brokerName: (form.brokerName || '').trim() || undefined,
        brokerPhone: (form.brokerPhone || '').trim() || undefined,
        active: form.active ?? true,
        updatedAt: serverTimestamp(),
      };

      if (editingItem) {
        await updateDoc(doc(db, p.workersCompPolicy(tenantId, editingItem.id)), payload);
        setSuccess('Workers comp policy updated');
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, 'tenants', tenantId, 'workers_comp'), payload);
        setSuccess('Workers comp policy created');
      }
      handleCloseDialog();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!entityId) {
    return (
      <Box sx={{ py: 2 }}>
        <Alert severity="info">Select an entity to manage workers comp policies.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="body2" color="text.secondary">
          Carrier, policy (masked), claims phone. Document linking in next phase.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Add Policy
        </Button>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Carrier</TableCell>
                <TableCell>State</TableCell>
                <TableCell>Policy (masked)</TableCell>
                <TableCell>Effective</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    No workers comp policies. Add one to track coverage.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {item.carrierName}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.state || 'Multi-state'}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {item.policyNumberMasked || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.effectiveDate || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={item.active ? 'Active' : 'Inactive'}
                        size="small"
                        color={item.active ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleOpenEdit(item)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingItem ? 'Edit Workers Comp Policy' : 'Add Workers Comp Policy'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Carrier Name"
              value={form.carrierName || ''}
              onChange={(e) => setForm((f) => ({ ...f, carrierName: e.target.value }))}
              fullWidth
              required
            />
            <FormControl fullWidth>
              <InputLabel>State (null = multi-state/primary)</InputLabel>
              <Select
                value={form.state === null || form.state === undefined ? 'multi' : form.state}
                label="State (null = multi-state/primary)"
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value === 'multi' ? null : e.target.value }))}
              >
                <MenuItem value="multi">Multi-state / Primary</MenuItem>
                {US_STATES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Policy Number (masked)"
              value={form.policyNumberMasked || ''}
              onChange={(e) => setForm((f) => ({ ...f, policyNumberMasked: e.target.value }))}
              placeholder="e.g. ****1234"
              fullWidth
            />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  label="Effective Date"
                  value={form.effectiveDate || ''}
                  onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                  fullWidth
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Expiration Date"
                  value={form.expirationDate || ''}
                  onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                  fullWidth
                />
              </Grid>
            </Grid>
            <TextField
              label="Claims Phone"
              value={form.claimsPhone || ''}
              onChange={(e) => setForm((f) => ({ ...f, claimsPhone: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Broker Name"
              value={form.brokerName || ''}
              onChange={(e) => setForm((f) => ({ ...f, brokerName: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Broker Phone"
              value={form.brokerPhone || ''}
              onChange={(e) => setForm((f) => ({ ...f, brokerPhone: e.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.active ?? true}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
              }
              label="Active"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editingItem ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={2000} onClose={() => setSuccess(null)}>
        <Alert severity="success">{success}</Alert>
      </Snackbar>
    </Box>
  );
};

export default EntityWorkersCompTab;

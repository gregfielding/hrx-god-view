/**
 * Entity Cost Centers Tab — Phase 1B Extension
 * CRUD for entity_cost_centers (GL / cost center codes).
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
  Autocomplete,
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

export interface EntityCostCenter {
  id: string;
  name: string;
  entityId?: string | null;
  glCompanyCode?: string;
  glLocationCode?: string;
  costCenterCode: string;
  departmentCode?: string;
  projectCode?: string;
  active: boolean;
  tags?: string[];
  createdAt?: any;
  updatedAt?: any;
}

interface EntityCostCentersTabProps {
  tenantId: string;
  entityId: string | null;
  onDefaultChange?: (costCenterId: string | null) => void;
}

const EntityCostCentersTab: React.FC<EntityCostCentersTabProps> = ({
  tenantId,
  entityId,
}) => {
  const [items, setItems] = useState<EntityCostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EntityCostCenter | null>(null);
  const [form, setForm] = useState<Partial<EntityCostCenter>>({
    name: '',
    entityId: entityId ?? null,
    costCenterCode: '',
    active: true,
  });
  const [saving, setSaving] = useState(false);

  const fetchItems = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const colRef = collection(db, 'tenants', tenantId, 'entity_cost_centers');
      const snapshot = await getDocs(colRef);
      const list: EntityCostCenter[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as EntityCostCenter[];
      setItems(list.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    } catch (err: any) {
      setError(err?.message || 'Failed to load cost centers');
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
      name: '',
      entityId: entityId ?? null,
      glCompanyCode: '',
      glLocationCode: '',
      costCenterCode: '',
      departmentCode: '',
      projectCode: '',
      active: true,
      tags: [],
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: EntityCostCenter) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      entityId: item.entityId ?? entityId ?? null,
      glCompanyCode: item.glCompanyCode || '',
      glLocationCode: item.glLocationCode || '',
      costCenterCode: item.costCenterCode,
      departmentCode: item.departmentCode || '',
      projectCode: item.projectCode || '',
      active: item.active ?? true,
      tags: item.tags || [],
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    const name = (form.name || '').trim();
    const costCenterCode = (form.costCenterCode || '').trim();
    if (!name || !costCenterCode) {
      setError('Name and cost center code are required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        name,
        entityId: form.entityId || null,
        glCompanyCode: (form.glCompanyCode || '').trim() || undefined,
        glLocationCode: (form.glLocationCode || '').trim() || undefined,
        costCenterCode,
        departmentCode: (form.departmentCode || '').trim() || undefined,
        projectCode: (form.projectCode || '').trim() || undefined,
        active: form.active ?? true,
        tags: form.tags || [],
        updatedAt: serverTimestamp(),
      };

      if (editingItem) {
        await updateDoc(doc(db, p.entityCostCenter(tenantId, editingItem.id)), payload);
        setSuccess('Cost center updated');
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, 'tenants', tenantId, 'entity_cost_centers'), payload);
        setSuccess('Cost center created');
      }
      handleCloseDialog();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const displayItems = entityId
    ? items.filter((i) => !i.entityId || i.entityId === entityId)
    : items;

  if (!entityId) {
    return (
      <Box sx={{ py: 2 }}>
        <Alert severity="info">Select an entity to manage cost centers.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="body2" color="text.secondary">
          Cost centers for this entity (or tenant-wide when entityId is empty)
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Add Cost Center
        </Button>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Cost Center Code</TableCell>
                <TableCell>GL Company</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    No cost centers. Add one to use for accounting exports.
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {item.name}
                      </Typography>
                      {item.tags && item.tags.length > 0 && (
                        <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
                          {item.tags.slice(0, 3).map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {item.costCenterCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.glCompanyCode || '—'}</TableCell>
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
        <DialogTitle>{editingItem ? 'Edit Cost Center' : 'Add Cost Center'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Name"
              value={form.name || ''}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. C1 Select - NV W2"
              fullWidth
              required
            />
            <TextField
              label="Cost Center Code"
              value={form.costCenterCode || ''}
              onChange={(e) => setForm((f) => ({ ...f, costCenterCode: e.target.value }))}
              placeholder="e.g. CC-104"
              fullWidth
              required
            />
            <TextField
              label="GL Company Code"
              value={form.glCompanyCode || ''}
              onChange={(e) => setForm((f) => ({ ...f, glCompanyCode: e.target.value }))}
              placeholder="e.g. C1SL"
              fullWidth
            />
            <TextField
              label="GL Location Code"
              value={form.glLocationCode || ''}
              onChange={(e) => setForm((f) => ({ ...f, glLocationCode: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Department Code"
              value={form.departmentCode || ''}
              onChange={(e) => setForm((f) => ({ ...f, departmentCode: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Project Code"
              value={form.projectCode || ''}
              onChange={(e) => setForm((f) => ({ ...f, projectCode: e.target.value }))}
              fullWidth
            />
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.tags || []}
              onChange={(_, v) => setForm((f) => ({ ...f, tags: v }))}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Tags" placeholder="e.g. NV, W2" />
              )}
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

export default EntityCostCentersTab;

/**
 * WC Class Codes Tab — Phase 1B Extension (Step 6)
 * CRUD for workers_comp_class_codes.
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
  FormControlLabel,
  Switch,
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

export interface WorkersCompClassCode {
  id: string;
  code: string;
  title: string;
  description?: string;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface WCClassCodesTabProps {
  tenantId: string;
}

const WCClassCodesTab: React.FC<WCClassCodesTabProps> = ({ tenantId }) => {
  const [items, setItems] = useState<WorkersCompClassCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkersCompClassCode | null>(null);
  const [form, setForm] = useState<Partial<WorkersCompClassCode>>({});
  const [saving, setSaving] = useState(false);

  const fetchItems = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'workers_comp_class_codes'));
      const list: WorkersCompClassCode[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as WorkersCompClassCode[];
      setItems(list.sort((a, b) => (a.code || '').localeCompare(b.code || '')));
    } catch (err: any) {
      setError(err?.message || 'Failed to load class codes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [tenantId]);

  const handleOpenCreate = () => {
    setEditingItem(null);
    setForm({ code: '', title: '', description: '', active: true });
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: WorkersCompClassCode) => {
    setEditingItem(item);
    setForm({ ...item });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
  };

  const handleSave = async () => {
    if (!tenantId) return;
    const code = (form.code || '').trim();
    const title = (form.title || '').trim();
    if (!code || !title) {
      setError('Code and title are required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        code,
        title,
        description: (form.description || '').trim() || undefined,
        active: form.active ?? true,
        updatedAt: serverTimestamp(),
      };
      if (editingItem) {
        await updateDoc(doc(db, p.workersCompClassCode(tenantId, editingItem.id)), payload);
        setSuccess('Class code updated');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'workers_comp_class_codes'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setSuccess('Class code created');
      }
      handleCloseDialog();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="body2" color="text.secondary">
          Central WC class codes for job order dropdown selection. Rate sets by entity+state coming in Phase 2.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Add Class Code
        </Button>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    No class codes. Add codes (e.g. 9015) for job order selection.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                        {item.code}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {item.description || '—'}
                      </Typography>
                    </TableCell>
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
        <DialogTitle>{editingItem ? 'Edit Class Code' : 'Add Class Code'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Code"
              value={form.code || ''}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. 9015"
              fullWidth
              required
            />
            <TextField
              label="Title"
              value={form.title || ''}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Building Operation"
              fullWidth
              required
            />
            <TextField
              label="Description"
              value={form.description || ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              multiline
              rows={2}
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

export default WCClassCodesTab;

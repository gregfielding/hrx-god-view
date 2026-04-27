/**
 * Onboarding Items Tab — Phase 1B
 * Master library of onboarding items (steps, documents, checks).
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
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';

export type OnboardingItemType = 'step' | 'document' | 'check';
export type Audience = 'worker' | 'internal' | 'both';
export type DocumentMode = 'esign' | 'upload' | 'acknowledge';
export type CheckProvider = 'none' | 'backgroundVendor' | 'drugVendor' | 'everify';

export interface OnboardingLibraryItem {
  id: string;
  key: string;
  title: string;
  type: OnboardingItemType;
  audience: Audience;
  requiredDefault: boolean;
  blockingDefault: boolean;
  documentMode?: DocumentMode;
  documentKey?: string;
  checkProvider?: CheckProvider;
  tags?: string[];
  isActive: boolean;
  description?: string;
  createdAt?: any;
  updatedAt?: any;
}

const TYPE_OPTIONS: { value: OnboardingItemType; label: string }[] = [
  { value: 'step', label: 'Step' },
  { value: 'document', label: 'Document' },
  { value: 'check', label: 'Check' },
];

const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: 'worker', label: 'Worker' },
  { value: 'internal', label: 'Internal' },
  { value: 'both', label: 'Both' },
];

const DOCUMENT_MODE_OPTIONS: { value: DocumentMode; label: string }[] = [
  { value: 'acknowledge', label: 'Acknowledge' },
  { value: 'upload', label: 'Upload' },
  { value: 'esign', label: 'E-sign (placeholder)' },
];

const CHECK_PROVIDER_OPTIONS: { value: CheckProvider; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'backgroundVendor', label: 'Background vendor' },
  { value: 'drugVendor', label: 'Drug screen vendor' },
  { value: 'everify', label: 'E-Verify' },
];

const emptyForm: Partial<OnboardingLibraryItem> = {
  key: '',
  title: '',
  type: 'step',
  audience: 'worker',
  requiredDefault: false,
  blockingDefault: false,
  documentMode: undefined,
  documentKey: '',
  checkProvider: undefined,
  tags: [],
  isActive: true,
  description: '',
};

interface OnboardingItemsTabProps {
  tenantId: string;
}

const OnboardingItemsTab: React.FC<OnboardingItemsTabProps> = ({ tenantId }) => {
  const { activeTenant } = useAuth();
  const effectiveTenantId = activeTenant?.id || tenantId;

  const [items, setItems] = useState<OnboardingLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<OnboardingItemType | ''>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<OnboardingLibraryItem | null>(null);
  const [form, setForm] = useState<Partial<OnboardingLibraryItem>>(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchItems = async () => {
    if (!effectiveTenantId) return;
    setLoading(true);
    setError(null);
    try {
      const colRef = collection(db, 'tenants', effectiveTenantId, 'onboarding_item_library');
      const q = query(colRef, orderBy('title'));
      const snapshot = await getDocs(q);
      const list: OnboardingLibraryItem[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as OnboardingLibraryItem[];
      setItems(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [effectiveTenantId]);

  const filteredItems = items.filter((item) => {
    const matchSearch =
      !search.trim() ||
      (item.title || '').toLowerCase().includes(search.toLowerCase()) ||
      (item.key || '').toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || item.type === typeFilter;
    return matchSearch && matchType;
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: OnboardingLibraryItem) => {
    setEditingItem(item);
    setForm({
      key: item.key,
      title: item.title,
      type: item.type,
      audience: item.audience,
      requiredDefault: item.requiredDefault ?? false,
      blockingDefault: item.blockingDefault ?? false,
      documentMode: item.documentMode,
      documentKey: item.documentKey || '',
      checkProvider: item.checkProvider,
      tags: item.tags || [],
      isActive: item.isActive ?? true,
      description: item.description || '',
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
    setForm(emptyForm);
  };

  const handleFormChange = (field: keyof OnboardingLibraryItem, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!effectiveTenantId) return;
    const key = (form.key || '').trim();
    const title = (form.title || '').trim();
    if (!key || !title) {
      setError('Key and title are required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        key,
        title,
        type: form.type || 'step',
        audience: form.audience || 'worker',
        requiredDefault: form.requiredDefault ?? false,
        blockingDefault: form.blockingDefault ?? false,
        tags: form.tags || [],
        isActive: form.isActive ?? true,
        description: (form.description || '').trim() || undefined,
        updatedAt: serverTimestamp(),
      };

      if (form.type === 'document') {
        payload.documentMode = form.documentMode || 'acknowledge';
        payload.documentKey = (form.documentKey || '').trim() || undefined;
      } else {
        payload.documentMode = undefined;
        payload.documentKey = undefined;
      }

      if (form.type === 'check') {
        payload.checkProvider = form.checkProvider || 'none';
      } else {
        payload.checkProvider = undefined;
      }

      if (editingItem) {
        await updateDoc(doc(db, p.onboardingItem(effectiveTenantId, editingItem.id)), payload);
        setSuccess('Item updated');
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(
          collection(db, 'tenants', effectiveTenantId, 'onboarding_item_library'),
          payload
        );
        setSuccess('Item created');
      }
      handleCloseDialog();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = (t: OnboardingItemType) => TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          <TextField
            size="small"
            placeholder="Search by title or key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Type</InputLabel>
            <Select
              value={typeFilter}
              label="Type"
              onChange={(e) => setTypeFilter(e.target.value as OnboardingItemType | '')}
            >
              <MenuItem value="">All</MenuItem>
              {TYPE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Add Item
        </Button>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Key</TableCell>
                <TableCell>Audience</TableCell>
                <TableCell>Required</TableCell>
                <TableCell>Blocking</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    No items. Add items from the library to build packages.
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {item.title}
                      </Typography>
                      {item.tags && item.tags.length > 0 && (
                        <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
                          {item.tags.slice(0, 4).map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={typeLabel(item.type)}
                        size="small"
                        color={item.type === 'document' ? 'primary' : item.type === 'check' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {item.key}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.audience}</TableCell>
                    <TableCell>{item.requiredDefault ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{item.blockingDefault ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <Chip
                        label={item.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={item.isActive ? 'success' : 'default'}
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

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingItem ? 'Edit Item' : 'Add Onboarding Item'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Key"
              value={form.key || ''}
              onChange={(e) => handleFormChange('key', e.target.value)}
              placeholder="e.g. handbook_employee_ack, w4, everify"
              fullWidth
              required
              disabled={!!editingItem}
              helperText={editingItem ? 'Key cannot be changed after creation' : 'Stable identifier used in packages'}
            />
            <TextField
              label="Title"
              value={form.title || ''}
              onChange={(e) => handleFormChange('title', e.target.value)}
              placeholder="e.g. Employee Handbook Acknowledgment"
              fullWidth
              required
            />
            <TextField
              label="Description (optional)"
              value={form.description || ''}
              onChange={(e) => handleFormChange('description', e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={form.type || 'step'}
                label="Type"
                onChange={(e) => handleFormChange('type', e.target.value as OnboardingItemType)}
              >
                {TYPE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Audience</InputLabel>
              <Select
                value={form.audience || 'worker'}
                label="Audience"
                onChange={(e) => handleFormChange('audience', e.target.value as Audience)}
              >
                {AUDIENCE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box display="flex" gap={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.requiredDefault ?? false}
                    onChange={(e) => handleFormChange('requiredDefault', e.target.checked)}
                  />
                }
                label="Required by default"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.blockingDefault ?? false}
                    onChange={(e) => handleFormChange('blockingDefault', e.target.checked)}
                  />
                }
                label="Blocking by default"
              />
            </Box>

            {form.type === 'document' && (
              <>
                <FormControl fullWidth>
                  <InputLabel>Document mode</InputLabel>
                  <Select
                    value={form.documentMode || 'acknowledge'}
                    label="Document mode"
                    onChange={(e) => handleFormChange('documentMode', e.target.value as DocumentMode)}
                  >
                    {DOCUMENT_MODE_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Document key"
                  value={form.documentKey || ''}
                  onChange={(e) => handleFormChange('documentKey', e.target.value)}
                  placeholder="e.g. handbook_employee, ic_agreement"
                  fullWidth
                />
              </>
            )}

            {form.type === 'check' && (
              <FormControl fullWidth>
                <InputLabel>Check provider</InputLabel>
                <Select
                  value={form.checkProvider || 'none'}
                  label="Check provider"
                  onChange={(e) => handleFormChange('checkProvider', e.target.value as CheckProvider)}
                >
                  {CHECK_PROVIDER_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.tags || []}
              onChange={(_, v) => handleFormChange('tags', v)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="outlined" label={option} size="small" {...getTagProps({ index })} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Tags (optional)" placeholder="e.g. W2, 1099, everify" />
              )}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={form.isActive ?? true}
                  onChange={(e) => handleFormChange('isActive', e.target.checked)}
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

export default OnboardingItemsTab;

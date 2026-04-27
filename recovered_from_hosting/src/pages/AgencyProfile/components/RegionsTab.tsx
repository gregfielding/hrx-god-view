import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  TableSortLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Autocomplete,
  IconButton,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
} from '@mui/material';
import { Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { collection, addDoc, getDocs, query, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../../../firebase';

interface RegionsTabProps {
  tenantId: string;
}

const timezoneOptions = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

const languageOptions = [
  'English',
  'Spanish',
  'Chinese (Mandarin)',
  'Tagalog',
  'Vietnamese',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Russian',
  'Japanese',
  'Korean',
];

const statusOptions = [
  'Active',
  'Inactive',
  'Archived',
];

const RegionsTab: React.FC<RegionsTabProps> = ({ tenantId }) => {
  const [form, setForm] = useState({
    name: '',
    shortcode: '',
    description: '',
    parentRegionId: '',
    timezones: [] as string[],
    externalIds: {} as Record<string, string>,
    defaultLanguage: '',
    status: 'Active',
  });
  const [regions, setRegions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<string>('name');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    shortcode: '',
    description: '',
    parentRegionId: '',
    timezones: [] as string[],
    externalIds: {} as Record<string, string>,
    defaultLanguage: '',
    status: 'Active',
  });
  const [externalIdKey, setExternalIdKey] = useState('');
  const [externalIdValue, setExternalIdValue] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchRegions();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchRegions = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'regions'));
      const snapshot = await getDocs(q);
      setRegions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch regions');
    }
    setLoading(false);
  };

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditChange = (field: string, value: any) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'regions'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setForm({ 
        name: '', 
        shortcode: '', 
        description: '', 
        parentRegionId: '', 
        timezones: [], 
        externalIds: {}, 
        defaultLanguage: '',
        status: 'Active'
      });
      setExternalIdKey('');
      setExternalIdValue('');
      setSuccess(true);
      fetchRegions();
    } catch (err: any) {
      setError(err.message || 'Failed to add region');
    }
    setLoading(false);
  };

  const handleEdit = (region: any) => {
    setEditingId(region.id);
    setEditForm({
      name: region.name || '',
      shortcode: region.shortcode || '',
      description: region.description || '',
      parentRegionId: region.parentRegionId || '',
      timezones: region.timezones || [],
      externalIds: region.externalIds || {},
      defaultLanguage: region.defaultLanguage || '',
      status: region.status || 'Active',
    });
  };

  const handleSaveEdit = async (regionId: string) => {
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'regions', regionId), {
        ...editForm,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setSuccess(true);
      fetchRegions();
    } catch (err: any) {
      setError(err.message || 'Failed to update region');
    }
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: '',
      shortcode: '',
      description: '',
      parentRegionId: '',
      timezones: [],
      externalIds: {},
      defaultLanguage: '',
      status: 'Active',
    });
  };

  const handleRowSelect = (id: string) => {
    setSelectedRows(prev => 
      prev.includes(id) 
        ? prev.filter(rowId => rowId !== id)
        : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedRows.length === regions.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(regions.map(region => region.id));
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteSelected = () => {
    setDeleteTarget('selected');
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setLoading(true);
    setError('');
    try {
      if (deleteTarget === 'selected') {
        // Delete multiple selected rows
        for (const id of selectedRows) {
          await deleteDoc(doc(db, 'tenants', tenantId, 'regions', id));
        }
        setSelectedRows([]);
      } else if (deleteTarget) {
        // Delete single row
        await deleteDoc(doc(db, 'tenants', tenantId, 'regions', deleteTarget));
      }
      setSuccess(true);
      fetchRegions();
    } catch (err: any) {
      setError(err.message || 'Failed to delete region(s)');
    }
    setLoading(false);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedRegions = React.useMemo(() => {
    const data = [...regions];
    data.sort((a, b) => {
      let aValue = a[orderBy] || '';
      let bValue = b[orderBy] || '';
      if (orderBy === 'name') {
        aValue = a.name || '';
        bValue = b.name || '';
      }
      if (orderBy === 'shortcode') {
        aValue = a.shortcode || '';
        bValue = b.shortcode || '';
      }
      if (orderBy === 'externalIds') {
        aValue = JSON.stringify(a.externalIds || {});
        bValue = JSON.stringify(b.externalIds || {});
      }
      if (aValue < bValue) return order === 'asc' ? -1 : 1;
      if (aValue > bValue) return order === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [regions, order, orderBy]);

  const getParentRegionName = (parentRegionId: string) => {
    if (!parentRegionId) return '-';
    const parent = regions.find(r => r.id === parentRegionId);
    return parent ? parent.name : '-';
  };

  return (
    <Box sx={{ p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">Regions ({regions.length})</Typography>
        <Box display="flex" gap={1}>
          {selectedRows.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteSelected}
            >
              Delete Selected ({selectedRows.length})
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(true)}
          >
            ADD NEW REGION
          </Button>
        </Box>
      </Box>
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New Region
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Region Name"
                  fullWidth
                  required
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Shortcode"
                  fullWidth
                  required
                  value={form.shortcode}
                  onChange={(e) => handleChange('shortcode', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  rows={2}
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Parent Region</InputLabel>
                  <Select
                    value={form.parentRegionId}
                    label="Parent Region"
                    onChange={(e) => handleChange('parentRegionId', e.target.value)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {regions.map((region) => (
                      <MenuItem key={region.id} value={region.id}>
                        {region.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  options={timezoneOptions}
                  value={form.timezones}
                  onChange={(_, newValue) => handleChange('timezones', newValue)}
                  renderInput={(params) => (
                    <TextField {...params} label="Time Zones" placeholder="Select time zones" />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    External Sync IDs
                  </Typography>
                  <Grid container spacing={1}>
                    {Object.entries(form.externalIds).map(([key, value]) => (
                      <Grid item xs={12} key={key}>
                        <Box display="flex" gap={1}>
                          <TextField
                            size="small"
                            label="System"
                            value={key}
                            onChange={(e) => {
                              const newExternalIds = { ...form.externalIds };
                              delete newExternalIds[key];
                              newExternalIds[e.target.value] = value;
                              handleChange('externalIds', newExternalIds);
                            }}
                          />
                          <TextField
                            size="small"
                            label="ID"
                            value={value}
                            onChange={(e) => {
                              const newExternalIds = { ...form.externalIds };
                              newExternalIds[key] = e.target.value;
                              handleChange('externalIds', newExternalIds);
                            }}
                          />
                          <IconButton
                            size="small"
                            onClick={() => {
                              const newExternalIds = { ...form.externalIds };
                              delete newExternalIds[key];
                              handleChange('externalIds', newExternalIds);
                            }}
                          >
                            <CancelIcon />
                          </IconButton>
                        </Box>
                      </Grid>
                    ))}
                    <Grid item xs={12}>
                      <Box display="flex" gap={1}>
                        <TextField
                          size="small"
                          label="System"
                          value={externalIdKey}
                          onChange={(e) => setExternalIdKey(e.target.value)}
                          placeholder="e.g., workdayId"
                        />
                        <TextField
                          size="small"
                          label="ID"
                          value={externalIdValue}
                          onChange={(e) => setExternalIdValue(e.target.value)}
                          placeholder="e.g., R-EU23"
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            if (externalIdKey && externalIdValue) {
                              const newExternalIds = { ...form.externalIds };
                              newExternalIds[externalIdKey] = externalIdValue;
                              handleChange('externalIds', newExternalIds);
                              setExternalIdKey('');
                              setExternalIdValue('');
                            }
                          }}
                        >
                          Add
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Language</InputLabel>
                  <Select
                    value={form.defaultLanguage}
                    label="Default Language"
                    onChange={(e) => handleChange('defaultLanguage', e.target.value)}
                  >
                    <MenuItem value="">Select Language</MenuItem>
                    {languageOptions.map((lang) => (
                      <MenuItem key={lang} value={lang}>
                        {lang}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={form.status}
                    label="Status"
                    onChange={(e) => handleChange('status', e.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <MenuItem key={status} value={status}>
                        {status}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Region'}
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </Grid>
            </Grid>
          </form>
        </>
      )}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={selectedRows.length > 0 && selectedRows.length < regions.length}
                  checked={selectedRows.length === regions.length && regions.length > 0}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell sortDirection={orderBy === 'shortcode' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'shortcode'}
                  direction={orderBy === 'shortcode' ? order : 'asc'}
                  onClick={() => handleRequestSort('shortcode')}
                >
                  Shortcode
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={orderBy === 'name' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => handleRequestSort('name')}
                >
                  Region Name
                </TableSortLabel>
              </TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Parent Region</TableCell>
              <TableCell>Time Zones</TableCell>
              <TableCell sortDirection={orderBy === 'externalIds' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'externalIds'}
                  direction={orderBy === 'externalIds' ? order : 'asc'}
                  onClick={() => handleRequestSort('externalIds')}
                >
                  External Sync IDs
                </TableSortLabel>
              </TableCell>
              <TableCell>Default Language</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRegions.map((region) => (
              <TableRow key={region.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRows.includes(region.id)}
                    onChange={() => handleRowSelect(region.id)}
                  />
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <TextField
                      size="small"
                      value={editForm.shortcode}
                      onChange={(e) => handleEditChange('shortcode', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    region.shortcode || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <TextField
                      size="small"
                      value={editForm.name}
                      onChange={(e) => handleEditChange('name', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    region.name
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <TextField
                      size="small"
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    region.description || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.parentRegionId}
                        onChange={(e) => handleEditChange('parentRegionId', e.target.value)}
                      >
                        <MenuItem value="">None</MenuItem>
                        {regions.filter(r => r.id !== region.id).map((r) => (
                          <MenuItem key={r.id} value={r.id}>
                            {r.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    getParentRegionName(region.parentRegionId)
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <Autocomplete
                      multiple
                      size="small"
                      options={timezoneOptions}
                      value={editForm.timezones}
                      onChange={(_, newValue) => handleEditChange('timezones', newValue)}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Select time zones" />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip label={option} {...getTagProps({ index })} size="small" />
                        ))
                      }
                    />
                  ) : (
                    <Box>
                      {region.timezones && region.timezones.length > 0 ? (
                        region.timezones.map((tz: string, index: number) => (
                          <Chip key={index} label={tz} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                        ))
                      ) : (
                        '-'
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <Box>
                      <Grid container spacing={1}>
                        {Object.entries(editForm.externalIds).map(([key, value]) => (
                          <Grid item xs={12} key={key}>
                            <Box display="flex" gap={1}>
                              <TextField
                                size="small"
                                label="System"
                                value={key}
                                onChange={(e) => {
                                  const newExternalIds = { ...editForm.externalIds };
                                  delete newExternalIds[key];
                                  newExternalIds[e.target.value] = value;
                                  handleEditChange('externalIds', newExternalIds);
                                }}
                              />
                              <TextField
                                size="small"
                                label="ID"
                                value={value}
                                onChange={(e) => {
                                  const newExternalIds = { ...editForm.externalIds };
                                  newExternalIds[key] = e.target.value;
                                  handleEditChange('externalIds', newExternalIds);
                                }}
                              />
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const newExternalIds = { ...editForm.externalIds };
                                  delete newExternalIds[key];
                                  handleEditChange('externalIds', newExternalIds);
                                }}
                              >
                                <CancelIcon />
                              </IconButton>
                            </Box>
                          </Grid>
                        ))}
                        <Grid item xs={12}>
                          <Box display="flex" gap={1}>
                            <TextField
                              size="small"
                              label="System"
                              value={externalIdKey}
                              onChange={(e) => setExternalIdKey(e.target.value)}
                              placeholder="e.g., workdayId"
                            />
                            <TextField
                              size="small"
                              label="ID"
                              value={externalIdValue}
                              onChange={(e) => setExternalIdValue(e.target.value)}
                              placeholder="e.g., R-EU23"
                            />
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                if (externalIdKey && externalIdValue) {
                                  const newExternalIds = { ...editForm.externalIds };
                                  newExternalIds[externalIdKey] = externalIdValue;
                                  handleEditChange('externalIds', newExternalIds);
                                  setExternalIdKey('');
                                  setExternalIdValue('');
                                }
                              }}
                            >
                              Add
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </Box>
                  ) : (
                    <Box>
                      {Object.keys(region.externalIds || {}).length > 0 ? (
                        Object.entries(region.externalIds || {}).map(([key, value]) => (
                          <Chip
                            key={key}
                            label={`${key}: ${value}`}
                            size="small"
                            sx={{ mr: 0.5, mb: 0.5 }}
                          />
                        ))
                      ) : (
                        '-'
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.defaultLanguage}
                        onChange={(e) => handleEditChange('defaultLanguage', e.target.value)}
                      >
                        <MenuItem value="">Select Language</MenuItem>
                        {languageOptions.map((lang) => (
                          <MenuItem key={lang} value={lang}>
                            {lang}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    region.defaultLanguage || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.status}
                        onChange={(e) => handleEditChange('status', e.target.value)}
                      >
                        {statusOptions.map((status) => (
                          <MenuItem key={status} value={status}>
                            {status}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Chip
                      label={region.status || 'Active'}
                      size="small"
                      color={
                        region.status === 'Active' ? 'success' :
                        region.status === 'Inactive' ? 'warning' :
                        region.status === 'Archived' ? 'default' : 'success'
                      }
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === region.id ? (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handleSaveEdit(region.id)}
                        disabled={loading}
                      >
                        <SaveIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="secondary"
                        onClick={handleCancelEdit}
                      >
                        <CancelIcon />
                      </IconButton>
                    </Box>
                  ) : (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        onClick={() => handleEdit(region)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(region.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {deleteTarget === 'selected' 
              ? `Are you sure you want to delete ${selectedRows.length} selected region(s)? This action cannot be undone.`
              : 'Are you sure you want to delete this region? This action cannot be undone.'
            }
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Region {editingId ? 'updated' : 'added'}!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RegionsTab; 
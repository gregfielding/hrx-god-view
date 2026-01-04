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
  Tooltip,
} from '@mui/material';
import { Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon, Delete as DeleteIcon, Security as SecurityIcon } from '@mui/icons-material';
import { collection, addDoc, getDocs, query, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../../../firebase';

interface DivisionsTabProps {
  tenantId: string;
}

const DivisionsTab: React.FC<DivisionsTabProps> = ({ tenantId }) => {
  const [form, setForm] = useState({
    name: '',
    shortcode: '',
    type: '',
    region: '',
    primaryLocation: '',
    costCenterCode: '',
    description: '',
    tags: [] as string[],
    status: 'Active',
    externalIds: {} as Record<string, string>,
  });
  const [divisions, setDivisions] = useState<any[]>([]);
  const [divisionTypes, setDivisionTypes] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
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
    type: '',
    region: '',
    primaryLocation: '',
    costCenterCode: '',
    description: '',
    tags: [] as string[],
    status: 'Active',
    externalIds: {} as Record<string, string>,
  });
  const [externalIdKey, setExternalIdKey] = useState('');
  const [externalIdValue, setExternalIdValue] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchDivisions();
    fetchDivisionTypes();
    fetchRegions();
    fetchLocations();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchDivisions = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'divisions'));
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch divisions');
    }
    setLoading(false);
  };

  const fetchDivisionTypes = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'divisionTypes'));
      const snapshot = await getDocs(q);
      setDivisionTypes(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch division types:', err);
    }
  };

  const fetchRegions = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'regions'));
      const snapshot = await getDocs(q);
      setRegions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch regions:', err);
    }
  };

  const fetchLocations = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      const locationData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      console.log("Locations data:", locationData);
      setLocations(locationData);
    } catch (err: any) {
      console.error('Failed to fetch locations:', err);
    }
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
      await addDoc(collection(db, 'tenants', tenantId, 'divisions'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setForm({ 
        name: '', 
        shortcode: '', 
        type: '', 
        region: '', 
        primaryLocation: '', 
        costCenterCode: '', 
        description: '', 
        tags: [], 
        status: 'Active',
        externalIds: {}
      });
      setExternalIdKey('');
      setExternalIdValue('');
      setSuccess(true);
      fetchDivisions();
    } catch (err: any) {
      setError(err.message || 'Failed to add division');
    }
    setLoading(false);
  };

  const handleEdit = (division: any) => {
    // Prevent editing system-managed divisions
    if (division.isSystem) {
      setError('System-managed divisions cannot be edited');
      return;
    }
    
    setEditingId(division.id);
    setEditForm({
      name: division.name || '',
      shortcode: division.shortcode || '',
      type: division.type || '',
      region: division.region || '',
      primaryLocation: division.primaryLocation || '',
      costCenterCode: division.costCenterCode || '',
      description: division.description || '',
      tags: division.tags || [],
      status: division.status || 'Active',
      externalIds: division.externalIds || {},
    });
  };

  const handleSaveEdit = async (id: string) => {
    // Prevent editing system-managed divisions
    const division = divisions.find(d => d.id === id);
    if (division?.isSystem) {
      setError('System-managed divisions cannot be edited');
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'divisions', id), {
        ...editForm,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditForm({
        name: '',
        shortcode: '',
        type: '',
        region: '',
        primaryLocation: '',
        costCenterCode: '',
        description: '',
        tags: [],
        status: 'Active',
        externalIds: {},
      });
      setSuccess(true);
      fetchDivisions();
    } catch (err: any) {
      setError(err.message || 'Failed to update division');
    }
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: '',
      shortcode: '',
      type: '',
      region: '',
      primaryLocation: '',
      costCenterCode: '',
      description: '',
      tags: [],
      status: 'Active',
      externalIds: {},
    });
  };

  const handleAddExternalId = () => {
    if (externalIdKey && externalIdValue) {
      setForm(prev => ({
        ...prev,
        externalIds: { ...prev.externalIds, [externalIdKey]: externalIdValue }
      }));
      setExternalIdKey('');
      setExternalIdValue('');
    }
  };

  const handleRemoveExternalId = (key: string) => {
    setForm(prev => {
      const newExternalIds = { ...prev.externalIds };
      delete newExternalIds[key];
      return { ...prev, externalIds: newExternalIds };
    });
  };

  const handleEditAddExternalId = () => {
    if (externalIdKey && externalIdValue) {
      setEditForm(prev => ({
        ...prev,
        externalIds: { ...prev.externalIds, [externalIdKey]: externalIdValue }
      }));
      setExternalIdKey('');
      setExternalIdValue('');
    }
  };

  const handleEditRemoveExternalId = (key: string) => {
    setEditForm(prev => {
      const newExternalIds = { ...prev.externalIds };
      delete newExternalIds[key];
      return { ...prev, externalIds: newExternalIds };
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
    if (selectedRows.length === divisions.filter(d => !d.isSystem).length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(divisions.filter(d => !d.isSystem).map(div => div.id));
    }
  };

  const handleDelete = (id: string) => {
    // Prevent deleting system-managed divisions
    const division = divisions.find(d => d.id === id);
    if (division?.isSystem) {
      setError('System-managed divisions cannot be deleted');
      return;
    }
    
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
        // Filter out system-managed divisions from deletion
        const divisionsToDelete = selectedRows.filter(id => {
          const division = divisions.find(d => d.id === id);
          return !division?.isSystem;
        });
        
        if (divisionsToDelete.length !== selectedRows.length) {
          setError('Some divisions could not be deleted because they are system-managed');
        }
        
        for (const id of divisionsToDelete) {
          await deleteDoc(doc(db, 'tenants', tenantId, 'divisions', id));
        }
        setSelectedRows([]);
      } else if (deleteTarget) {
        await deleteDoc(doc(db, 'tenants', tenantId, 'divisions', deleteTarget));
      }
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setSuccess(true);
      fetchDivisions();
    } catch (err: any) {
      setError(err.message || 'Failed to delete division');
    }
    setLoading(false);
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedDivisions = React.useMemo(() => {
    const data = [...divisions];
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
      if (orderBy === 'status') {
        aValue = a.status || '';
        bValue = b.status || '';
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
  }, [divisions, order, orderBy]);

  const statusOptions = [
    'Active',
    'Inactive',
    'Archived',
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'success';
      case 'Inactive': return 'warning';
      case 'Archived': return 'default';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">Divisions ({divisions.length})</Typography>
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
            ADD NEW DIVISION
          </Button>
        </Box>
      </Box>
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New Division
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Division Name"
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
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={form.type}
                    label="Type"
                    onChange={(e) => handleChange('type', e.target.value)}
                  >
                    <MenuItem value="">Select Type</MenuItem>
                    {divisionTypes.map((type) => (
                      <MenuItem key={type.id} value={type.id}>
                        {type.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Region</InputLabel>
                  <Select
                    value={form.region}
                    label="Region"
                    onChange={(e) => handleChange('region', e.target.value)}
                  >
                    <MenuItem value="">Select Region</MenuItem>
                    {regions.map((region) => (
                      <MenuItem key={region.id} value={region.id}>
                        {region.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Primary Location (Optional)</InputLabel>
                  <Select
                    value={form.primaryLocation}
                    label="Primary Location (Optional)"
                    onChange={(e) => handleChange('primaryLocation', e.target.value)}
                  >
                    <MenuItem value="">Select Location</MenuItem>
                    {locations.map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.nickname || location.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cost Center Code"
                  fullWidth
                  value={form.costCenterCode}
                  onChange={(e) => handleChange('costCenterCode', e.target.value)}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  rows={3}
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={form.tags}
                  onChange={(_, newValue) => handleChange('tags', newValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Tags"
                      placeholder="Add tags..."
                    />
                  )}
                />
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
                            disabled
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            size="small"
                            label="ID"
                            value={value}
                            disabled
                            sx={{ flex: 1 }}
                          />
                          <IconButton
                            size="small"
                            onClick={() => handleRemoveExternalId(key)}
                            color="error"
                          >
                            ×
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
                          placeholder="e.g., workdayCode"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          label="ID"
                          value={externalIdValue}
                          onChange={(e) => setExternalIdValue(e.target.value)}
                          placeholder="e.g., WD-OP1"
                          sx={{ flex: 1 }}
                        />
                        <Button
                          size="small"
                          onClick={handleAddExternalId}
                          disabled={!externalIdKey || !externalIdValue}
                        >
                          Add
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Division'}
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
                  indeterminate={selectedRows.length > 0 && selectedRows.length < divisions.filter(d => !d.isSystem).length}
                  checked={selectedRows.length === divisions.filter(d => !d.isSystem).length && divisions.filter(d => !d.isSystem).length > 0}
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
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Region</TableCell>
              <TableCell>Primary Location</TableCell>
              <TableCell>Cost Center Code</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Tags</TableCell>
              <TableCell sortDirection={orderBy === 'externalIds' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'externalIds'}
                  direction={orderBy === 'externalIds' ? order : 'asc'}
                  onClick={() => handleRequestSort('externalIds')}
                >
                  External Sync IDs
                </TableSortLabel>
              </TableCell>
              <TableCell sortDirection={orderBy === 'status' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'status'}
                  direction={orderBy === 'status' ? order : 'asc'}
                  onClick={() => handleRequestSort('status')}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedDivisions.map((division) => (
              <TableRow 
                key={division.id} 
                hover
                sx={{
                  backgroundColor: division.isSystem ? 'rgba(25, 118, 210, 0.04)' : 'inherit',
                  '&:hover': {
                    backgroundColor: division.isSystem ? 'rgba(25, 118, 210, 0.08)' : undefined,
                  }
                }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRows.includes(division.id)}
                    onChange={() => handleRowSelect(division.id)}
                    disabled={division.isSystem}
                  />
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <TextField
                      size="small"
                      value={editForm.shortcode}
                      onChange={(e) => handleEditChange('shortcode', e.target.value)}
                      fullWidth
                      disabled={division.isSystem}
                    />
                  ) : (
                    <Box display="flex" alignItems="center" gap={1}>
                      {division.shortcode || '-'}
                      {division.isSystem && (
                        <Tooltip title="System-managed division">
                          <SecurityIcon fontSize="small" color="primary" />
                        </Tooltip>
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <TextField
                      size="small"
                      value={editForm.name}
                      onChange={(e) => handleEditChange('name', e.target.value)}
                      fullWidth
                      disabled={division.isSystem}
                    />
                  ) : (
                    <Box display="flex" alignItems="center" gap={1}>
                      {division.name || '-'}
                      {division.isSystem && (
                        <Chip
                          label="System"
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={{ fontSize: '0.7rem', height: '20px' }}
                        />
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.type}
                        onChange={(e) => handleEditChange('type', e.target.value)}
                        disabled={division.isSystem}
                      >
                        <MenuItem value="">Select Type</MenuItem>
                        {divisionTypes.map((type) => (
                          <MenuItem key={type.id} value={type.id}>
                            {type.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Box display="flex" alignItems="center" gap={1}>
                      {divisionTypes.find(t => t.id === division.type)?.name || '-'}
                      {division.isSystem && division.autoAssignRules && (
                        <Tooltip title={`Auto-assigns workers with ${Object.entries(division.autoAssignRules).map(([key, value]) => `${key}: ${value}`).join(', ')}`}>
                          <Chip
                            label="Auto"
                            size="small"
                            color="secondary"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem', height: '20px' }}
                          />
                        </Tooltip>
                      )}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.region}
                        onChange={(e) => handleEditChange('region', e.target.value)}
                      >
                        <MenuItem value="">Select Region</MenuItem>
                        {regions.map((region) => (
                          <MenuItem key={region.id} value={region.id}>
                            {region.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    regions.find(r => r.id === division.region)?.name || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.primaryLocation}
                        onChange={(e) => handleEditChange('primaryLocation', e.target.value)}
                      >
                        <MenuItem value="">Select Location</MenuItem>
                        {locations.map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.nickname || location.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    (() => {
                      const location = locations.find(l => l.id === division.primaryLocation);
                      return location ? (location.nickname || location.name) : '-';
                    })()
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <TextField
                      size="small"
                      value={editForm.costCenterCode}
                      onChange={(e) => handleEditChange('costCenterCode', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    division.costCenterCode || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <TextField
                      size="small"
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    division.description || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <Autocomplete
                      multiple
                      freeSolo
                      size="small"
                      options={[]}
                      value={editForm.tags}
                      onChange={(_, newValue) => handleEditChange('tags', newValue)}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            variant="outlined"
                            label={option}
                            size="small"
                            {...getTagProps({ index })}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          placeholder="Add tags..."
                        />
                      )}
                    />
                  ) : (
                    <Box display="flex" flexWrap="wrap" gap={0.5}>
                      {division.tags?.map((tag: string, index: number) => (
                        <Chip
                          key={index}
                          label={tag}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <Box>
                      <Grid container spacing={1}>
                        {Object.entries(editForm.externalIds).map(([key, value]) => (
                          <Grid item xs={12} key={key}>
                            <Box display="flex" gap={1}>
                              <TextField
                                size="small"
                                label="System"
                                value={key}
                                disabled
                                sx={{ flex: 1 }}
                              />
                              <TextField
                                size="small"
                                label="ID"
                                value={value}
                                disabled
                                sx={{ flex: 1 }}
                              />
                              <IconButton
                                size="small"
                                onClick={() => handleEditRemoveExternalId(key)}
                                color="error"
                              >
                                ×
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
                              placeholder="e.g., workdayCode"
                              sx={{ flex: 1 }}
                            />
                            <TextField
                              size="small"
                              label="ID"
                              value={externalIdValue}
                              onChange={(e) => setExternalIdValue(e.target.value)}
                              placeholder="e.g., WD-OP1"
                              sx={{ flex: 1 }}
                            />
                            <Button
                              size="small"
                              onClick={handleEditAddExternalId}
                              disabled={!externalIdKey || !externalIdValue}
                            >
                              Add
                            </Button>
                          </Box>
                        </Grid>
                      </Grid>
                    </Box>
                  ) : (
                    <Box display="flex" flexDirection="column" gap={0.5}>
                      {Object.entries(division.externalIds || {}).map(([key, value]) => (
                        <Chip
                          key={key}
                          label={`${key}: ${value}`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
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
                      label={division.status || 'Active'}
                      color={getStatusColor(division.status) as any}
                      size="small"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === division.id ? (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handleSaveEdit(division.id)}
                        disabled={loading || division.isSystem}
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
                      <Tooltip title={division.isSystem ? "System-managed divisions cannot be edited" : "Edit division"}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleEdit(division)}
                            disabled={division.isSystem}
                          >
                            <EditIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={division.isSystem ? "System-managed divisions cannot be deleted" : "Delete division"}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(division.id)}
                            disabled={division.isSystem}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
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
              ? `Are you sure you want to delete ${selectedRows.length} selected division(s)? This action cannot be undone.`
              : 'Are you sure you want to delete this division? This action cannot be undone.'
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
          Division {editingId ? 'updated' : 'added'}!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DivisionsTab; 
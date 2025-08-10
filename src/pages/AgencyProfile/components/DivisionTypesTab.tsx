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

interface DivisionTypesTabProps {
  tenantId: string;
}

const DivisionTypesTab: React.FC<DivisionTypesTabProps> = ({ tenantId }) => {
  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    defaultColor: '',
    associatedTags: [] as string[],
    status: 'Active',
    externalIds: {} as Record<string, string>,
  });
  const [divisionTypes, setDivisionTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<string>('name');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    code: '',
    description: '',
    defaultColor: '',
    associatedTags: [] as string[],
    status: 'Active',
    externalIds: {} as Record<string, string>,
  });
  const [externalIdKey, setExternalIdKey] = useState('');
  const [externalIdValue, setExternalIdValue] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchDivisionTypes();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchDivisionTypes = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'divisionTypes'));
      const snapshot = await getDocs(q);
      setDivisionTypes(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch division types');
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
      await addDoc(collection(db, 'tenants', tenantId, 'divisionTypes'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setForm({ 
        name: '', 
        code: '', 
        description: '', 
        defaultColor: '', 
        associatedTags: [], 
        status: 'Active',
        externalIds: {}
      });
      setExternalIdKey('');
      setExternalIdValue('');
      setSuccess(true);
      fetchDivisionTypes();
    } catch (err: any) {
      setError(err.message || 'Failed to add division type');
    }
    setLoading(false);
  };

  const handleEdit = (divisionType: any) => {
    setEditingId(divisionType.id);
    setEditForm({
      name: divisionType.name || '',
      code: divisionType.code || '',
      description: divisionType.description || '',
      defaultColor: divisionType.defaultColor || '',
      associatedTags: divisionType.associatedTags || [],
      status: divisionType.status || 'Active',
      externalIds: divisionType.externalIds || {},
    });
  };

  const handleSaveEdit = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'divisionTypes', id), {
        ...editForm,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setEditForm({
        name: '',
        code: '',
        description: '',
        defaultColor: '',
        associatedTags: [],
        status: 'Active',
        externalIds: {},
      });
      setSuccess(true);
      fetchDivisionTypes();
    } catch (err: any) {
      setError(err.message || 'Failed to update division type');
    }
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: '',
      code: '',
      description: '',
      defaultColor: '',
      associatedTags: [],
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
    if (selectedRows.length === divisionTypes.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(divisionTypes.map(type => type.id));
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
          await deleteDoc(doc(db, 'tenants', tenantId, 'divisionTypes', id));
        }
        setSelectedRows([]);
      } else if (deleteTarget) {
        // Delete single row
        await deleteDoc(doc(db, 'tenants', tenantId, 'divisionTypes', deleteTarget));
      }
      setSuccess(true);
      fetchDivisionTypes();
    } catch (err: any) {
      setError(err.message || 'Failed to delete division type(s)');
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

  const sortedDivisionTypes = React.useMemo(() => {
    const data = [...divisionTypes];
    data.sort((a, b) => {
      let aValue = a[orderBy] || '';
      let bValue = b[orderBy] || '';
      if (orderBy === 'name') {
        aValue = a.name || '';
        bValue = b.name || '';
      }
      if (orderBy === 'code') {
        aValue = a.code || '';
        bValue = b.code || '';
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
  }, [divisionTypes, order, orderBy]);

  const colorOptions = [
    'blue', 'red', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown', 'gray', 'black'
  ];

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
    <Box sx={{ p: 0 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">Division Types ({divisionTypes.length})</Typography>
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
            ADD NEW DIVISION TYPE
          </Button>
        </Box>
      </Box>
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New Division Type
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Division Type Name"
                  fullWidth
                  required
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g., Sales, Operations, HR, Manufacturing"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Division Type Code"
                  fullWidth
                  required
                  value={form.code}
                  onChange={(e) => handleChange('code', e.target.value)}
                  placeholder="e.g., SALES, OPS, HR"
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
                  placeholder="Optional internal notes about the function or scope"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Default Color / Tag Icon</InputLabel>
                  <Select
                    value={form.defaultColor}
                    label="Default Color / Tag Icon"
                    onChange={(e) => handleChange('defaultColor', e.target.value)}
                  >
                    <MenuItem value="">Select Color</MenuItem>
                    {colorOptions.map((color) => (
                      <MenuItem key={color} value={color}>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Box
                            width={20}
                            height={20}
                            borderRadius="50%"
                            bgcolor={color}
                            border="1px solid #ccc"
                          />
                          {color.charAt(0).toUpperCase() + color.slice(1)}
                        </Box>
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
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={form.associatedTags}
                  onChange={(_, newValue) => handleChange('associatedTags', newValue)}
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
                      label="Associated Tags or Traits"
                      placeholder="e.g., Client-Facing, Union, Field Team"
                    />
                  )}
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
                  {loading ? 'Adding...' : 'Add Division Type'}
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
                  indeterminate={selectedRows.length > 0 && selectedRows.length < divisionTypes.length}
                  checked={selectedRows.length === divisionTypes.length && divisionTypes.length > 0}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell sortDirection={orderBy === 'code' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'code'}
                  direction={orderBy === 'code' ? order : 'asc'}
                  onClick={() => handleRequestSort('code')}
                >
                  Code
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
              <TableCell>Description</TableCell>
              <TableCell>Color</TableCell>
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
            {sortedDivisionTypes.map((divisionType) => (
              <TableRow key={divisionType.id} hover>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRows.includes(divisionType.id)}
                    onChange={() => handleRowSelect(divisionType.id)}
                  />
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <TextField
                      size="small"
                      value={editForm.code}
                      onChange={(e) => handleEditChange('code', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    divisionType.code || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <TextField
                      size="small"
                      value={editForm.name}
                      onChange={(e) => handleEditChange('name', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    divisionType.name || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <TextField
                      size="small"
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      fullWidth
                    />
                  ) : (
                    divisionType.description || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.defaultColor}
                        onChange={(e) => handleEditChange('defaultColor', e.target.value)}
                      >
                        <MenuItem value="">None</MenuItem>
                        {colorOptions.map((color) => (
                          <MenuItem key={color} value={color}>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Box
                                width={16}
                                height={16}
                                borderRadius="50%"
                                bgcolor={color}
                                border="1px solid #ccc"
                              />
                              {color.charAt(0).toUpperCase() + color.slice(1)}
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    divisionType.defaultColor ? (
                      <Box display="flex" alignItems="center" gap={1}>
                        <Box
                          width={16}
                          height={16}
                          borderRadius="50%"
                          bgcolor={divisionType.defaultColor}
                          border="1px solid #ccc"
                        />
                        {divisionType.defaultColor.charAt(0).toUpperCase() + divisionType.defaultColor.slice(1)}
                      </Box>
                    ) : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <Autocomplete
                      multiple
                      freeSolo
                      size="small"
                      options={[]}
                      value={editForm.associatedTags}
                      onChange={(_, newValue) => handleEditChange('associatedTags', newValue)}
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
                      {divisionType.associatedTags?.map((tag: string, index: number) => (
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
                  {editingId === divisionType.id ? (
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
                      {Object.entries(divisionType.externalIds || {}).map(([key, value]) => (
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
                  {editingId === divisionType.id ? (
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
                      label={divisionType.status || 'Active'}
                      color={getStatusColor(divisionType.status) as any}
                      size="small"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === divisionType.id ? (
                    <Box display="flex" gap={1}>
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => handleSaveEdit(divisionType.id)}
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
                        onClick={() => handleEdit(divisionType)}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(divisionType.id)}
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
              ? `Are you sure you want to delete ${selectedRows.length} selected division type(s)? This action cannot be undone.`
              : 'Are you sure you want to delete this division type? This action cannot be undone.'
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
          Division type {editingId ? 'updated' : 'added'}!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DivisionTypesTab; 
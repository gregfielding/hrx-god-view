import React, { useState, useEffect, useRef } from 'react';
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
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Autocomplete,
} from '@mui/material';
import { collection, addDoc, getDocs, query, where, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useNavigate } from 'react-router-dom';
import { Delete as DeleteIcon, Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';

// Department type options
const departmentTypeOptions = [
  'Operational',
  'Administrative',
  'Field-Based',
  'Support',
  'Revenue-Generating',
  'Sales',
  'Marketing',
  'Human Resources',
  'Finance',
  'IT',
  'Legal',
  'Compliance',
  'Quality Assurance',
  'Research & Development',
  'Customer Service',
  'Logistics',
  'Manufacturing',
  'Engineering',
  'Maintenance',
  'Security',
  'Facilities',
  'Procurement',
  'Supply Chain',
  'Inventory Management',
  'Production',
  'Assembly',
  'Packaging',
  'Shipping',
  'Receiving',
  'Warehouse',
  'Distribution',
  'Transportation',
  'Fleet Management',
  'Safety',
  'Environmental',
  'Training',
  'Recruitment',
  'Benefits',
  'Payroll',
  'Accounting',
  'Audit',
  'Risk Management',
  'Strategic Planning',
  'Business Development',
  'Product Management',
  'Project Management',
  'Operations Management',
  'Process Improvement',
  'Data Analytics',
  'Business Intelligence',
  'Digital Transformation',
  'Innovation',
  'Research',
  'Development',
  'Design',
  'Creative',
  'Communications',
  'Public Relations',
  'Media Relations',
  'Brand Management',
  'Market Research',
  'Business Analysis',
  'Systems Analysis',
  'Network Administration',
  'Database Administration',
  'Software Development',
  'Web Development',
  'Mobile Development',
  'DevOps',
  'Cybersecurity',
  'Information Security',
  'Data Protection',
  'Privacy',
  'Regulatory Affairs',
  'Government Relations',
  'Public Affairs',
  'Community Relations',
  'Stakeholder Relations',
  'Investor Relations',
  'Corporate Communications',
  'Internal Communications',
  'Change Management',
  'Organizational Development',
  'Talent Management',
  'Performance Management',
  'Compensation',
  'Employee Relations',
  'Labor Relations',
  'Diversity & Inclusion',
  'Workplace Safety',
  'Occupational Health',
  'Wellness',
  'Benefits Administration',
  'Retirement Planning',
  'Insurance',
  'Claims Management',
  'Risk Assessment',
  'Compliance Monitoring',
  'Policy Development',
  'Procedure Development',
  'Documentation',
  'Knowledge Management',
  'Learning & Development',
  'Skills Development',
  'Certification',
  'Accreditation',
  'Quality Control',
  'Quality Management',
  'Process Control',
  'Statistical Process Control',
  'Six Sigma',
  'Lean Management',
  'Continuous Improvement',
  'Other'
];

// Status options
const statusOptions = [
  'Active',
  'Inactive',
  'Archived',
];

interface DepartmentsTabProps {
  tenantId: string;
}

const DepartmentsTab: React.FC<DepartmentsTabProps> = ({ tenantId }) => {
  const [form, setForm] = useState({
    name: '',
    description: '',
    customId: '',
    division: '',
    locations: [] as string[],
    departmentType: '',
    primaryContact: '',
    tags: [] as string[],
    status: 'Active',
    costCenterCode: '',
    externalIds: {} as Record<string, string>,
  });
  const [departments, setDepartments] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [workforce, setWorkforce] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState<string>('name');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    customId: '',
    division: '',
    locations: [] as string[],
    departmentType: '',
    primaryContact: '',
    tags: [] as string[],
    status: 'Active',
    costCenterCode: '',
    externalIds: {} as Record<string, string>,
  });
  const [externalIdKey, setExternalIdKey] = useState('');
  const [externalIdValue, setExternalIdValue] = useState('');

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sortedDepartments = React.useMemo(() => {
    const sorted = [...departments].sort((a, b) => {
      const aValue = a[orderBy] || '';
      const bValue = b[orderBy] || '';
      
      if (order === 'desc') {
        return bValue.localeCompare(aValue);
      }
      return aValue.localeCompare(bValue);
    });
    return sorted;
  }, [departments, order, orderBy]);

  useEffect(() => {
    fetchDepartments();
    fetchDivisions();
    fetchLocations();
    fetchWorkforce();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tenants', tenantId, 'departments'));
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch departments');
    }
    setLoading(false);
  };

  const fetchDivisions = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'divisions'));
      const snapshot = await getDocs(q);
      setDivisions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch divisions:', err);
    }
  };

  const fetchLocations = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'locations'));
      const snapshot = await getDocs(q);
      setLocations(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch locations:', err);
    }
  };

  const fetchWorkforce = async () => {
    try {
      const q = query(collection(db, 'tenants', tenantId, 'workforce'));
      const snapshot = await getDocs(q);
      setWorkforce(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.error('Failed to fetch workforce:', err);
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
      await addDoc(collection(db, 'tenants', tenantId, 'departments'), {
        ...form,
        createdAt: serverTimestamp(),
      });
      setForm({ 
        name: '', 
        description: '', 
        customId: '', 
        division: '', 
        locations: [],
        departmentType: '',
        primaryContact: '',
        tags: [],
        status: 'Active',
        costCenterCode: '',
        externalIds: {}
      });
      setExternalIdKey('');
      setExternalIdValue('');
      setSuccess(true);
      fetchDepartments();
      setShowForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add department');
    }
    setLoading(false);
  };

  const handleEdit = (department: any) => {
    setEditingId(department.id);
    setEditForm({
      name: department.name || '',
      description: department.description || '',
      customId: department.customId || '',
      division: department.division || '',
      locations: department.locations || [],
      departmentType: department.departmentType || '',
      primaryContact: department.primaryContact || '',
      tags: department.tags || [],
      status: department.status || 'Active',
      costCenterCode: department.costCenterCode || '',
      externalIds: department.externalIds || {},
    });
  };

  const handleSaveEdit = async (departmentId: string) => {
    setLoading(true);
    setError('');
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'departments', departmentId), {
        ...editForm,
        updatedAt: serverTimestamp(),
      });
      setEditingId(null);
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to update department');
    }
    setLoading(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: '',
      description: '',
      customId: '',
      division: '',
      locations: [],
      departmentType: '',
      primaryContact: '',
      tags: [],
      status: 'Active',
      costCenterCode: '',
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
    if (selectedRows.length === departments.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(departments.map(dept => dept.id));
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
    try {
      if (deleteTarget === 'selected') {
        await Promise.all(
          selectedRows.map(id => deleteDoc(doc(db, 'tenants', tenantId, 'departments', id)))
        );
        setSelectedRows([]);
      } else if (deleteTarget) {
        await deleteDoc(doc(db, 'tenants', tenantId, 'departments', deleteTarget));
      }
      fetchDepartments();
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete department(s)');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Departments</Typography>
        <Box display="flex" gap={1}>
          {selectedRows.length > 0 && (
            <Button
              variant="outlined"
              color="error"
              onClick={handleDeleteSelected}
              startIcon={<DeleteIcon />}
            >
              Delete Selected ({selectedRows.length})
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : 'Add Department'}
          </Button>
        </Box>
      </Box>

      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>
            Add New Department
          </Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              {/* Basic Information */}
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Department Name"
                  fullWidth
                  required
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g., Warehouse Ops – East Bay"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Custom ID"
                  fullWidth
                  value={form.customId}
                  onChange={(e) => handleChange('customId', e.target.value)}
                  placeholder="e.g., WHOPS_EB"
                />
              </Grid>

              {/* Description */}
              <Grid item xs={12}>
                <TextField
                  label="Description"
                  fullWidth
                  multiline
                  rows={3}
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Department description and responsibilities"
                />
              </Grid>

              {/* Division and Department Type */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Division</InputLabel>
                  <Select
                    value={form.division}
                    label="Division"
                    onChange={(e) => handleChange('division', e.target.value)}
                  >
                    <MenuItem value="">Select Division</MenuItem>
                    {divisions.map((division) => (
                      <MenuItem key={division.id} value={division.id}>
                        {division.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Department Type</InputLabel>
                  <Select
                    value={form.departmentType}
                    label="Department Type"
                    onChange={(e) => handleChange('departmentType', e.target.value)}
                  >
                    <MenuItem value="">Select Type</MenuItem>
                    {departmentTypeOptions.map((type) => (
                      <MenuItem key={type} value={type}>
                        {type}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Locations */}
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={locations}
                  getOptionLabel={(option) => option.nickname || option.name || option.id}
                  value={form.locations}
                  onChange={(_, newValue) => handleChange('locations', newValue.map(l => l.id))}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Locations"
                      placeholder="Select locations for this department"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((locationId, index) => {
                      const location = locations.find(l => l.id === locationId);
                      return (
                        <Chip
                          key={locationId}
                          label={location ? (location.nickname || location.name || locationId) : locationId}
                          {...getTagProps({ index })}
                        />
                      );
                    })
                  }
                />
              </Grid>

              {/* Primary Contact */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Primary Contact</InputLabel>
                  <Select
                    value={form.primaryContact}
                    label="Primary Contact"
                    onChange={(e) => handleChange('primaryContact', e.target.value)}
                  >
                    <MenuItem value="">Select Contact</MenuItem>
                    {workforce.map((contact) => (
                      <MenuItem key={contact.id} value={contact.id}>
                        {contact.firstName} {contact.lastName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Cost Center Code */}
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Cost Center Code"
                  fullWidth
                  value={form.costCenterCode}
                  onChange={(e) => handleChange('costCenterCode', e.target.value)}
                  placeholder="e.g., CC001, WAREHOUSE_EB"
                />
              </Grid>

              {/* Status and Tags */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Active Status</InputLabel>
                  <Select
                    value={form.status}
                    label="Active Status"
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
                      placeholder="e.g., night shift, forklift, temp heavy"
                    />
                  )}
                />
              </Grid>

              {/* External Sync IDs */}
              <Grid item xs={12}>
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
                          placeholder="e.g., workdayDeptId"
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          label="ID"
                          value={externalIdValue}
                          onChange={(e) => setExternalIdValue(e.target.value)}
                          placeholder="e.g., WD123"
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

              {/* Submit Buttons */}
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Add Department'}
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
                  indeterminate={selectedRows.length > 0 && selectedRows.length < departments.length}
                  checked={selectedRows.length === departments.length && departments.length > 0}
                  onChange={handleSelectAll}
                />
              </TableCell>
              {/* Name */}
              <TableCell sortDirection={orderBy === 'name' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => handleRequestSort('name')}
                >
                  Department Name
                </TableSortLabel>
              </TableCell>
              {/* Custom ID */}
              <TableCell sortDirection={orderBy === 'customId' ? order : false}>
                <TableSortLabel
                  active={orderBy === 'customId'}
                  direction={orderBy === 'customId' ? order : 'asc'}
                  onClick={() => handleRequestSort('customId')}
                >
                  Custom ID
                </TableSortLabel>
              </TableCell>
              {/* Department Type */}
              <TableCell>Department Type</TableCell>
              {/* Division */}
              <TableCell>Division</TableCell>
              {/* Locations */}
              <TableCell>Locations</TableCell>
              {/* Status */}
              <TableCell>Status</TableCell>
              {/* External Sync IDs */}
              <TableCell>External IDs</TableCell>
              {/* Actions */}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedDepartments.map((dept) => (
              <TableRow
                key={dept.id}
                hover
                style={{ cursor: editingId === dept.id ? 'default' : 'pointer' }}
                onClick={() => editingId !== dept.id && navigate(`/tenants/${tenantId}/departments/${dept.id}`)}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedRows.includes(dept.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleRowSelect(dept.id);
                    }}
                  />
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <TextField
                      size="small"
                      value={editForm.name}
                      onChange={(e) => handleEditChange('name', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    dept.name
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <TextField
                      size="small"
                      value={editForm.customId}
                      onChange={(e) => handleEditChange('customId', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    dept.customId || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.departmentType}
                        onChange={(e) => handleEditChange('departmentType', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem value="">Select Type</MenuItem>
                        {departmentTypeOptions.map((type) => (
                          <MenuItem key={type} value={type}>
                            {type}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    dept.departmentType || '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.division}
                        onChange={(e) => handleEditChange('division', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuItem value="">Select Division</MenuItem>
                        {divisions.map((division) => (
                          <MenuItem key={division.id} value={division.id}>
                            {division.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    dept.division ? divisions.find(d => d.id === dept.division)?.name || '-' : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <Autocomplete
                      multiple
                      size="small"
                      options={locations}
                      getOptionLabel={(option) => option.nickname || option.name || option.id}
                      value={editForm.locations.map(id => locations.find(l => l.id === id)).filter(Boolean)}
                      onChange={(_, newValue) => handleEditChange('locations', newValue.map(l => l.id))}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          size="small"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    />
                  ) : (
                    dept.locations && dept.locations.length > 0 ? (
                      <Box>
                        {dept.locations.slice(0, 2).map((locationId: string) => {
                          const location = locations.find(l => l.id === locationId);
                          return (
                            <Typography key={locationId} variant="caption" display="block">
                              {location ? (location.nickname || location.name || locationId) : locationId}
                            </Typography>
                          );
                        })}
                        {dept.locations.length > 2 && (
                          <Typography variant="caption" color="textSecondary">
                            +{dept.locations.length - 2} more
                          </Typography>
                        )}
                      </Box>
                    ) : '-'
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
                    <FormControl size="small" fullWidth>
                      <Select
                        value={editForm.status}
                        onChange={(e) => handleEditChange('status', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
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
                      label={dept.status || 'Active'}
                      color={
                        dept.status === 'Active' ? 'success' :
                        dept.status === 'Inactive' ? 'warning' : 'default'
                      }
                      size="small"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === dept.id ? (
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
                              placeholder="e.g., workdayDeptId"
                              sx={{ flex: 1 }}
                            />
                            <TextField
                              size="small"
                              label="ID"
                              value={externalIdValue}
                              onChange={(e) => setExternalIdValue(e.target.value)}
                              placeholder="e.g., WD123"
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
                    dept.externalIds && Object.keys(dept.externalIds).length > 0 ? (
                      <Box>
                                                 {Object.entries(dept.externalIds).slice(0, 2).map(([key, value]) => (
                           <Typography key={key} variant="caption" display="block">
                             {key}: {String(value)}
                           </Typography>
                         ))}
                        {Object.keys(dept.externalIds).length > 2 && (
                          <Typography variant="caption" color="textSecondary">
                            +{Object.keys(dept.externalIds).length - 2} more
                          </Typography>
                        )}
                      </Box>
                    ) : '-'
                  )}
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={1}>
                    {editingId === dept.id ? (
                      <>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveEdit(dept.id);
                          }}
                        >
                          <SaveIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelEdit();
                          }}
                        >
                          <CancelIcon />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(dept);
                          }}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(dept.id);
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </>
                    )}
                  </Box>
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
              ? `Are you sure you want to delete ${selectedRows.length} selected department(s)? This action cannot be undone.`
              : 'Are you sure you want to delete this department? This action cannot be undone.'
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
          Department added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DepartmentsTab; 
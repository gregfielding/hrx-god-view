import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Switch,
  FormControlLabel,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Alert,
  Snackbar,
  CircularProgress,
  Autocomplete,
  Badge,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Assignment as AssignmentIcon,
  TrendingUp as TrendingUpIcon,
  Settings as SettingsIcon,
  Person as PersonIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
  Assessment as AssessmentIcon,
} from '@mui/icons-material';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import {
  KPIDefinition,
  KPIAssignment,
  CRMContact,
} from '../types/CRM';

interface KPIManagementProps {
  tenantId: string;
}

const KPIManagement: React.FC<KPIManagementProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<KPIDefinition[]>([]);
  const [assignments, setAssignments] = useState<KPIAssignment[]>([]);
  const [salespeople, setSalespeople] = useState<CRMContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKPIDialog, setShowKPIDialog] = useState(false);
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [editingKPI, setEditingKPI] = useState<KPIDefinition | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<KPIAssignment | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // KPI Form State
  const [kpiForm, setKpiForm] = useState({
    name: '',
    description: '',
    category: 'activity' as 'activity' | 'revenue' | 'conversion' | 'engagement' | 'efficiency',
    type: 'count' as 'count' | 'percentage' | 'currency' | 'duration' | 'score',
    target: 0,
    unit: '',
    frequency: 'daily' as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly',
    priority: 'medium' as 'low' | 'medium' | 'high',
    tags: [] as string[],
    aiSuggestions: true,
  });

  // Assignment Form State
  const [assignmentForm, setAssignmentForm] = useState({
    kpiId: '',
    salespersonId: '',
    target: 0,
    startDate: '',
    endDate: '',
    notes: '',
  });

  // Load KPIs and assignments
  useEffect(() => {
    if (!tenantId) return;

    const kpisRef = collection(db, 'tenants', tenantId, 'kpi_definitions');
    const assignmentsRef = collection(db, 'tenants', tenantId, 'kpi_assignments');
    const salespeopleRef = collection(db, 'tenants', tenantId, 'crm_contacts');

    // Listen for KPIs
    const kpisUnsubscribe = onSnapshot(kpisRef, (snapshot) => {
      const kpisData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPIDefinition));
      setKpis(kpisData);
    });

    // Listen for assignments
    const assignmentsUnsubscribe = onSnapshot(assignmentsRef, (snapshot) => {
      const assignmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KPIAssignment));
      setAssignments(assignmentsData);
    });

    // Load salespeople
    const loadSalespeople = async () => {
      try {
        const q = query(salespeopleRef, where('role', '==', 'salesperson'));
        const snapshot = await getDocs(q);
        const salespeopleData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
        setSalespeople(salespeopleData);
      } catch (err) {
        console.error('Error loading salespeople:', err);
      }
    };

    loadSalespeople();
    setLoading(false);

    return () => {
      kpisUnsubscribe();
      assignmentsUnsubscribe();
    };
  }, [tenantId]);

  const handleCreateKPI = () => {
    setEditingKPI(null);
    setKpiForm({
      name: '',
      description: '',
      category: 'activity',
      type: 'count',
      target: 0,
      unit: '',
      frequency: 'daily',
      priority: 'medium',
      tags: [],
      aiSuggestions: true,
    });
    setShowKPIDialog(true);
  };

  const handleEditKPI = (kpi: KPIDefinition) => {
    setEditingKPI(kpi);
    setKpiForm({
      name: kpi.name,
      description: kpi.description,
      category: kpi.category,
      type: kpi.type,
      target: kpi.target,
      unit: kpi.unit,
      frequency: kpi.frequency,
      priority: kpi.priority,
      tags: kpi.tags,
      aiSuggestions: kpi.aiSuggestions,
    });
    setShowKPIDialog(true);
  };

  const handleSaveKPI = async () => {
    try {
      const kpiData = {
        ...kpiForm,
        isActive: true,
        createdAt: editingKPI ? editingKPI.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (editingKPI) {
        await updateDoc(doc(db, 'tenants', tenantId, 'kpi_definitions', editingKPI.id), kpiData);
        setSuccess('KPI updated successfully');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'kpi_definitions'), kpiData);
        setSuccess('KPI created successfully');
      }

      setShowKPIDialog(false);
      setEditingKPI(null);
    } catch (err) {
      console.error('Error saving KPI:', err);
      setError('Failed to save KPI');
    }
  };

  const handleDeleteKPI = async (kpiId: string) => {
    if (!window.confirm('Are you sure you want to delete this KPI?')) return;

    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'kpi_definitions', kpiId));
      setSuccess('KPI deleted successfully');
    } catch (err) {
      console.error('Error deleting KPI:', err);
      setError('Failed to delete KPI');
    }
  };

  const handleAssignKPI = (kpi: KPIDefinition) => {
    setEditingAssignment(null);
    setAssignmentForm({
      kpiId: kpi.id,
      salespersonId: '',
      target: kpi.target,
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      notes: '',
    });
    setShowAssignmentDialog(true);
  };

  const handleEditAssignment = (assignment: KPIAssignment) => {
    setEditingAssignment(assignment);
    setAssignmentForm({
      kpiId: assignment.kpiId,
      salespersonId: assignment.salespersonId,
      target: assignment.target,
      startDate: assignment.startDate,
      endDate: assignment.endDate || '',
      notes: assignment.notes,
    });
    setShowAssignmentDialog(true);
  };

  const handleSaveAssignment = async () => {
    try {
      const kpi = kpis.find(k => k.id === assignmentForm.kpiId);
      const salesperson = salespeople.find(s => s.id === assignmentForm.salespersonId);

      if (!kpi || !salesperson) {
        setError('Invalid KPI or salesperson selection');
        return;
      }

      const assignmentData = {
        ...assignmentForm,
        salespersonName: salesperson.fullName,
        isActive: true,
        createdAt: editingAssignment ? editingAssignment.createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (editingAssignment) {
        await updateDoc(doc(db, 'tenants', tenantId, 'kpi_assignments', editingAssignment.id), assignmentData);
        setSuccess('Assignment updated successfully');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'kpi_assignments'), assignmentData);
        setSuccess('Assignment created successfully');
      }

      setShowAssignmentDialog(false);
      setEditingAssignment(null);
    } catch (err) {
      console.error('Error saving assignment:', err);
      setError('Failed to save assignment');
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!window.confirm('Are you sure you want to delete this assignment?')) return;

    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'kpi_assignments', assignmentId));
      setSuccess('Assignment deleted successfully');
    } catch (err) {
      console.error('Error deleting assignment:', err);
      setError('Failed to delete assignment');
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'activity': return <ScheduleIcon />;
      case 'revenue': return <TrendingUpIcon />;
      case 'conversion': return <AssessmentIcon />;
      case 'engagement': return <PersonIcon />;
      case 'efficiency': return <SettingsIcon />;
      default: return <AssessmentIcon />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'default';
    }
  };

  const getAssignmentCount = (kpiId: string) => {
    return assignments.filter(a => a.kpiId === kpiId && a.isActive).length;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          KPI Management
        </Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={handleCreateKPI}
        >
          Create KPI
        </Button>
      </Box>

      {/* KPI Definitions Table */}
      <Card sx={{ mb: 3 }}>
        <CardHeader
          title="KPI Definitions"
          subheader={`${kpis.length} KPIs defined`}
        />
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>KPI Name</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Frequency</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>AI Suggestions</TableCell>
                  <TableCell>Assignments</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {kpis.map((kpi) => (
                  <TableRow key={kpi.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {getCategoryIcon(kpi.category)}
                        <Box>
                          <Typography variant="body2" fontWeight="medium">
                            {kpi.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {kpi.description}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={kpi.category} 
                        size="small" 
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {kpi.target} {kpi.unit}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={kpi.frequency} 
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        label={kpi.priority} 
                        size="small" 
                        color={getPriorityColor(kpi.priority)}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip 
                        icon={kpi.aiSuggestions ? <CheckCircleIcon /> : <WarningIcon />}
                        label={kpi.aiSuggestions ? 'Enabled' : 'Disabled'} 
                        size="small"
                        color={kpi.aiSuggestions ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge badgeContent={getAssignmentCount(kpi.id)} color="primary">
                        <AssignmentIcon />
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton 
                          size="small" 
                          onClick={() => handleAssignKPI(kpi)}
                          title="Assign KPI"
                        >
                          <AssignmentIcon />
                        </IconButton>
                        <IconButton 
                          size="small" 
                          onClick={() => handleEditKPI(kpi)}
                          title="Edit KPI"
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton 
                          size="small" 
                          onClick={() => handleDeleteKPI(kpi.id)}
                          title="Delete KPI"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* KPI Assignments */}
      <Card>
        <CardHeader
          title="KPI Assignments"
          subheader={`${assignments.filter(a => a.isActive).length} active assignments`}
        />
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Salesperson</TableCell>
                  <TableCell>KPI</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>End Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {assignments.filter(a => a.isActive).map((assignment) => {
                  const kpi = kpis.find(k => k.id === assignment.kpiId);
                  return (
                    <TableRow key={assignment.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <PersonIcon />
                          <Typography variant="body2">
                            {assignment.salespersonName}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {kpi?.name || 'Unknown KPI'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {assignment.target} {kpi?.unit}
                        </Typography>
                      </TableCell>
                      <TableCell>{assignment.startDate}</TableCell>
                      <TableCell>{assignment.endDate || 'Ongoing'}</TableCell>
                      <TableCell>
                        <Chip 
                          label={assignment.isActive ? 'Active' : 'Inactive'} 
                          size="small"
                          color={assignment.isActive ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <IconButton 
                            size="small" 
                            onClick={() => handleEditAssignment(assignment)}
                            title="Edit Assignment"
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton 
                            size="small" 
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            title="Delete Assignment"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* KPI Dialog */}
      <Dialog open={showKPIDialog} onClose={() => setShowKPIDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingKPI ? 'Edit KPI' : 'Create New KPI'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="KPI Name"
                value={kpiForm.name}
                onChange={(e) => setKpiForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Daily Sales Calls"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select
                  value={kpiForm.category}
                  onChange={(e) => setKpiForm(prev => ({ ...prev, category: e.target.value as any }))}
                  label="Category"
                >
                  <MenuItem value="activity">Activity</MenuItem>
                  <MenuItem value="revenue">Revenue</MenuItem>
                  <MenuItem value="conversion">Conversion</MenuItem>
                  <MenuItem value="engagement">Engagement</MenuItem>
                  <MenuItem value="efficiency">Efficiency</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={kpiForm.description}
                onChange={(e) => setKpiForm(prev => ({ ...prev, description: e.target.value }))}
                multiline
                rows={2}
                placeholder="Describe what this KPI measures..."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={kpiForm.type}
                  onChange={(e) => setKpiForm(prev => ({ ...prev, type: e.target.value as any }))}
                  label="Type"
                >
                  <MenuItem value="count">Count</MenuItem>
                  <MenuItem value="percentage">Percentage</MenuItem>
                  <MenuItem value="currency">Currency</MenuItem>
                  <MenuItem value="duration">Duration</MenuItem>
                  <MenuItem value="score">Score</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Target Value"
                type="number"
                value={kpiForm.target}
                onChange={(e) => setKpiForm(prev => ({ ...prev, target: Number(e.target.value) }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Unit"
                value={kpiForm.unit}
                onChange={(e) => setKpiForm(prev => ({ ...prev, unit: e.target.value }))}
                placeholder="e.g., calls, emails, dollars"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Frequency</InputLabel>
                <Select
                  value={kpiForm.frequency}
                  onChange={(e) => setKpiForm(prev => ({ ...prev, frequency: e.target.value as any }))}
                  label="Frequency"
                >
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                  <MenuItem value="quarterly">Quarterly</MenuItem>
                  <MenuItem value="yearly">Yearly</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  value={kpiForm.priority}
                  onChange={(e) => setKpiForm(prev => ({ ...prev, priority: e.target.value as any }))}
                  label="Priority"
                >
                  <MenuItem value="low">Low</MenuItem>
                  <MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="high">High</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={kpiForm.tags}
                onChange={(_, newValue) => setKpiForm(prev => ({ ...prev, tags: newValue }))}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Tags"
                    placeholder="Add tags..."
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        variant="outlined"
                        label={option}
                        {...chipProps}
                      />
                    );
                  })
                }
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={kpiForm.aiSuggestions}
                    onChange={(e) => setKpiForm(prev => ({ ...prev, aiSuggestions: e.target.checked }))}
                  />
                }
                label="Enable AI task suggestions for this KPI"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowKPIDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveKPI} variant="contained">
            {editingKPI ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assignment Dialog */}
      <Dialog open={showAssignmentDialog} onClose={() => setShowAssignmentDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingAssignment ? 'Edit Assignment' : 'Assign KPI'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Salesperson</InputLabel>
                <Select
                  value={assignmentForm.salespersonId}
                  onChange={(e) => setAssignmentForm(prev => ({ ...prev, salespersonId: e.target.value }))}
                  label="Salesperson"
                >
                  {salespeople.map((person) => (
                    <MenuItem key={person.id} value={person.id}>
                      {person.fullName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Target Value"
                type="number"
                value={assignmentForm.target}
                onChange={(e) => setAssignmentForm(prev => ({ ...prev, target: Number(e.target.value) }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Start Date"
                type="date"
                value={assignmentForm.startDate}
                onChange={(e) => setAssignmentForm(prev => ({ ...prev, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="End Date (Optional)"
                type="date"
                value={assignmentForm.endDate}
                onChange={(e) => setAssignmentForm(prev => ({ ...prev, endDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                value={assignmentForm.notes}
                onChange={(e) => setAssignmentForm(prev => ({ ...prev, notes: e.target.value }))}
                multiline
                rows={2}
                placeholder="Additional notes for this assignment..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAssignmentDialog(false)}>Cancel</Button>
          <Button onClick={handleSaveAssignment} variant="contained">
            {editingAssignment ? 'Update' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Messages */}
      <Snackbar open={!!success} autoHideDuration={6000} onClose={() => setSuccess('')}>
        <Alert onClose={() => setSuccess('')} severity="success">
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert onClose={() => setError('')} severity="error">
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default KPIManagement; 
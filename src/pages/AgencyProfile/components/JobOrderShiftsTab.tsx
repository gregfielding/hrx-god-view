import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Card, CardContent, CardActions, Snackbar, Alert, MenuItem, FormControl, InputLabel, Select, Accordion, AccordionSummary, AccordionDetails, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Paper, Autocomplete, Chip } from '@mui/material';
import { collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, serverTimestamp, setDoc, query, where } from 'firebase/firestore';
import { db } from '../../../firebase';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNavigate } from 'react-router-dom';

const JobOrderShiftsTab: React.FC<{ agencyId: string; jobOrderId: string }> = ({ agencyId, jobOrderId }) => {
  const [form, setForm] = useState({
    title: '',
    description: '',
    jobTitle: '',
    startDate: '',
    endDate: '',
    staffRequested: '',
  });
  const [shifts, setShifts] = useState<any[]>([]);
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<any>(null);
  const [assignmentsMap, setAssignmentsMap] = useState<{ [shiftId: string]: any[] }>({});
  const navigate = useNavigate();

  useEffect(() => {
    fetchShifts();
    fetchJobTitles();
    fetchOrderNumber();
    fetchAllWorkers();
    // eslint-disable-next-line
  }, [agencyId, jobOrderId]);

  useEffect(() => {
    const fetchAllAssignments = async () => {
      if (shifts.length > 0) {
        const newMap: { [shiftId: string]: any[] } = {};
        for (const shift of shifts) {
          const q = query(collection(db, 'assignments'), where('shiftId', '==', shift.id));
          const snapshot = await getDocs(q);
          newMap[shift.id] = snapshot.docs.map(doc => ({ assignmentId: doc.id, ...doc.data() }));
        }
        setAssignmentsMap(newMap);
      }
    };
    fetchAllAssignments();
  }, [shifts, success]);

  const fetchShifts = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts');
      const snapshot = await getDocs(q);
      setShifts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch shifts');
    }
    setLoading(false);
  };

  const fetchJobTitles = async () => {
    try {
      const orderRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId);
      const orderSnap = await getDoc(orderRef);
      setJobTitles(orderSnap.exists() ? orderSnap.data().jobTitleIds || [] : []);
    } catch {}
  };

  const fetchOrderNumber = async () => {
    try {
      const orderRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId);
      const orderSnap = await getDoc(orderRef);
      if (orderSnap.exists()) {
        setOrderNumber(orderSnap.data().jobOrderId);
      }
    } catch {}
  };

  const fetchAllWorkers = async () => {
    try {
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setAllWorkers(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((user: any) => user.role === 'Worker' && user.agencyId === agencyId));
    } catch {}
  };

  const fetchApplicants = async (shiftId: string) => {
    try {
      const q = collection(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts', shiftId, 'applications');
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch {
      return [];
    }
  };

  const fetchAssignments = async (shiftId: string) => {
    try {
      const q = query(collection(db, 'assignments'), where('shiftId', '==', shiftId));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch {
      return [];
    }
  };

  const isFormValid = form.title && form.description && form.jobTitle && form.startDate && form.staffRequested;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts'), {
        ...form,
        staffRequested: Number(form.staffRequested),
        createdAt: serverTimestamp(),
      });
      setForm({ title: '', description: '', jobTitle: '', startDate: '', endDate: '', staffRequested: '' });
      setSuccess(true);
      fetchShifts();
    } catch (err: any) {
      setError(err.message || 'Failed to add shift');
    }
    setLoading(false);
  };

  const handleEdit = (shift: any) => {
    setEditId(shift.id);
    setEditForm({ ...shift });
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleEditSave = async () => {
    if (!editId) return;
    setLoading(true);
    setError('');
    try {
      const shiftRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts', editId);
      await updateDoc(shiftRef, { ...editForm, staffRequested: Number(editForm.staffRequested) });
      setEditId(null);
      setEditForm(null);
      setSuccess(true);
      fetchShifts();
    } catch (err: any) {
      setError(err.message || 'Failed to update shift');
    }
    setLoading(false);
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditForm(null);
  };

  const handleDelete = async (shiftId: string) => {
    setLoading(true);
    setError('');
    try {
      const shiftRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts', shiftId);
      await deleteDoc(shiftRef);
      setSuccess(true);
      fetchShifts();
    } catch (err: any) {
      setError(err.message || 'Failed to delete shift');
    }
    setLoading(false);
  };

  const handleAddAssignment = async (shiftId: string, worker: any) => {
    setLoading(true);
    try {
      // Prevent duplicate assignment
      const alreadyAssigned = (assignmentsMap[shiftId] || []).some((a: any) => a.userId === worker.id);
      if (alreadyAssigned) {
        setLoading(false);
        return;
      }
      // Fetch shift details
      const shiftRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts', shiftId);
      const shiftSnap = await getDoc(shiftRef);
      let shiftData: any = {};
      let worksiteName = '';
      if (shiftSnap.exists()) {
        shiftData = shiftSnap.data();
        // Fetch worksite nickname from the shift's customerId and worksiteId/locationId
        const worksiteId = shiftData.worksiteId || shiftData.locationId;
        if (shiftData.customerId && worksiteId) {
          const worksiteSnap = await getDoc(doc(db, 'customers', shiftData.customerId, 'locations', worksiteId));
          worksiteName = worksiteSnap.exists() ? worksiteSnap.data().nickname || worksiteSnap.data().title : worksiteId;
        }
      }
      await addDoc(collection(db, 'assignments'), {
        userId: worker.id,
        agencyId,
        jobOrderId,
        shiftId,
        firstName: worker.firstName,
        lastName: worker.lastName,
        email: worker.email,
        phone: worker.phone,
        role: worker.role,
        securityLevel: worker.securityLevel,
        departmentId: worker.departmentId,
        locationIds: worker.locationIds,
        status: 'Unconfirmed',
        assignedAt: serverTimestamp(),
        shiftTitle: shiftData.title || '',
        startDate: shiftData.startDate || '',
        endDate: shiftData.endDate || '',
        jobTitle: shiftData.jobTitle || '',
        worksiteName,
      });
      setSuccess(true);
      fetchShifts();
      setSelectedWorker(null);
    } catch (err: any) {
      setError(err.message || 'Failed to add assignment');
    }
    setLoading(false);
  };

  const handleRemoveAssignment = async (shiftId: string, userId: string) => {
    setLoading(true);
    setError('');
    if (!shiftId || !userId) {
      setError('Missing shift or user ID');
      setLoading(false);
      return;
    }
    try {
      const q = query(collection(db, 'assignments'), where('shiftId', '==', shiftId), where('userId', '==', userId));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        await deleteDoc(doc(db, 'assignments', snapshot.docs[0].id));
      }
      setSuccess(true);
      fetchShifts();
    } catch (err: any) {
      setError(err.message || 'Failed to remove assignment');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      {/* <Typography variant="h6" gutterBottom>Add Shift</Typography> */}
      <Typography variant="h6" gutterBottom>Shifts: Job Order {orderNumber || jobOrderId}</Typography>
      <form onSubmit={handleSubmit}>
        <Grid container spacing={2} mb={2}>
          <Grid item xs={12} sm={4}>
            <TextField label="Shift Title" fullWidth required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField label="Description" fullWidth required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} multiline />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              select
              label="Shift Job"
              fullWidth
              required
              value={form.jobTitle}
              onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))}
            >
              {jobTitles.map((title: string) => (
                <MenuItem key={title} value={title}>{title}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={2}>
            <TextField
              label="Start Date"
              type="date"
              fullWidth
              required
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <TextField
              label="End Date"
              type="date"
              fullWidth
              value={form.endDate}
              onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <TextField
              label="Staff Requested"
              type="number"
              fullWidth
              required
              value={form.staffRequested}
              onChange={e => setForm(f => ({ ...f, staffRequested: e.target.value }))}
            />
          </Grid>
          <Grid item xs={12}>
            <Button type="submit" variant="contained" color="primary" disabled={loading || !isFormValid}>
              {loading ? 'Adding...' : 'Add Shift'}
            </Button>
          </Grid>
        </Grid>
      </form>
      <Typography variant="h6" gutterBottom>Shifts</Typography>
      {shifts.map((shift) => (
        <Card key={shift.id} sx={{ mb: 3, width: '100%' }}>
          <CardContent>
            {editId === shift.id ? (
              <>
                <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={2}>
                  <Box sx={{ flex: 1 }}>
                    <TextField label="Title" value={editForm.title} onChange={e => handleEditChange('title', e.target.value)} fullWidth size="small" />
                    <TextField label="Description" value={editForm.description} onChange={e => handleEditChange('description', e.target.value)} fullWidth multiline minRows={2} sx={{ mt: 1 }} />
                  </Box>
                  <Box>
                    <Button size="small" variant="contained" onClick={handleEditSave} disabled={loading || !editForm.title || !editForm.description || !editForm.jobTitle || !editForm.startDate || !editForm.staffRequested}>Save</Button>
                    <Button size="small" onClick={handleEditCancel} sx={{ ml: 1 }}>Cancel</Button>
                  </Box>
                </Box>
                <Box display="flex" gap={2} mb={2}>
                  <TextField
                    select
                    label="Job Title"
                    value={editForm.jobTitle}
                    onChange={e => handleEditChange('jobTitle', e.target.value)}
                    sx={{ flex: 1 }}
                  >
                    {jobTitles.map((title: string) => (
                      <MenuItem key={title} value={title}>{title}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Start Date"
                    type="date"
                    value={editForm.startDate}
                    onChange={e => handleEditChange('startDate', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="End Date"
                    type="date"
                    value={editForm.endDate}
                    onChange={e => handleEditChange('endDate', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Staff Requested"
                    type="number"
                    value={editForm.staffRequested}
                    onChange={e => handleEditChange('staffRequested', e.target.value)}
                    sx={{ flex: 1 }}
                  />
                </Box>
              </>
            ) : (
              <>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                  <Box display="flex" alignItems="center" gap={2}>
                  <Typography variant="subtitle1" fontWeight={600}>{shift.title}</Typography>
                    
                    
                  </Box>
                  <Box>
                    
                    <Button size="small" variant="outlined" onClick={() => handleEdit(shift)}>Edit</Button>
                    <Button size="small" variant="outlined" color="error" onClick={() => handleDelete(shift.id)} sx={{ ml: 1, mr: 1 }} disabled={!!(assignmentsMap[shift.id]?.length > 0)}>Delete</Button>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel id={`shift-status-label-${shift.id}`}>Status</InputLabel>
                      <Select
                        labelId={`shift-status-label-${shift.id}`}
                        value={shift.status || 'Active'}
                        label="Status"
                        onChange={async (e) => {
                          setLoading(true);
                          try {
                            const shiftRef = doc(db, 'agencies', agencyId, 'jobOrders', jobOrderId, 'shifts', shift.id);
                            await updateDoc(shiftRef, { status: e.target.value });
                            fetchShifts();
                          } catch (err: any) {
                            setError(err.message || 'Failed to update shift status');
                          }
                          setLoading(false);
                        }}
                      >
                        <MenuItem value="Active">Active</MenuItem>
                        <MenuItem value="Cancelled">Cancelled</MenuItem>
                        <MenuItem value="Completed">Completed</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                </Box>
                <Typography variant="body2">Job Title: {shift.jobTitle}</Typography>
                <Typography variant="body2">Start Date: {shift.startDate}</Typography>
                <Typography variant="body2">End Date: {shift.endDate || 'Indefinite'}</Typography>
                <Typography variant="body2">Staff Requested: {(assignmentsMap[shift.id] || []).length}/{shift.staffRequested}</Typography>
                <Accordion sx={{ mt: 2 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Applicants & Assignments</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    {/* Applicants Table */}                    
                    <Typography variant="subtitle2" sx={{ mt: 2, mb:1 }}>Applications</Typography>
                    <TableContainer component={Paper} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, boxShadow: 'none', background: 'transparent', mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {/* Map over applicants here (fetchApplicants(shift.id)) */}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {/* Assignments Table */}
                    <Typography variant="subtitle2" sx={{ mt: 2, mb:1 }}>Assigned Workers</Typography>
                    <TableContainer component={Paper} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, boxShadow: 'none', background: 'transparent', mb: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>Phone</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>View</TableCell>
                            <TableCell>Remove</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(assignmentsMap[shift.id] || []).length === 0 ? (
                            <TableRow><TableCell colSpan={6}>No assigned workers.</TableCell></TableRow>
                          ) : (
                            assignmentsMap[shift.id].map((worker) => (
                              <TableRow key={worker.id}>
                                <TableCell>{worker.firstName} {worker.lastName}</TableCell>
                                <TableCell>{worker.email}</TableCell>
                                <TableCell>{worker.phone || '-'}</TableCell>
                                <TableCell>{worker.status || 'Unconfirmed'}</TableCell>
                                <TableCell>
                                  <Button size="small" variant="outlined" onClick={() => navigate(`/users/${worker.userId || worker.id}`)}>View</Button>
                                </TableCell>
                                <TableCell>
                                  <Button size="small" variant="outlined" color="error" onClick={() => handleRemoveAssignment(shift.id, worker.id)}>
                                    Remove
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {/* Add Worker to Shift */}
                    <Box display="flex" gap={2} mb={2}>
                      {(() => {
                        const assignedIds = (assignmentsMap[shift.id] || []).map((a: any) => a.userId);
                        const availableWorkers = allWorkers.filter((w: any) => !assignedIds.includes(w.id));
                        return (
                          <>
                            <Autocomplete
                              options={availableWorkers}
                              getOptionLabel={w => `${w.firstName} ${w.lastName}`}
                              value={selectedWorker}
                              onChange={(_, newValue) => setSelectedWorker(newValue)}
                              renderInput={(params) => (
                                <TextField {...params} label="Add Worker to Shift" fullWidth />
                              )}
                              sx={{ flex: 2 }}
                            />
                            <Button variant="contained" onClick={() => selectedWorker && handleAddAssignment(shift.id, selectedWorker)} disabled={!selectedWorker || loading}>Add</Button>
                          </>
                        );
                      })()}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </CardContent>
        </Card>
      ))}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Shift updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default JobOrderShiftsTab; 
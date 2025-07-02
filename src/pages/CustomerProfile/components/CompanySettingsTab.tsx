import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert, IconButton } from '@mui/material';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AgencyTab from './AgencyTab';

interface CompanySettingsTabProps {
  customerId: string;
}

const CompanySettingsTab: React.FC<CompanySettingsTabProps> = ({ customerId }) => {
  const [form, setForm] = useState({ name: '', code: '' });
  const [departments, setDepartments] = useState<any[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchDepartments();
    // eslint-disable-next-line
  }, [customerId]);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'customers', customerId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch departments');
    }
    setLoading(false);
  };

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'customers', customerId, 'departments'), {
        name: form.name,
        code: form.code,
      });
      setForm({ name: '', code: '' });
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to add department');
    }
    setLoading(false);
  };

  const handleEdit = (dept: any) => {
    setEditId(dept.id);
    setEditForm({ name: dept.name, code: dept.code || '' });
  };

  const handleEditSave = async () => {
    if (!editId) return;
    setLoading(true);
    setError('');
    try {
      const deptRef = doc(db, 'customers', customerId, 'departments', editId);
      await updateDoc(deptRef, { name: editForm.name, code: editForm.code });
      setEditId(null);
      setEditForm({ name: '', code: '' });
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to update department');
    }
    setLoading(false);
  };

  const handleDelete = async (deptId: string) => {
    setLoading(true);
    setError('');
    try {
      const deptRef = doc(db, 'customers', customerId, 'departments', deptId);
      await deleteDoc(deptRef);
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to delete department');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      {!showForm && (
        <Button variant="contained" color="primary" sx={{ mb: 2 }} onClick={() => setShowForm(true)}>
          Create New Department
        </Button>
      )}
      {showForm && (
        <>
          <Typography variant="h6" gutterBottom>Company Departments</Typography>
          <form onSubmit={handleSubmit}>
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Department Name" fullWidth required value={form.name} onChange={e => handleChange('name', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Department Code" fullWidth value={form.code} onChange={e => handleChange('code', e.target.value)} />
              </Grid>
              <Grid item xs={12} display="flex" gap={2}>
                <Button type="submit" variant="contained" color="primary" disabled={loading || !form.name}>
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
      <Typography variant="h6" gutterBottom>Departments</Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Code</TableCell>
              <TableCell>Edit</TableCell>
              <TableCell>Delete</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.length === 0 ? (
              <TableRow><TableCell colSpan={4}>No departments yet.</TableCell></TableRow>
            ) : (
              departments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>
                    {editId === dept.id ? (
                      <TextField value={editForm.name} onChange={e => handleEditChange('name', e.target.value)} required size="small" />
                    ) : (
                      dept.name
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === dept.id ? (
                      <TextField value={editForm.code} onChange={e => handleEditChange('code', e.target.value)} size="small" />
                    ) : (
                      dept.code || '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === dept.id ? (
                      <Button size="small" variant="contained" onClick={handleEditSave} disabled={loading || !editForm.name}>Save</Button>
                    ) : (
                      <IconButton onClick={() => handleEdit(dept)}><EditIcon /></IconButton>
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton color="error" onClick={() => handleDelete(dept.id)}><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="h6" gutterBottom>Associated Agency</Typography>
      <AgencyTab customerId={customerId} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Department updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default CompanySettingsTab; 
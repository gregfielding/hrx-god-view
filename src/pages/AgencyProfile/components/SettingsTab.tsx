import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Snackbar,
  Alert,
  Stack,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Grid,
  MenuItem,
  Select,
} from '@mui/material';
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import IconButton from '@mui/material/IconButton';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';



function SettingsTab({ tenantId }: { tenantId: string }) {
  const [deptForm, setDeptForm] = useState({ name: '', code: '' });
  const [departments, setDepartments] = useState<any[]>([]);
  const [editDeptId, setEditDeptId] = useState<string | null>(null);
  const [editDeptForm, setEditDeptForm] = useState({ name: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDepartments();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'tenants', tenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch departments');
    }
    setLoading(false);
  };





  const handleDeptChange = (field: string, value: string) => {
    setDeptForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDeptEditChange = (field: string, value: string) => {
    setEditDeptForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await addDoc(collection(db, 'tenants', tenantId, 'departments'), {
        name: deptForm.name,
        code: deptForm.code,
      });
      setDeptForm({ name: '', code: '' });
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to add department');
    }
    setLoading(false);
  };

  const handleDeptEdit = (dept: any) => {
    setEditDeptId(dept.id);
    setEditDeptForm({ name: dept.name, code: dept.code || '' });
  };

  const handleDeptEditSave = async () => {
    if (!editDeptId) return;
    setLoading(true);
    setError('');
    try {
      const deptRef = doc(db, 'tenants', tenantId, 'departments', editDeptId);
      await updateDoc(deptRef, { name: editDeptForm.name, code: editDeptForm.code });
      setEditDeptId(null);
      setEditDeptForm({ name: '', code: '' });
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to update department');
    }
    setLoading(false);
  };

  const handleDeptDelete = async (deptId: string) => {
    setLoading(true);
    setError('');
    try {
      const deptRef = doc(db, 'tenants', tenantId, 'departments', deptId);
      await deleteDoc(deptRef);
      setSuccess(true);
      fetchDepartments();
    } catch (err: any) {
      setError(err.message || 'Failed to delete department');
    }
    setLoading(false);
  };



  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* <Typography mb={3} variant="h6" gutterBottom>
        Agency Settings
      </Typography> */}
      <hr style={{ margin: '32px 0' }} />
      <Box mb={3}>
        <Typography variant="h6" gutterBottom>
          Agency Departments
        </Typography>
        <form onSubmit={handleDeptSubmit}>
          <Grid container spacing={2} mb={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Department Name"
                fullWidth
                required
                value={deptForm.name}
                onChange={(e) => handleDeptChange('name', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Department Code"
                fullWidth
                value={deptForm.code}
                onChange={(e) => handleDeptChange('code', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={loading || !deptForm.name}
              >
                {loading ? 'Adding...' : 'Add Department'}
              </Button>
            </Grid>
          </Grid>
        </form>
        {/* <Typography variant="h6" gutterBottom>Departments</Typography> */}
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
                <TableRow>
                  <TableCell colSpan={4}>No departments yet.</TableCell>
                </TableRow>
              ) : (
                departments.map((dept) => (
                  <TableRow key={dept.id}>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <TextField
                          value={editDeptForm.name}
                          onChange={(e) => handleDeptEditChange('name', e.target.value)}
                          required
                          size="small"
                        />
                      ) : (
                        dept.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <TextField
                          value={editDeptForm.code}
                          onChange={(e) => handleDeptEditChange('code', e.target.value)}
                          size="small"
                        />
                      ) : (
                        dept.code || '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleDeptEditSave}
                          disabled={loading || !editDeptForm.name}
                        >
                          Save
                        </Button>
                      ) : (
                        <IconButton onClick={() => handleDeptEdit(dept)}>
                          <EditIcon />
                        </IconButton>
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton color="error" onClick={() => handleDeptDelete(dept.id)}>
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Departments updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SettingsTab;

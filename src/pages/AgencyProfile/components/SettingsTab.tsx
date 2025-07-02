import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Chip, Snackbar, Alert, Stack, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Paper, Grid } from '@mui/material';
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import IconButton from '@mui/material/IconButton';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const SettingsTab: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  const [jobTitleInput, setJobTitleInput] = useState('');
  const [jobDescriptionInput, setJobDescriptionInput] = useState('');
  const [jobTitles, setJobTitles] = useState<{ title: string; description: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [uniformTitleInput, setUniformTitleInput] = useState('');
  const [uniformDescriptionInput, setUniformDescriptionInput] = useState('');
  const [uniformDefaults, setUniformDefaults] = useState<{ title: string; description: string; imageUrl?: string }[]>([]);
  const [editUniformId, setEditUniformId] = useState<string | null>(null);
  const [editUniformForm, setEditUniformForm] = useState({ title: '', description: '' });
  const [uniformImage, setUniformImage] = useState<File | null>(null);
  const [deptForm, setDeptForm] = useState({ name: '', code: '' });
  const [departments, setDepartments] = useState<any[]>([]);
  const [editDeptId, setEditDeptId] = useState<string | null>(null);
  const [editDeptForm, setEditDeptForm] = useState({ name: '', code: '' });
  const storage = getStorage();

  useEffect(() => {
    fetchJobTitles();
    fetchUniformDefaults();
    fetchDepartments();
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchJobTitles = async () => {
    setLoading(true);
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      if (snap.exists()) {
        setJobTitles(snap.data().jobTitles || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job titles');
    }
    setLoading(false);
  };

  const fetchUniformDefaults = async () => {
    setLoading(true);
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const snap = await getDoc(settingsRef);
      if (snap.exists()) {
        setUniformDefaults(snap.data().uniformDefaults || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch uniform defaults');
    }
    setLoading(false);
  };

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'agencies', agencyId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch departments');
    }
    setLoading(false);
  };

  const handleAddJobTitle = async () => {
    if (!jobTitleInput.trim()) return;
    setLoading(true);
    setError('');
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newTitles = [...jobTitles, { title: jobTitleInput.trim(), description: jobDescriptionInput.trim() }];
      await setDoc(settingsRef, { jobTitles: newTitles }, { merge: true });
      setJobTitles(newTitles);
      setJobTitleInput('');
      setJobDescriptionInput('');
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add job title');
    }
    setLoading(false);
  };

  const handleDeleteJobTitle = async (title: string) => {
    setLoading(true);
    setError('');
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newTitles = jobTitles.filter(t => t.title !== title);
      await setDoc(settingsRef, { jobTitles: newTitles }, { merge: true });
      setJobTitles(newTitles);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to delete job title');
    }
    setLoading(false);
  };

  const handleEdit = (job: any) => {
    setEditId(job.title);
    setEditForm({ title: job.title, description: job.description });
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSave = async () => {
    if (!editId) return;
    setLoading(true);
    setError('');
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newTitles = jobTitles.map(j =>
        j.title === editId ? { title: editForm.title, description: editForm.description } : j
      );
      await setDoc(settingsRef, { jobTitles: newTitles }, { merge: true });
      setJobTitles(newTitles);
      setEditId(null);
      setEditForm({ title: '', description: '' });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update job title');
    }
    setLoading(false);
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditForm({ title: '', description: '' });
  };

  const handleAddUniform = async () => {
    if (!uniformTitleInput.trim()) return;
    setLoading(true);
    setError('');
    try {
      let imageUrl = '';
      if (uniformImage) {
        const fileRef = storageRef(storage, `agencies/${agencyId}/uniforms/${Date.now()}_${uniformImage.name}`);
        await uploadBytes(fileRef, uniformImage);
        imageUrl = await getDownloadURL(fileRef);
      }
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newUniforms = [...uniformDefaults, { title: uniformTitleInput.trim(), description: uniformDescriptionInput.trim(), imageUrl }];
      await setDoc(settingsRef, { uniformDefaults: newUniforms }, { merge: true });
      setUniformDefaults(newUniforms);
      setUniformTitleInput('');
      setUniformDescriptionInput('');
      setUniformImage(null);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add uniform default');
    }
    setLoading(false);
  };

  const handleDeleteUniform = async (title: string) => {
    setLoading(true);
    setError('');
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newUniforms = uniformDefaults.filter(t => t.title !== title);
      await setDoc(settingsRef, { uniformDefaults: newUniforms }, { merge: true });
      setUniformDefaults(newUniforms);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to delete uniform default');
    }
    setLoading(false);
  };

  const handleEditUniform = (uniform: any) => {
    setEditUniformId(uniform.title);
    setEditUniformForm({ title: uniform.title, description: uniform.description });
  };

  const handleEditUniformChange = (field: string, value: string) => {
    setEditUniformForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditUniformSave = async () => {
    if (!editUniformId) return;
    setLoading(true);
    setError('');
    try {
      const settingsRef = doc(db, 'agencies', agencyId, 'settings', 'main');
      const newUniforms = uniformDefaults.map(j =>
        j.title === editUniformId ? { title: editUniformForm.title, description: editUniformForm.description } : j
      );
      await setDoc(settingsRef, { uniformDefaults: newUniforms }, { merge: true });
      setUniformDefaults(newUniforms);
      setEditUniformId(null);
      setEditUniformForm({ title: '', description: '' });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update uniform default');
    }
    setLoading(false);
  };

  const handleEditUniformCancel = () => {
    setEditUniformId(null);
    setEditUniformForm({ title: '', description: '' });
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
      await addDoc(collection(db, 'agencies', agencyId, 'departments'), {
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
      const deptRef = doc(db, 'agencies', agencyId, 'departments', editDeptId);
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
      const deptRef = doc(db, 'agencies', agencyId, 'departments', deptId);
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
      <Typography mb={3} variant="h6" gutterBottom>Agency Settings</Typography>
      <Box mb={3}>
      <Typography variant="h6" gutterBottom>Positions We Staff</Typography>
        
        <Box display="flex" gap={2} mb={2}>
          <TextField
            label="Add Job Title"
            value={jobTitleInput}
            onChange={e => setJobTitleInput(e.target.value)}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Description"
            value={jobDescriptionInput}
            onChange={e => setJobDescriptionInput(e.target.value)}
            sx={{ flex: 2 }}
          />
          <Button variant="contained" onClick={handleAddJobTitle} disabled={!jobTitleInput.trim() || loading}>
            Add
          </Button>
        </Box>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Edit</TableCell>
                <TableCell>Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobTitles.length === 0 ? (
                <TableRow><TableCell colSpan={4}>No job titles yet.</TableCell></TableRow>
              ) : (
                jobTitles.map((job) => (
                  <TableRow key={job.title}>
                    <TableCell>
                      {editId === job.title ? (
                        <TextField value={editForm.title} onChange={e => handleEditChange('title', e.target.value)} size="small" />
                      ) : (
                        job.title
                      )}
                    </TableCell>
                    <TableCell>
                      {editId === job.title ? (
                        <TextField value={editForm.description} onChange={e => handleEditChange('description', e.target.value)} size="small" />
                      ) : (
                        job.description
                      )}
                    </TableCell>
                    <TableCell>
                      {editId === job.title ? (
                        <Button size="small" variant="contained" onClick={handleEditSave} disabled={loading || !editForm.title}>Save</Button>
                      ) : (
                        <IconButton onClick={() => handleEdit(job)}><EditIcon /></IconButton>
                      )}
                      {editId === job.title && (
                        <Button size="small" onClick={handleEditCancel} sx={{ ml: 1 }}>Cancel</Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton color="error" onClick={() => handleDeleteJobTitle(job.title)}><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
      <hr style={{ margin: '32px 0' }} />
      <Box mb={3}>
        <Typography mb={1} variant="subtitle1" fontWeight={600}>Uniform Defaults</Typography>
        <Box display="flex" gap={2} mb={2}>
          <TextField
            label="Add Uniform Title"
            value={uniformTitleInput}
            onChange={e => setUniformTitleInput(e.target.value)}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Description"
            value={uniformDescriptionInput}
            onChange={e => setUniformDescriptionInput(e.target.value)}
            sx={{ flex: 2 }}
          />
          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            disabled={loading}
            sx={{ flex: 1 }}
          >
            Upload Image
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={e => setUniformImage(e.target.files ? e.target.files[0] : null)}
            />
          </Button>
          <Button variant="contained" onClick={handleAddUniform} disabled={!uniformTitleInput.trim() || loading}>
            Add
          </Button>
        </Box>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Image</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Edit</TableCell>
                <TableCell>Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {uniformDefaults.length === 0 ? (
                <TableRow><TableCell colSpan={5}>No uniform defaults yet.</TableCell></TableRow>
              ) : (
                uniformDefaults.map((uniform) => (
                  <TableRow key={uniform.title}>
                    <TableCell>
                      {uniform.imageUrl ? (
                        <img src={uniform.imageUrl} alt={uniform.title} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {editUniformId === uniform.title ? (
                        <TextField value={editUniformForm.title} onChange={e => handleEditUniformChange('title', e.target.value)} size="small" />
                      ) : (
                        uniform.title
                      )}
                    </TableCell>
                    <TableCell>
                      {editUniformId === uniform.title ? (
                        <TextField value={editUniformForm.description} onChange={e => handleEditUniformChange('description', e.target.value)} size="small" />
                      ) : (
                        uniform.description
                      )}
                    </TableCell>
                    <TableCell>
                      {editUniformId === uniform.title ? (
                        <Button size="small" variant="contained" onClick={handleEditUniformSave} disabled={loading || !editUniformForm.title}>Save</Button>
                      ) : (
                        <IconButton onClick={() => handleEditUniform(uniform)}><EditIcon /></IconButton>
                      )}
                      {editUniformId === uniform.title && (
                        <Button size="small" onClick={handleEditUniformCancel} sx={{ ml: 1 }}>Cancel</Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton color="error" onClick={() => handleDeleteUniform(uniform.title)}><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
      <hr style={{ margin: '32px 0' }} />
      <Box mb={3}>
        <Typography variant="h6" gutterBottom>Agency Departments</Typography>
        <form onSubmit={handleDeptSubmit}>
          <Grid container spacing={2} mb={2}>
            <Grid item xs={12} sm={6}>
              <TextField label="Department Name" fullWidth required value={deptForm.name} onChange={e => handleDeptChange('name', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Department Code" fullWidth value={deptForm.code} onChange={e => handleDeptChange('code', e.target.value)} />
            </Grid>
            <Grid item xs={12}>
              <Button type="submit" variant="contained" color="primary" disabled={loading || !deptForm.name}>
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
                <TableRow><TableCell colSpan={4}>No departments yet.</TableCell></TableRow>
              ) : (
                departments.map((dept) => (
                  <TableRow key={dept.id}>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <TextField value={editDeptForm.name} onChange={e => handleDeptEditChange('name', e.target.value)} required size="small" />
                      ) : (
                        dept.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <TextField value={editDeptForm.code} onChange={e => handleDeptEditChange('code', e.target.value)} size="small" />
                      ) : (
                        dept.code || '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {editDeptId === dept.id ? (
                        <Button size="small" variant="contained" onClick={handleDeptEditSave} disabled={loading || !editDeptForm.name}>Save</Button>
                      ) : (
                        <IconButton onClick={() => handleDeptEdit(dept)}><EditIcon /></IconButton>
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton color="error" onClick={() => handleDeptDelete(dept.id)}><DeleteIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Job titles updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default SettingsTab; 
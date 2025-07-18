import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Snackbar,
  Alert,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  IconButton,
} from '@mui/material';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAuth } from '../../contexts/AuthContext';

const FlexDefaults: React.FC = () => {
  const { tenantId } = useAuth();
  const [uniformTitleInput, setUniformTitleInput] = useState('');
  const [uniformDescriptionInput, setUniformDescriptionInput] = useState('');
  const [uniformDefaults, setUniformDefaults] = useState<
    { id: string; title: string; description: string; imageUrl?: string }[]
  >([]);
  const [editUniformId, setEditUniformId] = useState<string | null>(null);
  const [editUniformForm, setEditUniformForm] = useState({ title: '', description: '' });
  const [uniformImage, setUniformImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [showAddUniform, setShowAddUniform] = useState(false);
  const storage = getStorage();

  useEffect(() => {
    if (tenantId) {
      fetchUniformDefaults();
    }
  }, [tenantId]);

  const fetchUniformDefaults = async () => {
    setLoading(true);
    try {
      // Try to get from hrx-flex module settings first
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      const flexDoc = await getDoc(flexModuleRef);
      
      if (flexDoc.exists() && flexDoc.data().uniformDefaults) {
        // If uniformDefaults exists in module settings, use that
        setUniformDefaults(flexDoc.data().uniformDefaults.map((item: any, index: number) => ({
          id: index.toString(),
          title: item.title || '',
          description: item.description || '',
          imageUrl: item.imageUrl
        })));
      } else {
        // Fallback to subcollection
        const uniformsCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'uniformDefaults');
        const snapshot = await getDocs(uniformsCollection);
        const uniforms = snapshot.docs.map((doc) => ({
          id: doc.id,
          title: doc.data().title || '',
          description: doc.data().description || '',
          imageUrl: doc.data().imageUrl
        }));
        setUniformDefaults(uniforms);
      }
    } catch (err: any) {
      console.error('Error fetching uniform defaults:', err);
      setError(err.message || 'Failed to fetch uniform defaults');
    }
    setLoading(false);
  };

  const handleAddUniform = async () => {
    if (!uniformTitleInput.trim() || !tenantId) return;
    setLoading(true);
    setError('');
    try {
      let imageUrl = '';
      if (uniformImage) {
        const fileRef = storageRef(
          storage,
          `tenants/${tenantId}/uniforms/${Date.now()}_${uniformImage.name}`,
        );
        await uploadBytes(fileRef, uniformImage);
        imageUrl = await getDownloadURL(fileRef);
      }

      const newUniform = {
        title: uniformTitleInput.trim(),
        description: uniformDescriptionInput.trim(),
        imageUrl,
      };

      // Try to add to subcollection first
      try {
        const uniformsCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'uniformDefaults');
        await addDoc(uniformsCollection, newUniform);
      } catch (subcollectionError) {
        // If subcollection fails, add to module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingUniforms = currentData.uniformDefaults || [];
        await setDoc(flexModuleRef, {
          ...currentData,
          uniformDefaults: [...existingUniforms, newUniform]
        }, { merge: true });
      }

      setUniformDefaults([...uniformDefaults, { ...newUniform, id: Date.now().toString() }]);
      setUniformTitleInput('');
      setUniformDescriptionInput('');
      setUniformImage(null);
      setShowAddUniform(false);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add uniform default');
    }
    setLoading(false);
  };

  const handleDeleteUniform = async (uniformId: string) => {
    setLoading(true);
    setError('');
    try {
      // Try to delete from subcollection first
      try {
        const uniformRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'uniformDefaults', uniformId);
        await deleteDoc(uniformRef);
      } catch (subcollectionError) {
        // If subcollection fails, update module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingUniforms = currentData.uniformDefaults || [];
        const updatedUniforms = existingUniforms.filter((_: any, index: number) => index.toString() !== uniformId);
        await setDoc(flexModuleRef, {
          ...currentData,
          uniformDefaults: updatedUniforms
        }, { merge: true });
      }

      setUniformDefaults(uniformDefaults.filter(u => u.id !== uniformId));
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to delete uniform default');
    }
    setLoading(false);
  };

  const handleEditUniform = (uniform: any) => {
    setEditUniformId(uniform.id);
    setEditUniformForm({ title: uniform.title, description: uniform.description });
  };

  const handleEditUniformChange = (field: string, value: string) => {
    setEditUniformForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditUniformSave = async () => {
    if (!editUniformId || !tenantId) return;
    setLoading(true);
    setError('');
    try {
      const updatedUniform = {
        title: editUniformForm.title,
        description: editUniformForm.description,
      };

      // Try to update in subcollection first
      try {
        const uniformRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'uniformDefaults', editUniformId);
        await updateDoc(uniformRef, updatedUniform);
      } catch (subcollectionError) {
        // If subcollection fails, update module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingUniforms = currentData.uniformDefaults || [];
        const updatedUniforms = existingUniforms.map((uniform: any, index: number) => 
          index.toString() === editUniformId ? { ...uniform, ...updatedUniform } : uniform
        );
        await setDoc(flexModuleRef, {
          ...currentData,
          uniformDefaults: updatedUniforms
        }, { merge: true });
      }

      setUniformDefaults(uniformDefaults.map(u => 
        u.id === editUniformId ? { ...u, ...updatedUniform } : u
      ));
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

  const handleCancelAddUniform = () => {
    setShowAddUniform(false);
    setUniformTitleInput('');
    setUniformDescriptionInput('');
    setUniformImage(null);
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          No tenant selected. Please select a tenant to continue.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Uniform Defaults
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage default uniform configurations for your workforce.
      </Typography>

      {!showAddUniform ? (
        <Button
          variant="contained"
          onClick={() => setShowAddUniform(true)}
          sx={{ mb: 3 }}
        >
          Add Uniform Default
        </Button>
      ) : (
        <Box sx={{ mb: 3, p: 3, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#fafafa' }}>
          <Typography variant="h6" gutterBottom>
            Add Uniform Default
          </Typography>
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Uniform Title"
              value={uniformTitleInput}
              onChange={(e) => setUniformTitleInput(e.target.value)}
              fullWidth
            />
            <TextField
              label="Description"
              value={uniformDescriptionInput}
              onChange={(e) => setUniformDescriptionInput(e.target.value)}
              multiline
              rows={3}
              fullWidth
            />
            <Button
              component="label"
              variant="outlined"
              startIcon={<CloudUploadIcon />}
              disabled={loading}
              sx={{ alignSelf: 'flex-start' }}
            >
              Upload Image
              <input
                type="file"
                hidden
                accept="image/*"
                onChange={(e) => setUniformImage(e.target.files ? e.target.files[0] : null)}
              />
            </Button>
            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleAddUniform}
                disabled={!uniformTitleInput.trim() || loading}
              >
                Add Uniform
              </Button>
              <Button
                variant="outlined"
                onClick={handleCancelAddUniform}
                disabled={loading}
              >
                Cancel
              </Button>
            </Box>
          </Box>
        </Box>
      )}

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
              <TableRow>
                <TableCell colSpan={5}>No uniform defaults yet.</TableCell>
              </TableRow>
            ) : (
              uniformDefaults.map((uniform) => (
                <TableRow key={uniform.id}>
                  <TableCell>
                    {uniform.imageUrl ? (
                      <img
                        src={uniform.imageUrl}
                        alt={uniform.title}
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {editUniformId === uniform.id ? (
                      <TextField
                        value={editUniformForm.title}
                        onChange={(e) => handleEditUniformChange('title', e.target.value)}
                        size="small"
                      />
                    ) : (
                      uniform.title
                    )}
                  </TableCell>
                  <TableCell>
                    {editUniformId === uniform.id ? (
                      <TextField
                        value={editUniformForm.description}
                        onChange={(e) => handleEditUniformChange('description', e.target.value)}
                        size="small"
                      />
                    ) : (
                      uniform.description
                    )}
                  </TableCell>
                  <TableCell>
                    {editUniformId === uniform.id ? (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleEditUniformSave}
                        disabled={loading || !editUniformForm.title}
                      >
                        Save
                      </Button>
                    ) : (
                      <IconButton onClick={() => handleEditUniform(uniform)}>
                        <EditIcon />
                      </IconButton>
                    )}
                    {editUniformId === uniform.id && (
                      <Button size="small" onClick={handleEditUniformCancel} sx={{ ml: 1 }}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton color="error" onClick={() => handleDeleteUniform(uniform.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Uniform defaults updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default FlexDefaults; 
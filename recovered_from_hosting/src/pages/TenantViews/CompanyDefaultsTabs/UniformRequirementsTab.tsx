import React, { useEffect, useState } from 'react';
import { Box, Typography, Stack, TextField, Button, IconButton, Paper } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../firebase';

interface UniformRequirementsTabProps {
  tenantId: string;
}

type UniformRequirement = { title: string; description: string; imageUrl?: string };

type Defaults = {
  uniformRequirements: UniformRequirement[];
};

const DEFAULTS_DOC_ID = 'company-defaults';

const emptyDefaults: Defaults = {
  uniformRequirements: [
    { title: 'Steel Toe Boots', description: 'Employee provides steel toe boots' },
  ],
};

const UniformRequirementsTab: React.FC<UniformRequirementsTabProps> = ({ tenantId }) => {
  const [defaults, setDefaults] = useState<Defaults>(emptyDefaults);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);

  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const docRef = doc(db, 'tenants', tenantId, 'settings', DEFAULTS_DOC_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as Defaults;
          setDefaults({ ...emptyDefaults, ...data });
        }
      } catch (error) {
        console.error('Error loading defaults:', error);
      }
    };
    loadDefaults();
  }, [tenantId]);

  const uploadImageIfNeeded = async (): Promise<string | undefined> => {
    if (!file) return undefined;
    const path = `tenants/${tenantId}/settings/uniforms/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    return url;
  };

  const handleAdd = async () => {
    if (!title.trim()) return;
    const imageUrl = await uploadImageIfNeeded();
    const newItem: UniformRequirement = { 
      title: title.trim(), 
      description: description.trim(), 
      imageUrl 
    };
    const updatedDefaults = {
      ...defaults,
      uniformRequirements: [...defaults.uniformRequirements, newItem]
    };
    setDefaults(updatedDefaults);
    setTitle('');
    setDescription('');
    setFile(null);
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleRemove = async (index: number) => {
    const updatedDefaults = {
      ...defaults,
      uniformRequirements: defaults.uniformRequirements.filter((_, i) => i !== index)
    };
    setDefaults(updatedDefaults);
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleEdit = (index: number) => {
    const item = defaults.uniformRequirements[index];
    setEditingIndex(index);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditFile(null);
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null) return;
    
    const imageUrl = editFile ? await uploadImageIfNeeded() : defaults.uniformRequirements[editingIndex].imageUrl;
    
    const updatedItems = [...defaults.uniformRequirements];
    updatedItems[editingIndex] = {
      title: editTitle.trim(),
      description: editDescription.trim(),
      imageUrl
    };
    
    const updatedDefaults = {
      ...defaults,
      uniformRequirements: updatedItems
    };
    
    setDefaults(updatedDefaults);
    setEditingIndex(null);
    setEditTitle('');
    setEditDescription('');
    setEditFile(null);
    
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditTitle('');
    setEditDescription('');
    setEditFile(null);
  };

  const handleSave = async (updatedDefaults?: Defaults) => {
    setSaving(true);
    try {
      const docRef = doc(db, 'tenants', tenantId, 'settings', DEFAULTS_DOC_ID);
      const dataToSave = updatedDefaults || defaults;
      await setDoc(docRef, dataToSave, { merge: true });
      console.log('✅ Saved to Firestore:', dataToSave);
    } catch (error) {
      console.error('❌ Error saving defaults:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      <Stack spacing={3}>
        <Typography variant="h6" fontWeight={700}>Uniform Requirements</Typography>
        
        <Stack spacing={2}>
          <TextField 
            size="small" 
            label="Title" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />
          <TextField 
            size="small" 
            label="Description" 
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
          <input 
            type="file" 
            accept="image/*" 
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ marginBottom: '8px' }}
          />
          <Button 
            variant="outlined" 
            startIcon={<AddIcon />} 
            onClick={handleAdd}
            disabled={!title.trim()}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add
          </Button>
        </Stack>

        <Stack spacing={1}>
          {defaults.uniformRequirements.map((item, index) => (
            <Paper key={`${item.title}-${index}`} variant="outlined" sx={{ p: 1.5 }}>
              {editingIndex === index ? (
                // Edit mode
                <Stack spacing={2}>
                  <TextField 
                    size="small" 
                    label="Title" 
                    value={editTitle} 
                    onChange={(e) => setEditTitle(e.target.value)}
                    fullWidth
                  />
                  <TextField 
                    size="small" 
                    label="Description" 
                    value={editDescription} 
                    onChange={(e) => setEditDescription(e.target.value)}
                    multiline
                    rows={3}
                    fullWidth
                  />
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                    style={{ marginBottom: '8px' }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button 
                      variant="contained" 
                      startIcon={<SaveIcon />} 
                      onClick={handleSaveEdit}
                      disabled={!editTitle.trim()}
                      size="small"
                    >
                      Save
                    </Button>
                    <Button 
                      variant="outlined" 
                      startIcon={<CancelIcon />} 
                      onClick={handleCancelEdit}
                      size="small"
                    >
                      Cancel
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                // Normal mode
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700}>{item.title}</Typography>
                    {item.description && (
                      <Typography variant="body2" color="text.secondary">{item.description}</Typography>
                    )}
                    {item.imageUrl && (
                      <Box mt={1}>
                        <img src={item.imageUrl} alt={item.title} style={{ maxHeight: 80, borderRadius: 4 }} />
                      </Box>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <IconButton 
                      size="small" 
                      onClick={() => handleEdit(index)}
                      color="primary"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="remove" onClick={() => handleRemove(index)} size="small">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              )}
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
};

export default UniformRequirementsTab;

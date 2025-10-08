import React, { useEffect, useState } from 'react';
import { Box, Typography, Stack, Divider, TextField, Button, IconButton, Paper } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { experienceOptions, educationOptions } from '../../../data/experienceOptions';

interface OptionTabProps {
  tenantId: string;
  sectionKey: keyof Defaults;
  title: string;
  titlePlaceholder: string;
  descriptionPlaceholder?: string;
}

type OptionItem = { title: string; description?: string };
type UniformRequirement = { title: string; description: string; imageUrl?: string };
type PolicyItem = { title: string; description: string; fileUrl?: string };

type Defaults = {
  screeningPanels: OptionItem[];
  backgroundPackages: OptionItem[];
  languages: OptionItem[];
  skills: OptionItem[];
  ppe: OptionItem[];
  licenses: OptionItem[];
  certifications: OptionItem[];
  experienceLevels: OptionItem[];
  educationLevels: OptionItem[];
  physicalRequirements: OptionItem[];
  uniformRequirements: UniformRequirement[];
  injuryPolicies: PolicyItem[];
};

const DEFAULTS_DOC_ID = 'company-defaults';

const asItems = (titles: string[]): OptionItem[] => titles.map(t => ({ title: t }));

const emptyDefaults: Defaults = {
  screeningPanels: asItems(['4-Panel', '5-Panel', '7-Panel', '10-Panel']),
  backgroundPackages: asItems(['County 7-year', 'Federal + County', 'Statewide']),
  languages: asItems(['English', 'Spanish', 'French', 'German', 'Mandarin', 'Portuguese']),
  skills: asItems(['Forklift', 'Packing', 'Shipping/Receiving', 'Data Entry']),
  ppe: asItems(['Hard Hat', 'Safety Glasses', 'Steel Toe Boots', 'Gloves']),
  licenses: asItems(['Driver License', 'Forklift Certification', 'TWIC Card']),
  certifications: asItems(['OSHA 10', 'OSHA 30', 'CPR/First Aid']),
  experienceLevels: experienceOptions.map(option => ({ title: option.label, description: option.description })),
  educationLevels: educationOptions.map(option => ({ title: option.label, description: option.description })),
  physicalRequirements: asItems(['Standing', 'Walking', 'Lifting 25 lbs', 'Lifting 50 lbs']),
  uniformRequirements: [
    { title: 'Steel Toe Boots', description: 'Employee provides steel toe boots' },
  ],
  injuryPolicies: [],
};

const OptionTab: React.FC<OptionTabProps> = ({ 
  tenantId, 
  sectionKey, 
  title, 
  titlePlaceholder, 
  descriptionPlaceholder = "Description (optional)" 
}) => {
  const [defaults, setDefaults] = useState<Defaults>(emptyDefaults);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

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

  const addItem = (key: keyof Defaults, title: string, description?: string) => {
    if (!title.trim()) return;
    const newItem: OptionItem = { title: title.trim(), description: description?.trim() };
    setDefaults(prev => ({
      ...prev,
      [key]: [...prev[key], newItem]
    }));
    setValue('');
    setDescription('');
  };

  const removeItem = (key: keyof Defaults, index: number) => {
    setDefaults(prev => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index)
    }));
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

  const handleAdd = async () => {
    const newItem: OptionItem = { title: value.trim(), description: description.trim() };
    const updatedDefaults = {
      ...defaults,
      [sectionKey]: [...(defaults[sectionKey] as OptionItem[]), newItem]
    };
    setDefaults(updatedDefaults);
    setValue('');
    setDescription('');
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleRemove = async (index: number) => {
    const updatedDefaults = {
      ...defaults,
      [sectionKey]: (defaults[sectionKey] as OptionItem[]).filter((_, i) => i !== index)
    };
    setDefaults(updatedDefaults);
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleEdit = (index: number) => {
    const item = items[index];
    setEditingIndex(index);
    setEditTitle(item.title);
    setEditDescription(item.description || '');
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null) return;
    
    const updatedItems = [...items];
    updatedItems[editingIndex] = {
      title: editTitle.trim(),
      description: editDescription.trim()
    };
    
    const updatedDefaults = {
      ...defaults,
      [sectionKey]: updatedItems
    };
    
    setDefaults(updatedDefaults);
    setEditingIndex(null);
    setEditTitle('');
    setEditDescription('');
    
    // Save with the updated data
    await handleSave(updatedDefaults);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditTitle('');
    setEditDescription('');
  };

  const items = defaults[sectionKey] as OptionItem[];

  return (
    <Box sx={{ p: 0 }}>
      <Stack spacing={3}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        
        <Stack spacing={2}>
          <TextField 
            size="small" 
            placeholder={titlePlaceholder} 
            value={value} 
            onChange={(e) => setValue(e.target.value)}
            fullWidth
          />
          <TextField 
            size="small" 
            placeholder={descriptionPlaceholder} 
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
          <Button 
            variant="outlined" 
            startIcon={<AddIcon />} 
            onClick={handleAdd}
            disabled={!value.trim()}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add
          </Button>
        </Stack>

        <Stack spacing={1}>
          {items.map((item, index) => (
            <Paper key={index} elevation={1} sx={{ p: 2 }}>
              {editingIndex === index ? (
                // Edit mode
                <Stack spacing={2}>
                  <TextField 
                    size="small" 
                    placeholder={titlePlaceholder} 
                    value={editTitle} 
                    onChange={(e) => setEditTitle(e.target.value)}
                    fullWidth
                  />
                  <TextField 
                    size="small" 
                    placeholder={descriptionPlaceholder} 
                    value={editDescription} 
                    onChange={(e) => setEditDescription(e.target.value)}
                    multiline
                    rows={3}
                    fullWidth
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
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="body1" fontWeight={500}>{item.title}</Typography>
                    {item.description && (
                      <Typography variant="body2" color="text.secondary">{item.description}</Typography>
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
                    <IconButton 
                      size="small" 
                      onClick={() => handleRemove(index)}
                      color="error"
                    >
                      <DeleteIcon />
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

export default OptionTab;

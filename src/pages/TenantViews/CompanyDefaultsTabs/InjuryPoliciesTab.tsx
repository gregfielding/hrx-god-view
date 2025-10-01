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

interface InjuryPoliciesTabProps {
  tenantId: string;
}

type Attachment = { 
  id: string; 
  title: string; 
  fileUrl: string; 
  fileName: string;
};

type WorkersCompInfo = {
  title: string;
  description: string;
  attachments: Attachment[];
};

type Defaults = {
  workersCompInfo: WorkersCompInfo;
};

const DEFAULTS_DOC_ID = 'company-defaults';

const emptyDefaults: Defaults = {
  workersCompInfo: {
    title: '',
    description: '',
    attachments: []
  },
};

const InjuryPoliciesTab: React.FC<InjuryPoliciesTabProps> = ({ tenantId }) => {
  const [defaults, setDefaults] = useState<Defaults>(emptyDefaults);
  const [saving, setSaving] = useState(false);
  const [attachmentTitle, setAttachmentTitle] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);

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

  const uploadAttachment = async (): Promise<string | undefined> => {
    if (!attachmentFile) return undefined;
    const path = `tenants/${tenantId}/settings/workers-comp/${Date.now()}_${attachmentFile.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, attachmentFile);
    return await getDownloadURL(ref);
  };

  const handleUpdateInstructions = async () => {
    const updatedDefaults = {
      ...defaults,
      workersCompInfo: {
        ...defaults.workersCompInfo,
        title: defaults.workersCompInfo.title,
        description: defaults.workersCompInfo.description
      }
    };
    setDefaults(updatedDefaults);
    await handleSave(updatedDefaults);
  };

  const handleAddAttachment = async () => {
    if (!attachmentTitle.trim() || !attachmentFile) return;
    
    const fileUrl = await uploadAttachment();
    if (!fileUrl) return;
    
    const newAttachment: Attachment = {
      id: Date.now().toString(),
      title: attachmentTitle.trim(),
      fileUrl,
      fileName: attachmentFile.name
    };
    
    const updatedDefaults = {
      ...defaults,
      workersCompInfo: {
        ...defaults.workersCompInfo,
        attachments: [...defaults.workersCompInfo.attachments, newAttachment]
      }
    };
    
    setDefaults(updatedDefaults);
    setAttachmentTitle('');
    setAttachmentFile(null);
    await handleSave(updatedDefaults);
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    const updatedDefaults = {
      ...defaults,
      workersCompInfo: {
        ...defaults.workersCompInfo,
        attachments: defaults.workersCompInfo.attachments.filter(att => att.id !== attachmentId)
      }
    };
    setDefaults(updatedDefaults);
    await handleSave(updatedDefaults);
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
      <Stack spacing={4}>
        <Typography variant="h6" fontWeight={700}>Workers Comp Info</Typography>
        
        {/* Instructions Section */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Instructions for Workers
          </Typography>
          <Stack spacing={2}>
            <TextField 
              size="small" 
              label="Title" 
              value={defaults.workersCompInfo.title} 
              onChange={(e) => setDefaults(prev => ({
                ...prev,
                workersCompInfo: { ...prev.workersCompInfo, title: e.target.value }
              }))}
              onBlur={handleUpdateInstructions}
              fullWidth
              placeholder="e.g., What to do if you're injured at work"
            />
            <TextField 
              size="small" 
              label="Description (HTML supported)" 
              value={defaults.workersCompInfo.description} 
              onChange={(e) => setDefaults(prev => ({
                ...prev,
                workersCompInfo: { ...prev.workersCompInfo, description: e.target.value }
              }))}
              onBlur={handleUpdateInstructions}
              multiline
              rows={6}
              fullWidth
              helperText="Use HTML tags like <p>, <br>, <strong>, <em> for formatting"
              placeholder="Enter detailed instructions for workers on what to do in case of injury..."
            />
          </Stack>
        </Paper>

        {/* Attachments Section */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Attachments
          </Typography>
          
          {/* Add Attachment Form */}
          <Stack spacing={2} sx={{ mb: 3 }}>
            <TextField 
              size="small" 
              label="Attachment Title" 
              value={attachmentTitle} 
              onChange={(e) => setAttachmentTitle(e.target.value)}
              fullWidth
              placeholder="e.g., Insurance Card, Incident Report Form"
            />
            <input 
              type="file" 
              onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              style={{ marginBottom: '8px' }}
            />
            <Button 
              variant="outlined" 
              startIcon={<AddIcon />} 
              onClick={handleAddAttachment}
              disabled={!attachmentTitle.trim() || !attachmentFile}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add Attachment
            </Button>
          </Stack>

          {/* Attachments List */}
          <Stack spacing={1}>
            {defaults.workersCompInfo.attachments.map((attachment) => (
              <Paper key={attachment.id} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>
                      {attachment.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {attachment.fileName}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button 
                      size="small" 
                      variant="outlined"
                      onClick={() => window.open(attachment.fileUrl, '_blank')}
                    >
                      View
                    </Button>
                    <IconButton 
                      size="small" 
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                </Box>
              </Paper>
            ))}
            {defaults.workersCompInfo.attachments.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No attachments added yet
              </Typography>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
};

export default InjuryPoliciesTab;

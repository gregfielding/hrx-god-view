import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  TextField,
  Button,
  IconButton,
} from '@mui/material';
import {
  Description as DescriptionIcon,
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format } from 'date-fns';

import { db, storage } from '../../firebase';
import { p } from '../../data/firestorePaths';

interface StaffInstructionCardProps {
  title: string;
  fieldKey: string; // e.g., 'parking', 'checkIn', 'uniform', etc.
  placeholder: string;
  uploadPlaceholder: string;
  jobOrder: any;
  jobOrderId: string;
  tenantId: string;
  userId: string;
  onRefresh: () => Promise<void>;
}

const StaffInstructionCard: React.FC<StaffInstructionCardProps> = ({
  title,
  fieldKey,
  placeholder,
  uploadPlaceholder,
  jobOrder,
  jobOrderId,
  tenantId,
  userId,
  onRefresh
}) => {
  const instructionData = jobOrder?.staffInstructions?.[fieldKey];
  const inputId = `${fieldKey}-file-label`;
  const [localText, setLocalText] = useState(instructionData?.text || '');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>(instructionData?.text || '');

  // Update local text when job order data changes (e.g. after refresh)
  useEffect(() => {
    const text = instructionData?.text || '';
    setLocalText(text);
    lastSavedRef.current = text;
  }, [instructionData?.text]);

  useEffect(() => {
    return () => flushPendingSave();
  }, []);

  const flushPendingSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  };

  const saveTextToFirestore = async (text: string) => {
    if (text === lastSavedRef.current) return;
    try {
      await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
        [`staffInstructions.${fieldKey}.text`]: text,
        updatedAt: new Date()
      });
      lastSavedRef.current = text;
      // Don't call onRefresh() here: it triggers a full fetch + setLoading(true) and
      // causes the page to flash/reload. Local state is already correct; Firestore is updated.
    } catch (error) {
      console.error(`Error saving ${fieldKey} instructions:`, error);
    }
  };

  const handleTextChange = (newText: string) => {
    setLocalText(newText);
    flushPendingSave();
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      saveTextToFirestore(newText);
    }, 1000);
  };

  const handleBlur = () => {
    flushPendingSave();
    saveTextToFirestore(localText);
  };

  return (
    <Card>
      <CardHeader 
        title={title} 
        titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Text Area - only show if placeholder is provided */}
          {placeholder && (
            <TextField
              fullWidth
              multiline
              rows={4}
              label="Instructions"
              placeholder={placeholder}
              value={localText}
              onChange={(e) => handleTextChange(e.target.value)}
              onBlur={handleBlur}
            />
          )}

          {/* File Upload Section */}
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Attachments
            </Typography>
            
            {/* Existing Files */}
            {instructionData?.files && instructionData.files.length > 0 && (
              <Box sx={{ mb: 2 }}>
                {instructionData.files.map((file: any, index: number) => (
                  <Box 
                    key={index}
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      p: 1.5, 
                      mb: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      bgcolor: 'grey.50'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                      <DescriptionIcon fontSize="small" color="primary" />
                      <Box>
                        <Typography variant="body2" fontWeight="medium">
                          {file.label || file.name || 'Unnamed File'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {file.name} • Uploaded {file.uploadedAt ? format(new Date(file.uploadedAt), 'MMM dd, yyyy') : 'Unknown date'}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => window.open(file.url, '_blank')}
                      >
                        View
                      </Button>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={async () => {
                          if (window.confirm('Delete this file?')) {
                            try {
                              const updatedFiles = instructionData.files.filter((_: any, i: number) => i !== index);
                              await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
                                [`staffInstructions.${fieldKey}.files`]: updatedFiles,
                                updatedAt: new Date()
                              });
                              // Reload job order
                              await onRefresh();
                            } catch (error) {
                              console.error('Error deleting file:', error);
                            }
                          }
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}

            {/* Upload New File */}
            <Box sx={{ p: 2, border: '2px dashed', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {uploadPlaceholder}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'flex-end' }}>
                <TextField
                  size="small"
                  label="File Label"
                  placeholder="e.g., Parking Map"
                  sx={{ flex: 1 }}
                  id={inputId}
                />
                <Button
                  variant="contained"
                  component="label"
                  size="small"
                  startIcon={<UploadIcon />}
                >
                  Upload File
                  <input
                    type="file"
                    hidden
                    accept=".pdf,.png,.jpg,.jpeg,.gif"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      
                      const labelInput = document.getElementById(inputId) as HTMLInputElement;
                      const label = labelInput?.value || file.name;
                      
                      try {
                        if (!tenantId || !jobOrderId) {
                          throw new Error('Missing tenantId or jobOrderId');
                        }
                        
                        // Upload to Firebase Storage
                        const storageRef = ref(storage, `job_orders/${jobOrderId}/staff_instructions/${fieldKey}/${Date.now()}_${file.name}`);
                        console.log('Uploading to:', storageRef.fullPath);
                        
                        await uploadBytes(storageRef, file);
                        const downloadURL = await getDownloadURL(storageRef);
                        console.log('File uploaded successfully, URL:', downloadURL);
                        
                        // Add to job order document
                        const newFile = {
                          name: file.name,
                          label: label,
                          url: downloadURL,
                          type: file.type,
                          size: file.size,
                          uploadedAt: new Date().toISOString(),
                          uploadedBy: userId
                        };
                        
                        const currentFiles = instructionData?.files || [];
                        await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
                          [`staffInstructions.${fieldKey}.files`]: [...currentFiles, newFile],
                          updatedAt: new Date()
                        });
                        console.log('File metadata saved to Firestore');
                        
                        // Clear label input and file input
                        if (labelInput) labelInput.value = '';
                        e.target.value = ''; // Reset file input
                        
                        // Reload job order
                        await onRefresh();
                      } catch (error: any) {
                        console.error(`Error uploading file to ${fieldKey}:`, error);
                        console.error('Error details:', {
                          message: error.message,
                          code: error.code,
                          name: error.name,
                          stack: error.stack
                        });
                        alert(`Failed to upload file: ${error.code || error.message || 'Unknown error'}`);
                      }
                    }}
                  />
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default StaffInstructionCard;


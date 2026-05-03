import React, { useState, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  IconButton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  Description as DescriptionIcon,
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format } from 'date-fns';

import { db, storage } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type { RecruiterAccount } from '../../types/recruiter/account';

export interface AccountOrderDefaultsCardProps {
  title: string;
  fieldKey: string;
  placeholder: string;
  uploadPlaceholder: string;
  account: RecruiterAccount | null;
  accountId: string;
  tenantId: string;
  userId: string;
  onRefresh: () => void | Promise<void>;
  /** When set, read effective from location then account and save to location_defaults (location override mode). */
  locationKey?: string;
  locationDefaults?: Record<string, unknown>;
  onRefreshLocation?: () => void | Promise<void>;
  /**
   * `flat` removes the outer Card (use inside another card/panel — e.g. Cascading Data → Staff Instructions).
   * Upload/table chrome is lighter (no dashed nest, minimal table frame).
   */
  variant?: 'card' | 'flat';
}

function formatFileSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function instructionTextToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.en === 'string') return o.en;
    if (typeof o.instructions === 'string') return o.instructions;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.text === 'object' && o.text !== null && typeof (o.text as Record<string, unknown>).en === 'string') {
      return (o.text as Record<string, unknown>).en as string;
    }
    return '';
  }
  return '';
}

const AccountOrderDefaultsCard: React.FC<AccountOrderDefaultsCardProps> = ({
  title,
  fieldKey,
  placeholder,
  uploadPlaceholder,
  account,
  accountId,
  tenantId,
  userId,
  onRefresh,
  locationKey,
  locationDefaults,
  onRefreshLocation,
  variant = 'card',
}) => {
  const isFlat = variant === 'flat';
  const sectionGap = isFlat ? 2 : 3;
  const locationStaff = (locationDefaults as any)?.orderDefaults?.staffInstructions;
  const accountStaff = account?.orderDefaults?.staffInstructions;
  const instructionData = locationStaff?.[fieldKey] ?? accountStaff?.[fieldKey];
  const isLocationMode = !!locationKey;
  const inputId = `account-${fieldKey}-file-label`;
  const rawValue = instructionData?.text ?? instructionData;
  const initialText = instructionTextToString(rawValue);
  const [localText, setLocalText] = useState(() => (typeof initialText === 'string' ? initialText : ''));
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const latestTextRef = useRef<string>(typeof initialText === 'string' ? initialText : '');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>(typeof initialText === 'string' ? initialText : '');

  useEffect(() => {
    const text = instructionTextToString(rawValue);
    const safe = typeof text === 'string' ? text : '';
    setLocalText(safe);
    latestTextRef.current = safe;
    lastSavedRef.current = safe;
  }, [instructionData?.text, instructionData]);

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
      if (isLocationMode && locationKey) {
        const locationRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
        await updateDoc(locationRef, {
          [`orderDefaults.staffInstructions.${fieldKey}.text`]: text,
          updatedAt: serverTimestamp(),
          updatedBy: userId || null,
        });
        lastSavedRef.current = text;
        setToast({ open: true, message: 'Saved (location override)', severity: 'success' });
        await onRefreshLocation?.();
      } else {
        await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
          [`orderDefaults.staffInstructions.${fieldKey}.text`]: text,
          updatedAt: serverTimestamp(),
        });
        lastSavedRef.current = text;
        setToast({ open: true, message: 'Saved', severity: 'success' });
        await onRefresh();
      }
    } catch (error: any) {
      console.error(`Error saving ${fieldKey} order defaults:`, error);
      setToast({ open: true, message: `Failed to save: ${error?.message || 'Permission denied'}`, severity: 'error' });
    }
  };

  const handleTextChange = (newText: string) => {
    setLocalText(newText);
    latestTextRef.current = newText;
    flushPendingSave();
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      saveTextToFirestore(newText);
    }, 1000);
  };

  const handleBlur = () => {
    flushPendingSave();
    const textToSave = latestTextRef.current ?? localText;
    saveTextToFirestore(textToSave);
  };

  const tableContainerSx = isFlat
    ? {
        mb: 2,
        maxWidth: '100%',
        overflowX: 'auto' as const,
      }
    : {
        mb: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        maxWidth: '100%',
        overflowX: 'auto' as const,
      };

  const uploadRegionSx = isFlat
    ? {
        pt: 2,
        mt: 0.5,
        borderTop: '1px solid',
        borderColor: 'divider',
      }
    : {
        p: 2,
        border: '2px dashed',
        borderColor: 'divider',
        borderRadius: 1,
      };

  const mainBody = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: sectionGap }}>
      {placeholder && (
        <TextField
          fullWidth
          multiline
          rows={isFlat ? 3 : 4}
          label="Instructions"
          placeholder={placeholder}
          value={localText}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
        />
      )}

      <Box>
        <Typography
          variant={isFlat ? 'caption' : 'subtitle2'}
          gutterBottom
          sx={{ fontWeight: 600, display: 'block', color: isFlat ? 'text.secondary' : undefined }}
        >
          Uploaded files
        </Typography>

        <TableContainer sx={tableContainerSx}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ bgcolor: isFlat ? 'action.hover' : 'grey.100' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Label</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>File name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Uploaded</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Size</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {instructionData?.files && instructionData.files.length > 0 ? (
                    instructionData.files.map((file: any, index: number) => (
                      <TableRow key={`${file.url ?? ''}-${index}`} hover>
                        <TableCell>{file.label || file.name || '—'}</TableCell>
                        <TableCell sx={{ maxWidth: 260 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <DescriptionIcon fontSize="small" color="primary" sx={{ flexShrink: 0 }} />
                            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                              {file.name || '—'}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {file.uploadedAt ? format(new Date(file.uploadedAt), 'MMM d, yyyy h:mm a') : '—'}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatFileSize(file.size)}</TableCell>
                        <TableCell align="right">
                          <Button size="small" variant="outlined" onClick={() => window.open(file.url, '_blank')}>
                            View
                          </Button>
                          <IconButton
                            size="small"
                            color="error"
                            aria-label="Delete file"
                            onClick={async () => {
                              if (!window.confirm('Delete this file?')) return;
                              try {
                                const updatedFiles = instructionData.files.filter((_: any, i: number) => i !== index);
                                if (isLocationMode && locationKey) {
                                  const locationRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
                                  await updateDoc(locationRef, {
                                    [`orderDefaults.staffInstructions.${fieldKey}.files`]: updatedFiles,
                                    updatedAt: serverTimestamp(),
                                    updatedBy: userId || null,
                                  });
                                  await onRefreshLocation?.();
                                } else {
                                  await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
                                    [`orderDefaults.staffInstructions.${fieldKey}.files`]: updatedFiles,
                                    updatedAt: serverTimestamp(),
                                  });
                                  await onRefresh();
                                }
                                setToast({ open: true, message: 'File removed', severity: 'success' });
                              } catch (error: any) {
                                console.error('Error deleting file:', error);
                                setToast({
                                  open: true,
                                  message: error?.message || 'Failed to delete file',
                                  severity: 'error',
                                });
                              }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          No files yet. Choose a file and click Upload File.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={uploadRegionSx}>
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
                  disabled={uploading}
                  startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <UploadIcon />}
                >
                  {uploading ? 'Uploading…' : 'Upload File'}
                  <input
                    type="file"
                    hidden
                    disabled={uploading}
                    accept=".pdf,.png,.jpg,.jpeg,.gif"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const labelInput = document.getElementById(inputId) as HTMLInputElement;
                      const label = labelInput?.value?.trim() || file.name;

                      try {
                        setUploading(true);
                        if (!tenantId || !accountId) throw new Error('Missing tenantId or accountId');

                        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const pathPrefix = isLocationMode && locationKey
                          ? `tenants/${tenantId}/accounts/${accountId}/location_defaults/${locationKey}/${fieldKey}`
                          : `tenants/${tenantId}/accounts/${accountId}/order_defaults/${fieldKey}`;
                        const storagePath = `${pathPrefix}/${Date.now()}_${safeName}`;
                        const storageRef = ref(storage, storagePath);

                        await uploadBytes(storageRef, file);
                        const downloadURL = await getDownloadURL(storageRef);

                        const newFile = {
                          name: file.name,
                          label,
                          url: downloadURL,
                          type: file.type,
                          size: file.size,
                          uploadedAt: new Date().toISOString(),
                          uploadedBy: userId,
                        };

                        const currentFiles = instructionData?.files || [];
                        if (isLocationMode && locationKey) {
                          const locationRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
                          await updateDoc(locationRef, {
                            [`orderDefaults.staffInstructions.${fieldKey}.files`]: [...currentFiles, newFile],
                            updatedAt: serverTimestamp(),
                            updatedBy: userId || null,
                          });
                          await onRefreshLocation?.();
                        } else {
                          await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
                            [`orderDefaults.staffInstructions.${fieldKey}.files`]: [...currentFiles, newFile],
                            updatedAt: serverTimestamp(),
                          });
                          await onRefresh();
                        }

                        setToast({
                          open: true,
                          message: `Uploaded “${label}” (${file.name})`,
                          severity: 'success',
                        });
                        if (labelInput) labelInput.value = '';
                        e.target.value = '';
                      } catch (error: any) {
                        console.error(`Error uploading file to ${fieldKey}:`, error);
                        const msg = error?.code === 'storage/unauthorized'
                          ? 'Upload denied (Storage rules). Deploy updated storage rules or ask an admin.'
                          : error?.message || 'Unknown error';
                        setToast({ open: true, message: `Upload failed: ${msg}`, severity: 'error' });
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
  );

  const snackbar = (
    <Snackbar
      open={!!toast?.open}
      autoHideDuration={toast?.severity === 'error' ? 6000 : 3000}
      onClose={() => setToast(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={toast?.severity || 'info'} onClose={() => setToast(null)} sx={{ width: '100%' }}>
        {toast?.message}
      </Alert>
    </Snackbar>
  );

  if (isFlat) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {mainBody}
        {snackbar}
      </Box>
    );
  }

  return (
    <Card>
      <CardHeader title={title} titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }} />
      <CardContent>{mainBody}</CardContent>
      {snackbar}
    </Card>
  );
};

export default AccountOrderDefaultsCard;

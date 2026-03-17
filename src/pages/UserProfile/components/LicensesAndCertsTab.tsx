import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  TextField,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { 
  AddCircle, 
  Delete as DeleteIcon, 
  ExpandMore, 
  Verified, 
  CheckCircle,
  CalendarToday,
  Upload as UploadIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../../firebase';
import credentialsSeed from '../../../data/credentialsSeed.json';
import { isUploadRequiredCert, getCertificationVerificationStatus } from '../../../utils/certificationVerification';
import { useT } from '../../../i18n';

type Props = {
  uid: string;
};

interface Certification {
  name: string;
  fileUrl?: string;
  fileName?: string;
  uploadedAt?: Date;
  issuer?: string;
  expirationDate?: string;
  /** For upload-required certs: pending | verified (set by recruiter/admin). */
  verificationStatus?: string;
}

const quickAddCertifications = [
  'CNA',
  'ServSafe Manager',
  'Food Handler Card',
  'CPR / First Aid',
  'First Aid / CPR',
];

// Get all active certifications from credentialsSeed
const certificationOptions = credentialsSeed
  .filter(cred => cred.is_active && cred.type === 'Certification')
  .map(cred => cred.name)
  .sort();

// Also include licenses for completeness
const licenseOptions = credentialsSeed
  .filter(cred => cred.is_active && cred.type === 'License')
  .map(cred => cred.name)
  .sort();

// Combine and deduplicate
const allCertificationOptions = Array.from(new Set([...certificationOptions, ...licenseOptions])).sort();

const LicensesAndCertsTab: React.FC<Props> = ({ uid }) => {
  const t = useT();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [certificationDialogOpen, setCertificationDialogOpen] = useState(false);
  const [quickAddCertificationValue, setQuickAddCertificationValue] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [newCertification, setNewCertification] = useState({
    name: '',
    issuer: '',
    expirationDate: '',
    showExpiration: false,
    file: null as File | null,
  });

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for certifications
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const certs: Certification[] = Array.isArray(data.certifications)
          ? data.certifications
              .filter((c: any) => c && (typeof c === 'object' || typeof c === 'string'))
              .map((c: any) => {
                // Handle both object format and string format
                if (typeof c === 'string') {
                  return {
                    name: c,
                  };
                }
                return {
                  name: c.name || 'Unnamed Certificate',
                  fileUrl: c.fileUrl || c.downloadUrl,
                  fileName: c.fileName,
                  uploadedAt: c.uploadedAt?.toDate?.() || (c.uploadedAt ? new Date(c.uploadedAt) : undefined),
                  issuer: c.issuer,
                  expirationDate: c.expirationDate,
                };
              })
          : [];
        setCertifications(certs);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleQuickAddCertification = (certName: string) => {
    setQuickAddCertificationValue(certName);
    setNewCertification({
      name: certName,
      issuer: '',
      expirationDate: '',
      showExpiration: false,
      file: null,
    });
    setCertificationDialogOpen(true);
  };

  const handleOpenCertificationDialog = () => {
    setNewCertification({
      name: '',
      issuer: '',
      expirationDate: '',
      showExpiration: false,
      file: null,
    });
    setQuickAddCertificationValue(null);
    setCertificationDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewCertification(prev => ({ ...prev, file }));
    }
  };

  const handleSaveCertification = async () => {
    if (!newCertification.name.trim()) return;

    setUploading(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let uploadedAt: Date | undefined;

      // Upload file if provided
      if (newCertification.file) {
        const certSlug = newCertification.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const path = `users/${uid}/certifications/${certSlug}/${Date.now()}-${newCertification.file.name}`;
        const fileRef = ref(storage, path);
        
        await uploadBytes(fileRef, newCertification.file);
        fileUrl = await getDownloadURL(fileRef);
        fileName = newCertification.file.name;
        uploadedAt = new Date();
      }

      const entry: any = {
        name: newCertification.name.trim(),
      };
      
      if (newCertification.issuer) {
        entry.issuer = newCertification.issuer.trim();
      }
      
      if (newCertification.showExpiration && newCertification.expirationDate) {
        entry.expirationDate = newCertification.expirationDate;
      }
      
      if (fileUrl) {
        entry.fileUrl = fileUrl;
        entry.fileName = fileName;
        entry.uploadedAt = uploadedAt;
      }

      const updated = [...certifications, entry];
      
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        certifications: updated,
        updatedAt: serverTimestamp(),
      });

      setCertifications(updated);
      setCertificationDialogOpen(false);
      setNewCertification({
        name: '',
        issuer: '',
        expirationDate: '',
        showExpiration: false,
        file: null,
      });
      setQuickAddCertificationValue(null);
    } catch (error) {
      console.error('Error saving certification:', error);
      alert('Failed to save certification');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteCertification = async (cert: Certification) => {
    if (!confirm(`Are you sure you want to delete ${cert.name}?`)) return;

    try {
      // Delete file from storage if it exists
      if (cert.fileUrl) {
        try {
          // Extract path from URL - this is a simplified approach
          // In production, you might want to store the storage path separately
          const pathMatch = cert.fileUrl.match(/certifications%2F(.+?)\?/);
          if (pathMatch) {
            const filePath = `users/${uid}/certifications/${decodeURIComponent(pathMatch[1])}`;
            const fileRef = ref(storage, filePath);
            await deleteObject(fileRef);
          }
        } catch (storageError) {
          console.warn('Error deleting file from storage:', storageError);
          // Continue with deletion even if storage deletion fails
        }
      }

      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        certifications: arrayRemove(cert),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error deleting certification:', error);
      alert('Failed to delete certification');
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Certifications Section */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          ✅ Certifications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Professional certifications and licenses that help you stand out.
        </Typography>

        {certifications.length > 0 ? (
          <>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              {certifications.map((entry: Certification, idx: number) => {
                const uploadRequired = isUploadRequiredCert(entry.name);
                const certStatus = uploadRequired
                  ? getCertificationVerificationStatus(entry)
                  : null;
                return (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: certStatus === 'expired' ? 'error.light' : certStatus === 'verified' ? 'success.light' : 'divider',
                    bgcolor: certStatus === 'expired' ? 'error.50' : 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: 'primary.main',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {entry.name || 'Certification'}
                        {entry.issuer && ` (${entry.issuer})`}
                      </Typography>
                      {uploadRequired && certStatus && (
                        <Chip
                          size="small"
                          label={
                            certStatus === 'missing'
                              ? t('jobs.certStatusMissing')
                              : certStatus === 'uploaded'
                                ? t('jobs.certStatusUploaded')
                                : certStatus === 'verified'
                                  ? t('jobs.certStatusVerified')
                                  : t('jobs.certStatusExpired')
                          }
                          color={
                            certStatus === 'verified'
                              ? 'success'
                              : certStatus === 'uploaded'
                                ? 'warning'
                                : certStatus === 'expired'
                                  ? 'error'
                                  : 'default'
                          }
                          variant="outlined"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      )}
                    </Stack>
                    {entry.fileUrl && entry.fileName && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {entry.fileName} • {entry.uploadedAt ? `Uploaded ${formatDate(entry.uploadedAt)}` : 'File attached'}
                      </Typography>
                    )}
                    {entry.expirationDate && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        Expires: {entry.expirationDate}
                        {certStatus === 'expired' && (
                          <Typography component="span" variant="body2" color="error.main" sx={{ ml: 1 }}>
                            (Expired)
                          </Typography>
                        )}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {entry.fileUrl && (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<ViewIcon />}
                        href={entry.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View
                      </Button>
                    )}
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDeleteCertification(entry)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              );
              })}
            </Stack>
          </>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                ✅ You haven't added certifications yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add professional certifications like CNA, ServSafe, Food Handler, or CPR.
              </Typography>
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Quick add:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
              {quickAddCertifications.map((cert) => (
                <Chip
                  key={cert}
                  label={cert}
                  onClick={() => handleQuickAddCertification(cert)}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <Button
          startIcon={<AddCircle />}
          onClick={handleOpenCertificationDialog}
          variant={certifications.length > 0 ? "outlined" : "contained"}
        >
          Add Certification
        </Button>
      </Box>

      {/* Certification Dialog */}
      <Dialog 
        open={certificationDialogOpen} 
        onClose={() => !uploading && setCertificationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            position: { xs: 'fixed', sm: 'static' },
            bottom: { xs: 0, sm: 'auto' },
            top: { xs: 'auto', sm: '50%' },
            transform: { xs: 'none', sm: 'translateY(-50%)' },
            margin: { xs: 0, sm: 'auto' },
            maxHeight: { xs: '90vh', sm: '85vh' },
            borderRadius: { xs: '16px 16px 0 0', sm: 1 }
          }
        }}
      >
        <DialogTitle>Add Certification</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Certification Name"
              fullWidth
              required
              value={newCertification.name}
              onChange={(e) => setNewCertification({ ...newCertification, name: e.target.value })}
              InputProps={{
                startAdornment: (
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <Verified fontSize="small" color="action" />
                  </Box>
                )
              }}
            >
              <MenuItem value="">
                <em>Select a certification...</em>
              </MenuItem>
              {allCertificationOptions.map((certName) => (
                <MenuItem key={certName} value={certName}>
                  {certName}
                </MenuItem>
              ))}
            </TextField>
            
            <TextField
              label="Issuing Organization (Optional)"
              fullWidth
              value={newCertification.issuer}
              onChange={(e) => setNewCertification({ ...newCertification, issuer: e.target.value })}
              placeholder="e.g. State Board, ServSafe, Red Cross"
            />
            
            <Accordion 
              expanded={newCertification.showExpiration}
              onChange={(_, expanded) => setNewCertification({ ...newCertification, showExpiration: expanded })}
              sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CalendarToday fontSize="small" color="action" />
                  <Typography variant="body2">Add Expiration Date (Optional)</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  type="month"
                  label="Expiration Date"
                  fullWidth
                  value={newCertification.expirationDate}
                  onChange={(e) => setNewCertification({ ...newCertification, expirationDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  InputProps={{
                    startAdornment: (
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                        <CalendarToday fontSize="small" color="action" />
                      </Box>
                    )
                  }}
                />
              </AccordionDetails>
            </Accordion>

            {/* File Upload Section */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Upload Document (Optional)
              </Typography>
              <Button
                variant="outlined"
                component="label"
                startIcon={<UploadIcon />}
                fullWidth
                disabled={uploading}
              >
                {newCertification.file ? newCertification.file.name : 'Choose File'}
                <input
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                />
              </Button>
              {newCertification.file && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Selected: {newCertification.file.name}
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
          <Button 
            onClick={() => setCertificationDialogOpen(false)} 
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSaveCertification}
            disabled={!newCertification.name || uploading}
          >
            {uploading ? 'Uploading...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LicensesAndCertsTab;
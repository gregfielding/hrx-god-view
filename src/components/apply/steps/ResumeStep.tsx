import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Card, CardContent, Chip, Stack, Alert, useTheme, useMediaQuery } from '@mui/material';
import { Visibility, Download, Upload, Description } from '@mui/icons-material';
import ResumeUpload from '../../../components/ResumeUpload';
import { httpsCallable } from 'firebase/functions';
import { functions, db, storage } from '../../../firebase';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { useAuth } from '../../../contexts/AuthContext';
import { doc, onSnapshot } from 'firebase/firestore';
import { logger } from '../../../utils/logger';
import { useT } from '../../../i18n';

type Props = {
  tenantId: string;
  value: any;
  onChange: (v: any) => void;
};

interface UserResume {
  fileName: string;
  size: number;
  sizeKB: number;
  timestamp: Date;
  storagePath: string;
  downloadUrl?: string;
}

const ResumeStep: React.FC<Props> = ({ tenantId, value, onChange }) => {
  const t = useT();
  const [currentResume, setCurrentResume] = useState<UserResume | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { user } = useAuth();
  const userId = value?.userId || '';

  // Debug logging (gated)
  logger.debug('ResumeStep - userId:', userId);
  logger.debug('ResumeStep - value:', value);

  // Listen to user profile changes
  useEffect(() => {
    if (!user?.uid) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserProfile(data);
        
        // Update current resume from user profile
        if (data?.resume) {
          setCurrentResume(data.resume);
          logger.debug('Current resume updated:', data.resume);
        } else {
          setCurrentResume(null);
          logger.debug('No resume found in user profile');
        }
      }
    });

    return () => unsubscribe();
  }, [user?.uid]);

  const getResumeSignedUrl = httpsCallable(functions, 'getResumeSignedUrl');

  const handleViewResume = async () => {
    if (!currentResume) {
      setError(t('apply.noResumeToView'));
      return;
    }

    try {
      logger.debug('handleViewResume called for resume:', currentResume.fileName);
      
      // First try to use the stored download URL (if available)
      if (currentResume.downloadUrl) {
        logger.debug('Using stored download URL:', currentResume.downloadUrl);
        window.open(currentResume.downloadUrl, '_blank');
        return;
      }
      
      // Use public URL directly (since file is made public)
      if (currentResume.storagePath) {
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(currentResume.storagePath)}?alt=media`;
        logger.debug('Using public URL:', publicUrl);
        window.open(publicUrl, '_blank');
        return;
      }
      
      setError(t('apply.failedToOpenResume'));
    } catch (err) {
      logger.error('Failed to open resume:', err);
      setError(t('apply.failedToOpenResume'));
    }
  };

  const handleDownloadResume = async () => {
    if (!currentResume) {
      setError(t('apply.noResumeToDownload'));
      return;
    }

    try {
      logger.debug('handleDownloadResume called for resume:', currentResume.fileName);
      
      // First try to use the stored download URL (if available)
      if (currentResume.downloadUrl) {
        logger.debug('Using stored download URL for download:', currentResume.downloadUrl);
        const link = document.createElement('a');
        link.href = currentResume.downloadUrl;
        link.download = currentResume.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      
      // Use public URL directly (since file is made public)
      if (currentResume.storagePath) {
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/hrx1-d3beb.firebasestorage.app/o/${encodeURIComponent(currentResume.storagePath)}?alt=media`;
        logger.debug('Using public URL for download:', publicUrl);
        const link = document.createElement('a');
        link.href = publicUrl;
        link.download = currentResume.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      
      setError(t('apply.failedToOpenResume'));
    } catch (err) {
      logger.error('Failed to download resume:', err);
      setError(t('apply.failedToDownloadResume'));
    }
  };

  const handleResumeParsed = (parsed: any) => {
    // Extract contact information and map to form fields
    const contact = parsed?.contact || {};
    const resumeSuggestions: Record<string, boolean> = {};
    const resumeConfidence: Record<string, number> = {};
    
    // Map resume fields to form fields
    if (contact.name) {
      const nameParts = contact.name.split(' ');
      if (nameParts.length >= 2) {
        resumeSuggestions.firstName = true;
        resumeSuggestions.lastName = true;
        resumeConfidence.firstName = 0.9;
        resumeConfidence.lastName = 0.9;
      }
    }
    
    if (contact.email) {
      resumeSuggestions.email = true;
      resumeConfidence.email = 0.95;
    }
    
    if (contact.phone) {
      resumeSuggestions.phone = true;
      resumeConfidence.phone = 0.85;
    }
    
    if (contact.address) {
      resumeSuggestions.street = true;
      resumeConfidence.street = 0.8;
      // Note: Coordinates will be geocoded on the backend during resume parsing
    }
    
    // Update the form with parsed data and suggestion metadata
    const updatedValue = {
      ...(value || {}),
      parsed,
      resumeSuggestions,
      resumeConfidence,
      // Pre-fill form fields from resume
      firstName: contact.name ? contact.name.split(' ')[0] : value?.firstName,
      lastName: contact.name ? contact.name.split(' ').slice(1).join(' ') : value?.lastName,
      email: contact.email || value?.email,
      phone: contact.phone || value?.phone,
    };
    
    onChange(updatedValue);
    setShowUpload(false);
  };

  const formatFileSize = (sizeKB: number) => {
    if (sizeKB < 1024) return `${sizeKB} KB`;
    return `${(sizeKB / 1024).toFixed(1)} MB`;
  };

  const formatDate = (date: any) => {
    if (!date) return 'Unknown Date';
    try {
      let dateObj;
      if (date.toDate) {
        // Firestore Timestamp
        dateObj = date.toDate();
      } else if (date instanceof Date) {
        // Already a Date object
        dateObj = date;
      } else if (typeof date === 'string') {
        // String date
        dateObj = new Date(date);
      } else if (date._seconds) {
        // Firestore Timestamp object
        dateObj = new Date(date._seconds * 1000);
      } else {
        // Try to parse as Date
        dateObj = new Date(date);
      }
      
      // Check if the date is valid
      if (isNaN(dateObj.getTime())) {
        return 'Invalid Date';
      }
      
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } catch (error) {
      console.error('Date formatting error:', error, 'Input:', date);
      return 'Invalid Date';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'parsed': return 'success';
      case 'processing': return 'warning';
      case 'failed': return 'error';
      default: return 'default';
    }
  };

  logger.debug('ResumeStep - Render state:', {
    userId,
    loading,
    currentResume,
    showUpload
  });

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        {t('apply.uploadResume')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {currentResume && (
        <Card
          sx={{
            mb: 2,
            boxShadow: isMobile ? 0 : undefined,
            borderRadius: 2,
            border: isMobile ? '1px solid' : undefined,
            borderColor: isMobile ? 'divider' : undefined
          }}
        >
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <Description color="primary" />
              <Typography variant="h6">{t('apply.currentResume')}</Typography>
            </Stack>
            
            <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle1" fontWeight="medium" sx={{ mb: 1 }}>
                {currentResume.fileName}
              </Typography>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {currentResume.sizeKB} KB • Uploaded {formatDate(currentResume.timestamp)}
              </Typography>
              
              <Stack direction="row" spacing={1}>
                <Button
                  startIcon={<Visibility />}
                  size="small"
                  variant="outlined"
                  onClick={handleViewResume}
                >
                  {t('apply.view')}
                </Button>
                <Button
                  startIcon={<Download />}
                  size="small"
                  variant="outlined"
                  onClick={handleDownloadResume}
                >
                  {t('apply.download')}
                </Button>
                <Button
                  startIcon={<Upload />}
                  size="small"
                  variant="contained"
                  onClick={() => setShowUpload(true)}
                >
                  {t('apply.uploadNewResume')}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      )}

      {!currentResume && !loading && userId && (
        <>
          <Alert severity="info" sx={{ mb: 1 }}>
            {t('apply.resumeOptional')}
          </Alert>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button variant="text" size="small" onClick={() => onChange?.({ ...(value || {}), skipped: true })} aria-label={t('apply.skipForNow')}>
              {t('apply.skipForNow')}
            </Button>
          </Stack>
        </>
      )}

      {currentResume && !showUpload && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {t('apply.resumeUploaded')} {formatDate(currentResume.timestamp)} -{' '}
          <Button 
            variant="text" 
            size="small" 
            onClick={handleViewResume}
            sx={{ textDecoration: 'underline', p: 0, minWidth: 'auto' }}
          >
            {t('apply.clickToOpen')}
          </Button>
        </Alert>
      )}

      {(!currentResume || showUpload) && (
        <Box>
          {currentResume && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('apply.uploadingNewReplaces')}
            </Typography>
          )}
          
          <ResumeUpload
            userId={userId}
            tenantId={tenantId}
            onResumeParsed={handleResumeParsed}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('apply.acceptedFormats')}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ResumeStep;



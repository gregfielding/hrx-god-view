import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Card, CardContent, Chip, Stack, Alert } from '@mui/material';
import { Visibility, Download, Upload, Description } from '@mui/icons-material';
import ResumeUpload from '../../../components/ResumeUpload';
import { httpsCallable } from 'firebase/functions';
import { functions, db, storage } from '../../../firebase';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { useAuth } from '../../../contexts/AuthContext';
import { doc, onSnapshot } from 'firebase/firestore';
import { logger } from '../../../utils/logger';

type Props = {
  tenantId: string;
  value: any;
  onChange: (v: any) => void;
};

interface ResumeUpload {
  id: string;
  uploadId: string;
  fileName: string;
  fileType: string;
  sizeKB: number;
  status: 'processing' | 'parsed' | 'failed';
  uploadDate: Date;
  storagePath: string;
  parsedResumeId?: string;
  archived: boolean;
}

interface GetUserResumeUploadsResponse {
  uploads: ResumeUpload[];
}

interface GetResumeSignedUrlResponse {
  signedUrl: string;
  fileName: string;
  fileSize: number;
  uploadDate: Date;
}

const ResumeStep: React.FC<Props> = ({ tenantId, value, onChange }) => {
  const [previousUploads, setPreviousUploads] = useState<ResumeUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);

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
        logger.debug('UserProfile updated:', {
          resumeUrl: data?.resumeUrl,
          resumeFileName: data?.resumeFileName,
          resumeUploadDate: data?.resumeUploadDate,
          resumeStoragePath: data?.resumeStoragePath,
        });
      }
    });

    return () => unsubscribe();
  }, [user?.uid]);

  // Get user's resume uploads
  const getUserResumeUploads = httpsCallable(functions, 'getUserResumeUploads');
  const getResumeSignedUrl = httpsCallable(functions, 'getResumeSignedUrl');

  useEffect(() => {
    if (userId) {
      fetchResumeUploads();
    }
  }, [userId]);

  const fetchResumeUploads = async () => {
    if (!userId) {
      logger.debug('ResumeStep - No userId, skipping fetch');
      return;
    }
    
    logger.debug('ResumeStep - Fetching resume uploads for userId:', userId);
    setLoading(true);
    setError(null); // Clear any previous errors
    try {
      const result = await getUserResumeUploads({ userId }) as { data: GetUserResumeUploadsResponse };
      logger.debug('ResumeStep - Fetch result:', result);
      setPreviousUploads(result.data.uploads || []);
    } catch (err) {
      logger.error('Failed to fetch resume uploads:', err);
      logger.debug('Error details:', {
        message: err instanceof Error ? err.message : 'Unknown error',
        code: (err as any)?.code,
        data: (err as any)?.data,
        fullError: err
      });
      
      // Only show error if it's not a "not found" type error (empty collection is normal)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorCode = (err as any)?.code;
      
      // Don't show error for common "no data" scenarios
      if (
        errorMessage.includes('not found') || 
        errorMessage.includes('permission') ||
        errorMessage.includes('No document to update') ||
        errorCode === 'not-found' ||
        errorCode === 'permission-denied' ||
        // If the function returns empty array, that's normal
        (Array.isArray((err as any)?.data?.uploads) && (err as any).data.uploads.length === 0)
      ) {
        logger.debug('No previous resume uploads found - this is normal for new users');
      } else {
        logger.debug('Showing error because:', { errorMessage, errorCode });
        setError('Failed to load previous resumes');
      }
      setPreviousUploads([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleViewResume = async (uploadId: string) => {
    try {
      logger.debug('handleViewResume called with uploadId:', uploadId);
      logger.debug('userProfile data:', {
        hasUserProfile: !!userProfile,
        resumeUrl: userProfile?.resumeUrl,
        resumeFileName: userProfile?.resumeFileName,
        resumeUploadDate: userProfile?.resumeUploadDate,
        resumeStoragePath: userProfile?.resumeStoragePath
      });

      // First try to use the resume URL from the user document
      if (userProfile?.resumeUrl) {
        logger.debug('Using resume URL from user document:', userProfile.resumeUrl);
        window.open(userProfile.resumeUrl, '_blank');
        return;
      }
      
      // Always prefer a signed URL when no direct URL is saved
      try {
        const result = await getResumeSignedUrl({ userId, uploadId, action: 'view' }) as { data: GetResumeSignedUrlResponse };
        logger.debug('Signed URL obtained for view');
        window.open(result.data.signedUrl, '_blank');
        return;
      } catch (signedErr) {
        logger.error('Signed URL generation failed, attempting getDownloadURL fallback:', signedErr);
        // Fallback to Firebase Storage client getDownloadURL
        const path = userProfile?.resumeStoragePath || previousUploads.find(u => u.uploadId === uploadId)?.storagePath;
        if (path) {
          const url = await getDownloadURL(storageRef(storage, path));
          window.open(url, '_blank');
          return;
        }
        throw signedErr;
      }
    } catch (err) {
      logger.error('Failed to get signed URL:', err);
      setError('Failed to open resume');
    }
  };

  const handleDownloadResume = async (uploadId: string) => {
    try {
      // First try to use the resume URL from the user document
      if (userProfile?.resumeUrl) {
        logger.debug('Using resume URL from user document for download:', userProfile.resumeUrl);
        const link = document.createElement('a');
        link.href = userProfile.resumeUrl;
        link.download = userProfile.resumeFileName || 'resume.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      
      // Use signed URL for download when no direct URL is saved
      try {
        const result = await getResumeSignedUrl({ userId, uploadId, action: 'download' }) as { data: GetResumeSignedUrlResponse };
        const link = document.createElement('a');
        link.href = result.data.signedUrl;
        link.download = result.data.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      } catch (signedErr) {
        logger.error('Signed URL download failed, attempting getDownloadURL fallback:', signedErr);
        const path = userProfile?.resumeStoragePath || previousUploads.find(u => u.uploadId === uploadId)?.storagePath;
        if (path) {
          const url = await getDownloadURL(storageRef(storage, path));
          const link = document.createElement('a');
          link.href = url;
          link.download = previousUploads.find(u => u.uploadId === uploadId)?.fileName || 'resume.pdf';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
        throw signedErr;
      }
    } catch (err) {
      logger.error('Failed to download resume:', err);
      setError('Failed to download resume');
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
    fetchResumeUploads(); // Refresh the list
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

  const activeUploads = previousUploads.filter(upload => !upload.archived);
  const hasActiveUpload = activeUploads.length > 0;

  logger.debug('ResumeStep - Render state:', {
    userId,
    loading,
    previousUploads,
    activeUploads,
    hasActiveUpload,
    showUpload
  });

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Upload your resume (PDF/Word/TXT)
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Loading resume information...
        </Alert>
      )}

      {hasActiveUpload && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <Description color="primary" />
              <Typography variant="h6">Current Resume</Typography>
            </Stack>
            
            {activeUploads.map((upload) => (
              <Box key={upload.id} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" fontWeight="medium">
                    {upload.fileName}
                  </Typography>
                  <Chip 
                    label={upload.status} 
                    color={getStatusColor(upload.status) as any}
                    size="small"
                  />
                </Stack>
                
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {formatFileSize(upload.sizeKB)} • Uploaded {formatDate(upload.uploadDate)}
                </Typography>
                
                <Stack direction="row" spacing={1}>
                  <Button
                    startIcon={<Visibility />}
                    size="small"
                    variant="outlined"
                    onClick={() => handleViewResume(upload.uploadId)}
                  >
                    View
                  </Button>
                  <Button
                    startIcon={<Download />}
                    size="small"
                    variant="outlined"
                    onClick={() => handleDownloadResume(upload.uploadId)}
                  >
                    Download
                  </Button>
                  <Button
                    startIcon={<Upload />}
                    size="small"
                    variant="contained"
                    onClick={() => setShowUpload(true)}
                  >
                    Upload New Resume
                  </Button>
                </Stack>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {!hasActiveUpload && !loading && userId && (
        <>
          <Alert severity="info" sx={{ mb: 1 }}>
            Resume is optional. You can skip this step and continue, or upload your resume below.
          </Alert>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button variant="text" size="small" onClick={() => onChange?.({ ...(value || {}), skipped: true })} aria-label="Skip resume for now">
              Skip for now
            </Button>
          </Stack>
        </>
      )}

      {hasActiveUpload && !showUpload && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Resume uploaded {formatDate(activeUploads[0].uploadDate)} -{' '}
          <Button 
            variant="text" 
            size="small" 
            onClick={() => handleViewResume(activeUploads[0].uploadId)}
            sx={{ textDecoration: 'underline', p: 0, minWidth: 'auto' }}
          >
            click to open
          </Button>
        </Alert>
      )}

      {(!hasActiveUpload || showUpload) && (
        <Box>
          {hasActiveUpload && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Uploading a new resume will archive your current resume.
            </Typography>
          )}
          
          <ResumeUpload
            userId={userId}
            tenantId={tenantId}
            onResumeParsed={handleResumeParsed}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Accepted formats: PDF, DOCX, TXT. You can also skip this step and upload later.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ResumeStep;



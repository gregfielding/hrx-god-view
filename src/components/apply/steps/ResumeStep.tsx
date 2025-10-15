import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Card, CardContent, Chip, Stack, Alert } from '@mui/material';
import { Visibility, Download, Upload, Description } from '@mui/icons-material';
import ResumeUpload from '../../../components/ResumeUpload';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

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

  const userId = value?.userId || '';

  // Get user's resume uploads
  const getUserResumeUploads = httpsCallable(functions, 'getUserResumeUploads');
  const getResumeSignedUrl = httpsCallable(functions, 'getResumeSignedUrl');

  useEffect(() => {
    if (userId) {
      fetchResumeUploads();
    }
  }, [userId]);

  const fetchResumeUploads = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      const result = await getUserResumeUploads({ userId }) as { data: GetUserResumeUploadsResponse };
      setPreviousUploads(result.data.uploads || []);
    } catch (err) {
      console.error('Failed to fetch resume uploads:', err);
      setError('Failed to load previous resumes');
    } finally {
      setLoading(false);
    }
  };

  const handleViewResume = async (uploadId: string) => {
    try {
      const result = await getResumeSignedUrl({ userId, uploadId, action: 'view' }) as { data: GetResumeSignedUrlResponse };
      window.open(result.data.signedUrl, '_blank');
    } catch (err) {
      console.error('Failed to get signed URL:', err);
      setError('Failed to open resume');
    }
  };

  const handleDownloadResume = async (uploadId: string) => {
    try {
      const result = await getResumeSignedUrl({ userId, uploadId, action: 'download' }) as { data: GetResumeSignedUrlResponse };
      const link = document.createElement('a');
      link.href = result.data.signedUrl;
      link.download = result.data.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to download resume:', err);
      setError('Failed to download resume');
    }
  };

  const handleResumeParsed = (parsed: any) => {
    onChange({ ...(value || {}), parsed });
    fetchResumeUploads(); // Refresh the list
    setShowUpload(false);
  };

  const formatFileSize = (sizeKB: number) => {
    if (sizeKB < 1024) return `${sizeKB} KB`;
    return `${(sizeKB / 1024).toFixed(1)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString();
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
        </Box>
      )}
    </Box>
  );
};

export default ResumeStep;



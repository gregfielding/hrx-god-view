import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  Stack,
  Paper, 
  LinearProgress, 
  Alert,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { 
  CloudUpload, 
  Description, 
  CheckCircle, 
  Error as ErrorIcon, 
  Close,
  Visibility
} from '@mui/icons-material';
import { useDropzone } from 'react-dropzone';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase';
import { logger } from '../utils/logger';
import { toChipLabel } from '../utils/chipLabel';
import { openUserResumeInNewTab, pickResumeFromUserDoc, type UserResumeForOpen } from '../utils/userResumeOpen';

interface ResumeUploadProps {
  userId: string;
  tenantId?: string;
  onResumeParsed?: (parsedData: any) => void;
  onParsingStatusChange?: (status: ParsingStatus['status']) => void;
  hideTitle?: boolean;
  compact?: boolean;
  hideCaptureActions?: boolean;
  /** When true, omit the green “current resume” alert (e.g. worker profile shows it in the section header). */
  hideStoredResumeAlert?: boolean;
}

interface ParsingStatus {
  status: 'idle' | 'uploading' | 'parsing' | 'completed' | 'error';
  progress: number;
  message: string;
  error?: string;
  parsedData?: any;
}

interface PendingPreview {
  name: string;
  url: string;
  isImage: boolean;
}

/** Mobile Safari often omits `File.type`; infer from extension so validation and upload still run. */
function inferMimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? '';
}

function effectiveMime(file: File): string {
  return file.type || inferMimeFromFileName(file.name);
}

/**
 * Build a data URL for the parser without FileReader.readAsDataURL.
 * Some browsers/profiles never fire FileReader.onload, which left the UI stuck on "Reading file…"
 * with no network request to parseResumeHttp.
 */
async function fileToDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length === 0) {
    throw new Error('File is empty.');
  }
  const mime = effectiveMime(file) || 'application/octet-stream';
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  const b64 = btoa(binary);
  return `data:${mime};base64,${b64}`;
}

/** Same pattern as inbox / reply drawers; emulator uses REACT_APP_FUNCTIONS_URL. */
const FUNCTIONS_HTTP_BASE = (
  process.env.REACT_APP_FUNCTIONS_URL || 'https://us-central1-hrx1-d3beb.cloudfunctions.net'
).replace(/\/$/, '');
const PARSE_RESUME_HTTP_URL = `${FUNCTIONS_HTTP_BASE}/parseResumeHttp`;

/** Matches Cloud Function timeout (up to 540s); abort so the UI does not spin forever. */
const PARSE_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

const ResumeUpload: React.FC<ResumeUploadProps> = ({ 
  userId, 
  tenantId, 
  onResumeParsed,
  onParsingStatusChange,
  hideTitle = false,
  compact = false,
  hideCaptureActions = false,
  hideStoredResumeAlert = false,
}) => {
  const [parsingStatus, setParsingStatus] = useState<ParsingStatus>({
    status: 'idle',
    progress: 0,
    message: 'Ready to upload resume'
  });
  const [showPreview, setShowPreview] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photoLibraryInputRef = useRef<HTMLInputElement | null>(null);
  const [storedResume, setStoredResume] = useState<UserResumeForOpen | null>(null);

  useEffect(() => {
    if (!userId) {
      setStoredResume(null);
      return;
    }
    const userRef = doc(db, 'users', userId);
    const unsub = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) {
        setStoredResume(null);
        return;
      }
      setStoredResume(pickResumeFromUserDoc(snap.data() as Record<string, unknown>));
    });
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    onParsingStatusChange?.(parsingStatus.status);
  }, [onParsingStatusChange, parsingStatus.status]);

  const functions = getFunctions();
  const auth = getAuth();
  const parseResume = httpsCallable(functions, 'parseResume');
  const getResumeParsingStatus = httpsCallable(functions, 'getResumeParsingStatus');

  void parseResume;
  void getResumeParsingStatus;

  useEffect(() => () => {
    pendingPreviews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [pendingPreviews]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        logger.debug('Starting file upload', {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          userId,
          tenantId,
        });

        setParsingStatus({
          status: 'uploading',
          progress: 0,
          message: 'Reading file…',
        });

        const fileUrl = await fileToDataUrl(file);

        logger.debug('File converted to base64', {
          dataUrlLength: fileUrl.length,
          fileUrlPrefix: `${fileUrl.substring(0, Math.min(100, fileUrl.length))}...`,
        });

        setParsingStatus({
          status: 'parsing',
          progress: 30,
          message: 'Uploading and parsing resume (this can take a few minutes)…',
        });

        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          logger.error('No auth token available');
          throw new Error('User not authenticated');
        }

        logger.debug('Auth token obtained, making request to parseResumeHttp', { url: PARSE_RESUME_HTTP_URL });

        const requestBody = {
          fileUrl,
          fileName: file.name,
          fileSize: file.size,
          userId,
          tenantId,
        };

        logger.debug('Request payload', {
          fileName: requestBody.fileName,
          fileSize: requestBody.fileSize,
          userId: requestBody.userId,
          tenantId: requestBody.tenantId,
          fileUrlLength: requestBody.fileUrl.length,
        });

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), PARSE_REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(PARSE_RESUME_HTTP_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } catch (fetchErr: unknown) {
          const name = (fetchErr as Error)?.name;
          if (name === 'AbortError') {
            throw new Error(
              'Resume parsing timed out. The file may be large or the service is busy — try again or use a smaller PDF.'
            );
          }
          throw fetchErr;
        } finally {
          window.clearTimeout(timeoutId);
        }

        logger.debug('Response received', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        });

        if (!response.ok) {
          let errorData: { error?: string };
          try {
            errorData = await response.json();
            logger.error('Error response data:', errorData);
          } catch (parseError) {
            logger.error('Could not parse error response:', parseError);
            const textError = await response.text();
            logger.error('Raw error response:', textError);
            errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
          }
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        logger.debug('Response data received', {
          success: data.success,
          hasParsedData: !!data.parsedData,
          error: data.error,
        });

        if (data.success) {
          setParsingStatus({
            status: 'completed',
            progress: 100,
            message: 'Resume parsed successfully!',
            parsedData: data.parsedData,
          });

          logger.debug('Resume parsing completed successfully');

          if (onResumeParsed) {
            onResumeParsed(data.parsedData);
          }
        } else {
          logger.error('Parsing failed:', data.error);
          throw new Error(data.error || 'Failed to parse resume');
        }
      } catch (error: unknown) {
        const err = error as { message?: string; stack?: string; name?: string };
        logger.error('Resume upload / parse failed:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
        });

        let userMessage = err.message || 'Upload failed';
        if (typeof err.message === 'string' && err.message.toLowerCase().includes('failed to fetch')) {
          userMessage =
            'Network error — check your connection, disable VPN/ad-blockers for this site, or confirm the resume parser is deployed.';
        }
        if (typeof err.message === 'string' && err.message.includes('CORS')) {
          userMessage =
            'Browser blocked the response (CORS). Ask your admin to allow this app origin for parseResumeHttp.';
        }

        setParsingStatus({
          status: 'error',
          progress: 0,
          message: userMessage,
          error: userMessage,
        });
      }
    },
    [auth, onResumeParsed, tenantId, userId]
  );

  const processSelectedFiles = useCallback(
    (selected: File[]) => {
      const files = selected.filter(Boolean);
      if (files.length === 0) return;

      const allowedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
      ];

      const invalid = files.find((file) => !allowedTypes.includes(effectiveMime(file)));
      if (invalid) {
        setParsingStatus({
          status: 'error',
          progress: 0,
          message: 'Invalid file type. Please upload PDF, Word, text, or image files only.',
          error: 'Invalid file type',
        });
        return;
      }

      const oversized = files.find((file) => file.size > 25 * 1024 * 1024);
      if (oversized) {
        setParsingStatus({
          status: 'error',
          progress: 0,
          message: 'File too large. Please upload files smaller than 25MB each.',
          error: 'File too large',
        });
        return;
      }

      pendingPreviews.forEach((p) => URL.revokeObjectURL(p.url));

      if (files.length === 1) {
        setPendingFiles([]);
        setPendingPreviews([]);
        void handleFileUpload(files[0]);
        return;
      }

      const previews = files.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        isImage: effectiveMime(file).startsWith('image/'),
      }));
      setPendingFiles(files);
      setPendingPreviews(previews);
      setParsingStatus({
        status: 'idle',
        progress: 0,
        message: `${files.length} files selected. Preview and tap "Upload selected" to start parsing.`,
      });
    },
    [handleFileUpload, pendingPreviews]
  );

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    processSelectedFiles(acceptedFiles);
  }, [processSelectedFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
    multiple: true
  });

  const handleHiddenInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    processSelectedFiles(files);
    event.target.value = '';
  };

  const handleUploadSelected = async () => {
    const file = pendingFiles[0];
    if (!file) return;
    await handleFileUpload(file);
    setPendingFiles([]);
    pendingPreviews.forEach((p) => URL.revokeObjectURL(p.url));
    setPendingPreviews([]);
  };

  const resetUpload = () => {
    setParsingStatus({
      status: 'idle',
      progress: 0,
      message: 'Ready to upload resume'
    });
  };

  const getStatusColor = () => {
    switch (parsingStatus.status) {
      case 'completed': return 'success';
      case 'error': return 'error';
      case 'uploading':
      case 'parsing': return 'info';
      default: return 'default';
    }
  };

  const getStatusIcon = () => {
    switch (parsingStatus.status) {
      case 'completed': return <CheckCircle />;
      case 'error': return <ErrorIcon />;
      case 'uploading':
      case 'parsing': return <Description />;
      default: return <CloudUpload />;
    }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 600, mx: 'auto' }}>
      {!hideTitle && (
        <Typography variant="h6" gutterBottom>
          Upload Resume
        </Typography>
      )}

      {/* Middle “current resume” card — hidden on worker /profile/resume; header card shows View there instead. */}
      {!hideStoredResumeAlert && storedResume && (
        <Alert severity="success" sx={{ mb: 2 }} icon={<Description fontSize="inherit" />}>
          <Stack spacing={1}>
            <Typography variant="body2">
              Current resume: <strong>{storedResume.fileName}</strong>
            </Typography>
            <Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Visibility />}
                onClick={() => openUserResumeInNewTab(storedResume)}
              >
                View resume
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Upload a new file below to replace it.
            </Typography>
          </Stack>
        </Alert>
      )}

      <Paper
        {...getRootProps()}
        sx={{
          p: compact ? 2 : 3,
          textAlign: 'center',
          cursor: 'pointer',
          border: '2px dashed',
          borderColor: isDragActive ? 'primary.main' : 'grey.300',
          backgroundColor: isDragActive ? 'action.hover' : 'background.paper',
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: 'primary.main',
            backgroundColor: 'action.hover'
          }
        }}
      >
        <input {...getInputProps()} />
        
        <CloudUpload sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
        
        <Typography variant="h6" gutterBottom>
          {isDragActive
            ? 'Drop your resume or photos here'
            : storedResume
              ? 'Replace your resume'
              : 'Upload your resume'}
        </Typography>
        
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {hideCaptureActions ? 'Drag and drop a file, or tap to browse.' : 'Use file upload, camera capture, or photo library'}
        </Typography>

        {!hideCaptureActions && (
          <Stack direction="row" spacing={1} justifyContent="center" useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
            <Button size="small" variant="outlined" onClick={() => cameraInputRef.current?.click()}>
              Use camera
            </Button>
            <Button size="small" variant="outlined" onClick={() => photoLibraryInputRef.current?.click()}>
              Photo library
            </Button>
          </Stack>
        )}
        
        {!compact && (
          <Box sx={{ mt: 2 }}>
            <Chip
              label="PDF"
              size="small"
              sx={{ mr: 1, mb: 1 }}
            />
            <Chip
              label="Word (.docx)"
              size="small"
              sx={{ mr: 1, mb: 1 }}
            />
            <Chip
              label="Word (.doc)"
              size="small"
              sx={{ mr: 1, mb: 1 }}
            />
            <Chip
              label="Text (.txt)"
              size="small"
              sx={{ mb: 1 }}
            />
            <Chip
              label="Images (.jpg/.png/.heic)"
              size="small"
              sx={{ mb: 1 }}
            />
          </Box>
        )}
        
        <Typography variant="caption" color="text.secondary">
          Maximum file size: 25MB each
        </Typography>
      </Paper>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.txt"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={handleHiddenInputChange}
      />
      <input
        ref={photoLibraryInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.txt"
        multiple
        style={{ display: 'none' }}
        onChange={handleHiddenInputChange}
      />

      {pendingFiles.length > 0 && (
        <Paper sx={{ mt: 2, p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Preview before submit
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {pendingFiles.length > 1
              ? `${pendingFiles.length} pages/files selected. Multi-page capture is supported in one flow.`
              : '1 file selected.'}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {pendingPreviews.map((preview, idx) => (
              <Box
                key={`${preview.name}-${idx}`}
                sx={{
                  width: 88,
                  height: 88,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'grey.50',
                  p: 0.5,
                }}
              >
                {preview.isImage ? (
                  <img src={preview.url} alt={preview.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Typography variant="caption" color="text.secondary" align="center">
                    {preview.name}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" size="small" onClick={handleUploadSelected}>
              Upload selected
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setPendingFiles([]);
                pendingPreviews.forEach((p) => URL.revokeObjectURL(p.url));
                setPendingPreviews([]);
              }}
            >
              Clear
            </Button>
          </Stack>
        </Paper>
      )}

      {/* Upload Status */}
      {parsingStatus.status !== 'idle' && (
        <Paper sx={{ mt: 2, p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            {getStatusIcon()}
            <Typography variant="body1" sx={{ ml: 1, flexGrow: 1 }}>
              {parsingStatus.message}
            </Typography>
            {parsingStatus.status === 'completed' && (
              <IconButton 
                size="small" 
                onClick={() => setShowPreview(true)}
                title="View parsed data"
              >
                <Visibility />
              </IconButton>
            )}
            <IconButton 
              size="small" 
              onClick={resetUpload}
              title="Reset"
            >
              <Close />
            </IconButton>
          </Box>
          
          {parsingStatus.status === 'uploading' && (
            <LinearProgress variant="determinate" value={parsingStatus.progress} sx={{ mb: 1 }} />
          )}
          {parsingStatus.status === 'parsing' && (
            <LinearProgress variant="indeterminate" sx={{ mb: 1 }} aria-label="Parsing resume" />
          )}
          
          {parsingStatus.status === 'error' && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {parsingStatus.error}
            </Alert>
          )}
          
          {parsingStatus.status === 'completed' && (
            <Alert severity="success" sx={{ mt: 1 }}>
              Resume parsed successfully! Your profile has been updated with the extracted information.
            </Alert>
          )}
        </Paper>
      )}

      {/* Parsed Data Preview Dialog */}
      <Dialog 
        open={showPreview} 
        onClose={() => setShowPreview(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Parsed Resume Data
          <IconButton
            onClick={() => setShowPreview(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {parsingStatus.parsedData && (
            <ResumeDataPreview data={parsingStatus.parsedData} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPreview(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Resume Data Preview Component
interface ResumeDataPreviewProps {
  data: any;
}

const ResumeDataPreview: React.FC<ResumeDataPreviewProps> = ({ data }) => {
  return (
    <Box>
      {/* Contact Information */}
      {data.contact && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Contact Information</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            {data.contact.name && (
              <Typography><strong>Name:</strong> {data.contact.name}</Typography>
            )}
            {data.contact.email && (
              <Typography><strong>Email:</strong> {data.contact.email}</Typography>
            )}
            {data.contact.phone && (
              <Typography><strong>Phone:</strong> {data.contact.phone}</Typography>
            )}
            {data.contact.location && (
              <Typography><strong>Location:</strong> {data.contact.location}</Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Skills */}
      {data.skills && data.skills.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Skills</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {data.skills.map((skill: any, index: number) => (
              <Chip 
                key={index} 
                label={toChipLabel(skill)} 
                color="primary" 
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Education */}
      {data.education && data.education.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Education</Typography>
          {data.education.map((edu: any, index: number) => (
            <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                {toChipLabel(edu.degree)} {edu.field && `in ${toChipLabel(edu.field)}`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {toChipLabel(edu.institution)}
              </Typography>
              {edu.graduationYear && (
                <Typography variant="body2" color="text.secondary">
                  Graduated: {edu.graduationYear}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Experience */}
      {data.experience && data.experience.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Work Experience</Typography>
          {data.experience.map((exp: any, index: number) => (
            <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                {toChipLabel(exp.title)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {toChipLabel(exp.company)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {toChipLabel(exp.startDate)} - {toChipLabel(exp.endDate) || 'Present'}
              </Typography>
              {exp.description && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {exp.description}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Certifications */}
      {data.certifications && data.certifications.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Certifications</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {data.certifications.map((cert: any, index: number) => (
              <Chip 
                key={index} 
                label={toChipLabel(cert)} 
                color="secondary" 
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Languages */}
      {data.languages && data.languages.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>Languages</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {data.languages.map((lang: any, index: number) => (
              <Chip 
                key={index} 
                label={`${lang.language} (${lang.proficiency})`} 
                color="info" 
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ResumeUpload; 
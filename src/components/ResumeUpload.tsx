import React, { useState, useCallback } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
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
import { getFunctions, httpsCallable } from 'firebase/functions';

interface ResumeUploadProps {
  userId: string;
  tenantId?: string;
  onResumeParsed?: (parsedData: any) => void;
}

interface ParsingStatus {
  status: 'idle' | 'uploading' | 'parsing' | 'completed' | 'error';
  progress: number;
  message: string;
  error?: string;
  parsedData?: any;
}

const ResumeUpload: React.FC<ResumeUploadProps> = ({ 
  userId, 
  tenantId, 
  onResumeParsed 
}) => {
  const [parsingStatus, setParsingStatus] = useState<ParsingStatus>({
    status: 'idle',
    progress: 0,
    message: 'Ready to upload resume'
  });
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const functions = getFunctions();
  const parseResume = httpsCallable(functions, 'parseResume');
  const getResumeParsingStatus = httpsCallable(functions, 'getResumeParsingStatus');

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      setParsingStatus({
        status: 'error',
        progress: 0,
        message: 'Invalid file type. Please upload PDF, Word, or text files only.',
        error: 'Invalid file type'
      });
      return;
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setParsingStatus({
        status: 'error',
        progress: 0,
        message: 'File too large. Please upload files smaller than 10MB.',
        error: 'File too large'
      });
      return;
    }

    setUploadedFile(file);
    await handleFileUpload(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt']
    },
    multiple: false
  });

  const handleFileUpload = async (file: File) => {
    try {
      setParsingStatus({
        status: 'uploading',
        progress: 0,
        message: 'Uploading resume...'
      });

      // Convert file to base64 for upload
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const fileUrl = `data:${file.type};base64,${base64Data.split(',')[1]}`;

        setParsingStatus({
          status: 'parsing',
          progress: 30,
          message: 'Parsing resume with AI...'
        });

        try {
          const result = await parseResume({
            fileUrl,
            fileName: file.name,
            fileSize: file.size,
            userId,
            tenantId
          });

          const data = result.data as any;
          
          if (data.success) {
            setParsingStatus({
              status: 'completed',
              progress: 100,
              message: 'Resume parsed successfully!',
              parsedData: data.parsedData
            });
            
            if (onResumeParsed) {
              onResumeParsed(data.parsedData);
            }
          } else {
            throw new Error(data.error || 'Failed to parse resume');
          }
        } catch (error: any) {
          setParsingStatus({
            status: 'error',
            progress: 0,
            message: error.message || 'Failed to parse resume',
            error: error.message
          });
        }
      };

      reader.readAsDataURL(file);
    } catch (error: any) {
      setParsingStatus({
        status: 'error',
        progress: 0,
        message: error.message || 'Upload failed',
        error: error.message
      });
    }
  };

  const resetUpload = () => {
    setParsingStatus({
      status: 'idle',
      progress: 0,
      message: 'Ready to upload resume'
    });
    setUploadedFile(null);
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
      <Typography variant="h6" gutterBottom>
        Upload Resume
      </Typography>
      
      <Paper
        {...getRootProps()}
        sx={{
          p: 3,
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
          {isDragActive ? 'Drop your resume here' : 'Drag & drop your resume'}
        </Typography>
        
        <Typography variant="body2" color="text.secondary" gutterBottom>
          or click to browse files
        </Typography>
        
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
        </Box>
        
        <Typography variant="caption" color="text.secondary">
          Maximum file size: 10MB
        </Typography>
      </Paper>

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
          
          {(parsingStatus.status === 'uploading' || parsingStatus.status === 'parsing') && (
            <LinearProgress 
              variant="determinate" 
              value={parsingStatus.progress} 
              sx={{ mb: 1 }}
            />
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
                label={skill.name} 
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
                {edu.degree} {edu.field && `in ${edu.field}`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {edu.institution}
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
                {exp.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {exp.company}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {exp.startDate} - {exp.endDate || 'Present'}
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
                label={cert.name} 
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
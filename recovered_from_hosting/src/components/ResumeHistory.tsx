import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Visibility,
  Refresh
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface ResumeHistoryProps {
  userId: string;
}

interface ParsedResume {
  id: string;
  fileName: string;
  fileSize: number;
  uploadDate: string;
  status: 'completed' | 'failed' | 'processing';
  parsedData?: any;
  error?: string;
}

const ResumeHistory: React.FC<ResumeHistoryProps> = ({ userId }) => {
  const [resumes, setResumes] = useState<ParsedResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedResume, setSelectedResume] = useState<ParsedResume | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const functions = getFunctions();
  const getUserParsedResumes = httpsCallable(functions, 'getUserParsedResumes');

  const loadResumeHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getUserParsedResumes({ userId });
      const data = result.data as any;

      if (data.success) {
        setResumes(data.resumes || []);
      } else {
        setError(data.error || 'Failed to load resume history');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load resume history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadResumeHistory();
  }, [userId]);

  const handleViewResume = (resume: ParsedResume) => {
    setSelectedResume(resume);
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setSelectedResume(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'failed': return 'error';
      case 'processing': return 'warning';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
        <Button 
          size="small" 
          onClick={loadResumeHistory}
          sx={{ ml: 2 }}
        >
          Retry
        </Button>
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Resume History
        </Typography>
        <IconButton onClick={loadResumeHistory} title="Refresh">
          <Refresh />
        </IconButton>
      </Box>

      {resumes.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No resumes have been uploaded yet.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>File Name</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Upload Date</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {resumes.map((resume) => (
                <TableRow key={resume.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {resume.fileName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatFileSize(resume.fileSize)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(resume.uploadDate)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={resume.status}
                      color={getStatusColor(resume.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => handleViewResume(resume)}
                      disabled={resume.status !== 'completed'}
                      title="View parsed data"
                    >
                      <Visibility />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Resume Preview Dialog */}
      <Dialog
        open={showPreview}
        onClose={handleClosePreview}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Resume Data - {selectedResume?.fileName}
        </DialogTitle>
        <DialogContent>
          {selectedResume?.parsedData && (
            <ResumeDataPreview data={selectedResume.parsedData} />
          )}
          {selectedResume?.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {selectedResume.error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePreview}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Resume Data Preview Component (reused from ResumeUpload)
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

export default ResumeHistory; 
import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Grid,
  TextField,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Box,
  Chip,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { db , app } from '../../../../firebase';

interface ContextBrandingSettingsProps {
  tenantId: string;
}

const ContextBrandingSettings: React.FC<ContextBrandingSettingsProps> = ({ tenantId }) => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [originalWebsiteUrl, setOriginalWebsiteUrl] = useState('');
  const [sampleSocialPosts, setSampleSocialPosts] = useState<string[]>(['', '', '']);
  const [originalSampleSocialPosts, setOriginalSampleSocialPosts] = useState<string[]>([
    '',
    '',
    '',
  ]);
  const [uploadedDocs, setUploadedDocs] = useState<string[]>([]);
  const [originalUploadedDocs, setOriginalUploadedDocs] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const contextRef = doc(db, 'tenants', tenantId, 'aiSettings', 'context');
        const contextSnap = await getDoc(contextRef);
        if (contextSnap.exists()) {
          setWebsiteUrl(contextSnap.data().websiteUrl || '');
          setOriginalWebsiteUrl(contextSnap.data().websiteUrl || '');
          const socialArr = contextSnap.data().sampleSocialPosts || ['', '', ''];
          setSampleSocialPosts([socialArr[0] || '', socialArr[1] || '', socialArr[2] || '']);
          setOriginalSampleSocialPosts([
            socialArr[0] || '',
            socialArr[1] || '',
            socialArr[2] || '',
          ]);
          setUploadedDocs(contextSnap.data().uploadedDocs || []);
          setOriginalUploadedDocs(contextSnap.data().uploadedDocs || []);
        }
      } catch (err) {
        setError('Failed to fetch context & branding settings');
      }
    };
    fetchContext();
  }, [tenantId]);

  const handleSocialPostChange = (idx: number, value: string) => {
    setSampleSocialPosts((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };

  const handleSave = async () => {
    try {
      const functions = getFunctions(app, 'us-central1');
      const updateFn = httpsCallable(functions, 'updateAgencyAISettings');
      await updateFn({ tenantId, settingsType: 'context', settings: { websiteUrl, sampleSocialPosts, uploadedDocs } });
      setOriginalWebsiteUrl(websiteUrl);
      setOriginalSampleSocialPosts([...sampleSocialPosts]);
      setOriginalUploadedDocs([...uploadedDocs]);
      setSuccess(true);
    } catch (err) {
      setError('Failed to save context & branding settings');
    }
  };
  const isChanged =
    websiteUrl !== originalWebsiteUrl ||
    JSON.stringify(sampleSocialPosts) !== JSON.stringify(originalSampleSocialPosts) ||
    JSON.stringify(uploadedDocs) !== JSON.stringify(originalUploadedDocs);

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Context & Branding
        <Tooltip title="Set your agency's website, sample social posts, and upload documents for AI reference.">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            label="Website URL"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            fullWidth
            placeholder="https://example.com"
            helperText="Your agency's website for worker reference"
            sx={{ mb: 2 }}
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1" gutterBottom>
            Sample Social Media Posts (max 3)
            <Tooltip title="Provide up to 3 sample posts that reflect your agency's tone and style.">
              <IconButton size="small" sx={{ ml: 1 }}>
                <HelpOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Typography>
          {[0, 1, 2].map((idx) => (
            <TextField
              key={idx}
              label={`Social Post ${idx + 1}`}
              value={sampleSocialPosts[idx]}
              onChange={(e) => handleSocialPostChange(idx, e.target.value)}
              fullWidth
              multiline
              minRows={2}
              sx={{ mb: 2 }}
              placeholder="Example: 'Excited to announce our new partnership with...'"
              helperText="Sample posts that reflect your agency's tone and style"
            />
          ))}
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1" gutterBottom>
            Uploaded Documents
            <Tooltip title="Upload handbooks, policies, or other documents for worker reference (PDF, DOC, DOCX).">
              <IconButton size="small" sx={{ ml: 1 }}>
                <HelpOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Button variant="outlined" startIcon={<CloudUploadIcon />} component="label">
              Upload Document
              <input
                type="file"
                hidden
                accept=".pdf,.doc,.docx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploadedDocs((prev) => [...prev, file.name]);
                  }
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              PDF, DOC, DOCX files only
            </Typography>
          </Box>
          {uploadedDocs.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {uploadedDocs.map((doc, idx) => (
                <Chip
                  key={idx}
                  label={doc}
                  onDelete={() => setUploadedDocs((prev) => prev.filter((_, i) => i !== idx))}
                  deleteIcon={<DeleteIcon />}
                />
              ))}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            Upload handbooks, policies, or other documents for worker reference
          </Typography>
        </Grid>
      </Grid>
      <Button variant="contained" onClick={handleSave} disabled={!isChanged} sx={{ mt: 2 }}>
        Save Context & Branding
      </Button>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Context & branding updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default ContextBrandingSettings;

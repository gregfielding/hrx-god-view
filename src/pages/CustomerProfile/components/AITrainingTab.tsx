import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Snackbar,
  Alert,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Slider,
  Grid,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { doc, getDoc, setDoc, addDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase';
import { collection } from 'firebase/firestore';

const toneTraits = [
  { id: 'formality', label: 'Formality' },
  { id: 'friendliness', label: 'Friendliness' },
  { id: 'conciseness', label: 'Conciseness' },
  { id: 'assertiveness', label: 'Assertiveness' },
  { id: 'enthusiasm', label: 'Enthusiasm' },
];

interface AITrainingTabProps {
  tenantId: string;
}

const AITrainingTab: React.FC<AITrainingTabProps> = ({ tenantId }) => {
  // Tone & Style
  const [tone, setTone] = useState<any>({
    formality: 0.7,
    friendliness: 0.9,
    conciseness: 0.6,
    assertiveness: 0.5,
    enthusiasm: 0.8,
  });
  const [originalTone, setOriginalTone] = useState<any>({});
  const [toneSuccess, setToneSuccess] = useState(false);
  const [toneError, setToneError] = useState('');

  // Website
  const [website, setWebsite] = useState('');
  const [originalWebsite, setOriginalWebsite] = useState('');
  const [websiteSuccess, setWebsiteSuccess] = useState(false);

  // Social/job samples
  const [socialSamples, setSocialSamples] = useState<string>('');
  const [jobPostSamples, setJobPostSamples] = useState<string>('');
  const [originalSocialSamples, setOriginalSocialSamples] = useState('');
  const [originalJobPostSamples, setOriginalJobPostSamples] = useState('');
  const [samplesSuccess, setSamplesSuccess] = useState(false);

  // PDF uploads
  const storage = getStorage();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Custom Prompts
  const [customPrompts, setCustomPrompts] = useState<string[]>(['', '', '']);
  const [originalCustomPrompts, setOriginalCustomPrompts] = useState<string[]>(['', '', '']);
  const [promptsSuccess, setPromptsSuccess] = useState(false);

  // Fetch all settings on mount
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // Tone
        const toneRef = doc(db, 'tenants', tenantId, 'aiSettings', 'toneSettings');
        const toneSnap = await getDoc(toneRef);
        if (toneSnap.exists()) {
          setTone(toneSnap.data() || tone);
          setOriginalTone(toneSnap.data() || tone);
        }
        // Website
        const profileRef = doc(db, 'tenants', tenantId, 'aiSettings', 'companyProfile');
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          setWebsite(profileSnap.data().website || '');
          setOriginalWebsite(profileSnap.data().website || '');
        }
        // Social/job samples
        const aiTrainingRef = doc(db, 'tenants', tenantId, 'aiTraining', 'main');
        const aiTrainingSnap = await getDoc(aiTrainingRef);
        if (aiTrainingSnap.exists()) {
          setSocialSamples(aiTrainingSnap.data().socialSamples || '');
          setJobPostSamples(aiTrainingSnap.data().jobPostSamples || '');
          setOriginalSocialSamples(aiTrainingSnap.data().socialSamples || '');
          setOriginalJobPostSamples(aiTrainingSnap.data().jobPostSamples || '');
        }
        // PDFs
        const docsSnap = await getDocs(
          collection(db, 'tenants', tenantId, 'aiTraining', 'main', 'policyDocs'),
        );
        setDocs(docsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        // Custom Prompts
        const promptsRef = doc(db, 'tenants', tenantId, 'aiSettings', 'customPrompts');
        const promptsSnap = await getDoc(promptsRef);
        if (promptsSnap.exists()) {
          const arr = promptsSnap.data().prompts || ['', '', ''];
          setCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
          setOriginalCustomPrompts([arr[0] || '', arr[1] || '', arr[2] || '']);
        } else {
          setCustomPrompts(['', '', '']);
          setOriginalCustomPrompts(['', '', '']);
        }
      } catch (err) {}
      setLoading(false);
    };
    fetchAll();
    // eslint-disable-next-line
  }, [tenantId]);

  // Tone save
  const handleToneSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'toneSettings');
      await setDoc(ref, tone, { merge: true });
      setOriginalTone(tone);
      setToneSuccess(true);
    } catch (err: any) {
      setToneError(err.message || 'Failed to save tone settings');
    }
  };
  const isToneChanged = JSON.stringify(tone) !== JSON.stringify(originalTone);

  // Website save
  const handleWebsiteSave = async () => {
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'companyProfile');
      console.log('Saving website to:', ref.path, 'Value:', website);
      await setDoc(ref, { website }, { merge: true });
      setOriginalWebsite(website);
      setWebsiteSuccess(true);
    } catch (err) {
      console.error('Failed to save website:', err);
      setError('Failed to save website: ' + ((err as any)?.message || err));
    }
  };
  const isWebsiteChanged = website !== originalWebsite;

  // Social/job samples save
  const handleSamplesSave = async () => {
    setLoading(true);
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiTraining', 'main');
      await setDoc(ref, { socialSamples, jobPostSamples }, { merge: true });
      setOriginalSocialSamples(socialSamples);
      setOriginalJobPostSamples(jobPostSamples);
      setSamplesSuccess(true);
    } catch {}
    setLoading(false);
  };
  const isSamplesChanged =
    socialSamples !== originalSocialSamples || jobPostSamples !== originalJobPostSamples;

  // PDF upload
  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const fileRef = storageRef(
        storage,
        `tenants/${tenantId}/aiTraining/policyDocs/${Date.now()}_${file.name}`,
      );
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'tenants', tenantId, 'aiTraining', 'main', 'policyDocs'), {
        title: file.name,
        fileName: file.name,
        url,
        storagePath: fileRef.fullPath,
      });
      // Refetch docs
      const docsSnap = await getDocs(
        collection(db, 'tenants', tenantId, 'aiTraining', 'main', 'policyDocs'),
      );
      setDocs(docsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch {}
    setLoading(false);
  };

  const handleDocDelete = async (id: string, storagePath: string) => {
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'aiTraining', 'main', 'policyDocs', id));
      setDocs(docs.filter((d) => d.id !== id));
    } catch {}
  };

  const handlePromptChange = (idx: number, value: string) => {
    setCustomPrompts((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };
  const handlePromptsSave = async () => {
    setLoading(true);
    try {
      const ref = doc(db, 'tenants', tenantId, 'aiSettings', 'customPrompts');
      await setDoc(ref, { prompts: customPrompts }, { merge: true });
      setOriginalCustomPrompts([...customPrompts]);
      setPromptsSuccess(true);
    } catch {}
    setLoading(false);
  };
  const isPromptsChanged = JSON.stringify(customPrompts) !== JSON.stringify(originalCustomPrompts);

  return (
    <Box sx={{ p: 2, width: '100%', maxWidth: 900, mx: 'auto' }}>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Tone & Style Settings
        </Typography>
        <Grid container spacing={4} mb={2}>
          {toneTraits.map((trait) => (
            <Grid item xs={12} sm={6} md={4} key={trait.id}>
              <Typography>{trait.label}</Typography>
              <Slider
                value={tone[trait.id] || 0}
                min={0}
                max={1}
                step={0.01}
                onChange={(_, val) =>
                  setTone((prev: any) => ({ ...prev, [trait.id]: val as number }))
                }
              />
              <Typography variant="caption" color="text.secondary">
                Value: {tone[trait.id]?.toFixed(2)}
              </Typography>
            </Grid>
          ))}
        </Grid>
        <Button variant="contained" onClick={handleToneSave} disabled={!isToneChanged}>
          Save Tone & Style
        </Button>
      </Paper>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Company Website
        </Typography>
        <TextField
          label="Website URL"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
        <Button variant="contained" onClick={handleWebsiteSave} disabled={!isWebsiteChanged}>
          Save Website
        </Button>
      </Paper>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Social Media & Job Posting Samples
        </Typography>
        <TextField
          label="Copy & Paste Social Media Content"
          value={socialSamples}
          onChange={(e) => setSocialSamples(e.target.value)}
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2 }}
        />
        <TextField
          label="Copy & Paste Job Postings"
          value={jobPostSamples}
          onChange={(e) => setJobPostSamples(e.target.value)}
          fullWidth
          multiline
          minRows={3}
          sx={{ mb: 2 }}
        />
        <Button
          variant="contained"
          onClick={handleSamplesSave}
          disabled={!isSamplesChanged || loading}
        >
          Save Samples
        </Button>
      </Paper>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Upload Handbooks & Guides (PDF)
        </Typography>
        <Button
          component="label"
          variant="outlined"
          startIcon={<CloudUploadIcon />}
          disabled={loading}
          sx={{ mb: 2 }}
        >
          Upload PDF
          <input
            type="file"
            hidden
            accept=".pdf"
            onChange={(e) => handleFileUpload(e.target.files ? e.target.files[0] : null)}
          />
        </Button>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>File</TableCell>
                <TableCell>Open</TableCell>
                <TableCell>Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>{doc.title}</TableCell>
                  <TableCell>{doc.fileName}</TableCell>
                  <TableCell>
                    <Button component="a" href={doc.url} target="_blank">
                      Open
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button color="error" onClick={() => handleDocDelete(doc.id, doc.storagePath)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Custom Prompts (max 3)
        </Typography>
        <Grid container spacing={2}>
          {[0, 1, 2].map((idx) => (
            <Grid item xs={12} key={idx}>
              <TextField
                label={`Prompt ${idx + 1}`}
                value={customPrompts[idx]}
                onChange={(e) => handlePromptChange(idx, e.target.value)}
                fullWidth
                multiline
                minRows={2}
                sx={{
                  mb: 2,
                  border: '2px solid #ff69b4',
                  boxShadow: '0 0 8px 2px #ff69b4',
                  borderRadius: 2,
                  '& .MuiOutlinedInput-root': {
                    '& fieldset': {
                      borderColor: '#ff69b4',
                      boxShadow: '0 0 8px 2px #ff69b4',
                    },
                    '&:hover fieldset': {
                      borderColor: '#ff69b4',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#ff69b4',
                      boxShadow: '0 0 12px 4px #ff69b4',
                    },
                  },
                }}
              />
            </Grid>
          ))}
        </Grid>
        <Button
          variant="contained"
          color="secondary"
          onClick={handlePromptsSave}
          disabled={!isPromptsChanged || loading}
          sx={{ mt: 1 }}
        >
          Save Custom Prompts
        </Button>
      </Paper>
      <Snackbar open={!!toneError} autoHideDuration={4000} onClose={() => setToneError('')}>
        <Alert severity="error" onClose={() => setToneError('')} sx={{ width: '100%' }}>
          {toneError}
        </Alert>
      </Snackbar>
      <Snackbar open={toneSuccess} autoHideDuration={2000} onClose={() => setToneSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Tone settings updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={websiteSuccess}
        autoHideDuration={2000}
        onClose={() => setWebsiteSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Website updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={samplesSuccess}
        autoHideDuration={2000}
        onClose={() => setSamplesSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Samples updated!
        </Alert>
      </Snackbar>
      <Snackbar
        open={promptsSuccess}
        autoHideDuration={2000}
        onClose={() => setPromptsSuccess(false)}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Custom prompts updated!
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Saved!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AITrainingTab;

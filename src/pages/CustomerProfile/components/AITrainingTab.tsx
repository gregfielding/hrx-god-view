import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Stepper, Step, StepLabel, Snackbar, Alert, Checkbox, FormControlLabel, Paper, TableContainer, Table, TableHead, TableBody, TableRow, TableCell
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { doc, getDoc, setDoc, addDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase';
import { collection } from 'firebase/firestore';

const steps = [
  'Brand & Culture',
  'Voice Calibration',
  'Goals & Outcomes',
  'Policy Embedding',
  'Finalize',
];

const AITrainingTab: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState({
    mission: '',
    coreValues: '',
    communicationStyle: '',
    hrMessagesFile: null as File | null,
    managerComm: '',
    avoidLanguage: '',
    goals: '',
    reinforce: '',
    success: '',
    policyFile: null as File | null,
    onboardingContent: '',
    autoGenerate: false,
    preview: '',
  });
  const [originalForm, setOriginalForm] = useState(form);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const storage = getStorage();
  const [docs, setDocs] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const docRef = doc(db, 'customers', customerId, 'aiTraining', 'main');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          setForm({
            mission: data.mission || '',
            coreValues: data.coreValues || '',
            communicationStyle: data.communicationStyle || '',
            hrMessagesFile: null,
            managerComm: data.managerComm || '',
            avoidLanguage: data.avoidLanguage || '',
            goals: data.goals || '',
            reinforce: data.reinforce || '',
            success: data.success || '',
            policyFile: null,
            onboardingContent: data.onboardingContent || '',
            autoGenerate: data.autoGenerate || false,
            preview: data.preview || '',
          });
          setOriginalForm({
            mission: data.mission || '',
            coreValues: data.coreValues || '',
            communicationStyle: data.communicationStyle || '',
            hrMessagesFile: null,
            managerComm: data.managerComm || '',
            avoidLanguage: data.avoidLanguage || '',
            goals: data.goals || '',
            reinforce: data.reinforce || '',
            success: data.success || '',
            policyFile: null,
            onboardingContent: data.onboardingContent || '',
            autoGenerate: data.autoGenerate || false,
            preview: data.preview || '',
          });
        }
        // Fetch docs
        const docsSnap = await getDocs(collection(db, 'customers', customerId, 'aiTraining', 'main', 'policyDocs'));
        setDocs(docsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        // ignore for now
      }
      setLoading(false);
    };
    fetchData();
    // eslint-disable-next-line
  }, [customerId]);

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileUpload = async (field: 'hrMessagesFile' | 'policyFile', file: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const fileRef = storageRef(storage, `customers/${customerId}/aiTraining/${field}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'customers', customerId, 'aiTraining', 'main', 'policyDocs'), {
        title: file.name,
        fileName: file.name,
        url,
        storagePath: fileRef.fullPath,
      });
      // Refetch docs
      const docsSnap = await getDocs(collection(db, 'customers', customerId, 'aiTraining', 'main', 'policyDocs'));
      setDocs(docsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
    setLoading(false);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'customers', customerId, 'aiTraining', 'main');
      await setDoc(docRef, {
        ...form,
        hrMessagesFile: undefined,
        policyFile: undefined,
      }, { merge: true });
      setOriginalForm(form);
      setSuccess(true);
    } catch {}
    setLoading(false);
  };

  const isChanged = JSON.stringify(form) !== JSON.stringify(originalForm);

  const handleDocDelete = async (id: string, storagePath: string) => {
    try {
      await deleteDoc(doc(db, 'customers', customerId, 'aiTraining', 'main', 'policyDocs', id));
      setDocs(docs.filter(d => d.id !== id));
    } catch {}
  };

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {activeStep === 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Brand & Culture</Typography>
          <TextField
            label="Company Mission Statement"
            value={form.mission}
            onChange={e => handleChange('mission', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Core Values (comma separated)"
            value={form.coreValues}
            onChange={e => handleChange('coreValues', e.target.value)}
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="Describe your ideal communication style"
            value={form.communicationStyle}
            onChange={e => handleChange('communicationStyle', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
        </Paper>
      )}
      {activeStep === 1 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Voice Calibration</Typography>
          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            disabled={loading}
            sx={{ mb: 2 }}
          >
            Upload Sample HR Messages
            <input
              type="file"
              hidden
              accept=".pdf,.doc,.docx,.txt"
              onChange={e => handleFileUpload('hrMessagesFile', e.target.files ? e.target.files[0] : null)}
            />
          </Button>
          <TextField
            label="Paste example manager-to-worker communication"
            value={form.managerComm}
            onChange={e => handleChange('managerComm', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Examples of language to AVOID (2–3 examples)"
            value={form.avoidLanguage}
            onChange={e => handleChange('avoidLanguage', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
        </Paper>
      )}
      {activeStep === 2 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Goals & Outcomes</Typography>
          <TextField
            label="Primary workforce goals this year"
            value={form.goals}
            onChange={e => handleChange('goals', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Behaviors/values to reinforce"
            value={form.reinforce}
            onChange={e => handleChange('reinforce', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            label="What would success look like after 6 months?"
            value={form.success}
            onChange={e => handleChange('success', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
        </Paper>
      )}
      {activeStep === 3 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Policy Embedding</Typography>
          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            disabled={loading}
            sx={{ mb: 2 }}
          >
            Upload Handbook/HR Policy/FAQ
            <input
              type="file"
              hidden
              accept=".pdf,.doc,.docx"
              multiple
              onChange={e => {
                if (e.target.files) {
                  Array.from(e.target.files).forEach(file => handleFileUpload('policyFile', file));
                }
              }}
            />
          </Button>
          <TextField
            label="Paste onboarding/training content"
            value={form.onboardingContent}
            onChange={e => handleChange('onboardingContent', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
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
                    <TableCell><Button component="a" href={doc.url} target="_blank">Open</Button></TableCell>
                    <TableCell><Button color="error" onClick={() => handleDocDelete(doc.id, doc.storagePath)}>Delete</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
      {activeStep === 4 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Finalize</Typography>
          <FormControlLabel
            control={<Checkbox checked={form.autoGenerate} onChange={e => handleChange('autoGenerate', e.target.checked)} />}
            label="Auto-generate tone & culture profile from inputs"
          />
          <TextField
            label="Preview Recommended Tone Profile"
            value={form.preview}
            onChange={e => handleChange('preview', e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
          />
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={loading || !isChanged}
          >
            Save
          </Button>
        </Paper>
      )}
      <Box display="flex" justifyContent="space-between" mt={3}>
        <Button disabled={activeStep === 0} onClick={() => setActiveStep(s => s - 1)}>Back</Button>
        <Button disabled={activeStep === steps.length - 1} onClick={() => setActiveStep(s => s + 1)}>Next</Button>
      </Box>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Saved!</Alert>
      </Snackbar>
    </Box>
  );
};

export default AITrainingTab; 